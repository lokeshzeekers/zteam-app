async function uploadFile(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json({
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
    size: req.file.size,
  });
}

module.exports = { uploadFile };
