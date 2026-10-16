/**
 * More settings (local issue 42): the folded part of the options panel. Folding must
 * never hide that something is set, so its line counts the settings changed from
 * their defaults ("2 changed") and each changed field gets a dot by its name.
 *
 * "Changed" means the build is using a value other than the page's default:
 *   - the default is the field's own HTML default (defaultValue / defaultChecked /
 *     the defaultSelected option), so there is no second list to keep in step;
 *   - a field the build ignores right now doesn't count: hidden (the pad numbers
 *     outside Custom, the sway fields with sway off, coverage in Draw) or disabled
 *     (coverage in Full coverage);
 *   - Wall lines doesn't count when a big nozzle took its default away
 *     (settings.js fitWallLines): the nozzle moved it, not the user.
 * Display only: it reads the fields, never sets them.
 */
import { el } from './dom.js';
import { t } from './i18n.js';

const fields = () => [...el('more-settings').querySelectorAll('input[id], select[id]')];

function defaultOf(f) {
  if (f.type === 'checkbox') return f.defaultChecked;
  if (f.tagName === 'SELECT') return ([...f.options].find((o) => o.defaultSelected) ?? f.options[0])?.value;
  return f.defaultValue;
}

function changed(f) {
  if (f.disabled || f.closest('[hidden]')) return false;
  const d = defaultOf(f);
  if (f.type === 'checkbox') return f.checked !== d;
  if (f.tagName === 'SELECT') {
    const opt = [...f.options].find((o) => o.value === d);
    return f.value !== d && !opt?.disabled;
  }
  return Number(f.value) !== Number(d);
}

/** Refresh the dots and the "N changed" count. */
export function syncMore() {
  let n = 0;
  for (const f of fields()) {
    const on = changed(f);
    f.closest('label')?.classList.toggle('changed', on);
    if (on) n++;
  }
  el('more-count').textContent = n ? t('{n} changed', { n }) : '';
}
