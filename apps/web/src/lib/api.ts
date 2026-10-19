import { useQuery } from '@tanstack/react-query';
// direct path keeps the rest of @mapper/shared (uuid, zod) out of the bundle
import { snapshotFile } from '@mapper/shared/src/snapshot';

/** The read-only site (`vite build --mode static`) reads the files saved by `pnpm site:build` instead of the API. */
export const STATIC_SITE = import.meta.env.MODE === 'static';

async function get<T>(path: string): Promise<T> {
  if (STATIC_SITE) return getSnapshot<T>(path);
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function getSnapshot<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(snapshotFile(path));
  } catch {
    // Cloudflare Access redirects to its sign-in page when the session has expired, and fetch can't follow it
    throw new Error('Could not load the data. Your sign-in may have expired: reload the page.');
  }
  // a missing file comes back as the site's index.html
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('Not found in this copy of the data.');
  return res.json() as Promise<T>;
}

export interface SnapshotMeta {
  at: string;
  commit: string | null;
}
export const useSnapshotMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => get<SnapshotMeta>('/meta'), enabled: STATIC_SITE });

export type Rating = 'covered' | 'check' | 'not_found';
export type Status = 'proposed' | 'approved' | 'rejected';

export interface Curriculum {
  id: string;
  code: string;
  name: string;
  country: string;
  version: string | null;
  publisher_owned: boolean;
  source_file: string | null;
  objectives: number;
  stubs: number;
  mappings: { rating: Rating; status: Status; n: number }[];
  coverage: { edition: string; rating: Rating; status: Status; n: number }[];
}

export interface CoverageCell {
  mappingId: string;
  rating: Rating;
  status: Status;
  role: string;
  scopeNote: string | null;
  relatedNote: string | null;
  candidates: number;
  location: string;
  locationId: string;
  optional: boolean;
  supplement: boolean;
  type: string;
}

export interface CurriculumObjective {
  id: string;
  code: string | null;
  grade_label: string;
  grade_num: number | null;
  track: string | null;
  strand: string | null;
  sub_strand: string | null;
  topic: string | null;
  objective_no: string | null;
  text: string;
  stub: boolean;
  cells: Record<string, CoverageCell>;
}

export interface Coverage {
  curriculum: { id: string; code: string; name: string };
  editions: string[];
  objectives: CurriculumObjective[];
}

export interface LocationRow {
  location_id: string;
  edition_code: string;
  edition_name: string;
  label: string;
  grade_num: number;
  book: string | null;
  chapter_no: string | null;
  chapter_title: string | null;
  unit_no: string | null;
  unit_title: string | null;
  lesson_no: string | null;
  lesson_title: string | null;
  section: string | null;
  external_id: string | null;
  activity_ref: string | null;
  activity_title: string | null;
  type: string;
  optional: boolean;
  supplement: boolean;
  reuse_quality: string | null;
  content_item_id: string;
  source_file: string;
  source_sheet: string;
  source_row: number;
  sort_key: string;
}

export interface MappingVersion {
  id: string;
  version: number;
  rating: Rating;
  role: string;
  status: Status;
  scope_note: string | null;
  related_note: string | null;
  source: string;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface ObjectiveMapping extends LocationRow {
  mapping_id: string;
  rating: Rating;
  status: Status;
  role: string;
  scope_note: string | null;
  related_note: string | null;
  source: string;
  product_objective_text: string | null;
  isBest: boolean;
  alsoDeliveredIn: LocationRow[];
  history: MappingVersion[];
}

export interface ObjectiveDetail {
  objective: CurriculumObjective & { curriculum_code: string; curriculum_name: string; curriculum_id: string; meta: Record<string, unknown> };
  editions: { edition: string; mappings: ObjectiveMapping[] }[];
  related: (LocationRow & { objective_id: string; code: string; text: string; grade_label: string; curriculum_code: string; rating: Rating; product_objective_id: string | null })[];
}

export interface Edition {
  id: string;
  code: string;
  name: string;
  short_name: string;
  locations: number;
  grades: number[];
}

export interface BrowserLocation extends LocationRow {
  parent_location_id: string | null;
  objective_count: number;
  mapped: { curriculum: string; n: number }[];
}

export interface LocationDetail {
  location: LocationRow & { meta: Record<string, unknown>; parent_location_id: string | null };
  objectives: { id: string; text: string; ordinal: number; link: string; origin_edition: string }[];
  sharedWith: LocationRow[];
  mappings: (LocationRow & {
    mapping_id: string;
    rating: Rating;
    status: Status;
    role: string;
    scope_note: string | null;
    related_note: string | null;
    product_objective_text: string | null;
    objective_id: string;
    code: string | null;
    text: string;
    grade_label: string;
    curriculum_code: string;
    direct: boolean;
  })[];
}

export const useCurricula = () => useQuery({ queryKey: ['curricula'], queryFn: () => get<Curriculum[]>('/curricula') });
export const useCoverage = (id: string) => useQuery({ queryKey: ['coverage', id], queryFn: () => get<Coverage>(`/curricula/${id}/coverage`) });
export const useObjective = (id: string) => useQuery({ queryKey: ['objective', id], queryFn: () => get<ObjectiveDetail>(`/objectives/${id}`) });
export const useEditions = () => useQuery({ queryKey: ['editions'], queryFn: () => get<Edition[]>('/editions') });
export const useEditionLocations = (code: string, grade: number) =>
  useQuery({ queryKey: ['locations', code, grade], queryFn: () => get<BrowserLocation[]>(`/editions/${code}/locations?grade=${grade}`) });
export const useLocation = (id: string | null) =>
  useQuery({ queryKey: ['location', id], queryFn: () => get<LocationDetail>(`/locations/${id}`), enabled: !!id });

export const EDITION_NAMES: Record<string, string> = { PINE: 'PINE', AU2: 'PR1ME AU', PH_DPA: 'PR1ME PH DPA' };

// ---------------------------------------------------------------- Phase 2: upload and matching runs

export async function send<T>(method: 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body instanceof FormData ? undefined : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `${res.status}`), { data });
  return data as T;
}

