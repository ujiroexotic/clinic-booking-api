# Apex Clinic Booking API & Web Portal

A production-ready Clinic Appointment Booking API and responsive web portal built for **Koya Cohort 4 Assessment (Task 1)**.

Adheres strictly to the technical specification at [koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api) and fulfills all requirements across **Levels 1 to 5**.

---

## 🌟 Overview of Features & Levels

| Level | Feature | Description | Implementation Details |
|---|---|---|---|
| **Level 1** | Core Booking | List slots, book a slot, look up a booking | `GET /slots`, `POST /bookings`, `GET /bookings/:id`, `POST /reset` |
| **Level 2** | Security & Validation | API Key enforcement & payload validation | `X-API-Key` required on all endpoints (401). Trims strings, lowercases emails, validates email format, checks slot existence (404), rejects past slots (400). |
| **Level 3** | Concurrency & Cancellations | Double-booking protection & cancellations | Enforces unique active booking per slot at storage layer (`UNIQUE` partial index & transactions). Simultaneous race-condition safe (409). `DELETE /bookings/:id` frees slot and returns 409 if already cancelled. |
| **Level 4** | Idempotency & Pagination | Retry safety & cursor-based pagination | `Idempotency-Key` header: identical request returns cached 201 response with same booking ID; modified request returns 422. `GET /bookings` supports cursor pagination (`cursor`, `limit` 1–50, `next_cursor`). |
| **Level 5** | Rate Limiting | Abuse prevention per email | At most 5 attempts per email per minute (failed attempts included). The 6th returns 429 with `Retry-After` header in seconds. Unrelated emails unaffected. |

---

## 🚀 Live Demo & Endpoints

- **Web Portal URL:** `https://<YOUR-DEPLOYED-URL>` (or `http://localhost:3000`)
- **API Base URL:** `https://<YOUR-DEPLOYED-URL>`
- **API Key:** `clinic-secret-key-2026` (configurable via `API_KEY` env var)
- **OpenAPI 3.0 Contract:** `https://<YOUR-DEPLOYED-URL>/openapi.json`
- **Health Check:** `https://<YOUR-DEPLOYED-URL>/health`

---

## 🛠️ Tech Stack & Architecture

- **Backend:** Node.js (v24 / v22 / v20), Express 5 (ES Modules)
- **Database:**
  - Built-in `node:sqlite` in WAL mode for persistent zero-dependency local/container execution.
  - PostgreSQL adapter (`pg`) supported out of the box when `DATABASE_URL` is set (e.g. Neon, Supabase, Render PostgreSQL).
- **Concurrency & Race-Condition Safety:**
  - Partial conditional unique index:
    ```sql
    CREATE UNIQUE INDEX idx_unique_confirmed_slot ON bookings (slot_id) WHERE status = 'confirmed';
    ```
  - Immediate transactions (`BEGIN IMMEDIATE` / `BEGIN`) preventing interleaving read-write races.
- **Frontend:** Pure HTML5, modern CSS3 (custom properties, responsive grid, glassmorphism), and Vanilla JavaScript (zero bundler overhead, instant load).
- **Test Suite:** Built-in `node:test` and `node:assert/strict` covering all 5 levels with 100% passing tests.

---

## 📋 API Specification Summary

All API endpoints require the `X-API-Key: clinic-secret-key-2026` header. All errors return `{"error": "<message>"}`.

### 1. Reset Slots & Bookings (Level 1)
- **Method:** `POST /reset`
- **Body:** `{ "slots": [ { "id": "s1", "provider": "Dr Ade", "start": "...", "end": "..." } ] }`
- **Response:** `200 OK`

### 2. List Slots (Level 1)
- **Method:** `GET /slots`
- **Query Params:** `provider` (optional, exact match)
- **Response:** `200 OK` with slots ordered earliest `start` first. Includes `available: true/false`.

### 3. Book a Slot (Levels 1–5)
- **Method:** `POST /bookings`
- **Headers:** `X-API-Key` (required), `Idempotency-Key` (optional)
- **Body:** `{ "slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com" }`
- **Responses:**
  - `201 Created` — Booking confirmed
  - `400 Bad Request` — Missing/invalid field or slot already started
  - `404 Not Found` — Slot not found
  - `409 Conflict` — Slot already booked
  - `422 Unprocessable Entity` — Idempotency-Key reused with different body
  - `429 Too Many Requests` — Rate limit exceeded (>5 attempts/min for this email). Includes `Retry-After: <seconds>` header.

### 4. Get a Booking (Level 1)
- **Method:** `GET /bookings/:id`
- **Response:** `200 OK` or `404 Not Found`

