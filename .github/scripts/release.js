// The release step, run by release.yml with Deno (the repo's CI already has it); tested in
// tests/release.test.js. web/changelog.json is the source: the release run first collects
// each merged PR's `Changelog (check): text` lines from its description into `unreleased`
// (so PRs never edit the file and never conflict on it), moves them under a version
// (`stamp`), commits that to main and makes the GitHub Release from it. Hand-written
// entries in `unreleased` (a direct commit to main) ship with them.
//
//   deno run -A .github/scripts/release.js --since              # when the newest release commit was made (ISO), or nothing
//   deno run -A .github/scripts/release.js --collect prs.json   # add the Changelog lines of PRs merged since then to unreleased
//   deno run -A .github/scripts/release.js --pending            # JSON array of released versions with no tag yet, oldest first
//   deno run -A .github/scripts/release.js --notes v1.0.1       # that release's body
//   deno run -A .github/scripts/release.js --prepare [1.1.0]    # stamp unreleased in place and rewrite the card in web/index.html; prints the version, or nothing
//   deno run -A .github/scripts/release.js --commit v1.0.1      # the commit on main that released it (the release commit)
//   deno run -A .github/scripts/release.js --newest             # the newest released tag, or nothing
//
// Existing tags come from `git tag --list 'v*'` (the workflow fetches tags first).
import { CHECKS, nextVersion, releases, stamp, unreleased, withChangelog } from '../../web/changelog.js';

const FILE = new URL('../../web/changelog.json', import.meta.url);
const INDEX = new URL('../../web/index.html', import.meta.url);

/** Released tags with no git tag yet, oldest first. Throws when a tagged release follows an untagged one. */
export function pendingTags(data, existingTags) {
  const have = new Set(existingTags);
  const tags = releases(data).map((r) => r.tag).reverse();
  const first = tags.findIndex((t) => !have.has(t));
  if (first === -1) return [];
  const gap = tags.slice(first).find((t) => have.has(t));
  if (gap) throw new Error(`${gap} exists but an earlier release has no tag: releases in changelog.json were edited`);
  return tags.slice(first);
}

// A zero-width joiner after each @ so a handle in an entry never notifies anyone.
const defang = (s) => String(s).replace(/@/g, '@‍');

/** The release body: one line per entry with its PR, an entry's highlights in place of its
 *  line (each with its PRs; GitHub links a bare #123), then where the builds are. */
export function notesFor(release, repo = 'gittrahan/support-fins') {
  const refs = (prs) => (prs?.length ? ` (${prs.map((n) => `#${n}`).join(', ')})` : '');
  const out = [];
  for (const e of release.entries) {
    if (e.highlights?.length) {
      out.push(defang(e.text), '', ...e.highlights.map((h) => `- ${defang(h.text)}${refs(h.prs)}`), '');
    } else {
      out.push(`- ${defang(e.text)}${refs(e.pr ? [e.pr] : [])}`);
    }
  }
  while (out.at(-1) === '') out.pop();
  out.push('', `Plugin builds are attached below. Docker: \`ghcr.io/${repo}:${release.tag}\`.`);
  return out.join('\n');
}

// One line in a PR description: `Changelog (held): Tines grip ...`, optionally quoted, as a
// list item or in bold. `Changelog: none` says the PR changes nothing a user sees. HTML
// comments (the PR template's example) are ignored. `all` is the launch roll-up's check, not a PR's.
const LINE_RE = /^[ \t]*(?:>[ \t]*)?(?:(?:[-*+]|\d+\.)[ \t]+)?(?:\*\*|__)?changelog[ \t]*(?:\(([^)]*)\))?[ \t]*(?:\*\*|__)?:(?:\*\*|__)?[ \t]*(.*?)[ \t]*$/gim;
// `none`, alone or followed by a reason: "none -- tests only", "none (docs)"; not "none of the ..."
const NONE_RE = /^none[ \t]*(?:$|[-—–(:.,;])/i;
const PR_CHECKS = CHECKS.filter((c) => c !== 'all');

/** A PR description's changelog lines: {entries: [{check, text}], none, bad: [line]}. */
export function changelogLines(body) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const out = { entries: [], none: false, bad: [] };
  for (const [line, check, t] of text.matchAll(LINE_RE)) {
    const c = (check ?? '').trim().toLowerCase();
    if (NONE_RE.test(t)) out.none = true;
    else if (PR_CHECKS.includes(c) && t) out.entries.push({ check: c, text: t });
    else out.bad.push(line.trim());
  }
  return out;
}

/** PRs merged after `since` (ISO time), oldest merge first, as unreleased entries
 *  {pr, date, check, text}; PRs any entry already names, and lines whose text an entry
 *  already has (a hand-written one with no pr), are skipped, so collecting twice adds nothing. `missing`: PRs with no line and no `none`; `bad`: lines that don't parse. */
