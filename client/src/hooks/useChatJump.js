import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// Jump-to-message behaviour shared by the DM chat and the group chat.
//
//  - jumpTo(id): scroll to + flash the message; if it is not in the loaded window
//    yet, fetch a window around it (server `around=` option) and then scroll.
//  - ?msg=<id> in the URL (coming from the global Search page) is honoured once on load.
//  - pendingRef stays set until the scroll has happened, so the page's own
//    "scroll to bottom on new messages" effect can skip while a jump is in flight.
//
// Message elements must have id={`msg-${message.id}`}.
export default function useChatJump({ scopeKey, setMessages, setHasMore, fetchAround }) {
  const [params, setParams] = useSearchParams();
  const [highlightId, setHighlightId] = useState(null);
  const [detached, setDetached] = useState(false); // viewing an older window, not the live bottom
  const pendingRef = useRef(null);
  const flashTimer = useRef(null);
  const initialRef = useRef(Number(params.get('msg')) || null);

  // New chat opened in the same component instance: re-read the URL.
  // (Declared before the page's own load effect so the value is ready for it.)
  useEffect(() => {
    initialRef.current = Number(params.get('msg')) || null;
    setDetached(false);
    pendingRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const flash = useCallback((id) => {
    setHighlightId(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHighlightId(null), 2200);
  }, []);

  const scrollToId = useCallback((id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(id);
    return true;
  }, [flash]);

  // Once a new window has rendered, scroll to the pending message.
  const afterRender = useCallback(() => {
    const id = pendingRef.current;
    if (!id) return;
    requestAnimationFrame(() => {
      scrollToId(id);
      pendingRef.current = null;
    });
  }, [scrollToId]);

  const applyWindow = useCallback((id, data) => {
    pendingRef.current = id;
    setMessages(data.messages);
    setHasMore(data.hasMore);
    setDetached(true);
  }, [setMessages, setHasMore]);

  const jumpTo = useCallback(async (id) => {
    if (scrollToId(id)) return;
    try {
      const data = await fetchAround(id);
      applyWindow(id, data);
    } catch {
      /* message no longer reachable (deleted / cleared) — stay where we are */
    }
  }, [scrollToId, fetchAround, applyWindow]);

  // Called by the page's loadFirstPage: returns the message id to open around (once), or null.
  // Kept referentially stable (reads the URL through refs) so it never re-triggers the
  // page's load effect when the ?msg param is stripped.
  const paramsRef = useRef(params);
  const setParamsRef = useRef(setParams);
  paramsRef.current = params;
  setParamsRef.current = setParams;
  const takeInitial = useCallback(() => {
    const id = initialRef.current;
    if (!id) return null;
    initialRef.current = null;
    if (paramsRef.current.has('msg')) setParamsRef.current({}, { replace: true });
    return id;
  }, []);

  const clearDetached = useCallback(() => setDetached(false), []);

  return { highlightId, detached, pendingRef, jumpTo, takeInitial, applyWindow, afterRender, clearDetached };
}
