import {enhanceSelect} from './search-select.mjs';
import {localizeTree, translate} from './i18n.mjs';

/**
 * Isolated client view. No network, ranking, sample profiles or fallback results.
 * Dependencies: loadMetadata() -> meta; recommend(request) -> API v1 result;
 * optional loadGuide() -> versioned local aggregate reference, never cards.
 * Errors may be thrown as {code, message, fields} or {error: {code, message, fields}}.
 * The caller owns transport, credentials and the API adapter.
 */
export function mountPicker(root, { loadMetadata, recommend, loadGuide } = {}) {
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
  let autoTimer;
  let locale = 'ru';
  let guide = null;
  const searchControls = new Map();
  const view = doc.defaultView;
  try { locale = ['ru', 'kk', 'en'].includes(view.localStorage.getItem('tlp-locale')) ? view.localStorage.getItem('tlp-locale') : 'ru'; } catch {}

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
  const localeWrap = el('label', 'locale-switch', 'Язык интерфейса');
  const localeSelect = el('select');
  localeSelect.setAttribute('aria-label', 'Язык интерфейса');
  for (const [value, label] of [['ru','Русский'], ['kk','Қазақша'], ['en','English']]) {
    const option = el('option', '', label); option.value = value; localeSelect.append(option);
  }
  localeSelect.value = locale;
  localeWrap.append(localeSelect); header.append(localeWrap);

  const main = el("main");
  const intro = el("section", "intro");
  const titleGroup = el("div");
  titleGroup.append(el("p", "eyebrow", "Подбор event-подрядчиков"), el("h1", "", "Подрядчики под ваше событие."));
  intro.append(titleGroup, el("p", "intro-copy", "Расскажите о мероприятии. Получите до трёх подходящих вариантов и понятное объяснение для каждого."));
  const workspace = el("div", "workspace");
  const brief = el("section", "brief-panel");
  brief.append(el("h2", "", "Ваше мероприятие"));
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
    fields[name] = { input, error, wrap, label };
    return wrap;
  }

  grid.append(
    makeField("city", "Город", "select", true),
    makeField("event_date", "Дата события", "hidden", true),
    makeField("event_type", "Формат мероприятия", "select", true),
    makeField("category", "Какая услуга нужна", "select", true),
    makeField("budget_kzt", "Бюджет, ₸", "text", true, "На одного подрядчика или площадку за мероприятие.")
  );
  const dateText = el('input', 'date-text');
  dateText.id = `${uid}-date-text`;
  dateText.type = 'text'; dateText.name = 'event_date_text'; dateText.inputMode = 'numeric'; dateText.required = true;
  dateText.placeholder = 'ДД.ММ.ГГГГ'; dateText.autocomplete = 'off';
  dateText.setAttribute('aria-describedby', fields.event_date.error.id);
  dateText.addEventListener('blur', () => {
    if (isISODate(fields.event_date.input.value)) dateText.value = displayDate(fields.event_date.input.value);
  });
  const dateEntry = el('div', 'date-entry');
  fields.event_date.wrap.classList.add('date-field');
  fields.event_date.wrap.querySelector('label').htmlFor = dateText.id;
  const dateToggle = el('button', 'date-toggle');
  const calendarIcon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','aria-hidden':'true'})) calendarIcon.setAttribute(key, value);
  const calendarPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  calendarPath.setAttribute('d', 'M7 3v4M17 3v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z');
  calendarIcon.append(calendarPath); dateToggle.append(calendarIcon);
  dateToggle.type = 'button'; dateToggle.setAttribute('aria-label', 'Открыть календарь');
  dateToggle.setAttribute('aria-expanded', 'false'); dateToggle.setAttribute('aria-controls', `${uid}-calendar`);
  const dateCalendar = el('div', 'date-calendar');
  dateCalendar.id = `${uid}-calendar`; dateCalendar.hidden = true;
  dateCalendar.setAttribute('role', 'group'); dateCalendar.setAttribute('aria-label', 'Выбор даты');
  let calendarMonth = '';
  fields.event_date.input.after(dateEntry, dateCalendar);
  dateEntry.append(dateText, dateToggle);
  dateToggle.addEventListener('click', () => {
    if (!metadata) return;
    const opening = dateCalendar.hidden;
    dateCalendar.hidden = !opening; dateToggle.setAttribute('aria-expanded', String(opening));
    if (opening) {
      calendarMonth = (fields.event_date.input.value || metadata.date_range.min).slice(0, 7);
      renderCalendar();
    }
  });
  function closeCalendar() { dateCalendar.hidden = true; dateToggle.setAttribute('aria-expanded', 'false'); }
  fields.event_date.wrap.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dateCalendar.hidden) { event.preventDefault(); closeCalendar(); dateToggle.focus(); }
  });
  function closeCalendarOutside(event) { if (!fields.event_date.wrap.contains(event.target)) closeCalendar(); }
  doc.addEventListener('pointerdown', closeCalendarOutside);
  // Replacing a month's buttons briefly removes the focused node. Only an
  // actual focus move outside the date field should close this inline picker.
  doc.addEventListener('focusin', closeCalendarOutside);
  const compatibilityWrap = el('label', 'compatibility-toggle');
  const compatibilityInput = el('input'); compatibilityInput.type = 'checkbox'; compatibilityInput.checked = true;
  compatibilityWrap.hidden = true;
  compatibilityWrap.append(compatibilityInput, el('span', '', 'Скрывать несовместимые категории и форматы'));
  compatibilityInput.addEventListener('change', () => { updateCategoryOptions(); updateFormatOptions(); refreshLanguage(); });
  fields.budget_kzt.input.placeholder = "Например, 1 000 000";
  fields.budget_kzt.input.step = "1";
  fields.budget_kzt.input.min = "1";
  fields.budget_kzt.input.inputMode = "numeric";
  for (const name of ["city", "event_date", "event_type", "category", "budget_kzt"]) fields[name].input.required = true;
  const optional = el("details", "optional-fields");
  optional.append(el("summary", "", "Язык и длительность · необязательно"));
  const optionalGrid = el("div", "field-grid");
  optionalGrid.append(makeField("language", "Язык", "select", true), makeField("duration_hours", "Длительность, ч", "number"));
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
  const autoWrap = el('label', 'auto-toggle');
  const autoInput = el('input'); autoInput.type = 'checkbox'; autoInput.checked = true;
  autoInput.setAttribute('aria-label', 'Обновлять варианты автоматически');
  autoWrap.append(autoInput, el('span', '', 'Обновлять варианты автоматически'));
  const settings = el('details', 'form-settings');
  settings.append(el('summary', '', 'Настройки подбора'), autoWrap, compatibilityWrap);
  const priceGuide = el('aside', 'price-guide');
  priceGuide.hidden = true;
  fieldset.append(grid, priceGuide, optional, settings, submitButton);
  form.append(fieldset);
  const calendarNote = el("p", "form-note", "Доступные даты появятся после загрузки каталога.");
  dateCalendar.append(calendarNote);
  brief.append(form);

  const results = el("section", "results-panel");
  results.setAttribute("aria-labelledby", `${uid}-results-title`);
  const resultsHeader = el("div", "results-heading");
  const resultsTitle = el("h2", "", "Ваши варианты");
  resultsTitle.id = `${uid}-results-title`;
  const resultsMeta = el("span", "results-meta", "До 3 рекомендаций");
  resultsHeader.append(resultsTitle, resultsMeta);
  const catalogNotice = el("p", "catalog-notice", "Демонстрационный каталог. Имена изменены.");
  const sourceLanguage = el('p', 'catalog-notice', 'Описания и объяснения каталога приведены на русском языке.');
  const output = el("div");
  output.setAttribute("aria-live", "polite");
  output.setAttribute("aria-atomic", "false");
  const footnote = el("p", "section-footnote", "Цена «от» — нижняя граница из каталога. Итоговую стоимость и условия нужно уточнить у подрядчика.");
  results.append(resultsHeader, catalogNotice, sourceLanguage, output, footnote);
  workspace.append(brief, results);
  main.append(intro, workspace);
  const footer = el("footer", "site-footer");
  footer.append(el("span", "", "That's La Peace · HackAlem AI · 2026"), el("span", "", "Подбор помогает выбрать. Бронирование в сервисе не предусмотрено."));
  shell.append(header, main, footer);
  root.replaceChildren(skip, shell);

  function refreshLanguage() {
    doc.documentElement.lang = locale;
    sourceLanguage.hidden = locale === 'ru';
    localizeTree(root, locale);
  }
  localeSelect.addEventListener('change', () => {
    locale = localeSelect.value;
    try { view.localStorage.setItem('tlp-locale', locale); } catch {}
    refreshLanguage();
    for (const control of searchControls.values()) control.refreshLanguage?.();
    if (!dateCalendar.hidden) renderCalendar();
  });
  autoInput.addEventListener('change', () => {
    clearTimeout(autoTimer);
    if (autoInput.checked) scheduleAutomatic();
  });

  function setBusy(value) {
    pending = value;
    fieldset.disabled = !metadata || typeof recommend !== "function";
    submitButton.disabled = value || !metadata;
    form.setAttribute("aria-busy", String(value));
    buttonLabel.textContent = value && metadata ? "Подбираем варианты…" : "Подобрать варианты";
    refreshLanguage();
  }

  function clearErrors() {
    dateText.removeAttribute('aria-invalid');
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
      if (name === 'event_date') dateText.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      error.hidden = false;
      if (name === "language" || name === "duration_hours") optional.open = true;
      first ||= name;
    }
    if (first === 'event_date') dateText.focus();
    else if (searchControls.has(first)) searchControls.get(first).focus();
    else if (first) fields[first].input.focus();
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
    refreshLanguage();
  }

  function setOptions(name, values, placeholder) {
    const input = fields[name].input;
    const previous = input.value;
    const options = [el("option", "", placeholder)];
    options[0].value = "";
    if (name === 'category') {
      for (const [label, members] of serviceGroups) {
        const group = el('optgroup'); group.label = label;
        for (const value of values.filter(value => members.includes(value))) {
          const option = el('option', '', serviceLabels[value] || value); option.value = value; group.append(option);
        }
        if (group.children.length) options.push(group);
      }
      for (const value of values.filter(value => !serviceGroups.some(([, members]) => members.includes(value)))) {
        const option = el('option', '', value); option.value = value; options.push(option);
      }
    } else for (const value of values) {
      const option = el("option", "", value); option.value = value; options.push(option);
    }
    input.replaceChildren(...options);
    if (values.includes(previous)) input.value = previous;
    searchControls.get(name)?.refresh();
  }

  function updateCategoryOptions() {
    if (!metadata) return;
    const city = fields.city.input.value, format = fields.event_type.input.value;
    const values = metadata.categories.filter(value => !guide || !compatibilityInput.checked || !city || fields.category.input.value === value
      || guide.groups.some(group => group.city === city && group.category === value && (!format || group.event_type === format)));
    setOptions('category', values, 'Выберите услугу');
    refreshLanguage();
  }

  function updateFormatOptions() {
    if (!metadata) return;
    const city = fields.city.input.value, category = fields.category.input.value;
    const values = metadata.event_types.filter(value => !guide || !compatibilityInput.checked || !city || fields.event_type.input.value === value
      || guide.groups.some(group => group.city === city && group.event_type === value && (!category || group.category === category)));
    setOptions('event_type', values, 'Выберите формат');
    refreshLanguage();
  }

  function updateBudget() {
    const input = fields.budget_kzt.input;
    const value = parseBudget(input.value);
    if (Number.isSafeInteger(value) && value > 0) {
      const start = input.selectionStart;
      const digitsBefore = input.value.slice(0, start).replace(/\D/g, '').length;
      input.value = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(value).replace(/\u00a0/g, ' ');
      let position = 0; let seen = 0;
      while (position < input.value.length && seen < digitsBefore) if (/\d/.test(input.value[position++])) seen++;
      if (doc.activeElement === input) input.setSelectionRange(position, position);
    }
  }

  function updateGuide() {
    priceGuide.replaceChildren(); priceGuide.hidden = true;
    if (!dateCalendar.hidden) renderCalendar();
    if (!guide || !metadata || guide.dataset_version !== metadata.dataset_version) return;
    const city = fields.city.input.value, category = fields.category.input.value, eventType = fields.event_type.input.value;
    if (!city) return;
    priceGuide.hidden = false;
    if (city && Number.isInteger(guide.city_counts[city])) priceGuide.append(el('p', 'city-count', `${city}: ${guide.city_counts[city]} профилей в каталоге`));
    if (!category || !eventType) { refreshLanguage(); return; }
    const group = guide.groups.find(item => item.city === city && item.category === category && item.event_type === eventType);
    if (!group) {
      priceGuide.append(el('p', '', 'В этом сочетании нет профилей. Можно выбрать другую категорию или формат.'));
      refreshLanguage(); return;
    }
    const selected = group.dates[fields.event_date.input.value];
    const count = selected ? selected.available : group.total;
    const min = selected ? selected.price_min : group.price_min;
    const max = selected ? selected.price_max : group.price_max;
    priceGuide.append(el('p', 'guide-count', selected ? `На выбранную дату свободны: ${count} из ${group.total}.` : `В выбранной группе: ${count} профилей.`));
    if (count > 0) priceGuide.append(el('p', 'guide-price', min === max ? `Начальная цена: ${money.format(min)} ₸` : `Начальные цены: ${money.format(min)}–${money.format(max)} ₸`));
    priceGuide.append(el('p', 'field-hint', 'По каталогу, без учёта бюджета, языка и часов. Не итоговая смета.'));
    refreshLanguage();
  }

  function renderCalendar() {
    if (!metadata) return;
    const minMonth = metadata.date_range.min.slice(0, 7), maxMonth = metadata.date_range.max.slice(0, 7);
    if (!calendarMonth || calendarMonth < minMonth) calendarMonth = minMonth;
    if (calendarMonth > maxMonth) calendarMonth = maxMonth;
    const [year, month] = calendarMonth.split('-').map(Number);
    const heading = el('div', 'calendar-heading');
    const previous = el('button', 'calendar-nav', '‹'), next = el('button', 'calendar-nav', '›');
    previous.type = next.type = 'button';
    previous.setAttribute('aria-label', 'Предыдущий месяц'); next.setAttribute('aria-label', 'Следующий месяц');
    previous.disabled = calendarMonth === minMonth; next.disabled = calendarMonth === maxMonth;
    const monthLabel = el('strong', 'calendar-month-label', new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : locale === 'en' ? 'en-GB' : 'ru-RU', {month:'long', year:'numeric', timeZone:'UTC'}).format(new Date(Date.UTC(year, month - 1, 1))));
    monthLabel.setAttribute('aria-live', 'polite');
    const changeMonth = delta => {
      calendarMonth = new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
      renderCalendar();
      const nav = dateCalendar.querySelector(delta < 0 ? '.calendar-nav:first-child' : '.calendar-nav:last-child');
      (nav?.disabled ? dateCalendar.querySelector('.calendar-day:not(:disabled)') : nav)?.focus();
    };
    previous.addEventListener('click', () => changeMonth(-1)); next.addEventListener('click', () => changeMonth(1));
    heading.append(previous, monthLabel, next);
    const weekdays = el('div', 'calendar-weekdays'); weekdays.setAttribute('aria-hidden', 'true');
    for (let day = 0; day < 7; day++) weekdays.append(el('span', '', new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : locale === 'en' ? 'en-GB' : 'ru-RU', {weekday:'short', timeZone:'UTC'}).format(new Date(Date.UTC(2026, 8, 28 + day)))));
    const days = el('div', 'calendar-days');
    const first = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    for (let index = 0; index < first; index++) days.append(el('span', 'calendar-empty'));
    const group = guide?.groups.find(item => item.city === fields.city.input.value && item.category === fields.category.input.value && item.event_type === fields.event_type.input.value);
    const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= length; day++) {
      const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
      const stats = group?.dates[date];
      const button = el('button', `calendar-day${stats?.available === 0 ? ' is-busy' : ''}`, String(day));
      button.type = 'button'; button.dataset.date = date;
      button.disabled = date < metadata.date_range.min || date > metadata.date_range.max;
      button.setAttribute('aria-label', stats ? `${displayDate(date)}: ${stats.available} свободных профилей` : displayDate(date));
      button.setAttribute('aria-pressed', String(fields.event_date.input.value === date));
      if (stats) button.append(el('small', 'calendar-count', String(stats.available)));
      button.addEventListener('click', () => {
        fields.event_date.input.value = date; dateText.value = displayDate(date);
        closeCalendar(); onInput({target: fields.event_date.input}); dateText.focus();
      });
      button.addEventListener('keydown', event => {
        const steps = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7};
        if (!(event.key in steps)) return;
        event.preventDefault();
        const target = new Date(Date.UTC(year, month - 1, day + steps[event.key])).toISOString().slice(0, 10);
        if (target < metadata.date_range.min || target > metadata.date_range.max) return;
        calendarMonth = target.slice(0, 7); renderCalendar();
        dateCalendar.querySelector(`[data-date="${target}"]`)?.focus();
      });
      days.append(button);
    }
    dateCalendar.replaceChildren(heading, weekdays, days);
    if (group) dateCalendar.append(el('p', 'field-hint', 'Под датой — свободные профили по каталогу, без учёта бюджета, языка и часов.'));
    dateCalendar.append(calendarNote);
    refreshLanguage();
  }

  async function reloadMetadata() {
    if (destroyed) return;
    const current = ++generation;
    metadata = null;
    guide = null;
    compatibilityWrap.hidden = true;
    priceGuide.replaceChildren(); priceGuide.hidden = true; closeCalendar();
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
      setOptions("category", data.categories, "Выберите услугу");
      setOptions("language", data.languages, "Без предпочтений");
      for (const name of ['city', 'event_type', 'category', 'language']) {
        if (!searchControls.has(name)) searchControls.set(name, enhanceSelect(fields[name].input, {
          fieldLabel: fields[name].label,
          getDisplayText: option => translate(option.value ? (name === 'category' ? serviceLabels[option.value] || option.value : option.value) : ({city:'Выберите город',event_type:'Выберите формат',category:'Выберите услугу',language:'Без предпочтений'}[name]), locale),
          getSearchText: option => `${option.value} ${translate(option.value, locale)} ${name === 'category' ? `${serviceLabels[option.value] || ''} ${translate(serviceLabels[option.value] || '', locale)}` : ''}`,
          getGroupText: group => translate(group.label, locale),
          onRender: refreshLanguage,
        }));
      }
      fields.event_date.input.min = data.date_range.min;
      fields.event_date.input.max = data.date_range.max;
      calendarNote.textContent = `Календарь занятости: ${displayDate(data.date_range.min)} — ${displayDate(data.date_range.max)}.`;
      resultsMeta.textContent = `${data.dataset_count} профилей в каталоге`;
      setBusy(false);
      showState("idle", "Ваше событие начинается с выбора", "Укажите детали мероприятия. Здесь появятся подходящие люди и места — с объяснениями по вашему запросу.");
      withTimeout(() => typeof loadGuide === 'function' ? loadGuide() : null)
        .then(data => { if (!destroyed && isValidGuide(data, metadata)) {
          guide = data; compatibilityWrap.hidden = false;
          updateCategoryOptions(); updateFormatOptions(); updateGuide();
        } })
        .catch(() => {}); // Optional reference; actual recommendations never depend on it.
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
    const budget = parseBudget(values.budget_kzt);
    if (!values.budget_kzt || !Number.isSafeInteger(budget) || budget <= 0) errors.budget_kzt = "Укажите целый бюджет больше нуля, не превышающий 9 007 199 254 740 991 ₸.";
    const duration = values.duration_hours ? Number(values.duration_hours) : null;
    if (fields.duration_hours.input.validity.badInput || (duration !== null && (!Number.isFinite(duration) || duration <= 0))) errors.duration_hours = "Укажите число часов больше нуля или оставьте поле пустым.";
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
    const sourceMessage = el('p', '', data.message); sourceMessage.dataset.catalogText = ''; sourceMessage.lang = 'ru';
    summary.append(el("h3", "", titles[data.status]), sourceMessage);
    summary.append(el("p", "request-summary", `${request.city} · ${request.category} · ${displayDate(request.event_date)} · ${request.event_type}`));
    const methodDetails = el('details', 'guide-details');
    methodDetails.append(el('summary', '', 'Как получен результат'));
    const modeLabels = {
      deterministic: "Объяснения составлены по правилам на основе данных каталога.",
      llm: "Формулировки объяснений подготовлены языковой моделью на основе профилей.",
      deterministic_fallback: "Языковая модель недоступна. Объяснения составлены по правилам на основе данных каталога."
    };
    if (modeLabels[data.explanation_mode]) {
      const mode = el("p", "explanation-mode", modeLabels[data.explanation_mode]);
      mode.dataset.explanationMode = data.explanation_mode;
      methodDetails.append(mode);
    }
    if (data.status === "matched" && data.eligible_count > data.cards.length) {
      methodDetails.append(el("p", "ranking-note", "Первые три выбраны по совпадениям описания с форматом, затем с категорией. При равенстве — по меньшей цене «от»."));
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
        explanation.lastChild.dataset.catalogText = ''; explanation.lastChild.lang = 'ru';
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
          excerpt.lastChild.dataset.catalogText = ''; excerpt.lastChild.lang = 'ru';
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
    methodDetails.append(counts);
    const exclusions = el("ul", "exclusion-list");
    for (const [key, label] of Object.entries(exclusionLabels)) {
      const count = data.exclusions?.[key];
      if (Number.isInteger(count) && count > 0) exclusions.append(el("li", "", `${label}: ${count}`));
    }
    if (exclusions.childElementCount) {
      const target = data.status === 'matched' ? methodDetails : el('div');
      target.append(exclusions, el("p", "exclusion-note", "Один профиль может не подходить по нескольким причинам. Эти числа не складываются."));
      if (data.status !== 'matched') nodes.push(target);
    }
    nodes.push(methodDetails);
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
          dateText.value = displayDate(fields.event_date.input.value); updateBudget(); updateGuide();
          for (const control of searchControls.values()) control.refresh();
          submit();
        });
        alternative.append(button);
        if (suggestion.kind === "increase_budget") alternative.append(el("p", "suggestion-note", "Новый бюджет сравнивается с ценой «от», не с подтверждённой стоимостью заказа."));
        suggestions.append(alternative);
      }
      if (seen.size) nodes.push(suggestions);
    }
    output.replaceChildren(...nodes);
    refreshLanguage();
  }

  async function submit(event) {
    event?.preventDefault();
    clearTimeout(autoTimer);
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
    if (destroyed || !metadata || (!fields[event.target.name] && event.target !== dateText)) return;
    clearTimeout(autoTimer);
    if (pending) { ++generation; setBusy(false); }
    if (event.target === dateText) {
      const text = dateText.value.trim();
      const match = text.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      const date = match ? `${match[3]}-${match[2]}-${match[1]}` : /^\d{8}$/.test(text) ? `${text.slice(4)}-${text.slice(2, 4)}-${text.slice(0, 2)}` : text;
      fields.event_date.input.value = isISODate(date) ? date : '';
      if (/^\d{8}$/.test(text) && fields.event_date.input.value) dateText.value = displayDate(date);
    } else if (event.target === fields.event_date.input) dateText.value = fields.event_date.input.value ? displayDate(fields.event_date.input.value) : '';
    if (event.target === fields.budget_kzt.input) updateBudget();
    if (['city', 'category', 'event_type'].includes(event.target.name)) { updateCategoryOptions(); updateFormatOptions(); }
    const field = event.target === dateText ? fields.event_date : fields[event.target.name];
    if (field) {
      if (field === fields.event_date) dateText.removeAttribute('aria-invalid');
      field.input.removeAttribute("aria-invalid");
      field.error.textContent = "";
      field.error.hidden = true;
    }
    updateGuide();
    showState("edited", "Детали изменены", autoInput.checked ? 'Заполните остальные поля — варианты обновятся автоматически.' : "Запустите подбор, чтобы получить варианты по новым условиям.");
    scheduleAutomatic();
  }

  function scheduleAutomatic() {
    clearTimeout(autoTimer);
    if (!metadata || !autoInput.checked || destroyed) return;
    const {errors} = readRequest();
    if (!Object.keys(errors).length) autoTimer = setTimeout(() => submit(), 650);
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
      clearTimeout(autoTimer);
      for (const control of searchControls.values()) control.destroy();
      doc.removeEventListener('pointerdown', closeCalendarOutside);
      doc.removeEventListener('focusin', closeCalendarOutside);
      ++generation;
      form.removeEventListener("submit", submit);
      form.removeEventListener("input", onInput);
      root.replaceChildren();
    }
  };
}

