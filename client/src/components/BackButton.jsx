import { useNavigate } from 'react-router-dom';

// Goes back to wherever the user actually came from (browser-style history
// back), with a sensible fallback for the rare case there's no history yet
// (e.g. a bookmarked/deep link straight into a chat).
export default function BackButton({ fallback = '/' }) {
  const navigate = useNavigate();
  function goBack() {
    if (window.history.length > 2) navigate(-1);
    else navigate(fallback);
  }
  return (
    <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
      Back
    </button>
  );
}
