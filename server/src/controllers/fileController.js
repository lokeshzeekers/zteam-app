const jwt = require('jsonwebtoken');
const path = require('path');

async function uploadFile(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json({
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
    size: req.file.size,
  });
}

// Issues a 2-minute single-file download token so Android WebView / mobile browsers
// can hand an authenticated HTTPS URL directly to Android's native DownloadManager.
async function createDownloadLink(req, res) {
  const { filename } = req.params;
  if (!filename || path.basename(filename) !== filename || filename.startsWith('.')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  const downloadName = typeof req.body?.fileName === 'string' && req.body.fileName.trim()
    ? req.body.fileName.trim().slice(0, 200)
    : filename;

  const token = jwt.sign(
    { purpose: 'file-download', uid: req.user.id, file: filename, name: downloadName },
    process.env.JWT_SECRET,
    { expiresIn: '2m' }
  );
  res.json({
    url: `/api/files/download/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`,
  });
}

module.exports = { uploadFile, createDownloadLink };
