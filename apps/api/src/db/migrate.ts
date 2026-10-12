import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { db, sqlClient } from './client.js';

await sqlClient`CREATE EXTENSION IF NOT EXISTS vector`;
await migrate(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) });
console.log('Migrations applied.');
await sqlClient.end();
