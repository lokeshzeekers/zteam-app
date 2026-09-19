import api from '../api';

const Icon = ({ children, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const PaperclipIcon = (props) => (
  <Icon {...props}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Icon>
);
export const FileIcon = (props) => (
  <Icon {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></Icon>
);
export const SendIcon = (props) => (
  <Icon {...props}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Icon>
);
export const SpinnerIcon = (props) => (
  <Icon {...props}><path d="M21 12a9 9 0 1 1-6.22-8.56" className="spin" /></Icon>
);

// The attachment inside a chat bubble: a file chip instead of a bare 📎 link.
export function FileAttachment({ fileUrl, fileName }) {
  return (
    <a className="file-chip" href={(api.defaults.baseURL || '') + fileUrl} target="_blank" rel="noreferrer" title={fileName}>
      <span className="file-chip-icon"><FileIcon size={18} /></span>
      <span className="file-chip-name">{fileName}</span>
    </a>
  );
}

// The little button next to the message box that opens the file picker.
export function AttachButton({ onClick, uploading }) {
  return (
    <button
      type="button"
      className="attach-btn"
      onClick={onClick}
      disabled={uploading}
      title={uploading ? 'Uploading…' : 'Attach a file'}
      aria-label="Attach a file"
    >
      {uploading ? <SpinnerIcon size={19} /> : <PaperclipIcon size={19} />}
    </button>
  );
}
