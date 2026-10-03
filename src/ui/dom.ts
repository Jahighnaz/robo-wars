// Minimal DOM builder.
type Kid = Node | string | number | null | undefined | false | Kid[];
type Props = Record<string, unknown> | null;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = String(v);
    else if (k === 'style') n.style.cssText = String(v);
    else if (k === 'html') n.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'disabled') (n as HTMLButtonElement).disabled = !!v;
    else n.setAttribute(k, String(v));
  }
  const add = (c: Kid) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return n;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function gem(color: string): HTMLSpanElement {
  return el('span', { class: 'gem', style: `background:${color};box-shadow:0 0 8px ${color}` });
}
