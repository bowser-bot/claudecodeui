import express from 'express';

import { getSentFile } from '../sent-files.js';

const router = express.Router();

/**
 * GET /api/files/sent/:token
 * Streams a file an agent delivered via the `send_user_file` tool. Mounted
 * behind authenticateToken; the token is additionally scoped to the user that
 * registered it.
 */
router.get('/sent/:token', (req, res) => {
  const entry = getSentFile(req.params.token, req.user?.id);
  if (!entry) {
    res.status(404).json({ error: 'File not found or expired' });
    return;
  }
  res.download(entry.absPath, entry.name, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to read file' });
    }
  });
});

export default router;
