import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL ?? 'postgres://mapper:mapper@localhost:5433/mapper';
export const sqlClient = postgres(url, { max: 10, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type DB = typeof db;
