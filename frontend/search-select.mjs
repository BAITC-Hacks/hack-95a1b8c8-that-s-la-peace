/**
 * Progressive search for a native select. The select remains the only form
 * value; filtering never selects a suggestion or emits input/change on it.
 * Call refresh() after rebuilding options from metadata. No network or styles.
 */
export function enhanceSelect(select, {
  fieldLabel,
  placeholder = "Поиск в списке",
  emptyText = "Нет вариантов",
  allText = "Показать весь список",
  getSearchText = option => option.label,
  onRender = () => {}
} = {}) {
  if (!select || select.tagName !== "SELECT" || !select.parentNode) {
    throw new TypeError("enhanceSelect requires an attached native select");
  }
  if (instances.has(select)) return instances.get(select);
  const doc = select.ownerDocument;
  const uid = `select-search-${++sequence}`;
  const assignedId = !select.id;
  if (assignedId) select.id = `${uid}-select`;
  const fieldName = fieldLabel || select.labels?.[0]?.textContent.trim() || select.getAttribute("aria-label") || select.name || "список";
  const wrapper = doc.createElement("div");
  wrapper.className = "select-search";
  const label = doc.createElement("label");
  label.className = "select-search-label";
  label.htmlFor = `${uid}-input`;
  label.textContent = `${placeholder}: ${fieldName}`;
  const controls = doc.createElement("div");
  controls.className = "select-search-controls";
  const input = doc.createElement("input");
  input.type = "search";
  input.id = label.htmlFor;
  input.className = "select-search-input";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-controls", select.id);
  const allButton = doc.createElement("button");
  allButton.type = "button";
  allButton.className = "select-search-all";
  allButton.textContent = allText;
  allButton.setAttribute('aria-label', 'Показать весь список');
  const status = doc.createElement("p");
  status.id = `${uid}-status`;
  status.className = "select-search-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  input.setAttribute("aria-describedby", status.id);
  select.setAttribute("aria-describedby", [select.getAttribute("aria-describedby"), status.id].filter(Boolean).join(" "));
  controls.append(input, allButton);
  wrapper.append(label, controls, status);
  select.before(wrapper);

  let entries = [];
  let options = [];
  let renderedOptions = [];
  let destroyed = false;

  function captureOptions() {
    entries = Array.from(select.children, node => ({
      node,
      children: node.tagName === "OPTGROUP" ? Array.from(node.children) : null
    }));
    options = Array.from(select.options);
  }

  function render(showAll = false) {
    const selected = new Set(select.selectedOptions);
    const query = showAll ? "" : normalize(input.value);
    const matches = option => !query || normalize(getSearchText(option)).includes(query);
    const visible = option => !option.value || selected.has(option) || matches(option);
    const nodes = [];
    for (const entry of entries) {
      if (entry.children) {
        const children = entry.children.filter(node => node.tagName !== "OPTION" || visible(node));
        entry.node.replaceChildren(...children);
        if (children.length) nodes.push(entry.node);
      } else if (entry.node.tagName !== "OPTION" || visible(entry.node)) nodes.push(entry.node);
    }
    select.replaceChildren(...nodes);
    // Insertion can make a native select choose its first option. Restore the
    // exact previous selection, including selectedIndex=-1 and multiple values.
    select.selectedIndex = -1;
    for (const option of select.options) option.selected = selected.has(option);
    renderedOptions = Array.from(select.options);
    const count = options.filter(option => option.value && matches(option)).length;
    const retained = query && Array.from(selected).some(option => option.value && !matches(option));
    status.textContent = query
      ? `${count ? `Найдено: ${count}. Выберите вариант в списке.` : `${emptyText}. Измените поиск или покажите весь список.`}${retained ? " Выбранное значение сохранено в списке." : ""}`
      : `Вариантов в списке: ${count}. Поиск не меняет выбранное значение.`;
    status.classList.toggle('is-empty-search', !query);
    syncDisabled();
    onRender();
  }

  function syncDisabled() {
    input.disabled = select.disabled;
    allButton.disabled = select.disabled;
  }

  function refresh() {
    if (destroyed) return;
    const current = Array.from(select.options);
    // A refresh without an external rebuild must not forget filtered options.
    if (current.length !== renderedOptions.length || current.some((option, index) => option !== renderedOptions[index])) captureOptions();
    render();
  }

  function onSearch(event) {
    // The host form listens to input. Search text is not a changed API field.
    event.stopPropagation();
    render();
  }

  function stopChange(event) { event.stopPropagation(); }

  function showAll() {
    input.value = "";
    render();
    select.focus();
  }

  function onKeydown(event) {
    if (event.isComposing) return;
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      select.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = "";
      render();
    }
  }

  function onSelection() { render(); }
  function onReset() {
    // Restore defaults to the DOM before the browser's native reset runs.
    input.value = "";
    render();
    queueMicrotask(() => { if (!destroyed) render(); });
  }

  captureOptions();
  render();
  input.addEventListener("input", onSearch);
  input.addEventListener("change", stopChange);
  input.addEventListener("keydown", onKeydown);
  allButton.addEventListener("click", showAll);
  select.addEventListener("change", onSelection);
  const form = select.form;
  form?.addEventListener("reset", onReset);
  const observer = new doc.defaultView.MutationObserver(syncDisabled);
  observer.observe(select, {attributes: true, attributeFilter: ["disabled"]});

  const api = {
    refresh,
    destroy() {
      if (destroyed) return;
      refresh();
      render(true);
      destroyed = true;
      observer.disconnect();
      input.removeEventListener("input", onSearch);
      input.removeEventListener("change", stopChange);
      input.removeEventListener("keydown", onKeydown);
      allButton.removeEventListener("click", showAll);
      select.removeEventListener("change", onSelection);
      form?.removeEventListener("reset", onReset);
      wrapper.remove();
      const describedBy = (select.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== status.id).join(" ");
      if (describedBy) select.setAttribute("aria-describedby", describedBy);
      else select.removeAttribute("aria-describedby");
      if (assignedId && select.id === `${uid}-select`) select.removeAttribute("id");
      instances.delete(select);
    }
  };
  instances.set(select, api);
  return api;
}

const instances = new WeakMap();
let sequence = 0;
function normalize(value) { return String(value).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim(); }
