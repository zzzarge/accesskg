// Vercel Function: POST /api/route
import { handleRoute } from './_lib/route.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'bad_json' }); }
  }
  const out = await handleRoute(body, process.env);
  res.status(out.status).json(out.json);
}
