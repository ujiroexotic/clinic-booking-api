import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  apiKey: process.env.API_KEY || 'clinic-secret-key-2026',
  databaseUrl: process.env.DATABASE_URL || null,
  dbFile: process.env.DB_FILE || 'clinic.db',
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxAttempts: 5       // at most 5 attempts per email per minute
};
