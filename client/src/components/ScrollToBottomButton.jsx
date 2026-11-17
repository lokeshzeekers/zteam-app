// Small round "go to the latest message" button that floats over the chat.
export default function ScrollToBottomButton({ visible, onClick }) {
  if (!visible) return null;
  return (
    <button type="button" className="scroll-bottom-btn" onClick={onClick} aria-label="Scroll to latest message" title="Scroll to latest">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
