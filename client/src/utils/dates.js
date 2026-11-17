// Day helpers for the chat date separators (WhatsApp style).
// All comparisons use the viewer's LOCAL calendar day, not UTC.

export function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const pad = (n) => String(n).padStart(2, '0');

// Always day/month/year, e.g. 05/03/2026 (never month-first, whatever the browser locale).
export function formatDate(value) {
  const d = new Date(value);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// 05/03/2026, 6:41 PM
export function formatDateTime(value) {
  const d = new Date(value);
  return `${formatDate(d)}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

// "Today", "Yesterday", the weekday for the last week, otherwise day/month/year.
export function dayLabel(value, now = new Date()) {
  const d = new Date(value);
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return formatDate(d);
}

// Walks a time-ordered list and returns it with a { kind: 'date' } marker inserted
// at the start of every new day. `getTime(item)` returns the item's timestamp.
export function withDateSeparators(items, getTime) {
  const out = [];
  let last = null;
  for (const item of items) {
    const t = getTime(item);
    const key = dayKey(t);
    if (key !== last) {
      out.push({ kind: 'date', key: `date-${key}`, time: t });
      last = key;
    }
    out.push(item);
  }
  return out;
}
