import type { EditionCode, LocationType } from '@mapper/shared';

/** A curriculum code a source row is mapped to (publisher-made, imported as approved). */
export interface CodeLink {
  code: string;
  /** Objective text in the location this code belongs to; null = whole-lesson mapping. */
  objectiveText: string | null;
  sourceRow: number;
}

export interface ParsedLocation {
  edition: EditionCode;
  /** Unique within the edition; feeds the stable location ID. */
  key: string;
  /** Content item this location delivers. For PH activities that reuse PINE this is a PINE key. */
  content: { edition: EditionCode; key: string; title: string; kind: 'lesson' | 'activity' };
  /** Objectives that belong to the content item (only set by the content's origin parser). */
  ownObjectives: string[];
  /** Objectives this location delivers: own ones plus links into shared content. */
  delivers: { text: string; link: 'direct' | 'reworded_of' }[];
  parentKey?: string;
  gradeNum: number;
  book?: string | null;
  chapterNo?: string | null;
  chapterTitle?: string | null;
  unitNo?: string | null;
  unitTitle?: string | null;
  lessonNo?: string | null;
  lessonTitle?: string | null;
  section?: string | null;
  activityRef?: string | null;
  externalId?: string | null;
  activityTitle?: string | null;
  type: LocationType;
  optional: boolean;
  supplement: boolean;
  reuseQuality?: string | null;
  sortKey: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  meta: Record<string, unknown>;
  codes: CodeLink[];
}

export interface SkippedRow {
  sheet: string;
  row: number;
  reason: string;
  sample?: string;
}

export interface ParseResult {
  locations: ParsedLocation[];
  skipped: SkippedRow[];
  notes: string[];
  /** Lookup used by the SG crosswalk: `${sheet}|${row}` -> location key. */
  rowIndex: Map<string, string>;
}

export interface ParsedCurriculumObjective {
  key: string;
  code: string | null;
  gradeLabel: string;
  gradeNum: number | null;
  track?: string | null;
  strand?: string | null;
  subStrand?: string | null;
  topic?: string | null;
  objectiveNo?: string | null;
  text: string;
  sortKey: string;
  meta?: Record<string, unknown>;
}
