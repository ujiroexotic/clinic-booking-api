import express from 'express';
import { resetDatabase } from '../db.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { slots } = req.body || {};
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'Request body must contain a "slots" array' });
    }

    // Validate slots format if present
    for (const slot of slots) {
      if (!slot.id || !slot.provider || !slot.start || !slot.end) {
        return res.status(400).json({ error: 'Each slot must have id, provider, start, and end' });
      }
    }

    await resetDatabase(slots);
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;

