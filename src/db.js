import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let sqliteDb = null;
let pgPool = null;
const isPg = Boolean(config.databaseUrl);

export async function initDb() {
  if (isPg) {
    pgPool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    // Test connection
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS slots (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          slot_id TEXT NOT NULL REFERENCES slots(id),
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot_pg 
        ON bookings (slot_id) WHERE status = 'confirmed';

        CREATE TABLE IF NOT EXISTS idempotency (
          key TEXT PRIMARY KEY,
          body_hash TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          response_body TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rate_limits (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          attempted_at BIGINT NOT NULL
        );
      `);
    } finally {
      client.release();
    }
  } else {
    // Ensure dir if file path has folder
    const dbDir = path.dirname(config.dbFile);
    if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    sqliteDb = new DatabaseSync(config.dbFile);
    sqliteDb.exec(`PRAGMA journal_mode = WAL;`);
    sqliteDb.exec(`PRAGMA busy_timeout = 5000;`);
    sqliteDb.exec(`PRAGMA foreign_keys = ON;`);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL REFERENCES slots(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot 
      ON bookings (slot_id) WHERE status = 'confirmed';

      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        body_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        attempted_at INTEGER NOT NULL
      );
    `);
  }
}

export async function resetDatabase(slots) {
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM slots');
      await client.query('DELETE FROM idempotency');
      await client.query('DELETE FROM rate_limits');

      for (const slot of slots) {
        await client.query(
          'INSERT INTO slots (id, provider, start_time, end_time) VALUES ($1, $2, $3, $4)',
          [slot.id, slot.provider, slot.start, slot.end]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    sqliteDb.exec('BEGIN IMMEDIATE');
    try {
      sqliteDb.exec('DELETE FROM bookings;');
      sqliteDb.exec('DELETE FROM slots;');
      sqliteDb.exec('DELETE FROM idempotency;');
      sqliteDb.exec('DELETE FROM rate_limits;');

      const insertStmt = sqliteDb.prepare(
        'INSERT INTO slots (id, provider, start_time, end_time) VALUES (?, ?, ?, ?)'
      );
      for (const slot of slots) {
        insertStmt.run(slot.id, slot.provider, slot.start, slot.end);
      }
      sqliteDb.exec('COMMIT');
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  }
}

export async function getSlots(providerFilter) {
  if (isPg) {
    let query = `
      SELECT 
        s.id, 
        s.provider, 
        s.start_time as start, 
        s.end_time as end,
        CASE WHEN b.id IS NOT NULL THEN false ELSE true END AS available
      FROM slots s
      LEFT JOIN bookings b ON s.id = b.slot_id AND b.status = 'confirmed'
    `;
    const params = [];
    if (providerFilter) {
      params.push(providerFilter);
      query += ` WHERE s.provider = $1`;
    }
    query += ` ORDER BY s.start_time ASC`;

    const res = await pgPool.query(query, params);
    return res.rows.map(r => ({
      id: r.id,
      provider: r.provider,
      start: r.start,
      end: r.end,
      available: Boolean(r.available)
    }));
  } else {
    let query = `
      SELECT 
        s.id, 
        s.provider, 
        s.start_time as start, 
        s.end_time as end,
        CASE WHEN b.id IS NOT NULL THEN 0 ELSE 1 END AS available
      FROM slots s
      LEFT JOIN bookings b ON s.id = b.slot_id AND b.status = 'confirmed'
    `;
    const params = [];
    if (providerFilter) {
      params.push(providerFilter);
      query += ` WHERE s.provider = ?`;
    }
    query += ` ORDER BY s.start_time ASC`;

    const stmt = sqliteDb.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(r => ({
      id: r.id,
      provider: r.provider,
      start: r.start,
      end: r.end,
      available: r.available === 1
    }));
  }
}

export async function getSlotById(id) {
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, provider, start_time as start, end_time as end FROM slots WHERE id = $1',
      [id]
    );
    return res.rows[0] || null;
  } else {
    const stmt = sqliteDb.prepare(
      'SELECT id, provider, start_time as start, end_time as end FROM slots WHERE id = ?'
    );
    const row = stmt.get(id);
    return row || null;
  }
}

export async function createBooking({ id, slot_id, name, email, status, created_at }) {
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // Check slot existence
      const slotRes = await client.query('SELECT * FROM slots WHERE id = $1', [slot_id]);
      if (slotRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: 'not_found' };
      }

      // Check if already booked
      const existing = await client.query(
        "SELECT id FROM bookings WHERE slot_id = $1 AND status = 'confirmed'",
        [slot_id]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { error: 'conflict' };
      }

      await client.query(
        'INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, slot_id, name, email, status, created_at]
      );
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') { // Unique violation
        return { error: 'conflict' };
      }
      throw err;
    } finally {
      client.release();
    }
  } else {
    sqliteDb.exec('BEGIN IMMEDIATE');
    try {
      const slotStmt = sqliteDb.prepare('SELECT id FROM slots WHERE id = ?');
      const slot = slotStmt.get(slot_id);
      if (!slot) {
        sqliteDb.exec('ROLLBACK');
        return { error: 'not_found' };
      }

      const checkStmt = sqliteDb.prepare(
        "SELECT id FROM bookings WHERE slot_id = ? AND status = 'confirmed'"
      );
      const existing = checkStmt.get(slot_id);
      if (existing) {
        sqliteDb.exec('ROLLBACK');
        return { error: 'conflict' };
      }

      const insertStmt = sqliteDb.prepare(
        'INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      insertStmt.run(id, slot_id, name, email, status, created_at);
      sqliteDb.exec('COMMIT');
      return { success: true };
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return { error: 'conflict' };
      }
      throw err;
    }
  }
}

