/** Prints how many curricula are loaded. scripts/docker-start.sh runs the ingest only when this is 0. */
import { sqlClient as sql } from '../src/db/client.js';

const [row] = await sql`SELECT count(*)::int AS n FROM curricula`;
console.log(row!.n);
await sql.end();
