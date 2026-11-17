import { useEffect, useRef, useState } from 'react';

// WhatsApp-style "⋮" menu: a three-dot button that opens a list of TEXT options.
// Used in the chat headers on phones and tablets (icon row is kept on desktop).
// items: [{ label, icon?, onClick, danger?, active?, hidden? }]
export default function ChatMenu({ items, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`chat-menu ${className}`} ref={ref}>
      <button
        type="button"
        className="chat-menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="chat-menu-list" role="menu">
          {items.filter((i) => !i.hidden).map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className={`${i.danger ? 'danger' : ''}${i.active ? ' active' : ''}`}
              onClick={() => { setOpen(false); i.onClick(); }}
            >
              {i.icon && <span className="chat-menu-icon" aria-hidden="true">{i.icon}</span>}
              <span>{i.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