export async function getBookingById(id) {
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1',
      [id]
    );
    return res.rows[0] || null;
  } else {
    const stmt = sqliteDb.prepare(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?'
    );
    const row = stmt.get(id);
    return row || null;
  }
}

export async function cancelBooking(id) {
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: 'not_found' };
      }
      const booking = res.rows[0];
      if (booking.status === 'cancelled') {
        await client.query('ROLLBACK');
        return { error: 'already_cancelled' };
      }

      await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);
      booking.status = 'cancelled';
      await client.query('COMMIT');
      return { booking };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    sqliteDb.exec('BEGIN IMMEDIATE');
    try {
      const getStmt = sqliteDb.prepare('SELECT * FROM bookings WHERE id = ?');
      const booking = getStmt.get(id);
      if (!booking) {
        sqliteDb.exec('ROLLBACK');
        return { error: 'not_found' };
      }
      if (booking.status === 'cancelled') {
        sqliteDb.exec('ROLLBACK');
        return { error: 'already_cancelled' };
      }

      const updateStmt = sqliteDb.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?");
      updateStmt.run(id);
      sqliteDb.exec('COMMIT');
      booking.status = 'cancelled';
      return { booking };
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  }
}

export async function listBookings({ email, limit, cursor }) {
  let parsedCursor = null;
  if (cursor) {
    try {
      parsedCursor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      // invalid cursor
    }
  }

  // Fetch limit + 1 to know if there's a next page
  const fetchLimit = limit + 1;

  if (isPg) {
    let query = `
      SELECT id, slot_id, name, email, status, created_at 
      FROM bookings 
      WHERE LOWER(email) = LOWER($1)
    `;
    const params = [email];

    if (parsedCursor && parsedCursor.c && parsedCursor.id) {
      params.push(parsedCursor.c, parsedCursor.id);
      query += ` AND (created_at > $2 OR (created_at = $2 AND id > $3))`;
    }

    params.push(fetchLimit);
    query += ` ORDER BY created_at ASC, id ASC LIMIT $${params.length}`;

    const res = await pgPool.query(query, params);
    const rows = res.rows;
    let next_cursor = null;

    if (rows.length > limit) {
      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      next_cursor = Buffer.from(JSON.stringify({ c: last.created_at, id: last.id })).toString('base64url');
      return { bookings: pageRows, next_cursor };
    } else {
      return { bookings: rows, next_cursor: null };
    }
  } else {
    let query = `
      SELECT id, slot_id, name, email, status, created_at 
      FROM bookings 
      WHERE LOWER(email) = LOWER(?)
    `;
    const params = [email];

    if (parsedCursor && parsedCursor.c && parsedCursor.id) {
      params.push(parsedCursor.c, parsedCursor.c, parsedCursor.id);
      query += ` AND (created_at > ? OR (created_at = ? AND id > ?))`;
    }

    params.push(fetchLimit);
    query += ` ORDER BY created_at ASC, id ASC LIMIT ?`;

    const stmt = sqliteDb.prepare(query);
    const rows = stmt.all(...params);
    let next_cursor = null;

    if (rows.length > limit) {
      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      next_cursor = Buffer.from(JSON.stringify({ c: last.created_at, id: last.id })).toString('base64url');
      return { bookings: pageRows, next_cursor };
    } else {
      return { bookings: rows, next_cursor: null };
    }
  }
}

