import { useEffect, useState } from 'react';
import api from '../api';
import { FileIcon, SpinnerIcon } from './ChatIcons';

// Map extension -> MIME type we are willing to render inline. We build the
// blob with this type ourselves (never trusting the response), so an uploaded
// .html/.svg can never execute in the app's origin.
const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif',
};
const PDF_TYPE = 'application/pdf';

function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

// Stored value looks like "/uploads/1712345-123.pdf" — we only need the stored name.
function storedName(fileUrl = '') {
  return decodeURIComponent(fileUrl.split('?')[0].split('/').pop() || '');
}

async function fetchBlob(fileUrl, type) {
  const res = await api.get(`/api/files/${encodeURIComponent(storedName(fileUrl))}`, { responseType: 'blob' });
  return new Blob([res.data], { type: type || res.data.type || 'application/octet-stream' });
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function PreviewModal({ kind, url, fileName, onDownload, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="file-preview-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="file-preview-box" onClick={(e) => e.stopPropagation()}>
        <div className="file-preview-bar">
          <span className="file-preview-title" title={fileName}>{fileName}</span>
          <button type="button" className="btn-primary btn-sm" onClick={onDownload}>Download</button>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="file-preview-body">
          {kind === 'image' ? (
            <img src={url} alt={fileName} />
          ) : (
            <iframe src={url} title={fileName} />
          )}
        </div>
      </div>
    </div>
  );
}

// The attachment inside a chat bubble: image thumbnail / file chip with
// Preview (images + PDFs) and Download.
export default function FileAttachment({ fileUrl, fileName }) {
  const ext = extOf(fileName) || extOf(storedName(fileUrl));
  const imageType = IMAGE_TYPES[ext];
  const kind = imageType ? 'image' : ext === 'pdf' ? 'pdf' : null;

  const [thumb, setThumb] = useState(null);
  const [preview, setPreview] = useState(null); // { url }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Images show a thumbnail straight in the bubble.
  useEffect(() => {
    if (kind !== 'image') return undefined;
    let revoked = false;
    let objectUrl = null;
    fetchBlob(fileUrl, imageType)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setThumb(objectUrl);
      })
      .catch(() => { if (!revoked) setError('Could not load image'); });
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileUrl, kind, imageType]);

  useEffect(() => () => { if (preview?.url && kind === 'pdf') URL.revokeObjectURL(preview.url); }, [preview, kind]);

  async function download() {
    setBusy(true); setError('');
    try {
      saveBlob(await fetchBlob(fileUrl), fileName);
    } catch {
      setError('Download failed');
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    if (kind === 'image') {
      if (thumb) setPreview({ url: thumb });
      return;
    }
    setBusy(true); setError('');
    try {
      const blob = await fetchBlob(fileUrl, PDF_TYPE);
      setPreview({ url: URL.createObjectURL(blob) });
    } catch {
      setError('Could not open preview');
    } finally {
      setBusy(false);
    }
  }

  function closePreview() {
    if (preview?.url && kind === 'pdf') URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  return (
    <div className="file-attachment">
      {kind === 'image' && thumb && (
        <button type="button" className="file-thumb" onClick={openPreview} title="Click to preview">
          <img src={thumb} alt={fileName} />
        </button>
      )}
      <div className="file-chip" title={fileName}>
        <span className="file-chip-icon">{busy ? <SpinnerIcon size={18} /> : <FileIcon size={18} />}</span>
        <span className="file-chip-name">{fileName}</span>
        <span className="file-chip-actions">
          {kind && <button type="button" onClick={openPreview} disabled={busy || (kind === 'image' && !thumb)}>Preview</button>}
          <button type="button" onClick={download} disabled={busy}>Download</button>
        </span>
      </div>
      {error && <div className="file-error">{error}</div>}
      {preview && (
        <PreviewModal kind={kind} url={preview.url} fileName={fileName} onDownload={download} onClose={closePreview} />
      )}
    </div>
  );
}