let mountSequence = 0;
// Service labels only; canonical catalog categories and the API stay unchanged.
const serviceLabels = {
  'Ведущий':'Ведение мероприятия', 'Ведущий церемонии':'Проведение церемонии',
  'Фотограф':'Фотосъёмка', 'Видеограф':'Видеосъёмка', 'Лайв-бэнд':'Живая музыка',
  'Инструменталист':'Инструментальная музыка', 'Танцевальный коллектив':'Танцевальное шоу',
  'Декоратор':'Декор мероприятия', 'Флорист':'Флористика',
};
const serviceGroups = [
  ['Ведение и шоу', ['Ведущий', 'Ведущий церемонии', 'Танцевальный коллектив', 'Шоу-программа']],
  ['Фото и видео', ['Фотограф', 'Видеограф', 'Фото и видеобудки']],
  ['Музыка', ['Лайв-бэнд', 'Инструменталист', 'Национальный ансамбль']],
  ['Площадки', ['Банкетный зал', 'Ресторан', 'Загородная площадка', 'Отель']],
  ['Оформление и подарки', ['Декоратор', 'Флорист', 'Подарки и сувениры']],
];
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const exclusionLabels = {
  busy: "Заняты на дату", budget: "Выше бюджета", event_type: "Другой формат",
  language: "Не подходит язык", duration: "Не подходит длительность"
};
const requestKeys = ["city", "event_date", "event_type", "category", "budget_kzt", "duration_hours", "language"];