export async function getIdempotencyRecord(key) {
  if (isPg) {
    const res = await pgPool.query('SELECT * FROM idempotency WHERE key = $1', [key]);
    return res.rows[0] || null;
  } else {
    const stmt = sqliteDb.prepare('SELECT * FROM idempotency WHERE key = ?');
    return stmt.get(key) || null;
  }
}

export async function saveIdempotencyRecord(key, body_hash, status_code, response_body) {
  const createdAt = new Date().toISOString();
  if (isPg) {
    await pgPool.query(
      `INSERT INTO idempotency (key, body_hash, status_code, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET 
         body_hash = EXCLUDED.body_hash,
         status_code = EXCLUDED.status_code,
         response_body = EXCLUDED.response_body`,
      [key, body_hash, status_code, response_body, createdAt]
    );
  } else {
    const stmt = sqliteDb.prepare(
      `INSERT OR REPLACE INTO idempotency (key, body_hash, status_code, response_body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(key, body_hash, status_code, response_body, createdAt);
  }
}

export async function checkAndRecordRateLimit(email, windowMs, maxAttempts) {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // Clean old records for this email
      await client.query(
        'DELETE FROM rate_limits WHERE LOWER(email) = LOWER($1) AND attempted_at < $2',
        [email, windowStart]
      );

      // Fetch attempts in window
      const res = await client.query(
        'SELECT attempted_at FROM rate_limits WHERE LOWER(email) = LOWER($1) ORDER BY attempted_at ASC',
        [email]
      );

      // Always record current attempt
      await client.query(
        'INSERT INTO rate_limits (email, attempted_at) VALUES ($1, $2)',
        [email.toLowerCase(), now]
      );
      await client.query('COMMIT');

      if (res.rows.length >= maxAttempts) {
        const oldestAttempt = Number(res.rows[0].attempted_at);
        const retryAfter = Math.max(1, Math.ceil((oldestAttempt + windowMs - now) / 1000));
        return { allowed: false, retryAfter };
      }

      return { allowed: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    sqliteDb.exec('BEGIN IMMEDIATE');
    try {
      // Clean old records
      sqliteDb.prepare(
        'DELETE FROM rate_limits WHERE LOWER(email) = LOWER(?) AND attempted_at < ?'
      ).run(email, windowStart);

      // Count recent attempts
      const attempts = sqliteDb.prepare(
        'SELECT attempted_at FROM rate_limits WHERE LOWER(email) = LOWER(?) ORDER BY attempted_at ASC'
      ).all(email);

      // Record current attempt
      sqliteDb.prepare('INSERT INTO rate_limits (email, attempted_at) VALUES (?, ?)').run(
        email.toLowerCase(),
        now
      );
      sqliteDb.exec('COMMIT');

      if (attempts.length >= maxAttempts) {
        const oldestAttempt = Number(attempts[0].attempted_at);
        const retryAfter = Math.max(1, Math.ceil((oldestAttempt + windowMs - now) / 1000));
        return { allowed: false, retryAfter };
      }

      return { allowed: true };
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  }
}
