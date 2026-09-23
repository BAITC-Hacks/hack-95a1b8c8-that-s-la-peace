/**
 * Isolated client view. No network, ranking, sample profiles or fallback results.
 * Dependencies: loadMetadata() -> meta; recommend(request) -> API v1 result.
 * Errors may be thrown as {code, message, fields} or {error: {code, message, fields}}.
 * The caller owns transport, credentials and the API adapter.
 */
export function mountPicker(root, { loadMetadata, recommend } = {}) {
  if (!root || typeof root.replaceChildren !== "function") {
    throw new TypeError("mountPicker requires a DOM root element");
  }
  const doc = root.ownerDocument;
  const uid = `picker-${++mountSequence}`;
  let metadata = null;
  let generation = 0;
  let destroyed = false;
  let pending = false;
  let retryAction = null;

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  const shell = el("div", "site-shell");
  const skip = el("a", "skip-link", "К форме подбора");
  skip.href = `#${uid}-form`;
  const header = el("header", "site-header");
  const brand = el("div", "brand");
  const mark = el("span", "brand-mark");
  mark.setAttribute("aria-hidden", "true");
  brand.append(mark, el("span", "", "that's la peace"));
  header.append(brand, el("span", "header-note", "Люди и места для вашего события"));

  const main = el("main");
  const intro = el("section", "intro");
  const titleGroup = el("div");
  titleGroup.append(el("p", "eyebrow", "Подбор event-подрядчиков"), el("h1", "", "Подрядчики под ваше событие."));
  intro.append(titleGroup, el("p", "intro-copy", "Расскажите о мероприятии. Получите до трёх подходящих вариантов и понятное объяснение для каждого."));
  const workspace = el("div", "workspace");
  const brief = el("section", "brief-panel");
  const kicker = el("p", "panel-kicker");
  kicker.append(el("span", "step-number", "01"), el("span", "", "Ваше мероприятие"));
  brief.append(kicker, el("h2", "", "Начнём с деталей"), el("p", "panel-copy", "Пять обязательных полей. Язык и длительность можно уточнить дополнительно."));
  const form = el("form");
  form.id = `${uid}-form`;
  form.noValidate = true;
  const fieldset = el("fieldset", "picker-fieldset");
  fieldset.disabled = true;
  const grid = el("div", "field-grid");
  const fields = {};

  function makeField(name, label, type, wide = false, hint = "") {
    const wrap = el("div", wide ? "field field-wide" : "field");
    const input = el(type === "select" ? "select" : "input");
    input.name = name;
    input.id = `${uid}-${name}`;
    if (type !== "select") input.type = type;
    else {
      const placeholder = el("option", "", "Данные каталога");
      placeholder.value = "";
      input.append(placeholder);
    }
    const title = el("label", "", label);
    title.htmlFor = input.id;
    const error = el("p", "field-error");
    error.id = `${input.id}-error`;
    error.hidden = true;
    const described = [error.id];
    wrap.append(title, input);
    if (hint) {
      const help = el("p", "field-hint", hint);
      help.id = `${input.id}-hint`;
      described.push(help.id);
      wrap.append(help);
    }
    input.setAttribute("aria-describedby", described.join(" "));
    wrap.append(error);
    fields[name] = { input, error, wrap };
    return wrap;
  }

  grid.append(
    makeField("city", "Город", "select"),
    makeField("event_date", "Дата события", "date"),
    makeField("event_type", "Формат мероприятия", "select", true),
    makeField("category", "Кого или что ищем", "select", true),
    makeField("budget_kzt", "Бюджет, ₸", "number", true, "На одного подрядчика или площадку за мероприятие.")
  );
  fields.budget_kzt.input.placeholder = "Например, 1 000 000";
  fields.budget_kzt.input.step = "1";
  fields.budget_kzt.input.min = "1";
  fields.budget_kzt.input.inputMode = "numeric";
  for (const name of ["city", "event_date", "event_type", "category", "budget_kzt"]) fields[name].input.required = true;
  const optional = el("details", "optional-fields");
  optional.append(el("summary", "", "Язык и длительность · необязательно"));
  const optionalGrid = el("div", "field-grid");
  optionalGrid.append(makeField("language", "Язык", "select"), makeField("duration_hours", "Длительность, ч", "number"));
  fields.duration_hours.input.placeholder = "Не указана";
  fields.duration_hours.input.step = "any";
  fields.duration_hours.input.min = "0";
  fields.duration_hours.input.inputMode = "decimal";
  optional.append(optionalGrid);
  const submitButton = el("button", "submit-button");
  submitButton.type = "submit";
  const buttonLabel = el("span", "", "Подобрать варианты");
  const arrow = el("span", "submit-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  submitButton.append(buttonLabel, arrow);
  fieldset.append(grid, optional, submitButton);
  form.append(fieldset);
  const calendarNote = el("p", "form-note", "Доступные даты появятся после загрузки каталога.");
  brief.append(form, calendarNote);

  const results = el("section", "results-panel");
  results.setAttribute("aria-labelledby", `${uid}-results-title`);
  const resultsHeader = el("div", "results-heading");
  const resultsTitle = el("h2", "", "Ваши варианты");
  resultsTitle.id = `${uid}-results-title`;
  const resultsMeta = el("span", "results-meta", "До 3 рекомендаций");
  resultsHeader.append(resultsTitle, resultsMeta);
  const output = el("div");
  output.setAttribute("aria-live", "polite");
  output.setAttribute("aria-atomic", "false");
  const footnote = el("p", "section-footnote", "Цена «от» — нижняя граница из каталога. Итоговую стоимость и условия нужно уточнить у подрядчика.");
  results.append(resultsHeader, output, footnote);
  workspace.append(brief, results);
  main.append(intro, workspace);
  const footer = el("footer", "site-footer");
  footer.append(el("span", "", "That's La Peace · HackAlem AI · 2026"), el("span", "", "Подбор помогает выбрать. Бронирование в сервисе не предусмотрено."));
  shell.append(header, main, footer);
  root.replaceChildren(skip, shell);

  function setBusy(value) {
    pending = value;
    fieldset.disabled = value || !metadata || typeof recommend !== "function";
    form.setAttribute("aria-busy", String(value));
    buttonLabel.textContent = value && metadata ? "Подбираем варианты…" : "Подобрать варианты";
  }

  function clearErrors() {
    for (const { input, error } of Object.values(fields)) {
      input.removeAttribute("aria-invalid");
      error.textContent = "";
      error.hidden = true;
    }
  }

  function showFieldErrors(errors) {
    clearErrors();
    let first;
    for (const [name, message] of Object.entries(errors || {})) {
      if (!fields[name] || typeof message !== "string") continue;
      const { input, error } = fields[name];
      input.setAttribute("aria-invalid", "true");
      error.textContent = message;
      error.hidden = false;
      if (name === "language" || name === "duration_hours") optional.open = true;
      first ||= input;
    }
    first?.focus();
  }

  function showState(kind, title, message, retry = null) {
    const state = el("div", `result-state${kind === "error" ? " is-error" : kind === "loading" ? " is-loading" : ""}`);
    state.dataset.state = kind;
    const graphic = el("div", "state-graphic");
    graphic.setAttribute("aria-hidden", "true");
    state.append(graphic, el("h3", "", title), el("p", "state-copy", message));
    retryAction = retry;
    if (retry) {
      const retryButton = el("button", "retry-button", "Попробовать ещё раз");
      retryButton.type = "button";
      retryButton.addEventListener("click", () => { if (!pending && !destroyed) retryAction?.(); });
      state.append(retryButton);
    }
    output.replaceChildren(state);
  }

  function setOptions(name, values, placeholder) {
    const input = fields[name].input;
    const previous = input.value;
    const options = [el("option", "", placeholder)];
    options[0].value = "";
    for (const value of values) {
      const option = el("option", "", value);
      option.value = value;
      options.push(option);
    }
    input.replaceChildren(...options);
    if (values.includes(previous)) input.value = previous;
  }

  async function reloadMetadata() {
    if (destroyed) return;
    const current = ++generation;
    metadata = null;
    clearErrors();
    setBusy(true);
    showState("loading", "Загружаем каталог", "Проверяем доступные города, категории и календарь.");
    if (typeof loadMetadata !== "function" || typeof recommend !== "function") {
      setBusy(false);
      showState("unavailable", "Сервис подбора пока недоступен", "Подбор ещё не подключён. Рекомендации появятся, когда сервис станет доступен.", reloadMetadata);
      return;
    }
    try {
      const data = await withTimeout(() => loadMetadata());
      if (destroyed || current !== generation) return;
      validateMetadata(data);
      metadata = data;
      setOptions("city", data.cities, "Выберите город");
      setOptions("event_type", data.event_types, "Выберите формат");
      setOptions("category", data.categories, "Выберите категорию");
      setOptions("language", data.languages, "Без предпочтений");
      fields.event_date.input.min = data.date_range.min;
      fields.event_date.input.max = data.date_range.max;
      calendarNote.textContent = `Календарь занятости: ${displayDate(data.date_range.min)} — ${displayDate(data.date_range.max)}.`;
      resultsMeta.textContent = `${data.dataset_count} профилей в каталоге`;
      setBusy(false);
      showState("idle", "Ваше событие начинается с выбора", "Укажите детали мероприятия. Здесь появятся подходящие люди и места — с объяснениями по вашему запросу.");
    } catch {
      if (destroyed || current !== generation) return;
      setBusy(false);
      showState("unavailable", "Сервис подбора пока недоступен", "Не удалось загрузить каталог. Попробуйте ещё раз немного позже.", reloadMetadata);
    }
  }

  function readRequest() {
    const values = Object.fromEntries(Object.entries(fields).map(([name, { input }]) => [name, input.value.trim()]));
    const errors = {};
    for (const [name, source, message] of [
      ["city", "cities", "Выберите город из каталога."],
      ["category", "categories", "Выберите категорию из каталога."],
      ["event_type", "event_types", "Выберите формат мероприятия."]
    ]) {
      if (!metadata[source].includes(values[name])) errors[name] = message;
    }
    if (!isISODate(values.event_date)) errors.event_date = "Укажите реальную дату мероприятия.";
    else if (values.event_date < metadata.date_range.min || values.event_date > metadata.date_range.max) {
      errors.event_date = `Выберите дату с ${displayDate(metadata.date_range.min)} по ${displayDate(metadata.date_range.max)}.`;
    }
    const budget = Number(values.budget_kzt);
    if (!values.budget_kzt || !Number.isSafeInteger(budget) || budget <= 0) errors.budget_kzt = "Укажите целый бюджет больше нуля, не превышающий 9 007 199 254 740 991 ₸.";
    const duration = values.duration_hours ? Number(values.duration_hours) : null;
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) errors.duration_hours = "Укажите число часов больше нуля или оставьте поле пустым.";
    if (values.language && !metadata.languages.includes(values.language)) errors.language = "Выберите язык из каталога.";
    return {
      errors,
      request: {
        city: values.city, event_date: values.event_date, event_type: values.event_type,
        category: values.category, budget_kzt: budget, duration_hours: duration,
        language: values.language || null
      }
    };
  }

  function renderResult(data, request) {
    validateResult(data);
    const summary = el("div", "results-summary");
    summary.dataset.state = data.status;
    const titles = {
      matched: "Подобрали для вас",
      no_category_in_city: "В этом городе нет такой категории",
      no_matches: "Кандидаты есть, но не подходят по условиям"
    };
    summary.append(el("h3", "", titles[data.status]), el("p", "", data.message));
    summary.append(el("p", "request-summary", `${request.city} · ${request.category} · ${displayDate(request.event_date)} · ${request.event_type}`));
    const modeLabels = {
      deterministic: "Объяснения составлены по правилам на основе данных каталога.",
      llm: "Формулировки объяснений подготовлены языковой моделью на основе профилей.",
      deterministic_fallback: "Языковая модель недоступна. Объяснения составлены по правилам на основе данных каталога."
    };
    if (modeLabels[data.explanation_mode]) {
      const mode = el("p", "explanation-mode", modeLabels[data.explanation_mode]);
      mode.dataset.explanationMode = data.explanation_mode;
      summary.append(mode);
    }
    const nodes = [summary];
    const cards = data.cards.slice(0, 3);
    if (cards.length) {
      const list = el("ol", "cards");
      for (const card of cards) {
        const item = el("li", "contractor-card");
        item.dataset.profileId = String(card.id);
        const top = el("div", "card-top");
        const identity = el("div");
        identity.append(el("p", "card-category", card.category), el("h3", "", card.name), el("p", "card-city", card.city));
        const price = el("p", "card-price", `от ${money.format(card.price_from_kzt)} ₸`);
        price.append(el("span", "price-note", "за мероприятие"));
        top.append(identity, price);
        const explanation = el("div", "explanation");
        explanation.append(el("p", "explanation-label", "Почему подходит"), el("p", "", card.explanation));
        item.append(top, explanation);
        const facts = el("div", "profile-facts");
        if (Array.isArray(card.languages) && card.languages.every(value => typeof value === "string")) {
          facts.append(el("p", "profile-languages", `Языки: ${card.languages.length ? card.languages.join(", ") : "не указаны"}.`));
        }
        if (card.max_hours === null) facts.append(el("p", "profile-duration", "Присутствие по часам неприменимо."));
        else if (Number.isFinite(card.max_hours) && card.max_hours > 0) facts.append(el("p", "profile-duration", `На площадке: до ${money.format(card.max_hours)} ч.`));
        if (facts.childElementCount) item.append(facts);
        if (typeof card.description_excerpt === "string" && card.description_excerpt.trim()) {
          const excerpt = el("details", "profile-excerpt");
          excerpt.append(el("summary", "", "Из описания профиля"), el("p", "", card.description_excerpt));
          item.append(excerpt);
        }
        const flags = el("div", "data-flags");
        if (card.source === "provided") flags.append(el("span", "data-flag data-source", "Исходный каталог"));
        if (card.source === "team_added") flags.append(el("span", "data-flag data-source", "Добавлено командой"));
        if (card.synthetic) flags.append(el("span", "data-flag synthetic", "Синтетический профиль в каталоге"));
        if (card.city_imputed) flags.append(el("span", "data-flag", "Город проставлен при подготовке данных"));
        if (card.price_imputed) flags.append(el("span", "data-flag", "Цена проставлена при подготовке данных"));
        if (flags.childElementCount) item.append(flags);
        list.append(item);
      }
      nodes.push(list);
    }
    const counts = el("p", "request-summary", `В этой категории и городе: ${data.total_in_city_category}. Подходят по условиям: ${data.eligible_count}. Показано: ${cards.length}.`);
    nodes.push(counts);
    const exclusions = el("ul", "exclusion-list");
    for (const [key, label] of Object.entries(exclusionLabels)) {
      const count = data.exclusions?.[key];
      if (Number.isInteger(count) && count > 0) exclusions.append(el("li", "", `${label}: ${count}`));
    }
    if (exclusions.childElementCount) {
      nodes.push(exclusions, el("p", "exclusion-note", "Один профиль может не подходить по нескольким причинам. Эти числа не складываются."));
    }
    if (data.status === "no_matches" && Array.isArray(data.suggestions)) {
      const suggestions = el("section", "suggestions");
      suggestions.setAttribute("aria-label", "Можно изменить условия");
      suggestions.append(el("h3", "", "Можно изменить условия"), el("p", "suggestions-intro", "Изменим только выбранное условие после вашего нажатия."));
      const seen = new Set();
      const responseGeneration = generation;
      for (const suggestion of data.suggestions) {
        if (seen.size >= 2 || !isValidSuggestion(suggestion, request, metadata) || seen.has(suggestion.kind)) continue;
        seen.add(suggestion.kind);
        const alternative = el("div", "suggestion");
        alternative.dataset.suggestionKind = suggestion.kind;
        alternative.append(el("p", "suggestion-message", suggestion.message));
        alternative.append(el("p", "suggestion-count", `По проверке сервиса подходят: ${suggestion.eligible_count}.`));
        const button = el("button", "suggestion-button", suggestion.kind === "change_date"
          ? `Выбрать дату ${displayDate(suggestion.request.event_date)}`
          : `Увеличить бюджет до ${money.format(suggestion.request.budget_kzt)} ₸`);
        button.type = "button";
        button.dataset.suggestionKind = suggestion.kind;
        button.addEventListener("click", () => {
          if (destroyed || pending || !metadata || generation !== responseGeneration || !isValidSuggestion(suggestion, request, metadata)) return;
          const current = readRequest();
          if (Object.keys(current.errors).length || requestKeys.some(key => current.request[key] !== request[key])) return;
          for (const key of requestKeys) fields[key].input.value = suggestion.request[key] === null ? "" : String(suggestion.request[key]);
          submit();
        });
        alternative.append(button);
        if (suggestion.kind === "increase_budget") alternative.append(el("p", "suggestion-note", "Новый бюджет сравнивается с ценой «от», не с подтверждённой стоимостью заказа."));
        suggestions.append(alternative);
      }
      if (seen.size) nodes.push(suggestions);
    }
    output.replaceChildren(...nodes);
  }

  async function submit(event) {
    event?.preventDefault();
    if (destroyed || pending || !metadata || typeof recommend !== "function") return;
    clearErrors();
    const { request, errors } = readRequest();
    if (Object.keys(errors).length) {
      showFieldErrors(errors);
      showState("invalid", "Проверьте детали мероприятия", "Исправьте отмеченные поля. Остальные значения сохранены.");
      return;
    }
    const current = ++generation;
    setBusy(true);
    showState("loading", "Ищем подходящие варианты", "Учитываем параметры запроса и занятость на выбранную дату.");
    try {
      const data = await withTimeout(() => recommend(request));
      if (destroyed || current !== generation) return;
      if (data?.error) throw data.error;
      renderResult(data, request);
      setBusy(false);
    } catch (caught) {
      if (destroyed || current !== generation) return;
      setBusy(false);
      const error = caught?.error || caught;
      if (error?.code === "invalid_request") {
        showFieldErrors(error.fields);
        showState("invalid", "Проверьте детали мероприятия", typeof error.message === "string" && error.message.trim() ? error.message : "Сервис не смог принять запрос. Проверьте отмеченные поля.");
      } else {
        showState("error", "Не удалось выполнить подбор", "Сервис временно недоступен. Ваши параметры сохранены — попробуйте ещё раз.", submit);
      }
    }
  }

  function onInput(event) {
    if (destroyed || pending || !metadata) return;
    const field = fields[event.target.name];
    if (field) {
      field.input.removeAttribute("aria-invalid");
      field.error.textContent = "";
      field.error.hidden = true;
    }
    showState("edited", "Детали изменены", "Запустите подбор, чтобы получить варианты по новым условиям.");
  }

  form.addEventListener("submit", submit);
  form.addEventListener("input", onInput);
  const ready = reloadMetadata();
  return {
    ready,
    reloadMetadata,
    submit,
    destroy() {
      destroyed = true;
      ++generation;
      form.removeEventListener("submit", submit);
      form.removeEventListener("input", onInput);
      root.replaceChildren();
    }
  };
}

