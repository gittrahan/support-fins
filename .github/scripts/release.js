// The release step, run by release.yml with Deno (the repo's CI already has it); tested in
// tests/release.test.js. web/changelog.json is the source: PRs append to `unreleased`, the
// release PR moves them under a version (`stamp`), and merging it makes the GitHub Release.
//
//   deno run -A .github/scripts/release.js --pending            # JSON array of released versions with no tag yet, oldest first
//   deno run -A .github/scripts/release.js --notes v1.0.1       # that release's body
//   deno run -A .github/scripts/release.js --prepare [1.1.0]    # stamp unreleased in place; prints the version, or nothing
//   deno run -A .github/scripts/release.js --carry old.json      # the version an open release PR chose, if still ahead
//
// Existing tags come from `git tag --list 'v*'` (the workflow fetches tags first).
import { isNewer, nextVersion, releases, stamp, unreleased } from '../../web/changelog.js';

const FILE = new URL('../../web/changelog.json', import.meta.url);
const GROUPS = { held: 'Held', stays: 'Stays put', clean: 'Comes off clean', easy: 'Easy anywhere', all: 'Everything' };

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

/** The release body: one line per entry (linked to its PR), then any longer summaries by check. */
export function notesFor(release, repo = 'gittrahan/support-fins') {
  const out = release.entries.map((e) => `- ${defang(e.text)}${e.pr ? ` (https://github.com/${repo}/pull/${e.pr})` : ''}`);
  const groups = {};
  for (const e of release.entries) for (const g of e.summary ?? []) (groups[g.check] ??= []).push(...g.items);
  for (const [check, items] of Object.entries(groups)) out.push('', `**${GROUPS[check]}**`, ...items.map((i) => `- ${defang(i)}`));
  out.push('', `Plugin builds are attached below. Docker: \`ghcr.io/${repo}:${release.tag}\`.`);
  return out.join('\n');
}

/** The release PR's change: unreleased stamped under `version` (default: one patch up). Null when nothing waits. */
export function prepare(data, version, date) {
  if (!unreleased(data).length) return null;
  const v = version || nextVersion(data);
  return { version: v, data: stamp(data, v, date) };
}

/** The version an open release PR was given (say a hand-picked 1.1.0), so rebuilding the PR keeps it. */
export function carried(data, prData) {
  const v = releases(prData)[0]?.version;
  return v && isNewer(data, v) ? v : '';
}

async function gitTags() {
  const { stdout } = await new Deno.Command('git', { args: ['tag', '--list', 'v*'], stdout: 'piped' }).output();
  return new TextDecoder().decode(stdout).split('\n').filter(Boolean);
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
      console.log(out.version);
    }
  } else if (cmd === '--carry') {
    let prData = null;
    try { prData = JSON.parse(await Deno.readTextFile(arg)); } catch { /* no open release PR */ }
    console.log(carried(data, prData));
  } else {
    console.error('usage: release.js --pending | --notes vX.Y.Z | --prepare [X.Y.Z] | --carry FILE');
    Deno.exit(2);
  }
}
