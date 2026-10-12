/** Human-readable product location labels, shared by every API response. */
export interface LocationLike {
  edition_code: string;
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
}

export function locationLabel(l: LocationLike): string {
  const lesson = [l.lesson_no, l.lesson_title].filter(Boolean).join(' ');
  switch (l.edition_code) {
    case 'PINE':
      return `G${l.grade_num} Ch ${l.chapter_no} · ${lesson}`;
    case 'AU2':
      return `${l.book} T${l.chapter_no}${l.unit_no && l.unit_no !== '0' ? ` U${l.unit_no}` : ''} · ${lesson}${l.section ? ` (${l.section})` : ''}`;
    case 'PH_DPA':
      return `G${l.grade_num} · ${l.external_id ?? l.activity_ref ?? ''} ${l.activity_title ?? lesson}`.trim();
    default:
      return lesson;
  }
}

/** Columns needed by locationLabel, for SQL select lists (alias `pl`, editions alias `e`). */
export const LOCATION_COLUMNS = `
  pl.id AS location_id, e.code AS edition_code, e.short_name AS edition_name, pl.grade_num, pl.book, pl.chapter_no,
  pl.chapter_title, pl.unit_no, pl.unit_title, pl.lesson_no, pl.lesson_title, pl.section, pl.external_id,
  pl.activity_ref, pl.activity_title, pl.type, pl.optional, pl.supplement, pl.reuse_quality, pl.content_item_id,
  pl.source_file, pl.source_sheet, pl.source_row, pl.sort_key`;
