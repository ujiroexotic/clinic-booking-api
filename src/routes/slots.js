import express from 'express';
import { getSlots } from '../db.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { provider } = req.query;
    const slots = await getSlots(provider ? String(provider) : null);
    return res.status(200).json({ slots });
  } catch (err) {
    next(err);
  }
});

export default router;
