CREATE TYPE "public"."location_type" AS ENUM('teaching', 'practice', 'problem_solving', 'review', 'assessment');--> statement-breakpoint
CREATE TYPE "public"."mapping_role" AS ENUM('best', 'alternative', 'related');--> statement-breakpoint
CREATE TYPE "public"."mapping_source" AS ENUM('imported', 'matcher', 'human', 'reupload');--> statement-breakpoint
CREATE TYPE "public"."mapping_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rating" AS ENUM('covered', 'check', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"origin_edition_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curricula" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"version" text,
	"publisher_owned" boolean DEFAULT false NOT NULL,
	"source_file" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curricula_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "curriculum_objectives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"code" text,
	"grade_label" text NOT NULL,
	"grade_num" integer,
	"track" text,
	"strand" text,
	"sub_strand" text,
	"topic" text,
	"objective_no" text,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,
	"embedding" vector(768),
	"sort_key" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"curriculum_id" uuid,
	CONSTRAINT "editions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"file" text NOT NULL,
	"sha256" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"response" jsonb NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_objectives" (
	"location_id" uuid NOT NULL,
	"product_objective_id" uuid NOT NULL,
	"link" text DEFAULT 'direct' NOT NULL,
	CONSTRAINT "location_objectives_location_id_product_objective_id_pk" PRIMARY KEY("location_id","product_objective_id")
);
--> statement-breakpoint
CREATE TABLE "mapping_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rating" "rating" NOT NULL,
	"role" "mapping_role" DEFAULT 'alternative' NOT NULL,
	"status" "mapping_status" NOT NULL,
	"scope_note" text,
	"related_note" text,
	"source" "mapping_source" NOT NULL,
	"matching_run_id" uuid,
	"import_batch_id" uuid,
	"actor" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"curriculum_objective_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"product_location_id" uuid NOT NULL,
	"product_objective_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embed_model" text,
	"llm_model" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"est_cost" numeric,
	"actual_cost" numeric,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"parent_location_id" uuid,
	"grade_num" integer NOT NULL,
	"book" text,
	"chapter_no" text,
	"chapter_title" text,
	"unit_no" text,
	"unit_title" text,
	"lesson_no" text,
	"lesson_title" text,
	"section" text,
	"activity_ref" text,
	"external_id" text,
	"activity_title" text,
	"type" "location_type" NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"supplement" boolean DEFAULT false NOT NULL,
	"reuse_quality" text,
	"sort_key" text NOT NULL,
	"source_file" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_objectives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_item_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,
	"embedding" vector(768),
	"status" "record_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_origin_edition_id_editions_id_fk" FOREIGN KEY ("origin_edition_id") REFERENCES "public"."editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_objectives" ADD CONSTRAINT "curriculum_objectives_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_objectives" ADD CONSTRAINT "location_objectives_location_id_product_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."product_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_objectives" ADD CONSTRAINT "location_objectives_product_objective_id_product_objectives_id_fk" FOREIGN KEY ("product_objective_id") REFERENCES "public"."product_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_versions" ADD CONSTRAINT "mapping_versions_mapping_id_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_versions" ADD CONSTRAINT "mapping_versions_matching_run_id_matching_runs_id_fk" FOREIGN KEY ("matching_run_id") REFERENCES "public"."matching_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_versions" ADD CONSTRAINT "mapping_versions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_curriculum_objective_id_curriculum_objectives_id_fk" FOREIGN KEY ("curriculum_objective_id") REFERENCES "public"."curriculum_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_product_location_id_product_locations_id_fk" FOREIGN KEY ("product_location_id") REFERENCES "public"."product_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_product_objective_id_product_objectives_id_fk" FOREIGN KEY ("product_objective_id") REFERENCES "public"."product_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD CONSTRAINT "matching_runs_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_objectives" ADD CONSTRAINT "product_objectives_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cobj_curriculum_idx" ON "curriculum_objectives" USING btree ("curriculum_id","sort_key");--> statement-breakpoint
CREATE INDEX "cobj_code_idx" ON "curriculum_objectives" USING btree ("code");--> statement-breakpoint
CREATE INDEX "cobj_tsv_idx" ON "curriculum_objectives" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "lobj_obj_idx" ON "location_objectives" USING btree ("product_objective_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mv_mapping_version_uq" ON "mapping_versions" USING btree ("mapping_id","version");--> statement-breakpoint
CREATE INDEX "map_cobj_idx" ON "mappings" USING btree ("curriculum_objective_id","edition_id");--> statement-breakpoint
CREATE INDEX "map_loc_idx" ON "mappings" USING btree ("product_location_id");--> statement-breakpoint
CREATE INDEX "map_pobj_idx" ON "mappings" USING btree ("product_objective_id");--> statement-breakpoint
CREATE INDEX "loc_edition_idx" ON "product_locations" USING btree ("edition_id","grade_num","sort_key");--> statement-breakpoint
CREATE INDEX "loc_content_idx" ON "product_locations" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "loc_source_idx" ON "product_locations" USING btree ("source_file","source_sheet","source_row");--> statement-breakpoint
CREATE INDEX "pobj_content_idx" ON "product_objectives" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "pobj_tsv_idx" ON "product_objectives" USING gin ("tsv");