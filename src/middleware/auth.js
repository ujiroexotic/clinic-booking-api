import { config } from '../config.js';

export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== config.apiKey) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid X-API-Key header' });
  }
  next();
}
