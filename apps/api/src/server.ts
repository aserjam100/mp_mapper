import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { ZodError } from 'zod';
import { markInterruptedRuns } from './matching/run.js';
import { match } from './routes/match.js';
import { read } from './routes/read.js';

const app = new Hono();
app.use('/api/*', logger());
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', read);
app.route('/api', match);
app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// Docker: the API also serves the built web app (WEB_DIST), with index.html for client-side routes.
const webDist = process.env.WEB_DIST;
if (webDist) {
  app.all('/api/*', (c) => c.notFound());
  app.use('/*', serveStatic({ root: webDist }));
  app.get('*', serveStatic({ path: `${webDist}/index.html` }));
}

await markInterruptedRuns();

const port = Number(process.env.API_PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => console.log(`API on http://localhost:${port}`));
