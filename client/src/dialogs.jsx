import { useEffect, useState } from 'react';

// In-app replacements for window.confirm() / window.alert().
//
// Why: in the Electron desktop app, the browser's native confirm()/alert() dialogs
// leave the page without keyboard/mouse focus afterwards — text boxes such as
// "Type a message..." then can't be clicked or typed into until the whole app is
// quit and reopened. These dialogs are plain HTML, so focus is never lost, and they
// look the same in the browser and the desktop app.
//
//   if (!(await confirmDialog('Delete this?', { confirmText: 'Delete' }))) return;
//   alertDialog('Something went wrong');

let pushDialog = null;
const pending = [];

function openDialog(dialog) {
  return new Promise((resolve) => {
    const entry = { ...dialog, resolve };
    if (pushDialog) pushDialog(entry);
    else pending.push(entry); // host not mounted yet — shown as soon as it is
  });
}

export function confirmDialog(message, { title, confirmText = 'OK', cancelText = 'Cancel', danger = true } = {}) {
  return openDialog({ kind: 'confirm', message, title, confirmText, cancelText, danger });
}

export function alertDialog(message, { title } = {}) {
  return openDialog({ kind: 'alert', message, title });
}

export function DialogHost() {
  const [stack, setStack] = useState([]);

  useEffect(() => {
    pushDialog = (entry) => setStack((s) => [...s, entry]);
    pending.splice(0).forEach(pushDialog);
    return () => { pushDialog = null; };
  }, []);

  const current = stack[0];

  function close(result) {
    if (!current) return;
    current.resolve(result);
    setStack((s) => s.slice(1));
  }

  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(current.kind === 'alert'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;
  const isConfirm = current.kind === 'confirm';

  return (
    <div className="call-modal dialog-overlay" onClick={() => close(!isConfirm)}>
      <div
        className="edit-modal-inner dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="dialog-title">{current.title || (isConfirm ? 'Please confirm' : 'Notice')}</h3>
        <p id="dialog-message" className="dialog-message">{current.message}</p>
        <div className="edit-modal-actions">
          {isConfirm && (
            <button type="button" className="btn-secondary" onClick={() => close(false)}>{current.cancelText}</button>
          )}
          <button
            type="button"
            className={isConfirm && current.danger ? 'btn-danger' : ''}
            autoFocus
            onClick={() => close(true)}
          >
            {isConfirm ? current.confirmText : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
