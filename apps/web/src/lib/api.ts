import { useQuery } from '@tanstack/react-query';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

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
