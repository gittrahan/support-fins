// The changelog's one rule, shared by the landing card, the test and the release
// workflow: an entry's version is its position (entry 0 = v<base>.0). Pure, no imports,
// so Node and Deno can load it too.
export const CHECKS = ['held', 'stays', 'clean', 'easy', 'all'];

/** [{...entry, version: '0.7.2', tag: 'v0.7.2'}] oldest first, or [] for anything malformed. */
export function withVersions(data) {
  if (!data || typeof data.base !== 'string' || !Array.isArray(data.entries)) return [];
  return data.entries.map((e, i) => ({ ...e, version: `${data.base}.${i}`, tag: `v${data.base}.${i}` }));
}

/** The newest `n` entries, newest first. */
export function latest(data, n = 4) {
  return withVersions(data).reverse().slice(0, n);
}
