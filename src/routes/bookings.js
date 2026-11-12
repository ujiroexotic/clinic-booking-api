import express from 'express';
import crypto from 'node:crypto';
import {
  getSlotById,
  createBooking,
  getBookingById,
  cancelBooking,
  listBookings,
  getIdempotencyRecord,
  saveIdempotencyRecord,
  checkAndRecordRateLimit
} from '../db.js';
import { config } from '../config.js';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashBody(body) {
  // Sort keys for stable representation
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

// POST /bookings
router.post('/', async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    let bodyHash = null;

    // Level 4: Idempotency Key check
    if (idempotencyKey) {
      bodyHash = hashBody(req.body);
      const existing = await getIdempotencyRecord(idempotencyKey);
      if (existing) {
        if (existing.body_hash === bodyHash) {
          const cachedBody = JSON.parse(existing.response_body);
          return res.status(existing.status_code).json(cachedBody);
        } else {
          return res.status(422).json({ error: 'Idempotency-Key reused with a different request body' });
        }
      }
    }

    // Level 5: Rate Limiting by email
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (rawEmail) {
      const rateLimit = await checkAndRecordRateLimit(
        rawEmail,
        config.rateLimitWindowMs,
        config.rateLimitMaxAttempts
      );
      if (!rateLimit.allowed) {
        res.setHeader('Retry-After', rateLimit.retryAfter.toString());
        return res.status(429).json({ error: 'Too many booking attempts for this email' });
      }
    }

    // Level 2: Field validation
    const slotId = typeof req.body?.slot_id === 'string' ? req.body.slot_id.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = rawEmail;

    if (!slotId || !name || !email) {
      return res.status(400).json({ error: 'Missing or empty slot_id, name, or email' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Level 2: Slot exists check
    const slot = await getSlotById(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Slot does not exist' });
    }

    // Level 2: Slot already started check
    const slotStartTime = new Date(slot.start).getTime();
    if (slotStartTime <= Date.now()) {
      return res.status(400).json({ error: 'The slot has already started' });
    }

    // Level 1 & 3: Create booking
    const bookingId = 'b_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const createdAt = new Date().toISOString();

    const bookingResult = await createBooking({
      id: bookingId,
      slot_id: slotId,
      name,
      email,
      status: 'confirmed',
      created_at: createdAt
    });

    if (bookingResult.error === 'conflict') {
      return res.status(409).json({ error: 'Slot already booked' });
    }

    if (bookingResult.error === 'not_found') {
      return res.status(404).json({ error: 'Slot does not exist' });
    }

    const responseData = {
      id: bookingId,
      slot_id: slotId,
      name,
      email,
      status: 'confirmed',
      created_at: createdAt
    };

    // Save idempotency record if key was provided
    if (idempotencyKey) {
      await saveIdempotencyRecord(idempotencyKey, bodyHash, 201, JSON.stringify(responseData));
    }

    return res.status(201).json(responseData);
  } catch (err) {
    next(err);
  }
});

// GET /bookings (Level 4: List a person's bookings with cursor pagination)
router.get('/', async (req, res, next) => {
  try {
    const { email, limit, cursor } = req.query;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Missing required query parameter: email' });
    }

    let parsedLimit = 10;
    if (limit !== undefined) {
      const num = Number(limit);
      if (!Number.isInteger(num) || num < 1 || num > 50) {
        return res.status(400).json({ error: 'Limit must be an integer between 1 and 50' });
      }
      parsedLimit = num;
    }

    const result = await listBookings({
      email: email.trim().toLowerCase(),
      limit: parsedLimit,
      cursor: cursor ? String(cursor) : null
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /bookings/:id (Level 1: Get a booking)
router.get('/:id', async (req, res, next) => {
  try {
    const booking = await getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'No booking with that id' });
    }
    return res.status(200).json(booking);
  } catch (err) {
    next(err);
  }
});

// DELETE /bookings/:id (Level 3: Cancel a booking)
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await cancelBooking(req.params.id);
    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'No booking with that id' });
    }
    if (result.error === 'already_cancelled') {
      return res.status(409).json({ error: 'Already cancelled' });
    }
    return res.status(200).json(result.booking);
  } catch (err) {
    next(err);
  }
});

export default router;
