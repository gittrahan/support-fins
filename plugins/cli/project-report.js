// A completed computation is not necessarily a written project: an explicit
// selection or the final write can still fail. Keep those facts separate.
export class ProjectReport {
  constructor(check) {
    this.mode = check ? 'check' : 'generate';
    this.outputWritten = false;
    this.results = new Map();
  }

  select(objects) {
    for (const { number, id, name, plate } of objects) {
      this.results.set(number, { number, id, name, plate, status: 'not_processed', reason: null, warnings: [] });
    }
  }

  object(o) { return this.results.get(o.number); }

  data() {
    const objectResults = [...this.results.values()];
    const summary = { selected: objectResults.length, compatible: 0, incompatible: 0,
      processed: 0, no_supports: 0, skipped: 0, failed: 0, not_processed: 0 };
    for (const o of objectResults) summary[o.status]++;
    return { mode: this.mode, outputWritten: this.outputWritten, objectResults, summary };
  }
}

export function formatProjectReport({ mode, outputWritten, objectResults, summary }) {
  const counts = Object.entries(summary).filter(([key, n]) => key !== 'selected' && n)
    .map(([key, n]) => `${n} ${key.replaceAll('_', ' ')}`).join(', ');
  const lines = [`${summary.selected} selected${counts ? `: ${counts}` : ''}; `
    + (mode === 'check' ? 'compatibility only; no fins generated or output written'
      : outputWritten ? 'output written' : 'no output written')];
  for (const o of objectResults) {
    lines.push(`  object ${o.number} ${JSON.stringify(o.name)}, plate ${o.plate ?? '?'}: `
      + o.status.replaceAll('_', ' ') + (o.reason ? ` — ${o.reason}` : ''));
    for (const warning of o.warnings) lines.push(`    warning: ${warning}`);
  }
  return lines.join('\n');
}
