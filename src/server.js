import app from './app.js';
import { initDb } from './db.js';
import { config } from './config.js';

async function start() {
  try {
    await initDb();
    console.log('Database initialized successfully.');

    app.listen(config.port, () => {
      console.log(`Clinic Booking Server running at http://localhost:${config.port}`);
      console.log(`API Key configured: ${config.apiKey}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

