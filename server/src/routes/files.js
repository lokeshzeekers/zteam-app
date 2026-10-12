const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { uploadFile } = require('../controllers/fileController');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB — internal ~20-person team, generous but bounded

// Simple, deliberately not exhaustive: block the extensions that can
// actually execute code on a teammate's machine. Everything else (docs,
// PDFs, images, spreadsheets, zips, etc.) keeps working exactly as before.
// No antivirus/scanning — just an extension check, per the brief.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.msi', '.ps1', '.scr', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.com', '.jar', '.app', '.gadget',
  '.sh', '.bash', '.apk', '.cpl', '.hta', '.reg',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new Error(`For security, "${ext}" files can't be shared here.`));
    }
    cb(null, true);
  },
});

// Turn multer's errors (file too large, blocked extension) into the same
// clean { error } JSON shape every other endpoint already uses, instead of
// letting them fall through as an unhandled exception / raw stack trace.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'That file is larger than the 100MB limit.' });
    }
    if (err) {
      return res.status(400).json({ error: err.message || 'Could not upload that file.' });
    }
    next();
  });
}

router.post('/upload', requireAuth, handleUpload, uploadFile);

// Authenticated file fetch. The client reads this with its Bearer token and
// turns the response into a blob for preview/download, so it works the same
// in the browser, behind a reverse proxy that only forwards /api, and inside
// Electron (where a relative /uploads/... URL would not resolve at all).
router.get('/:filename', requireAuth, (req, res) => {
  const { filename } = req.params;
  if (!filename || path.basename(filename) !== filename || filename.startsWith('.')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  const full = path.join(uploadDir, filename);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(full, { dotfiles: 'deny' });
});

module.exports = router;
