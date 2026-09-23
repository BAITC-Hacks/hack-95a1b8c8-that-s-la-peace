import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi, validateMetadata, validateResult} from '../../frontend/api.mjs';

// Deliberately synthetic transport fixtures. These do not test the real backend,
// ranking, availability or AI and are never imported by the application.
const meta = {api_version: 1, dataset_version: 'a'.repeat(64), cities: ['Алматы'], categories: ['Ведущий'], event_types: ['корпоратив'], languages: ['русский'], dataset_count: 66, date_range: {min: '2026-09-23', max: '2026-12-31'}};
const card = id => ({id, name: `Тест ${id}`, category: 'Ведущий', city: 'Алматы', price_from_kzt: 100000, explanation: 'Тестовое объяснение для проверки интерфейса.', synthetic: true, city_imputed: false, price_imputed: false, languages: ['русский'], max_hours: 4, description_excerpt: 'Синтетический тестовый фрагмент.', source: 'provided'});
const result = {api_version: 1, dataset_version: 'a'.repeat(64), explanation_mode: 'deterministic', suggestions: [], status: 'matched', message: 'Найдено два профиля.', cards: [card('z'), card('a')], total_in_city_category: 3, eligible_count: 2, exclusions: {busy: 1, budget: 0, event_type: 0, language: 0, duration: 0}};
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json; charset=utf-8'}});

test('transport uses agreed routes and JSON, no cookies; preserves backend order', async () => {
  const calls = [];
  const api = createApi({fetchImpl: async (path, init) => {calls.push({path, init}); return response(path.endsWith('/meta') ? meta : result);}});
  assert.deepEqual(await api.loadMetadata(), meta);
  const request = {city: 'Алматы', event_date: '2026-10-15', event_type: 'корпоратив', category: 'Ведущий', budget_kzt: 1000000, duration_hours: null, language: null};
  const actual = await api.recommend(request);
  assert.deepEqual(actual.cards.map(x => x.id), ['z', 'a']);
  assert.equal(calls[0].path, '/api/meta');
  assert.equal(calls[1].path, '/api/recommendations');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), request);
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.redirect, 'error');
});

test('normal empty results remain successful distinct outcomes', async () => {
  for (const [status, total] of [['no_category_in_city', 0], ['no_matches', 3]]) {
    const empty = {...result, status, cards: [], eligible_count: 0, total_in_city_category: total, exclusions: {busy: 0, budget: 0, event_type: 0, language: 0, duration: 0}};
    assert.equal((await createApi({fetchImpl: async () => response(empty)}).recommend({})).status, status);
  }
});

test('422 provides only known field errors', async () => {
  const api = createApi({fetchImpl: async () => response({error: {code: 'invalid_request', message: 'Проверьте дату.', fields: {event_date: 'Вне окна.', unknown: 'discard', budget_kzt: 3}}}, 422)});
  await assert.rejects(api.recommend({}), error => error.code === 'invalid_request' && error.message === 'Проверьте дату.' && JSON.stringify(error.fields) === JSON.stringify({event_date: 'Вне окна.'}));
});

test('network errors and server details are masked; no fallback successful cards', async () => {
  for (const fetchImpl of [async () => {throw new Error('private internal detail');}, async () => response({detail: 'private internal detail'}, 503), async () => new Response('<html>error</html>')]) {
    const api = createApi({fetchImpl});
    await assert.rejects(api.recommend({}), error => error.code === 'service_unavailable' && !error.message.includes('private'));
  }
});

test('timeout cancels a hanging request', async () => {
  let aborted = false;
  const api = createApi({timeoutMs: 10, fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {aborted = true; reject(new Error('aborted'));});
  })});
  await assert.rejects(api.loadMetadata(), {code: 'service_unavailable'});
  assert.equal(aborted, true);
});

test('malformed metadata cannot promise availability outside a real date window', () => {
  assert.equal(validateMetadata(meta), meta);
  for (const bad of [{...meta, cities: []}, {...meta, date_range: {min: '2026-11-31', max: '2026-12-31'}}, {...meta, date_range: {min: '2027-01-01', max: '2026-12-31'}}]) {
    assert.throws(() => validateMetadata(bad), {code: 'service_unavailable'});
  }
});

test('malformed successful payloads are rejected instead of silently truncated or reordered', () => {
  const cases = [
    {...result, cards: [card('a'), card('a')]},
    {...result, cards: [card('1'), card('2'), card('3'), card('4')], eligible_count: 4, total_in_city_category: 4},
    {...result, cards: [{...card('a'), synthetic: 'False'}, card('b')]},
    {...result, status: 'no_matches'},
    {...result, eligible_count: 0},
    {...result, cards: [card('a')]},
  ];
  for (const bad of cases) assert.throws(() => validateResult(bad), {code: 'service_unavailable'});
});

test('published v1 version and dataset identity remain consistent across requests', async () => {
  const api = createApi({fetchImpl: async path => response(path.endsWith('/meta') ? meta : {...result, dataset_version: 'b'.repeat(64)})});
  await api.loadMetadata();
  await assert.rejects(api.recommend({}), {code: 'service_unavailable'});
  assert.throws(() => validateMetadata({...meta, api_version: 2}), {code: 'service_unavailable'});
  assert.throws(() => validateResult({...result, explanation_mode: 'unknown'}), {code: 'service_unavailable'});
});

test('suggestions must change exactly one permitted condition and preserve the complete request', () => {
  const request = {city: 'Алматы', event_date: '2026-10-15', event_type: 'корпоратив', category: 'Ведущий', budget_kzt: 1000000, duration_hours: null, language: null};
  const suggestion = {kind: 'change_date', message: 'Тест: другая дата.', request: {...request, event_date: '2026-10-16'}, eligible_count: 1};
  const empty = {...result, status: 'no_matches', cards: [], eligible_count: 0, suggestions: [suggestion]};
  assert.equal(validateResult(empty, request, meta), empty);
  for (const bad of [
    {...suggestion, request: {...suggestion.request, city: 'Астана'}},
    {...suggestion, request: {...suggestion.request, event_date: '2027-01-01'}},
    {...suggestion, eligible_count: 0},
    {...suggestion, kind: 'increase_budget', request: {...request, budget_kzt: 1}},
  ]) assert.throws(() => validateResult({...empty, suggestions: [bad]}, request, meta), {code: 'service_unavailable'});
});
