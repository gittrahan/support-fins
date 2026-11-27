/** Bind optional browser material metadata to the archive members it describes.
 * Repainting, changing geometry or adding slicer settings invalidates the field;
 * source data is then decoded again, rather than trusting a stale session. */
export async function materialSessionFingerprint(parts) {
  const relevant = [...parts].filter(([name]) =>
    name.endsWith('.model') || name.endsWith('.config') || name === 'Metadata/PrusaSlicer3_project.json'
  ).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const encoder = new TextEncoder(), records = [];
  const digest = async (bytes) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  for (const [name, data] of relevant) {
    records.push([name, await digest(typeof data === 'string' ? encoder.encode(data) : data)]);
  }
  return digest(encoder.encode(JSON.stringify(records)));
}
