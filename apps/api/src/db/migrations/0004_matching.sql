CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"curriculum_objective_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_location_id" uuid,
	"chosen_product_objective_id" uuid,
	"rating" "rating",
	"note" text,
	"judged" boolean DEFAULT false NOT NULL,
	"judge_error" text,
	"mapping_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matching_runs" ADD COLUMN "mode" text DEFAULT 'propose' NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD COLUMN "progress" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_run_id_matching_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."matching_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_curriculum_objective_id_curriculum_objectives_id_fk" FOREIGN KEY ("curriculum_objective_id") REFERENCES "public"."curriculum_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_chosen_location_id_product_locations_id_fk" FOREIGN KEY ("chosen_location_id") REFERENCES "public"."product_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_chosen_product_objective_id_product_objectives_id_fk" FOREIGN KEY ("chosen_product_objective_id") REFERENCES "public"."product_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_mapping_id_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mr_run_obj_ed_uq" ON "match_results" USING btree ("run_id","curriculum_objective_id","edition_id");--> statement-breakpoint
CREATE INDEX "cobj_embedding_idx" ON "curriculum_objectives" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "pobj_embedding_idx" ON "product_objectives" USING hnsw ("embedding" vector_cosine_ops);