import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import resetRouter from './routes/reset.js';
import slotsRouter from './routes/slots.js';
import bookingsRouter from './routes/bookings.js';
import { requireApiKey } from './middleware/auth.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security and utility middleware
app.use(cors());
app.use(express.json());

// Handle malformed JSON gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// Public health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Provide client-side default key configuration
app.get('/api/config', (req, res) => {
  res.json({ defaultApiKey: config.apiKey });
});

// API Routes protected by API Key
app.use('/reset', requireApiKey, resetRouter);
app.use('/slots', requireApiKey, slotsRouter);
app.use('/bookings', requireApiKey, bookingsRouter);

// Fallback 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

export default app;
