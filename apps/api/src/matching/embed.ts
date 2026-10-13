/**
 * Embeddings for curriculum objectives and product objectives (bullets).
 *
 * Providers (EMBEDDING_PROVIDER in .env):
 * - `ollama` (default): local, e.g. nomic-embed-text. Nothing leaves the machine.
 * - `openai`: OpenAI embeddings API (OPENAI_API_KEY). This sends text to an external API, so it needs
 *   the recorded consent (see lib/settings.ts).
 *
 * The model in use is stored in app_settings; if it changes, every stored vector is cleared and rebuilt,
 * so vectors from two models are never compared.
 */
import { sqlClient as sql } from '../db/client.js';
import { getExternalConsent, getSetting, setSetting } from '../lib/settings.js';

export interface EmbedConfig {
  provider: 'ollama' | 'openai';
  model: string;
  dim: number;
}

export function embedConfig(): EmbedConfig {
  const provider = (process.env.EMBEDDING_PROVIDER ?? 'ollama') as EmbedConfig['provider'];
  if (provider !== 'ollama' && provider !== 'openai') throw new Error(`Unknown EMBEDDING_PROVIDER "${provider}" (use ollama or openai)`);
  return {
    provider,
    model: process.env.EMBEDDING_MODEL ?? (provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'),
    dim: Number(process.env.EMBEDDING_DIM ?? 768),
  };
}

export const embedLabel = (c: EmbedConfig) => `${c.provider}:${c.model}:${c.dim}`;

/** nomic-embed-text is trained with task prefixes; other models get the plain text. */
function prefixed(c: EmbedConfig, kind: 'query' | 'document', text: string): string {
  if (!/nomic/i.test(c.model)) return text;
  return `${kind === 'query' ? 'search_query' : 'search_document'}: ${text}`;
}

async function callProvider(c: EmbedConfig, input: string[]): Promise<number[][]> {
  if (c.provider === 'ollama') {
    const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
    let res: Response;
    try {
      res = await fetch(`${url}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: c.model, input }),
      });
    } catch {
      throw new Error(`Ollama is not reachable at ${url}. Start it with \`ollama serve\` and run \`ollama pull ${c.model}\`.`);
    }
    if (!res.ok) throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
    return ((await res.json()) as { embeddings: number[][] }).embeddings;
  }
  if (!(await getExternalConsent())) {
    throw new Error('EMBEDDING_PROVIDER=openai sends product text to an external API. Give consent first (Runs page, or --consent on the CLI).');
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: c.model, input, dimensions: c.dim }),
  });
  if (!res.ok) throw new Error(`OpenAI embed failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { data: { embedding: number[] }[] }).data.map((d) => d.embedding);
}

export async function embedTexts(kind: 'query' | 'document', texts: string[], c = embedConfig()): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const vectors = await callProvider(c, texts.slice(i, i + 64).map((t) => prefixed(c, kind, t)));
    for (const v of vectors) {
      if (v.length !== c.dim) throw new Error(`Embedding has ${v.length} dimensions; EMBEDDING_DIM is ${c.dim}`);
      out.push(v);
    }
  }
  return out;
}

export const toVector = (v: number[]) => `[${v.join(',')}]`;

/** Lesson titles that say nothing about the content and are left out of the embedded text. */
const GENERIC_TITLES = /^(mind stretcher|let's remember|lets remember|practice|review|more practice)$/i;

/**
 * Embed every active objective that has no vector yet (or all of them, if the model changed).
 * Curriculum stubs (code-only, no text) are skipped. Returns counts.
 */
export async function ensureEmbeddings(log: (s: string) => void = () => {}): Promise<{ curriculum: number; product: number }> {
  const c = embedConfig();
  const label = embedLabel(c);
  const stored = await getSetting<{ label: string }>('embedding');
  if (stored && stored.label !== label) {
    log(`Embedding model changed (${stored.label} -> ${label}); clearing stored vectors.`);
    await sql`UPDATE curriculum_objectives SET embedding = NULL`;
    await sql`UPDATE product_objectives SET embedding = NULL`;
  }

  const cRows = await sql`
    SELECT id, text FROM curriculum_objectives
    WHERE embedding IS NULL AND status = 'active' AND coalesce(meta->>'stub', 'false') <> 'true'`;
  const pRows = await sql`
    SELECT po.id, po.text, ci.title FROM product_objectives po JOIN content_items ci ON ci.id = po.content_item_id
    WHERE po.embedding IS NULL AND po.status = 'active'`;

  const write = async (table: 'curriculum_objectives' | 'product_objectives', rows: { id: string }[], vectors: number[][]) => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r, j) => [r.id, toVector(vectors[i + j]!)]);
      await sql`
        UPDATE ${sql(table)} t SET embedding = v.e::vector
        FROM (VALUES ${sql(chunk)}) AS v(id, e) WHERE t.id = v.id::uuid`;
    }
  };

  if (cRows.length) {
    log(`Embedding ${cRows.length} curriculum objectives with ${label}…`);
    await write('curriculum_objectives', cRows as never, await embedTexts('query', cRows.map((r) => r.text)));
  }
  if (pRows.length) {
    log(`Embedding ${pRows.length} product objectives with ${label}…`);
    const texts = pRows.map((r) => (r.title && !GENERIC_TITLES.test(r.title.trim()) ? `${r.title}: ${r.text}` : r.text));
    for (let i = 0; i < pRows.length; i += 512) {
      await write('product_objectives', pRows.slice(i, i + 512) as never, await embedTexts('document', texts.slice(i, i + 512)));
      log(`  ${Math.min(i + 512, pRows.length)} / ${pRows.length}`);
    }
  }
  await setSetting('embedding', { label, at: new Date().toISOString() });
  return { curriculum: cRows.length, product: pRows.length };
}
