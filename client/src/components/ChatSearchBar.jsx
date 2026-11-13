import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from './ChatIcons';

const Chevron = ({ up }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points={up ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
  </svg>
);

// Search-inside-this-chat bar. Matches arrive newest-first; the up arrow steps to OLDER
// matches, the down arrow to NEWER ones (like WhatsApp). The parent owns scrolling:
// onJump(match) fires whenever the active match changes.
export default function ChatSearchBar({ fetchMatches, onJump, onTermChange, onClose }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search as you type.
  useEffect(() => {
    const term = q.trim();
    onTermChange?.(term);
    if (!term) { setMatches([]); setIdx(0); setSearched(false); return undefined; }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const found = await fetchMatches(term);
        if (mine !== seq.current) return; // a newer search superseded this one
        setMatches(found);
        setIdx(0);
        setSearched(true);
        if (found.length) onJump(found[0]);
      } catch {
        if (mine === seq.current) { setMatches([]); setSearched(true); }
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function step(delta) {
    if (!matches.length) return;
    const next = (idx + delta + matches.length) % matches.length;
    setIdx(next);
    onJump(matches[next]);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  }

  let status = '';
  if (busy) status = 'Searching…';
  else if (searched) status = matches.length ? `${idx + 1} of ${matches.length}` : 'No results';

  return (
    <div className="chat-search-bar">
      <SearchIcon size={17} />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search in this chat…"
        aria-label="Search in this chat"
      />
      <span className="chat-search-status muted small" aria-live="polite">{status}</span>
      <button type="button" className="icon-btn-sm" onClick={() => step(1)} disabled={matches.length < 2} title="Older match" aria-label="Older match"><Chevron up /></button>
      <button type="button" className="icon-btn-sm" onClick={() => step(-1)} disabled={matches.length < 2} title="Newer match" aria-label="Newer match"><Chevron /></button>
      <button type="button" className="icon-btn-sm" onClick={onClose} title="Close search" aria-label="Close search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}
