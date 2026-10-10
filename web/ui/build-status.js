import { BuildActivity } from '../build-activity.js';
import { el } from './dom.js';
import { t } from './i18n.js';

const activity = new BuildActivity((visible) => {
  el('spinner').classList.toggle('show', visible);
  el('spinner-text').textContent = visible ? t('Calculating in background…') : '';
});
export const setBuildPending = (stage, busy) => {
  activity.set(stage, busy);
  dispatchEvent(new Event('geometryactivitychange'));
};
export const settingsPending = () => activity.pending.has('settings');
