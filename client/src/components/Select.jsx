import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A styled replacement for the browser's native <select>. The native dropdown
// list cannot be styled at all, so this renders its own menu (in a portal, so
// it is never clipped by a modal's scroll area) with full keyboard support:
// Arrow keys / Home / End to move, Enter or Space to choose, Esc to close.
//
//   <Select value={x} onChange={(v) => ...} options={[{ value: 'a', label: 'A' }]} />
//
// `onChange` receives the option's value (not an event).

const MENU_MAX_HEIGHT = 260;

export default function Select({
  value, onChange, options, placeholder = 'Select…', disabled = false, className = '', ariaLabel, id,
}) {
  const autoId = useId();
  const listId = `${id || autoId}-list`;
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);

  const selectedIndex = useMemo(
    () => options.findIndex((o) => String(o.value) === String(value)),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openMenu = useCallback(() => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const closeMenu = useCallback(() => setOpen(false), []);

  const choose = useCallback((opt) => {
    onChange?.(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }, [onChange]);

  // Position the menu under (or, when there is no room, above) the trigger.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < Math.min(MENU_MAX_HEIGHT, options.length * 38 + 12) && r.top > spaceBelow;
    setPos(openUp
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(MENU_MAX_HEIGHT, r.top - 12) }
      : { left: r.left, width: r.width, top: r.bottom + 6, maxHeight: Math.min(MENU_MAX_HEIGHT, spaceBelow - 12) });
  }, [open, options.length]);

  // Close on outside click, resize, or when something behind the menu scrolls.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Keep the highlighted option visible while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, pos]);

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive((i) => Math.max(0, i - 1)); break;
      case 'Home': e.preventDefault(); setActive(0); break;
      case 'End': e.preventDefault(); setActive(options.length - 1); break;
      case 'Enter':
      case ' ': e.preventDefault(); if (options[active]) choose(options[active]); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); closeMenu(); break;
      case 'Tab': closeMenu(); break;
      default: break;
    }
  }

  return (
    <div className={`select ${className}`}>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className={`select-trigger ${open ? 'open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value ${selected ? '' : 'select-placeholder'}`}>{selected ? selected.label : placeholder}</span>
        <svg className="select-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="select-menu"
          style={pos}
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.length === 0 && <div className="select-empty">No options</div>}
          {options.map((opt, i) => (
            <div
              key={String(opt.value)}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === selectedIndex}
              className={`select-option ${i === active ? 'active' : ''} ${i === selectedIndex ? 'selected' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(opt)}
            >
              <span>{opt.label}</span>
              {i === selectedIndex && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
