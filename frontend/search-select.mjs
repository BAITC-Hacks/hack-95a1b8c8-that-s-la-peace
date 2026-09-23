/** Editable combobox backed by an unchanged native select. No network or styles. */
export function enhanceSelect(select, {
  fieldLabel,
  placeholder = "Поиск в списке",
  emptyText = "Нет вариантов",
  allText = "Показать весь список",
  getSearchText = option => option.label,
  getDisplayText = option => option.label,
  getGroupText = group => group.label,
  onRender = () => {}
} = {}) {
  if (!select || select.tagName !== "SELECT" || !select.parentNode || select.multiple) {
    throw new TypeError("enhanceSelect requires an attached single native select");
  }
  if (instances.has(select)) return instances.get(select);
  const doc = select.ownerDocument, view = doc.defaultView;
  const uid = `combobox-${++sequence}`;
  const previous = {hidden: select.hidden, tabindex: select.getAttribute("tabindex")};
  const labels = Array.from(select.labels || []);
  const fieldName = fieldLabel || labels[0]?.textContent.trim() || select.getAttribute("aria-label") || select.name || "список";
  const wrapper = doc.createElement("div"); wrapper.className = "select-combobox";
  const control = doc.createElement("div"); control.className = "combobox-control";
  const input = doc.createElement("input"); input.type = "text"; input.id = `${uid}-input`;
  input.className = "combobox-input"; input.autocomplete = "off"; input.spellcheck = false;
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-haspopup", "listbox"); input.setAttribute("aria-controls", `${uid}-list`);
  const toggle = doc.createElement("button"); toggle.type = "button"; toggle.tabIndex = -1;
  toggle.className = "combobox-toggle"; toggle.setAttribute("aria-label", allText);
  toggle.setAttribute("aria-controls", `${uid}-list`);
  const arrow = doc.createElement("span"); arrow.textContent = "⌄"; arrow.setAttribute("aria-hidden", "true"); toggle.append(arrow);
  const list = doc.createElement("div"); list.id = `${uid}-list`; list.className = "combobox-listbox";
  list.setAttribute("role", "listbox"); list.setAttribute("aria-label", fieldName);
  const status = doc.createElement("p"); status.id = `${uid}-status`; status.className = "combobox-status";
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  control.append(input, toggle); wrapper.append(control, list, status); select.before(wrapper);
  const relabelled = labels.filter(label => label.htmlFor === select.id && select.id);
  for (const label of relabelled) label.htmlFor = input.id;
  if (!relabelled.length) input.setAttribute("aria-label", fieldName);
  select.hidden = true; select.tabIndex = -1;

  let opened = false, query = null, active = null, shown = [], destroyed = false, rendering = false, pointerInside = false, pointerOnly = false, touchStart = null, suppressClick = false;
  const selectedOption = () => select.selectedOptions[0];
  const disabledOption = option => option.disabled || (option.parentElement?.tagName === "OPTGROUP" && option.parentElement.disabled);

  function mirrorState() {
    const disabled = select.matches(":disabled");
    input.disabled = disabled; toggle.disabled = disabled;
    if (disabled) { opened = false; query = null; active = null; }
    for (const name of ["aria-invalid", "aria-errormessage"]) {
      if (select.hasAttribute(name)) input.setAttribute(name, select.getAttribute(name));
      else input.removeAttribute(name);
    }
    input.setAttribute("aria-describedby", [select.getAttribute("aria-describedby"), status.id].filter(Boolean).join(" "));
    input.setAttribute("aria-required", String(select.required));
  }

  function render(notify = true) {
    if (destroyed || rendering) return;
    rendering = true;
    try {
      mirrorState();
      const options = Array.from(select.options), selected = selectedOption();
      const empty = options.find(option => !option.value);
      input.placeholder = empty ? String(getDisplayText(empty)) : placeholder;
      if (query === null) input.value = selected?.value ? String(getDisplayText(selected)) : "";
      const needle = normalize(query || "");
      shown = options.filter(option => !option.hidden && (!needle || normalize(getSearchText(option)).includes(needle)));
      if (!shown.includes(active) || (active && disabledOption(active))) active = null;
      list.replaceChildren();
      let currentGroup = null;
      for (const option of shown) {
        const group = option.parentElement?.tagName === "OPTGROUP" ? option.parentElement : null;
        if (group && group !== currentGroup) {
          const heading = doc.createElement("div"); heading.className = "combobox-group";
          heading.setAttribute("role", "presentation"); heading.textContent = String(getGroupText(group)); list.append(heading);
        }
        currentGroup = group;
        const item = doc.createElement("div"); item.className = "combobox-option";
        item.id = `${uid}-option-${options.indexOf(option)}`;
        item.dataset.value = option.value; item.dataset.index = String(options.indexOf(option));
        item.setAttribute("role", "option"); item.setAttribute("aria-selected", String(option.selected));
        item.setAttribute("aria-disabled", String(Boolean(disabledOption(option))));
        item.classList.toggle("is-active", option === active); item.textContent = String(getDisplayText(option));
        list.append(item);
      }
      input.setAttribute("aria-expanded", String(opened)); toggle.setAttribute("aria-expanded", String(opened));
      wrapper.dataset.open = String(opened); list.hidden = !opened;
      if (opened && active) input.setAttribute("aria-activedescendant", `${uid}-option-${options.indexOf(active)}`);
      else input.removeAttribute("aria-activedescendant");
      status.textContent = opened && !shown.length ? emptyText : "";
      status.hidden = !opened || shown.length > 0;
      if (notify) onRender();
    } finally { rendering = false; }
  }

  function close() {
    if (!opened && query === null && active === null) return;
    opened = false; query = null; active = null; render();
  }
  function open(selectText = true) {
    if (destroyed || select.matches(":disabled")) return;
    opened = true; query = null; active = null; render();
    if (selectText && doc.activeElement === input) input.select();
  }
  function commit(option) {
    if (!option || !Array.from(select.options).includes(option) || disabledOption(option) || select.matches(":disabled")) return;
    const changed = select.selectedIndex !== option.index;
    select.selectedIndex = option.index;
    if (pointerOnly) toggle.focus({preventScroll: true});
    else input.focus({preventScroll: true});
    close();
    if (changed) {
      // Only the canonical select bubbles to the form, once per committed
      // change. Typing, filtering and cancelling never change API fields.
      select.dispatchEvent(new view.Event("input", {bubbles: true}));
      select.dispatchEvent(new view.Event("change", {bubbles: true}));
    }
  }
  function onInput(event) {
    event.stopPropagation(); query = input.value; opened = true; active = null; render();
  }
  function stopChange(event) { event.stopPropagation(); }
  function onKeydown(event) {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      if (!opened) { opened = true; query = null; render(); }
      const choices = shown.filter(option => !disabledOption(option));
      if (!choices.length) return;
      const index = choices.indexOf(active), delta = event.key === "ArrowDown" ? 1 : -1;
      active = choices[index < 0 ? (delta > 0 ? 0 : choices.length - 1) : Math.max(0, Math.min(choices.length - 1, index + delta))];
      render(); doc.getElementById(input.getAttribute("aria-activedescendant"))?.scrollIntoView({block: "nearest"});
    } else if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation(); if (opened && active) commit(active);
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === "Tab") close();
  }
  function onFocus() { pointerOnly = false; open(); }
  function onClick() { if (!opened) open(); else if (query === null) input.select(); }
  function onToggle() {
    const shouldClose = opened && query === null;
    pointerOnly = true;
    if (doc.activeElement === input) input.blur();
    if (shouldClose) close(); else open(false);
  }
  function onListClick(event) {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const item = event.target.closest(".combobox-option");
    if (item && list.contains(item)) { event.preventDefault(); commit(select.options[Number(item.dataset.index)]); }
  }
  function onPointerDown(event) {
    pointerInside = true;
    suppressClick = false;
    const option = event.target.closest(".combobox-option");
    if (event.pointerType !== "mouse" && option && list.contains(option)) {
      touchStart = {id: event.pointerId, x: event.clientX, y: event.clientY, index: Number(option.dataset.index), moved: false};
    }
    if (event.pointerType === "mouse" && (list.contains(event.target) || toggle.contains(event.target))) event.preventDefault();
  }
  function onPointerMove(event) {
    if (touchStart?.id === event.pointerId && (Math.abs(event.clientX - touchStart.x) > 10 || Math.abs(event.clientY - touchStart.y) > 10)) touchStart.moved = true;
  }
  function onListUp(event) {
    // A touch's compatibility mouse events can blur the input before click.
    // Commit taps on pointerup; scrolling/cancelled gestures never commit.
    if (touchStart?.id !== event.pointerId) return;
    const touched = touchStart; touchStart = null; suppressClick = true;
    if (!touched.moved) { event.preventDefault(); commit(select.options[touched.index]); }
  }
  function onDocumentDown(event) { if (!wrapper.contains(event.target)) close(); }
  function onDocumentUp(event) {
    if (event.type === "pointercancel" && touchStart) suppressClick = true;
    pointerInside = false; touchStart = null;
  }
  function onBlur(event) { if (!pointerInside && !wrapper.contains(event.relatedTarget)) close(); }
  function onNativeChange() { query = null; active = null; render(); }
  function onReset() { queueMicrotask(() => {
    if (!destroyed) { opened = false; query = null; active = null; render(); }
  }); }
  const observer = new view.MutationObserver(() => render(false));
  observer.observe(select, {attributes: true, attributeFilter: ["disabled", "required", "aria-invalid", "aria-describedby", "aria-errormessage"]});
  for (let parent = select.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "FIELDSET") observer.observe(parent, {attributes: true, attributeFilter: ["disabled"]});
  }
  input.addEventListener("input", onInput); input.addEventListener("change", stopChange);
  input.addEventListener("keydown", onKeydown); input.addEventListener("focus", onFocus); input.addEventListener("click", onClick);
  toggle.addEventListener("click", onToggle); list.addEventListener("click", onListClick); list.addEventListener("pointerup", onListUp);
  list.addEventListener("pointermove", onPointerMove);
  wrapper.addEventListener("pointerdown", onPointerDown); wrapper.addEventListener("focusout", onBlur);
  doc.addEventListener("pointerdown", onDocumentDown); doc.addEventListener("pointerup", onDocumentUp); doc.addEventListener("pointercancel", onDocumentUp);
  select.addEventListener("input", onNativeChange); select.addEventListener("change", onNativeChange);
  const form = select.form; form?.addEventListener("reset", onReset);
  const api = {
    refresh() { render(); },
    refreshLanguage() { render(false); },
    focus(options) { if (!destroyed) input.focus(options); },
    destroy() {
      if (destroyed) return;
      destroyed = true; observer.disconnect();
      doc.removeEventListener("pointerdown", onDocumentDown); doc.removeEventListener("pointerup", onDocumentUp); doc.removeEventListener("pointercancel", onDocumentUp);
      select.removeEventListener("input", onNativeChange); select.removeEventListener("change", onNativeChange); form?.removeEventListener("reset", onReset);
      wrapper.remove(); select.hidden = previous.hidden;
      if (previous.tabindex === null) select.removeAttribute("tabindex"); else select.setAttribute("tabindex", previous.tabindex);
      for (const label of relabelled) if (label.htmlFor === input.id) label.htmlFor = select.id;
      instances.delete(select);
    }
  };
  instances.set(select, api); render(); return api;
}
const instances = new WeakMap();
let sequence = 0;
function normalize(value) { return String(value).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim(); }
