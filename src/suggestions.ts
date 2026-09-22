/** App-owned suggestions: no native datalist popup or browser form history. */
export function attachSuggestions(input: HTMLInputElement, source: () => string[], options: {
  onSelect?: (value: string) => void;
  showOnEmpty?: boolean;
  showAllOnFocus?: boolean;
  anchor?: HTMLElement;
  tag?: boolean;
} = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  const popup = document.createElement('div');
  popup.className = 'app-suggestions';
  popup.id = `suggestions-${input.id || input.name}`;
  popup.setAttribute('role', 'listbox');
  popup.setAttribute('aria-label', '输入候选');
  popup.hidden = true;
  document.body.append(popup);
  input.removeAttribute('list');
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', popup.id);
  input.setAttribute('aria-expanded', 'false');
  let matches: string[] = [], cursor = -1;
  const close = () => {
    popup.hidden = true;
    cursor = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const position = () => {
    if (popup.hidden) return;
    const anchor = options.anchor || input;
    const rect = anchor.getBoundingClientRect();
    const scrollArea = input.closest('.modal-body')?.getBoundingClientRect();
    if (!input.isConnected || (scrollArea && (rect.bottom <= scrollArea.top || rect.top >= scrollArea.bottom))) { close(); return; }
    // getBoundingClientRect reports rendered pixels; fixed offsets inherit body zoom.
    const scale = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const up = below < 180 * scale && above > below;
    const height = Math.max(0, Math.min(240, (up ? above : below) / scale));
    popup.style.width = `${Math.min(rect.width, innerWidth - 24) / scale}px`;
    popup.style.maxHeight = `${height}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - rect.width - 12)) / scale}px`;
    popup.style.top = `${(up ? rect.top : rect.bottom) / scale + (up ? -6 : 6)}px`;
    popup.style.transform = up ? 'translateY(-100%)' : 'none';
  };
  const select = (value: string) => {
    if (options.onSelect) options.onSelect(value);
    else {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
    input.focus();
  };
  const highlight = () => {
    [...popup.children].forEach((element, index) => element.setAttribute('aria-selected', String(index === cursor)));
    const active = popup.children[cursor] as HTMLElement | undefined;
    if (active) { input.setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const render = (all = false) => {
    const query = all ? '' : input.value.trim().toLocaleLowerCase();
    matches = !query && options.showOnEmpty === false ? [] : [...new Set(source())].filter(value => value.toLocaleLowerCase().includes(query)).slice(0, 100);
    cursor = -1;
    popup.replaceChildren();
    for (const [index, value] of matches.entries()) {
      const item = document.createElement('div');
      item.id = `${popup.id}-${index}`;
      item.className = 'app-suggestion';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.textContent = value;
      if (options.tag) item.dataset.suggestTag = value;
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => select(value));
      popup.append(item);
    }
    popup.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(!!matches.length));
    input.removeAttribute('aria-activedescendant');
    position();
  };
  input.addEventListener('focus', () => render(options.showAllOnFocus), { signal });
  input.addEventListener('click', () => render(options.showAllOnFocus), { signal });
  input.addEventListener('input', () => render(), { signal });
  input.addEventListener('blur', close, { signal });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (popup.hidden) render(options.showAllOnFocus);
      if (!matches.length) return;
      cursor = event.key === 'ArrowDown' ? Math.min(cursor + 1, matches.length - 1) : cursor < 0 ? matches.length - 1 : Math.max(0, cursor - 1);
      highlight();
    } else if (event.key === 'Enter' && !popup.hidden && cursor >= 0) {
      event.preventDefault(); event.stopImmediatePropagation(); select(matches[cursor]);
    } else if (event.key === 'Tab') close();
  }, { signal });
  document.addEventListener('pointerdown', event => { if (event.target !== input && !popup.contains(event.target as Node)) close(); }, { signal });
  document.addEventListener('scroll', position, { capture: true, signal });
  window.addEventListener('resize', position, { signal });
  return () => { controller.abort(); popup.remove(); };
}
