// Wraps every case-insensitive occurrence of `term` in <mark>. Plain text otherwise.
export default function Highlight({ text, term }) {
  const t = (term || '').trim();
  if (!t || !text) return text ?? null;
  const lower = text.toLowerCase();
  const needle = t.toLowerCase();
  const parts = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at} className="search-hit">{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}
