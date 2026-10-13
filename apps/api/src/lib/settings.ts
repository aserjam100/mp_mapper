import { sqlClient as sql } from '../db/client.js';

/** Small key/value settings stored in `app_settings`. */
export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
  return row ? (row.value as T) : null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/**
 * The user's go-ahead to send product content to external APIs (the LLM judge, or an API embedding
 * provider). The brief asks to be told before this happens for the first time, so nothing external
 * runs until this is recorded, from the UI or with `--consent` on the CLI.
 */
export const EXTERNAL_CONSENT_KEY = 'external_api_consent';
export interface ExternalConsent {
  at: string;
  by: string;
}
export const getExternalConsent = () => getSetting<ExternalConsent>(EXTERNAL_CONSENT_KEY);
export const giveExternalConsent = (by: string) =>
  setSetting(EXTERNAL_CONSENT_KEY, { at: new Date().toISOString(), by } satisfies ExternalConsent);
