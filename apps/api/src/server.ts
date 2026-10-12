import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { read } from './routes/read.js';

const app = new Hono();
app.use('/api/*', logger());
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', read);
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.API_PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => console.log(`API on http://localhost:${port}`));
