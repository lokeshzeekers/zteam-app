import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, EditIcon, EyeIcon } from './ChatIcons';

// Small dropdown on the sender's own message bubble (shown on hover, always
// visible on touch screens). Each action is optional: "Edit" (text messages)
// and "Seen by" (group messages).
export default function MessageMenu({ onEdit, onSeenBy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`msg-menu${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="msg-menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Message options"
        title="Message options"
      >
        <ChevronDownIcon size={15} />
      </button>
      {open && (
        <div className="msg-menu-list" role="menu">
          {onSeenBy && (
            <button type="button" className="msg-menu-item" role="menuitem" onClick={() => { setOpen(false); onSeenBy(); }}>
              <EyeIcon size={14} /> Seen by
            </button>
          )}
          {onEdit && (
            <button type="button" className="msg-menu-item" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>
              <EditIcon size={14} /> Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