let mountSequence = 0;
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const exclusionLabels = {
  busy: "Заняты на дату", budget: "Выше бюджета", event_type: "Другой формат",
  language: "Не подходит язык", duration: "Не подходит длительность"
};
const requestKeys = ["city", "event_date", "event_type", "category", "budget_kzt", "duration_hours", "language"];

function isValidSuggestion(suggestion, original, meta) {
  if (!suggestion || !["change_date", "increase_budget"].includes(suggestion.kind) || typeof suggestion.message !== "string" || !suggestion.message.trim() || !Number.isSafeInteger(suggestion.eligible_count) || suggestion.eligible_count <= 0) return false;
  const request = suggestion.request;
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== requestKeys.length || requestKeys.some(key => !Object.hasOwn(request, key))) return false;
  if (!meta.cities.includes(request.city) || !meta.categories.includes(request.category) || !meta.event_types.includes(request.event_type)) return false;
  if (!isISODate(request.event_date) || request.event_date < meta.date_range.min || request.event_date > meta.date_range.max) return false;
  if (!Number.isSafeInteger(request.budget_kzt) || request.budget_kzt <= 0) return false;
  if (request.duration_hours !== null && (typeof request.duration_hours !== "number" || !Number.isFinite(request.duration_hours) || request.duration_hours <= 0)) return false;
  if (request.language !== null && !meta.languages.includes(request.language)) return false;
  const changed = requestKeys.filter(key => request[key] !== original[key]);
  const allowed = suggestion.kind === "change_date" ? "event_date" : "budget_kzt";
  return changed.length === 1 && changed[0] === allowed && (allowed !== "budget_kzt" || request.budget_kzt > original.budget_kzt);
}

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function displayDate(value) { return value.split("-").reverse().join("."); }