export function parseBudget(value) {
  const text = String(value).trim();
  if (/^\d[\d\s\u00a0\u202f]*$/.test(text)) return Number(text.replace(/[\s\u00a0\u202f]/g, ''));
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ''));
  return NaN;
}

function isValidGuide(data, meta) {
  if (!meta || !data || data.dataset_version !== meta.dataset_version || !data.city_counts || !Array.isArray(data.groups)
    || data.date_range?.min !== meta.date_range.min || data.date_range?.max !== meta.date_range.max) return false;
  if (Object.keys(data.city_counts).length !== meta.cities.length || !meta.cities.every(city => Number.isInteger(data.city_counts[city]) && data.city_counts[city] >= 0)
    || Object.values(data.city_counts).reduce((sum, value) => sum + value, 0) !== meta.dataset_count) return false;
  const dayCount = (Date.parse(meta.date_range.max) - Date.parse(meta.date_range.min)) / 86400000 + 1;
  const groups = new Set();
  const price = value => Number.isSafeInteger(value) && value > 0;
  return data.groups.every(group => {
    if (!group || !meta.cities.includes(group.city) || !meta.categories.includes(group.category) || !meta.event_types.includes(group.event_type)
      || !Number.isInteger(group.total) || group.total <= 0 || group.total > data.city_counts[group.city]
      || !price(group.price_min) || !price(group.price_max) || group.price_min > group.price_max
      || !group.dates || Object.keys(group.dates).length !== dayCount) return false;
    const key = JSON.stringify([group.city, group.category, group.event_type]);
    if (groups.has(key)) return false;
    groups.add(key);
    return Object.entries(group.dates).every(([date, stats]) => isISODate(date) && date >= meta.date_range.min && date <= meta.date_range.max
      && stats && Number.isInteger(stats.available) && stats.available >= 0 && stats.available <= group.total
      && (stats.available === 0 ? stats.price_min === null && stats.price_max === null
        : price(stats.price_min) && price(stats.price_max) && stats.price_min <= stats.price_max && stats.price_min >= group.price_min && stats.price_max <= group.price_max));
  });
}

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
