const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/sessionAuth');

const router = Router();

// All file serving requires auth — these contain sensitive crew data

// Photos (person photos, task photos)
router.get('/photos/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../photos', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo not found' });
  res.sendFile(filePath);
});

// Certs (certifications — sensitive employee documents)
router.get('/certs/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../certs', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// Audio (voice report recordings)
router.get('/audio/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../audio', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio not found' });
  res.sendFile(filePath);
});

// Message photos (private message attachments)
router.get('/message-photos/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../message-photos', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo not found' });
  res.sendFile(filePath);
});

// Message audio (private voice messages)
router.get('/message-audio/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../message-audio', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio not found' });
  res.sendFile(filePath);
});

module.exports = router;