function validateMetadata(meta) {
  if (!meta || !Number.isInteger(meta.dataset_count) || meta.dataset_count < 0) throw new Error("Invalid metadata");
  for (const key of ["cities", "categories", "event_types", "languages"]) {
    if (!Array.isArray(meta[key]) || (key !== "languages" && !meta[key].length) || meta[key].some(value => typeof value !== "string" || !value.trim())) throw new Error("Invalid metadata");
  }
  if (!isISODate(meta.date_range?.min) || !isISODate(meta.date_range?.max) || meta.date_range.min > meta.date_range.max) throw new Error("Invalid calendar");
}

function validateResult(result) {
  if (!result || !["matched", "no_category_in_city", "no_matches"].includes(result.status) || typeof result.message !== "string" || !result.message.trim() || !Array.isArray(result.cards)) throw new Error("Invalid result");
  if (!Number.isInteger(result.eligible_count) || !Number.isInteger(result.total_in_city_category) || result.eligible_count < result.cards.length || result.total_in_city_category < result.eligible_count) throw new Error("Invalid counts");
  if ((result.status === "matched") !== (result.cards.length > 0)) throw new Error("Inconsistent result");
  if (result.status === "no_category_in_city" && result.total_in_city_category !== 0) throw new Error("Inconsistent category count");
  if (result.status === "no_matches" && (result.total_in_city_category === 0 || result.eligible_count !== 0)) throw new Error("Inconsistent match count");
  const ids = new Set();
  for (const card of result.cards) {
    if (!card || ["id", "name", "category", "city", "explanation"].some(key => typeof card[key] !== "string" || !card[key].trim()) || !Number.isFinite(card.price_from_kzt) || card.price_from_kzt <= 0 || ["synthetic", "city_imputed", "price_imputed"].some(key => typeof card[key] !== "boolean") || ids.has(card.id)) throw new Error("Invalid card");
    ids.add(card.id);
  }
}

async function withTimeout(operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Service timeout")), 12000); })
    ]);
  } finally { clearTimeout(timer); }
}
