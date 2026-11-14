import { ru } from './ru.js';
import { en } from './en.js';

export const DICTS = { ru, en };
let lang = 'ru';

export function setLang(l) { lang = DICTS[l] ? l : 'ru'; if (typeof document !== 'undefined') document.documentElement.lang = lang; }
export function getLang() { return lang; }

export function t(key, params = {}) {
  let s = DICTS[lang][key];
  if (s == null) s = DICTS.ru[key];
  if (s == null) return key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? fmtParam(params[k]) : `{${k}}`));
}

function fmtParam(v) {
  if (typeof v === 'number') return num(v, Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
  return String(v);
}

export function num(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