export function collect(data, prs, since) {
  const known = [...releases(data).flatMap((r) => r.entries), ...unreleased(data)];
  const seen = new Set(known.map((e) => e.pr).filter(Boolean));
  const texts = new Set(known.map((e) => e.text));
  const out = { entries: [], missing: [], bad: [] };
  const merged = prs.filter((p) => p.mergedAt && (!since || Date.parse(p.mergedAt) > Date.parse(since)) && !seen.has(p.number))
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt));
  for (const p of merged) {
    const l = changelogLines(p.body);
    for (const e of l.entries) if (!texts.has(e.text)) out.entries.push({ pr: p.number, date: p.mergedAt.slice(0, 10), ...e });
    for (const b of l.bad) out.bad.push({ pr: p.number, line: b });
    if (!l.entries.length && !l.none && !l.bad.length) out.missing.push({ pr: p.number, title: p.title ?? '' });
  }
  return out;
}

/** The release commit's change: unreleased stamped under `version` (default: one patch up). Null when nothing waits. */
export function prepare(data, version, date) {
  if (!unreleased(data).length) return null;
  const v = version || nextVersion(data);
  return { version: v, data: stamp(data, v, date) };
}

async function git(...args) {
  const { code, stdout } = await new Deno.Command('git', { args, stdout: 'piped', stderr: 'null' }).output();
  return code ? null : new TextDecoder().decode(stdout);
}

/** When the newest release commit was made (committer time, ISO in UTC, as GitHub's search
 *  dates are), or null before the first release. */
async function since(data) {
  const tag = releases(data)[0]?.tag;
  const sha = tag && await releaseCommit(tag);
  return sha ? new Date((await git('show', '-s', '--format=%cI', sha)).trim()).toISOString() : null;
}

async function gitTags() {
  return (await git('tag', '--list', 'v*')).split('\n').filter(Boolean);
}

/** The first commit on main's first-parent line whose changelog holds `tag`: the release
 *  commit. Tagging and deploying it (not whatever push started the run) keeps a staging
 *  commit merged after it off the live site. */
async function releaseCommit(tag) {
  const log = await git('log', '--first-parent', '--reverse', '--format=%H', 'HEAD', '--', 'web/changelog.json');
  for (const sha of (log ?? '').split('\n').filter(Boolean)) {
    const text = await git('show', `${sha}:web/changelog.json`);
    let data = null;
    try { data = JSON.parse(text); } catch { continue; }
    if (releases(data).some((r) => r.tag === tag)) return sha;
  }
  return null;
}

if (import.meta.main) {
  const [cmd, arg] = Deno.args;
  const data = JSON.parse(await Deno.readTextFile(FILE));
  const repo = Deno.env.get('GITHUB_REPOSITORY') || undefined;
  if (cmd === '--pending') {
    console.log(JSON.stringify(pendingTags(data, await gitTags())));
  } else if (cmd === '--notes') {
    const r = releases(data).find((x) => x.tag === arg);
    if (!r) { console.error(`no release ${arg} in changelog.json`); Deno.exit(1); }
    console.log(notesFor(r, repo));
  } else if (cmd === '--prepare') {
    const out = prepare(data, arg, new Date().toISOString().slice(0, 10));
    if (out) {
      await Deno.writeTextFile(FILE, JSON.stringify(out.data, null, 2) + '\n');
      // the landing card and top-bar version are static HTML written from the changelog
      await Deno.writeTextFile(INDEX, withChangelog(await Deno.readTextFile(INDEX), out.data));
      console.log(out.version);
    }
  } else if (cmd === '--since') {
    console.log((await since(data)) ?? '');
  } else if (cmd === '--collect') {
    // prs.json: `gh pr list --state merged --json number,title,body,mergedAt`
    const prs = JSON.parse(await Deno.readTextFile(arg));
    const out = collect(data, prs, await since(data));
    // GitHub Actions annotations: they show on the run's summary page
    for (const b of out.bad) console.log(`::warning::#${b.pr}: changelog line not read (check is ${PR_CHECKS.join(', ')}): ${b.line}`);
    for (const m of out.missing) console.log(`::warning::#${m.pr} has no Changelog line, so the release notes leave it out: ${m.title}`);
    if (out.entries.length) {
      await Deno.writeTextFile(FILE, JSON.stringify({ ...data, unreleased: [...unreleased(data), ...out.entries] }, null, 2) + '\n');
    }
    console.log(`collected ${out.entries.length} changelog entries from merged PRs`);
  } else if (cmd === '--commit') {
    const sha = await releaseCommit(arg);
    if (!sha) { console.error(`no commit on this branch releases ${arg}`); Deno.exit(1); }
    console.log(sha);
  } else if (cmd === '--newest') {
    console.log(releases(data)[0]?.tag ?? '');
  } else {
    console.error('usage: release.js --pending | --notes vX.Y.Z | --since | --collect prs.json | --prepare [X.Y.Z] | --commit vX.Y.Z | --newest');
    Deno.exit(2);
  }
}
