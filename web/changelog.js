// The changelog's rules, shared by the landing card, the test and the release workflow:
// a PR appends its entry to `unreleased`; only the release step (`stamp`) writes `releases`,
// moving every unreleased entry under the new version, so a version always names a real
// release. `releases` runs oldest first. Pure, no imports, so Node and Deno can load it too.
//
// The landing card's What's new block and the top bar's version are written into
// web/index.html (between the BEGIN/END markers) rather than fetched, so they paint with
// the page instead of flashing in; tests/changelog.test.js fails when they are stale.
//
//   deno run -A web/changelog.js     rewrite both blocks from changelog.json
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

export const RELEASES_URL = 'https://github.com/gittrahan/support-fins/releases';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const block = (name) => [`<!-- BEGIN ${name} (web/changelog.js writes this block) -->`, `<!-- END ${name} -->`];

/** The card's lines for one release, newest entry first; an entry's highlights stand in for its text. */
function lines(r) {
  return [...r.entries].reverse().flatMap((e) => (e.highlights?.length ? e.highlights.map((h) => h.text) : [e.text]));
}

/** The What's new section: released entries only, newest release first (entries stay English). None released: no section. */
export function cardHTML(data) {
  const rs = releases(data);
  if (!rs.length) return '';
  const out = [
    '<section id="whatsnew" class="whatsnew">',
    `  <h2><span data-i18n="What's new">What's new</span> <span class="ver">${esc(rs[0].tag)}</span></h2>`,
    '  <div class="list" tabindex="0">',
  ];
  rs.forEach((r, i) => {
    if (i) out.push(`    <p class="rel">${esc(r.tag)} <span>${esc(r.date)}</span></p>`);
    out.push('    <ul>', ...lines(r).map((t) => `      <li>${esc(t)}</li>`), '    </ul>');
  });
  out.push('  </div>',
    `  <a href="${RELEASES_URL}" target="_blank" rel="noopener" data-i18n="See all releases">See all releases</a>`,
    '</section>');
  return out.join('\n');
}

/** The top bar's version label; it sits in .brand-text, so it sheds with it on narrow windows and phones. */
export function versionHTML(data) {
  const top = releases(data)[0];
  return top ? `<small class="brand-ver" title="Version" data-i18n-title="Version">${esc(top.tag)}</small>` : '';
}

// `indent` set: the block goes on lines of its own at that indent; unset, inline.
function put(html, name, body, indent) {
  const [begin, end] = block(name);
  const a = html.indexOf(begin), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`web/index.html: missing the ${begin} ... ${end} markers`);
  const inner = indent === undefined ? body
    : '\n' + (body ? body.split('\n').map((l) => indent + l).join('\n') + '\n' : '') + indent;
  return html.slice(0, a + begin.length) + inner + html.slice(b);
}

/** index.html with its What's new and version blocks written from `data`. */
export function withChangelog(html, data) {
  return put(put(html, 'whatsnew', cardHTML(data), '    '), 'version', versionHTML(data));
}

if (import.meta.main) {
  const at = (f) => new URL(f, import.meta.url);
  const data = JSON.parse(Deno.readTextFileSync(at('changelog.json')));
  Deno.writeTextFileSync(at('index.html'), withChangelog(Deno.readTextFileSync(at('index.html')), data));
}
