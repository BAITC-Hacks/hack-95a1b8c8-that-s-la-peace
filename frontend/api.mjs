// API v1 agreed in TASK_SPLIT.md. No provider credentials belong in this client.
export class ApiError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
  }
}

const unavailable = () => new ApiError('service_unavailable', 'Сервис подбора временно недоступен. Попробуйте ещё раз.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim());
const count = value => Number.isInteger(value) && value >= 0;
const version = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validateMetadata(meta) {
  if (!object(meta) || meta.api_version !== 1 || !version(meta.dataset_version)
      || !['cities', 'categories', 'event_types', 'languages'].every(key => strings(meta[key]))
      || !count(meta.dataset_count) || !object(meta.date_range)
      || !validDate(meta.date_range.min) || !validDate(meta.date_range.max)
      || meta.date_range.min > meta.date_range.max) throw unavailable();
  return meta;
}

export function validateResult(result, request, metadata) {
  const statuses = ['matched', 'no_category_in_city', 'no_matches'];
  if (!object(result) || result.api_version !== 1 || !version(result.dataset_version)
      || (metadata && result.dataset_version !== metadata.dataset_version)
      || !['deterministic', 'llm', 'deterministic_fallback'].includes(result.explanation_mode)
      || !Array.isArray(result.suggestions) || result.suggestions.length > 2
      || !statuses.includes(result.status) || typeof result.message !== 'string' || !result.message.trim()
      || !Array.isArray(result.cards) || result.cards.length > 3
      || !count(result.total_in_city_category) || !count(result.eligible_count)
      || result.eligible_count > result.total_in_city_category || !object(result.exclusions)
      || !['busy', 'budget', 'event_type', 'language', 'duration'].every(key => count(result.exclusions[key]))) throw unavailable();
  if (result.status === 'matched' && (result.cards.length === 0 || result.cards.length !== Math.min(3, result.eligible_count))) throw unavailable();
  if (result.status !== 'matched' && (result.cards.length !== 0 || result.eligible_count !== 0)) throw unavailable();
  if (result.status === 'no_category_in_city' && result.total_in_city_category !== 0) throw unavailable();
  if (result.status === 'no_matches' && result.total_in_city_category === 0) throw unavailable();
  if (result.status !== 'no_matches' && result.suggestions.length) throw unavailable();
  if (result.status === 'no_category_in_city' && Object.values(result.exclusions).some(value => value !== 0)) throw unavailable();
  const ids = new Set();
  for (const card of result.cards) {
    if (!object(card) || !['id', 'name', 'category', 'city', 'explanation'].every(key => typeof card[key] === 'string' && card[key].trim())
        || !Number.isSafeInteger(card.price_from_kzt) || card.price_from_kzt < 0
        || !['synthetic', 'city_imputed', 'price_imputed'].every(key => typeof card[key] === 'boolean')
        || !strings(card.languages) || !(card.max_hours === null || (Number.isFinite(card.max_hours) && card.max_hours > 0))
        || typeof card.description_excerpt !== 'string' || !card.description_excerpt.trim()
        || !['provided', 'team_added'].includes(card.source)
        || ids.has(card.id)) throw unavailable();
    ids.add(card.id);
  }
  const kinds = new Set();
  for (const suggestion of result.suggestions) {
    if (!request || !object(suggestion) || !['change_date', 'increase_budget'].includes(suggestion.kind)
        || kinds.has(suggestion.kind) || !Number.isInteger(suggestion.eligible_count) || suggestion.eligible_count <= 0
        || typeof suggestion.message !== 'string' || !suggestion.message.trim() || !object(suggestion.request)) throw unavailable();
    kinds.add(suggestion.kind);
    const next = suggestion.request;
    const keys = ['city', 'event_date', 'event_type', 'category', 'budget_kzt', 'duration_hours', 'language'];
    if (Object.keys(next).length !== keys.length || keys.some(key => !(key in next))) throw unavailable();
    const changes = keys.filter(key => next[key] !== (request[key] ?? null));
    const changedField = suggestion.kind === 'change_date' ? 'event_date' : 'budget_kzt';
    if (changes.length !== 1 || changes[0] !== changedField) throw unavailable();
    if (!validDate(next.event_date) || (metadata && (next.event_date < metadata.date_range.min || next.event_date > metadata.date_range.max))
        || !Number.isSafeInteger(next.budget_kzt) || next.budget_kzt <= 0
        || (suggestion.kind === 'increase_budget' && next.budget_kzt <= request.budget_kzt)) throw unavailable();
  }
  if (result.suggestions.length === 2 && result.suggestions[0].kind !== 'change_date') throw unavailable();
  return result;
}

export function createApi({fetchImpl = globalThis.fetch, timeoutMs = 12000} = {}) {
  let metadata;
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {Accept: 'application/json'} : {Accept: 'application/json', 'Content-Type': 'application/json'},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      if (response.status === 422) {
        const data = await response.json();
        if (!object(data?.error) || data.error.code !== 'invalid_request') throw unavailable();
        const fields = object(data.error.fields)
          ? Object.fromEntries(Object.entries(data.error.fields).filter(([key, value]) =>
            ['city', 'event_date', 'event_type', 'category', 'budget_kzt', 'duration_hours', 'language'].includes(key) && typeof value === 'string'))
          : {};
        throw new ApiError('invalid_request', typeof data.error.message === 'string' ? data.error.message : 'Проверьте параметры запроса.', fields);
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw unavailable();
      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    loadMetadata: async () => (metadata = validateMetadata(await request('/api/meta'))),
    recommend: async input => validateResult(await request('/api/recommendations', input), input, metadata),
  };
}
