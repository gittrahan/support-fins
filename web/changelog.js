// The changelog's rules, shared by the landing card, the test and the release workflow:
// a PR appends its entry to `unreleased`; only the release step (`stamp`) writes `releases`,
// moving every unreleased entry under the new version, so a version always names a real
// release. `releases` runs oldest first. Pure, no imports, so Node and Deno can load it too.
export const CHECKS = ['held', 'stays', 'clean', 'easy', 'all'];
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const arr = (a) => (Array.isArray(a) ? a : []);

/** Released versions, newest first: [{version, tag, date, entries}]; malformed ones dropped. */
export function releases(data) {
  return arr(data?.releases)
    .filter((r) => r && VERSION_RE.test(r.version))
    .map((r) => ({ ...r, tag: `v${r.version}`, entries: arr(r.entries) }))
    .reverse();
}

/** Entries merged since the last release, oldest first. */
export function unreleased(data) {
  return arr(data?.unreleased);
}

/** The version a release takes by default: one patch above the newest, or `first`. */
export function nextVersion(data, first = '1.0.0') {
  const top = releases(data)[0];
  if (!top) return first;
  const [, a, b, c] = top.version.match(VERSION_RE);
  return `${a}.${b}.${+c + 1}`;
}

/** Does `v` come after every released version? A release never goes backwards. */
export function isNewer(data, v) {
  const m = typeof v === 'string' && v.match(VERSION_RE);
  if (!m) return false;
  const top = releases(data)[0];
  if (!top) return true;
  const n = top.version.match(VERSION_RE);
  for (let i = 1; i <= 3; i++) if (+m[i] !== +n[i]) return +m[i] > +n[i];
  return false;
}

/** The release step: every unreleased entry moves under `version`. New data; throws on a bad version or date, or nothing to release. */
export function stamp(data, version, date) {
  if (!data || typeof data !== 'object') throw new Error('changelog data is missing');
  if (!isNewer(data, version)) throw new Error(`v${version} is not above the newest release`);
  if (!DATE_RE.test(date) || isNaN(Date.parse(date))) throw new Error(`release date ${date} is not YYYY-MM-DD`);
  if (!unreleased(data).length) throw new Error('nothing unreleased to release');
  return {
    ...data,
    releases: [...arr(data.releases), { version, date, entries: unreleased(data) }],
    unreleased: [],
  };
}
