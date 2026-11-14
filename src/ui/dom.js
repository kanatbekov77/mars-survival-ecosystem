// Tiny DOM helpers, modal manager with focus trap, sparkline charts.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

// Modal stack: focus moves into the dialog and returns afterwards.
const stack = [];
export function openModal(content, { label, onClose, dismissable = true, className = '' } = {}) {
  const prev = document.activeElement;
  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label || '' }, content);
  const backdrop = h('div', { class: 'backdrop' }, dialog);
  const entry = { backdrop, dialog, prev, onClose, dismissable };
  stack.push(entry);
  document.body.append(backdrop);
  const first = dialog.querySelector('[data-autofocus]') || dialog.querySelector(FOCUSABLE);
  (first || dialog).focus?.();
  if (!first) dialog.setAttribute('tabindex', '-1');
  return { close: () => closeModal(entry), el: dialog };
}

export function closeModal(entry) {
  const i = stack.indexOf(entry);
  if (i < 0) return;
  stack.splice(i, 1);
  entry.backdrop.remove();
  entry.onClose?.();
  if (entry.prev && document.contains(entry.prev)) entry.prev.focus?.();
}

export function topModal() { return stack[stack.length - 1] || null; }
export function modalOpen() { return stack.length > 0; }
export function closeAllModals() { while (stack.length) closeModal(stack[stack.length - 1]); }

document.addEventListener('keydown', (e) => {
  const top = topModal();
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (top.dismissable) closeModal(top); return; }
  if (e.key === 'Tab') {
    const f = [...top.dialog.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}

// Sparkline with optional threshold band; values: number[]
export function sparkline(values, { w = 220, hgt = 44, lo, hi, min, max, label = '', forecast = [] } = {}) {
  const all = [...values, ...forecast].filter((v) => v != null && !Number.isNaN(v));
  if (!all.length) return h('div', { class: 'spark-empty' }, '—');
  let mn = min ?? Math.min(...all, lo ?? Infinity), mx = max ?? Math.max(...all, hi ?? -Infinity);
  if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
  const n = values.length + forecast.length;
  const X = (i) => (n <= 1 ? w : (i / (n - 1)) * (w - 2) + 1);
  const Y = (v) => hgt - 3 - ((v - mn) / (mx - mn)) * (hgt - 6);
  const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const fpts = forecast.length ? [values.length - 1, ...forecast.map((_, i) => values.length + i)].map((i, k) => `${X(i).toFixed(1)},${Y(k === 0 ? values[values.length - 1] : forecast[k - 1]).toFixed(1)}`).join(' ') : '';
  return s('svg', { class: 'spark', viewBox: `0 0 ${w} ${hgt}`, width: '100%', height: hgt, role: 'img', 'aria-label': label, preserveAspectRatio: 'none' },
    lo != null && hi != null ? s('rect', { x: 0, y: Y(Math.min(hi, mx)), width: w, height: Math.max(0, Y(Math.max(lo, mn)) - Y(Math.min(hi, mx))), class: 'spark-band' }) : null,
    lo != null && hi == null ? s('line', { x1: 0, x2: w, y1: Y(lo), y2: Y(lo), class: 'spark-limit' }) : null,
    hi != null && lo == null ? s('line', { x1: 0, x2: w, y1: Y(hi), y2: Y(hi), class: 'spark-limit' }) : null,
    s('polyline', { points: pts, class: 'spark-line', fill: 'none' }),
    fpts ? s('polyline', { points: fpts, class: 'spark-forecast', fill: 'none' }) : null,
  );
}

export function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