### 5. Cancel a Booking (Level 3)
- **Method:** `DELETE /bookings/:id`
- **Response:** `200 OK` (frees slot), `404 Not Found`, or `409 Conflict` (if already cancelled)

### 6. List Person's Bookings (Level 4)
- **Method:** `GET /bookings`
- **Query Params:**
  - `email` (required, case-insensitive)
  - `limit` (optional, integer 1–50, default 10)
  - `cursor` (optional, cursor string)
- **Response:** `200 OK` `{ "bookings": [...], "next_cursor": "..." | null }` (oldest first)

---

## 🧪 Automated Test Suite

Run the full automated test suite verifying all 5 levels:

```bash
npm test
```

### Test Coverage Highlights:
- **Level 1:** Reset database, ordering of slots by start time, provider filtering, booking creation and retrieval.
- **Level 2:** Missing API key (401), invalid API key (401), missing required fields (400), invalid email format (400), non-existent slot (404), slot in the past (400).
- **Level 3:** Double-booking prevention (409), cancellation and slot freeing, already cancelled rejection (409), **10 concurrent simultaneous requests** to the same slot (guarantees exactly 1 succeeds and 9 conflict).
- **Level 4:** Idempotency-Key replay with identical body (returns original 201), Idempotency-Key replay with modified body (returns 422), cursor pagination with page traversal and termination with `next_cursor: null`.
- **Level 5:** 5 attempts allowed per email within 60s window, 6th attempt rejected with 429 and `Retry-After` header, other emails completely unaffected.

---

## 🖥️ Running Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open in browser:**
   Navigate to [http://localhost:3000](http://localhost:3000). Click **"Load Sample Clinic Slots"** to populate realistic doctor appointment slots and begin booking!

---

## ☁️ Deployment Guide

### Option A: Deploy to Render (Recommended & Free)
1. Push this repository to GitHub.
2. Sign in to [Render](https://render.com) and click **New > Web Service**.
3. Connect your GitHub repository.
4. Settings:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node src/server.js`
   - **Environment Variables:**
     - `API_KEY`: `clinic-secret-key-2026`
     - *(Optional)* `DATABASE_URL`: Your PostgreSQL connection string (if using Render Postgres or Neon). If omitted, SQLite operates locally with persistent disk.
5. Click **Create Web Service**. Your app is live at `https://<service-name>.onrender.com`.

### Option B: Deploy to Vercel with Neon Serverless Postgres
1. Create a free PostgreSQL database on [Neon](https://neon.tech).
2. Copy the connection string (`postgres://...`).
3. Deploy to Vercel:
   ```bash
   npx vercel
   ```
4. Set environment variables on Vercel:
   - `DATABASE_URL`: `postgres://...`
   - `API_KEY`: `clinic-secret-key-2026`

---

## 🎥 Loom Walkthrough Script (5 min guide)

When recording your video for submission:

1. **Introduction (0:00 - 0:45)**
   - State your name and project: "Apex Clinic Appointment Booking API & Web Portal for Task 1".
   - Briefly introduce the tech stack: Node.js, Express, persistent database with atomic concurrency control, and clean responsive web interface.

2. **Web Portal Demonstration (0:45 - 2:00)**
   - Show the live web portal running at the HTTPS URL.
   - Filter by doctor (e.g. Dr Ade, Dr Bello).
   - Select an available slot and book with a patient name and email.
   - Show the instant Confirmation Receipt modal with booking reference ID.
   - Click "My Bookings", enter the email, and show the booking listed.
   - Demonstrate cancellation: click "Cancel", show the booking marked cancelled, and show the slot immediately becoming available again in the grid!

3. **Code Walkthrough (2:00 - 4:00)**
   - **`src/db.js`**: Point out the conditional unique index `idx_unique_confirmed_slot` and transaction safety that guarantees Level 3 concurrency even under simultaneous requests.
   - **`src/middleware/auth.js`**: Explain `X-API-Key` validation (Level 2).
   - **`src/routes/bookings.js`**:
     - Walk through `Idempotency-Key` checking and 422 mismatch detection (Level 4).
     - Walk through rate limiting per email (Level 5) with `Retry-After` header.
     - Walk through cursor-based pagination with `next_cursor` (Level 4).
     - Walk through slot start time check preventing past bookings (Level 2).

4. **Automated Tests & Wrap Up (4:00 - 4:45)**
   - Run `npm test` in the terminal to display all 9 tests passing across all 5 levels.
   - Conclude by showing the public GitHub repo and deployed URLs.
