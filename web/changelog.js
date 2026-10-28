// The changelog's rules, shared by the landing card, the test and the release workflow:
// a PR appends its entry to `unreleased`; publishing a release on GitHub stamps those
// entries into `releases` under its version on the live branch only, so main never
// carries a version no release made. Pure, no imports, so Node and Deno can load it too.
export const CHECKS = ['held', 'stays', 'clean', 'easy', 'all'];
export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

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

/** The release step: every unreleased entry moves under `version`. New data; throws on a bad version. */
export function stamp(data, version, date) {
  if (!isNewer(data, version)) throw new Error(`v${version} is not above the newest release`);
  return {
    ...data,
    releases: [...arr(data.releases), { version, date, entries: unreleased(data) }],
    unreleased: [],
  };
}
