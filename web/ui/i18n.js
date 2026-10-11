import de from '../i18n/de.js';

export const SUPPORTED_LANGS = {
  en: 'English',
  de: 'Deutsch',
};

const STORAGE_KEY = 'support_fins_lang';

function getStoredLang() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function setStoredLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
}

// No language picker on the site yet, and the German is still partial, so every
// visitor gets English. Testers opt in with ?lang=de (remembered; ?lang=en resets).
// Browser-language detection comes back with the picker.
function initialLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang')?.trim().toLowerCase().slice(0, 2);
    if (q && SUPPORTED_LANGS[q]) setStoredLang(q);
  } catch {}
  return getStoredLang() || 'en';
}

export let currentLang = initialLang();

/** Is the page in German? From currentLang, which initialLang/setLanguage keep in step
 *  with storage -- reading localStorage here threw where the browser blocks it. */
export const inGerman = () => currentLang === 'de';

if (!SUPPORTED_LANGS[currentLang]) currentLang = 'en';

export const norm = (s) => (s || '')
  .replace(/[“”"]/g, '"')
  .replace(/[‘’']/g, "'")
  .replace(/[—–—–]/g, '-')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normDe = {};
for (const [k, v] of Object.entries(de)) {
  normDe[norm(k)] = v;
}

const DICTIONARIES = { de: normDe };

const pluralCache = new Map();
function getPluralRule(lang, n) {
  let pr = pluralCache.get(lang);
  if (!pr) {
    pr = new Intl.PluralRules(lang);
    pluralCache.set(lang, pr);
  }
  return pr.select(n);
}

export function t(key, params = {}) {
  if (!key) return '';
  const cleanKey = norm(key);
  const dict = DICTIONARIES[currentLang];
  let val = dict?.[cleanKey] ?? dict?.[key];
  if (!val) {
    if (cleanKey.endsWith('.')) {
      val = dict?.[cleanKey.slice(0, -1).trim()];
    } else {
      val = dict?.[cleanKey + '.'];
    }
  }

  if (params.n !== undefined && typeof val === 'object' && val !== null) {
    const rule = getPluralRule(currentLang, params.n);
    val = val[rule] || val.other || val.one || cleanKey;
  }

  let text = (typeof val === 'string' ? val : key);
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`{${k}}`, 'g'), v);
  }
  return text;
}

export function tn(singular, plural, n, params = {}) {
  const allParams = { n, ...params };
  if (currentLang === 'en') {
    const rule = getPluralRule('en', n);
    return t(rule === 'one' ? singular : plural, allParams);
  }
  const dict = DICTIONARIES[currentLang];
  const entry = dict?.[norm(plural)] || dict?.[norm(singular)];
  if (typeof entry === 'object' && entry !== null) {
    const rule = getPluralRule(currentLang, n);
    const form = entry[rule] || entry.other || entry.one;
    if (form) {
      let res = form;
      for (const [k, v] of Object.entries(allParams)) {
        res = res.replace(new RegExp(`{${k}}`, 'g'), v);
      }
      return res;
    }
  }
  const rule = getPluralRule('en', n);
  return t(rule === 'one' ? singular : plural, allParams);
}

export function setLanguage(lang) {
  if (!SUPPORTED_LANGS[lang]) return;
  currentLang = lang;
  setStoredLang(lang);
  document.documentElement.lang = lang;
  updateDomTranslations();
  window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
}

export function updateDomTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const explicit = node.getAttribute('data-i18n');
    const orig = (node.dataset.origText ??= node.textContent.trim());
    const key = (explicit && explicit !== 'true' && explicit !== '') ? explicit : orig;
    if (currentLang === 'en') {
      node.textContent = node.dataset.origText;
      if (node.tagName === 'OPTION') node.label = node.dataset.origText;
    } else {
      const tr = t(key);
      if (tr && tr !== key) {
        node.textContent = tr;
        if (node.tagName === 'OPTION') node.label = tr;
      }
    }
  });

  document.querySelectorAll('[data-i18n-html]').forEach((node) => {
    const explicit = node.getAttribute('data-i18n-html');
    const orig = (node.dataset.origHtml ??= node.innerHTML.trim());
    const key = (explicit && explicit !== 'true' && explicit !== '') ? explicit : orig;
    if (currentLang === 'en') {
      node.innerHTML = node.dataset.origHtml;
    } else {
      const tr = t(key);
      if (tr && tr !== key) node.innerHTML = tr;
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    const explicit = node.getAttribute('data-i18n-title');
    const orig = (node.dataset.origTitle ??= (node.getAttribute('title') || '').trim());
    if (!orig) return;
    const key = (explicit && explicit !== 'true' && explicit !== '') ? explicit : orig;
    if (currentLang === 'en') {
      node.setAttribute('title', node.dataset.origTitle);
    } else {
      const tr = t(key);
      if (tr && tr !== key) node.setAttribute('title', tr);
    }
  });

  document.querySelectorAll('select').forEach((sel) => {
    const val = sel.value;
    sel.value = val;
  });
}
