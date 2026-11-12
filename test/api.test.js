import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { initDb } from '../src/db.js';
import { config } from '../src/config.js';

let server;
let baseUrl;
const API_KEY = config.apiKey;

before(async () => {
  await initDb();
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function apiRequest(endpoint, { method = 'GET', headers = {}, body = null } = {}) {
  const reqHeaders = { ...headers };
  if (body && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: res.status,
    headers: res.headers,
    data
  };
}

describe('Clinic Booking API Tests - All Levels', () => {

  const futureSlot1 = {
    id: 's_future_1',
    provider: 'Dr Ade',
    start: '2028-12-10T09:00:00Z',
    end: '2028-12-10T09:30:00Z'
  };

  const futureSlot2 = {
    id: 's_future_2',
    provider: 'Dr Ade',
    start: '2028-12-10T10:00:00Z',
    end: '2028-12-10T10:30:00Z'
  };

  const futureSlot3 = {
    id: 's_future_3',
    provider: 'Dr Bello',
    start: '2028-12-10T11:00:00Z',
    end: '2028-12-10T11:30:00Z'
  };

  const pastSlot = {
    id: 's_past_1',
    provider: 'Dr Past',
    start: '2020-01-01T09:00:00Z',
    end: '2020-01-01T09:30:00Z'
  };

  test('Level 2: Authentication enforcement', async () => {
    // Missing API Key
    const resNoKey = await apiRequest('/slots');
    assert.equal(resNoKey.status, 401);
    assert.ok(resNoKey.data.error);

    // Wrong API Key
    const resWrongKey = await apiRequest('/slots', {
      headers: { 'X-API-Key': 'wrong-key' }
    });
    assert.equal(resWrongKey.status, 401);
    assert.ok(resWrongKey.data.error);
  });

  test('Level 1: Reset and List slots', async () => {
    // Reset database with initial slots
    const resetRes = await apiRequest('/reset', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slots: [futureSlot2, futureSlot1, futureSlot3, pastSlot]
      }
    });
    assert.equal(resetRes.status, 200);

    // List slots (should be ordered earliest start first)
    const listRes = await apiRequest('/slots', {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.data.slots));
    assert.equal(listRes.data.slots.length, 4);

    // Verify ordering: pastSlot (2020), futureSlot1 (09:00), futureSlot2 (10:00), futureSlot3 (11:00)
    assert.equal(listRes.data.slots[0].id, 's_past_1');
    assert.equal(listRes.data.slots[1].id, 's_future_1');
    assert.equal(listRes.data.slots[2].id, 's_future_2');
    assert.equal(listRes.data.slots[3].id, 's_future_3');

    // All slots initially available
    for (const slot of listRes.data.slots) {
      assert.equal(slot.available, true);
    }

    // Filter by provider
    const filterRes = await apiRequest('/slots?provider=Dr%20Bello', {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(filterRes.status, 200);
    assert.equal(filterRes.data.slots.length, 1);
    assert.equal(filterRes.data.slots[0].id, 's_future_3');
  });

  test('Level 2: Input Validation for Bookings', async () => {
    // Missing slot_id
    const resMissingSlot = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: { name: 'Ada Obi', email: 'ada@example.com' }
    });
    assert.equal(resMissingSlot.status, 400);

    // Empty name
    const resEmptyName = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: { slot_id: 's_future_1', name: '   ', email: 'ada@example.com' }
    });
    assert.equal(resEmptyName.status, 400);

    // Invalid email
    const resInvalidEmail = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: { slot_id: 's_future_1', name: 'Ada Obi', email: 'notanemail' }
    });
    assert.equal(resInvalidEmail.status, 400);

    // Non-existent slot
    const resNonExistent = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: { slot_id: 's_does_not_exist', name: 'Ada Obi', email: 'ada@example.com' }
    });
    assert.equal(resNonExistent.status, 404);

    // Slot in the past
    const resPastSlot = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: { slot_id: 's_past_1', name: 'Ada Obi', email: 'ada@example.com' }
    });
    assert.equal(resPastSlot.status, 400);
  });

  let createdBookingId = null;

  test('Level 1: Create booking and lookup', async () => {
    const res = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slot_id: 's_future_1',
        name: '  Ada Obi  ',
        email: '  Ada@Example.COM  '
      }
    });

    assert.equal(res.status, 201);
    assert.ok(res.data.id);
    assert.equal(res.data.slot_id, 's_future_1');
    assert.equal(res.data.name, 'Ada Obi'); // Trimmed
    assert.equal(res.data.email, 'ada@example.com'); // Trimmed and lowercased
    assert.equal(res.data.status, 'confirmed');
    assert.ok(res.data.created_at);

    createdBookingId = res.data.id;

    // Lookup booking by ID
    const getRes = await apiRequest(`/bookings/${createdBookingId}`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.id, createdBookingId);
    assert.equal(getRes.data.status, 'confirmed');

    // Slot should now show available: false
    const slotsRes = await apiRequest('/slots', {
      headers: { 'X-API-Key': API_KEY }
    });
    const bookedSlot = slotsRes.data.slots.find(s => s.id === 's_future_1');
    assert.equal(bookedSlot.available, false);
  });

  test('Level 3: Double booking conflict and cancellation', async () => {
    // Attempt to book the same slot again -> 409
    const conflictRes = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slot_id: 's_future_1',
        name: 'Chioma Chukwu',
        email: 'chioma@example.com'
      }
    });
    assert.equal(conflictRes.status, 409);
    assert.ok(conflictRes.data.error);

    // Cancel the booking
    const cancelRes = await apiRequest(`/bookings/${createdBookingId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.status, 'cancelled');

    // Second cancellation -> 409
    const cancelAgainRes = await apiRequest(`/bookings/${createdBookingId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(cancelAgainRes.status, 409);

    // After cancellation, slot is available again
    const slotsRes = await apiRequest('/slots', {
      headers: { 'X-API-Key': API_KEY }
    });
    const freedSlot = slotsRes.data.slots.find(s => s.id === 's_future_1');
    assert.equal(freedSlot.available, true);

    // Re-booking the freed slot succeeds
    const rebookRes = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slot_id: 's_future_1',
        name: 'Chioma Chukwu',
        email: 'chioma@example.com'
      }
    });
    assert.equal(rebookRes.status, 201);
    assert.equal(rebookRes.data.status, 'confirmed');
  });

  test('Level 3: Concurrency Safety (Simultaneous requests to book same slot)', async () => {
    // Reset to have a fresh future slot
    await apiRequest('/reset', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slots: [
          {
            id: 's_concurrency_race',
            provider: 'Dr Race',
            start: '2029-01-01T09:00:00Z',
            end: '2029-01-01T09:30:00Z'
          }
        ]
      }
    });

    // 10 simultaneous requests to book the exact same slot
    const promises = Array.from({ length: 10 }).map((_, idx) =>
      apiRequest('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: {
          slot_id: 's_concurrency_race',
          name: `User ${idx}`,
          email: `user${idx}@example.com`
        }
      })
    );

    const results = await Promise.all(promises);
    const successResponses = results.filter(r => r.status === 201);
    const conflictResponses = results.filter(r => r.status === 409);

    assert.equal(successResponses.length, 1, 'Exactly one concurrent request must succeed with 201');
    assert.equal(conflictResponses.length, 9, 'All other concurrent requests must return 409 conflict');
  });

  test('Level 4: Idempotency-Key support', async () => {
    // Reset with available slot
    await apiRequest('/reset', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slots: [
          {
            id: 's_idem_1',
            provider: 'Dr Idem',
            start: '2029-05-01T09:00:00Z',
            end: '2029-05-01T09:30:00Z'
          }
        ]
      }
    });

    const idemKey = 'unique-key-abc-123';
    const body1 = {
      slot_id: 's_idem_1',
      name: 'Ibrahim Musa',
      email: 'ibrahim@example.com'
    };

    // First request with idempotency key
    const res1 = await apiRequest('/bookings', {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Idempotency-Key': idemKey
      },
      body: body1
    });
    assert.equal(res1.status, 201);
    const firstBookingId = res1.data.id;

    // Retry with SAME idempotency key and SAME body
    const resRetry = await apiRequest('/bookings', {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Idempotency-Key': idemKey
      },
      body: body1
    });
    assert.equal(resRetry.status, 201);
    assert.equal(resRetry.data.id, firstBookingId);

    // Reuse SAME idempotency key with DIFFERENT body -> 422
    const resMismatch = await apiRequest('/bookings', {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Idempotency-Key': idemKey
      },
      body: {
        slot_id: 's_idem_1',
        name: 'Different Person',
        email: 'different@example.com'
      }
    });
    assert.equal(resMismatch.status, 422);
    assert.ok(resMismatch.data.error);
  });

  test('Level 4: Cursor pagination for GET /bookings', async () => {
    // Reset and insert multiple slots
    const slots = Array.from({ length: 5 }).map((_, i) => ({
      id: `s_page_${i}`,
      provider: 'Dr Page',
      start: `2030-01-0${i + 1}T10:00:00Z`,
      end: `2030-01-0${i + 1}T10:30:00Z`
    }));

    await apiRequest('/reset', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: { slots }
    });

    const patientEmail = 'paginate.user@example.com';

    // Book all 5 slots sequentially for this user
    for (let i = 0; i < 5; i++) {
      await apiRequest('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: {
          slot_id: `s_page_${i}`,
          name: 'Paginate User',
          email: patientEmail
        }
      });
    }

    // Invalid limit tests
    const resBadLimit1 = await apiRequest(`/bookings?email=${patientEmail}&limit=0`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(resBadLimit1.status, 400);

    const resBadLimit2 = await apiRequest(`/bookings?email=${patientEmail}&limit=51`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(resBadLimit2.status, 400);

    // Page 1: limit 2
    const page1 = await apiRequest(`/bookings?email=${patientEmail}&limit=2`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(page1.status, 200);
    assert.equal(page1.data.bookings.length, 2);
    assert.ok(page1.data.next_cursor);

    // Page 2: pass cursor
    const page2 = await apiRequest(`/bookings?email=${patientEmail}&limit=2&cursor=${page1.data.next_cursor}`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(page2.status, 200);
    assert.equal(page2.data.bookings.length, 2);
    assert.ok(page2.data.next_cursor);

    // Page 3: final page
    const page3 = await apiRequest(`/bookings?email=${patientEmail}&limit=2&cursor=${page2.data.next_cursor}`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.equal(page3.status, 200);
    assert.equal(page3.data.bookings.length, 1);
    assert.equal(page3.data.next_cursor, null);

    // Verify ordering: oldest first
    const allBookings = [...page1.data.bookings, ...page2.data.bookings, ...page3.data.bookings];
    for (let i = 1; i < allBookings.length; i++) {
      assert.ok(new Date(allBookings[i].created_at) >= new Date(allBookings[i - 1].created_at));
    }
  });

  test('Level 5: Rate Limiting per email (at most 5 attempts per min, 6th returns 429)', async () => {
    // Reset database
    await apiRequest('/reset', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slots: Array.from({ length: 10 }).map((_, i) => ({
          id: `s_rate_${i}`,
          provider: 'Dr Rate',
          start: `2031-01-0${i + 1}T10:00:00Z`,
          end: `2031-01-0${i + 1}T10:30:00Z`
        }))
      }
    });

    const targetEmail = 'spammer@example.com';
    const otherEmail = 'innocent@example.com';

    // 5 attempts for targetEmail (even if some fail validation)
    for (let i = 0; i < 5; i++) {
      const res = await apiRequest('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: {
          slot_id: `s_rate_${i}`,
          name: 'Spammer Test',
          email: targetEmail
        }
      });
      assert.ok([201, 400, 409].includes(res.status), `Attempt ${i + 1} should be evaluated normally`);
    }

    // 6th attempt for targetEmail should be rate-limited (429)
    const resRateLimited = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slot_id: 's_rate_6',
        name: 'Spammer Test',
        email: targetEmail
      }
    });
    assert.equal(resRateLimited.status, 429);
    assert.ok(resRateLimited.data.error);
    const retryAfter = resRateLimited.headers.get('retry-after');
    assert.ok(retryAfter, 'Must contain Retry-After header');
    assert.ok(Number(retryAfter) >= 1, 'Retry-After must be positive seconds');

    // Other email is NOT affected
    const resOther = await apiRequest('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: {
        slot_id: 's_rate_7',
        name: 'Innocent User',
        email: otherEmail
      }
    });
    assert.equal(resOther.status, 201);
  });

});
