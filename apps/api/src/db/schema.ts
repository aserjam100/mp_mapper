import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const EMBED_DIM = Number(process.env.EMBEDDING_DIM ?? 768);

export const ratingEnum = pgEnum('rating', ['covered', 'check', 'not_found']);
export const mappingStatusEnum = pgEnum('mapping_status', ['proposed', 'approved', 'rejected']);
export const mappingSourceEnum = pgEnum('mapping_source', ['imported', 'matcher', 'human', 'reupload']);
export const mappingRoleEnum = pgEnum('mapping_role', ['best', 'alternative', 'related']);
export const locationTypeEnum = pgEnum('location_type', ['teaching', 'practice', 'problem_solving', 'review', 'assessment']);
export const recordStatusEnum = pgEnum('record_status', ['active', 'removed']);

// ---------------------------------------------------------------- curricula

export const curricula = pgTable('curricula', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  version: text('version'),
  publisherOwned: boolean('publisher_owned').notNull().default(false),
  sourceFile: text('source_file'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const curriculumObjectives = pgTable(
  'curriculum_objectives',
  {
    id: uuid('id').primaryKey(),
    curriculumId: uuid('curriculum_id').notNull().references(() => curricula.id),
    code: text('code'),
    gradeLabel: text('grade_label').notNull(),
    gradeNum: integer('grade_num'),
    track: text('track'),
    strand: text('strand'),
    subStrand: text('sub_strand'),
    topic: text('topic'),
    objectiveNo: text('objective_no'),
    text: text('text').notNull(),
    textNorm: text('text_norm').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', coalesce(text, ''))`),
    embedding: vector('embedding', { dimensions: EMBED_DIM }),
    sortKey: text('sort_key').notNull(),
    status: recordStatusEnum('status').notNull().default('active'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('cobj_curriculum_idx').on(t.curriculumId, t.sortKey),
    index('cobj_code_idx').on(t.code),
    index('cobj_tsv_idx').using('gin', t.tsv),
  ],
);

// ---------------------------------------------------------------- products

export const editions = pgTable('editions', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  curriculumId: uuid('curriculum_id').references(() => curricula.id),
});

/** The shared teaching unit. A PINE lesson reused by a PH activity is stored once here. */
export const contentItems = pgTable('content_items', {
  id: uuid('id').primaryKey(),
  originEditionId: uuid('origin_edition_id').notNull().references(() => editions.id),
  kind: text('kind').notNull(), // lesson | activity
  title: text('title').notNull(),
});

export const productLocations = pgTable(
  'product_locations',
  {
    id: uuid('id').primaryKey(),
    editionId: uuid('edition_id').notNull().references(() => editions.id),
    contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id),
    parentLocationId: uuid('parent_location_id'),
    gradeNum: integer('grade_num').notNull(),
    book: text('book'),
    chapterNo: text('chapter_no'),
    chapterTitle: text('chapter_title'),
    unitNo: text('unit_no'),
    unitTitle: text('unit_title'),
    lessonNo: text('lesson_no'),
    lessonTitle: text('lesson_title'),
    section: text('section'), // Bk | Hub
    activityRef: text('activity_ref'), // PH: PINE_G1_C01_P1.1.1
    externalId: text('external_id'), // PH: PH_G1_C01_P1.1.1
    activityTitle: text('activity_title'),
    type: locationTypeEnum('type').notNull(),
    optional: boolean('optional').notNull().default(false),
    supplement: boolean('supplement').notNull().default(false),
    reuseQuality: text('reuse_quality'),
    sortKey: text('sort_key').notNull(),
    sourceFile: text('source_file').notNull(),
    sourceSheet: text('source_sheet').notNull(),
    sourceRow: integer('source_row').notNull(),
    status: recordStatusEnum('status').notNull().default('active'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('loc_edition_idx').on(t.editionId, t.gradeNum, t.sortKey),
    index('loc_content_idx').on(t.contentItemId),
    index('loc_source_idx').on(t.sourceFile, t.sourceSheet, t.sourceRow),
  ],
);

export const productObjectives = pgTable(
  'product_objectives',
  {
    id: uuid('id').primaryKey(),
    contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    textNorm: text('text_norm').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', coalesce(text, ''))`),
    embedding: vector('embedding', { dimensions: EMBED_DIM }),
    status: recordStatusEnum('status').notNull().default('active'),
  },
  (t) => [index('pobj_content_idx').on(t.contentItemId), index('pobj_tsv_idx').using('gin', t.tsv)],
);

/** Which objectives a location delivers. A PH activity points at the PINE bullet it reuses. */
export const locationObjectives = pgTable(
  'location_objectives',
  {
    locationId: uuid('location_id').notNull().references(() => productLocations.id),
    productObjectiveId: uuid('product_objective_id').notNull().references(() => productObjectives.id),
    link: text('link').notNull().default('direct'), // direct | reworded_of
  },
  (t) => [primaryKey({ columns: [t.locationId, t.productObjectiveId] }), index('lobj_obj_idx').on(t.productObjectiveId)],
);

// ---------------------------------------------------------------- mappings

export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  file: text('file').notNull(),
  sha256: text('sha256').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  report: jsonb('report').$type<Record<string, unknown>>().notNull().default({}),
});

export const matchingRuns = pgTable('matching_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  curriculumId: uuid('curriculum_id').notNull().references(() => curricula.id),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  embedModel: text('embed_model'),
  llmModel: text('llm_model'),
  status: text('status').notNull().default('pending'),
  estCost: numeric('est_cost'),
  actualCost: numeric('actual_cost'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  report: jsonb('report').$type<Record<string, unknown>>().notNull().default({}),
});

/** Identity of a link. Its state lives in append-only mapping_versions. */
export const mappings = pgTable(
  'mappings',
  {
    id: uuid('id').primaryKey(),
    curriculumObjectiveId: uuid('curriculum_objective_id').notNull().references(() => curriculumObjectives.id),
    editionId: uuid('edition_id').notNull().references(() => editions.id),
    productLocationId: uuid('product_location_id').notNull().references(() => productLocations.id),
    /** null = whole-lesson mapping (e.g. AU AC9 codes, which the source ties to lessons, not bullets). */
    productObjectiveId: uuid('product_objective_id').references(() => productObjectives.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('map_cobj_idx').on(t.curriculumObjectiveId, t.editionId),
    index('map_loc_idx').on(t.productLocationId),
    index('map_pobj_idx').on(t.productObjectiveId),
  ],
);

export const mappingVersions = pgTable(
  'mapping_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingId: uuid('mapping_id').notNull().references(() => mappings.id),
    version: integer('version').notNull(),
    rating: ratingEnum('rating').notNull(),
    role: mappingRoleEnum('role').notNull().default('alternative'),
    status: mappingStatusEnum('status').notNull(),
    scopeNote: text('scope_note'),
    relatedNote: text('related_note'),
    source: mappingSourceEnum('source').notNull(),
    matchingRunId: uuid('matching_run_id').references(() => matchingRuns.id),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    actor: text('actor').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mv_mapping_version_uq').on(t.mappingId, t.version)],
);

export const llmCache = pgTable('llm_cache', {
  key: text('key').primaryKey(),
  response: jsonb('response').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