export interface SheetPreview {
  name: string;
  rowCount: number;
  rows: string[][];
}
export interface UploadResult {
  uploadId: string;
  fileName: string;
  sheets: SheetPreview[];
}
export interface ColumnMap {
  grade: number;
  text: number;
  strand: number | null;
  subStrand: number | null;
  code: number | null;
}
export interface ParsedObjective {
  row: number;
  code: string | null;
  gradeLabel: string;
  gradeNum: number | null;
  strand: string | null;
  subStrand: string | null;
  text: string;
}
export interface UploadPreview {
  count: number;
  byGrade: Record<string, number>;
  objectives: ParsedObjective[];
  skipped: { row: number; reason: string }[];
  skippedCount: number;
  warnings: string[];
}

export interface MatchingStatus {
  embedding: { label: string; provider: string; ollama: boolean | null; missing: { product_missing: number; curriculum_missing: number } };
  judge: { model: string; effort: string; hasKey: boolean };
  consent: { at: string; by: string } | null;
}

export interface Tally {
  objectives: number;
  bestFound: number;
  top3: number;
  anywhere: number;
  keyInWindow: number;
  rated: number;
  ratingAgree: number;
}
export interface AccuracyReport {
  editions: string[];
  judged: boolean;
  total: Tally & { noKey: number };
  confusion: Record<string, Record<string, number>>;
  byGrade: Record<string, Tally>;
  byStrand: Record<string, Tally>;
}

export type RunStatus = 'retrieving' | 'ready' | 'judging' | 'finishing' | 'done' | 'failed';
export interface RunRow {
  id: string;
  mode: 'propose' | 'accuracy';
  status: RunStatus;
  params: { editions: string[]; gradeWindow: number };
  embed_model: string;
  llm_model: string;
  est_cost: string | null;
  actual_cost: string | null;
  started_at: string;
  finished_at: string | null;
  progress: { stage?: string; done?: number; total?: number; usd?: number; errors?: number };
  error: string | null;
  curriculum_id: string;
  curriculum_code: string;
  curriculum_name: string;
}
export interface RunDetail {
  run: RunRow & {
    report: {
      estimate?: { calls: number; cachedCalls: number; usd: number; usdRemaining: number; model: string; inputTokens: number; outputTokens: number };
      judged?: boolean;
      written?: Record<string, number>;
      usd?: number;
      calls?: number;
      cachedCalls?: number;
      errors?: number;
      accuracy?: AccuracyReport;
    };
  };
  summary: { edition: string; rating: string; n: number }[];
  consent: { at: string } | null;
  hasKey: boolean;
}
export interface RunCell {
  rating: Rating | null;
  note: string | null;
  judged: boolean;
  error: string | null;
  mappingId: string | null;
  chosen: { label: string; locationId: string; scopeNotes: string[]; reuse: boolean; bullets: string[] } | null;
  candidates: { key: string; label: string; locationId: string; type: string; gradeNum: number; judge: string | null; sources: string[]; scopeNotes: string[] }[];
}
export interface RunResult {
  id: string;
  code: string | null;
  grade_label: string;
  strand: string | null;
  text: string;
  cells: Record<string, RunCell>;
}

const ACTIVE: RunStatus[] = ['retrieving', 'judging', 'finishing'];
export const useMatchingStatus = () => useQuery({ queryKey: ['matching-status'], queryFn: () => get<MatchingStatus>('/matching/status'), staleTime: 5_000 });
export const useRuns = () =>
  useQuery({
    queryKey: ['runs'],
    queryFn: () => get<RunRow[]>('/runs'),
    refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.includes(r.status)) ? 2000 : false),
    staleTime: 0,
  });
export const useRun = (id: string) =>
  useQuery({
    queryKey: ['run', id],
    queryFn: () => get<RunDetail>(`/runs/${id}`),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.run.status) ? 1500 : false),
    staleTime: 0,
  });
export const useRunResults = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ['run-results', id], queryFn: () => get<RunResult[]>(`/runs/${id}/results`), enabled, staleTime: 0 });
