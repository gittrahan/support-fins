// Offset-based edits leave original XML (including unknown metadata) intact.
// Only manifests go through this small tree; large mesh files use threemf.js.
export const local = (name) => name.split(':').pop();
export const escapeXML = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, c) =>
  c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : +c.slice(1))
    : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[c]);

export function xmlTree(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML declarations with entities are not supported');
  const top = { children: [] }, stack = [top];
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  for (const match of xml.matchAll(tags)) {
    const raw = match[0];
    if (/^<[/!?]/.test(raw) && !raw.startsWith('</')) continue;
    const tag = raw.match(/^<\/?([^\s/>]+)/)[1];
    if (raw.startsWith('</')) {
      const node = stack.pop();
      if (node === top || node.tag !== tag) throw new Error('unbalanced project XML');
      node.close = match.index; node.end = match.index + raw.length;
    } else {
      const attrs = {};
      for (const a of raw.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        if (Object.hasOwn(attrs, a[1])) throw new Error('duplicate XML attribute');
        attrs[a[1]] = decode(a[2] ?? a[3]);
      }
      const selfClosing = /\/>$/.test(raw);
      const node = { tag, attrs, start: match.index, open: match.index + raw.length,
        close: selfClosing ? match.index + raw.length - 2 : null,
        end: selfClosing ? match.index + raw.length : null, selfClosing, children: [] };
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  if (stack.length !== 1 || top.children.length !== 1) throw new Error('invalid project XML');
  return top.children[0];
}

export const children = (node, tag) => node.children.filter((n) => local(n.tag) === tag);
export const child = (node, tag) => children(node, tag)[0];
export const metadata = (node) => Object.fromEntries(children(node, 'metadata')
  .filter((n) => n.attrs.key).map((n) => [n.attrs.key, n.attrs.value]));
export const meta = (key, value) => `<metadata key="${escapeXML(key)}" value="${escapeXML(value)}"/>`;
export const attr = (node, name) => Object.entries(node.attrs).find(([k]) => local(k) === name)?.[1];

export function insert(node, text) {
  if (!node.selfClosing) return [node.close, node.close, text];
  return [node.close, node.end, `>${text}</${node.tag}>`];
}

export function editXML(xml, edits) {
  let last = xml.length;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    if (end > last || start > end) throw new Error('overlapping project edits');
    xml = xml.slice(0, start) + text + xml.slice(end); last = start;
  }
  return xml;
}
