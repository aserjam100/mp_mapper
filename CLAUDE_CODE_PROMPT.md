# Build: PR1ME Curriculum Mapping Tool (local prototype)

## What I want

A local web app that stores all our curriculum-to-product mappings in Postgres. When a new curriculum comes in, I upload it, the app matches each objective against our existing product content, and it produces a reviewable mapping: where each objective is covered, in which product, at which lesson, and how confident. Once a mapping is reviewed and approved (in the app or by re-uploading an edited Excel export), it is stored and reused for future runs.

**Work in phases and stop at each checkpoint for my confirmation. Start with Phase 0 only — do not write app code until I approve the plan.**

## Source files (in `data/source/`)

Inspect each file yourself before writing parsers. My notes below are a guide, not a spec; tell me where the files disagree with them.

### 1. PINE learning objectives (product: PINE, Grades 1–6)
- One sheet per grade (`Grade 1` … `Grade 6`). Title in row 1, header row 3 (`Lesson`, `Objectives`).
- Chapter and unit headings appear as rows in the Lesson column (e.g. `Chapter 1: Numbers 0 to 10`, `Unit 1: Counting and Comparing`), with lesson rows beneath (e.g. `1.1 Counting, reading and writing numbers`). Fill chapter/unit down.
- An objectives cell holds several bullets (`•\t…`). Split each bullet into its own product objective.
- `Let's Remember` rows (both ' and ’ apostrophes) are review content: keep them, flagged as type `review`.
- Grade 5 and 6 sheets have extra columns; check what they contain.

### 2. PR1ME Scope and Sequence AU2 (product: PR1ME Australia, Years 1–6)
- Sheet `PR1ME AUS 1-6 objectives`; header row 4: book, Bk/Hub, topic no., topic, unit no., unit, lesson no., lesson, objective, V9Strand, CD9 (AC9 code), NSW columns, content source, new/update, lesson count, page count, writer.
- Book header rows like `BOOK 1A` are not content.
- Lesson `0 Let's Remember` = review content.
- Objective cells may hold several bullets; split them.
- **AC9 codes are publisher-made mappings: import them as approved mappings** (see Data model). One cell may contain several codes separated by newlines.
- **Ignore the NSW columns.** Row 1 has a note saying to ignore NSW codes. Keep the editorial columns (content source, new/update, writer) as metadata only.

### 3. PH DPA Scope and Sequence (product: PR1ME PH DPA, Grades 1–6)
- Read only the sheets `Grade 1` … `Grade 6` and `OPTIONAL`. Ignore all other sheets (Pending Review, Missing Practices, Comments for Vendor, notes, etc.).
- Two header rows (rows 1–2). Chapter, unit and lesson are filled down. Each row is a digital practice **activity**: activity reference (e.g. `PINE_G1_C01_P1.1.1`), activity title, objective, assessment columns, PH curriculum learning objective, PH curriculum code (e.g. `M1NS-Ia-1.1`), PH reference ID (e.g. `PH_G1_C01_P1.1.1`), activity type, product code.
- Activity title is a formula (`=E3`): read cached values. If cached values are missing, resolve the reference yourself.
- Sheets report ~1,000 rows but only ~150–250 have content; skip empty rows.
- **OPTIONAL activities count as available content**; store them with an `optional` flag.
- **PH activities reuse PINE content.** The activity reference points to the PINE activity. Store shared content once and link the PH activity to it, so matches are not double-counted and results can say "PINE G1 Ch 1 lesson 1.1, also delivered in PH as PH_G1_C01_P1.1.1". Report how many PH activities link cleanly to PINE and how many don't.
- **PH curriculum codes and text are publisher-made mappings: import them as approved.** Also create the PH curriculum and its objectives from the code + text columns.

### 4. Singapore_Product_Curriculum_Crosswalk.xlsx (existing SG mapping, inferred)
- Sheets: `SG objectives` (288 SG objectives; header on row 5), `Match detail` (one row per SG objective × product location; header on row 5), `Review gaps`, `Method`, `Summary`.
- Create the SG curriculum (MOE 2021 Primary Mathematics, updated Oct 2025; 202 Standard + 86 Foundation objectives) from `SG objectives`.
- Import `Match detail` rows as **proposed** mappings (not approved — they were inferred, not reviewed). **Drop all `PR1ME NZ` rows.** For the Australia rows, use the AC9 data and ignore NSW.
- Link each row to the product objective parsed from the source files above (match on edition + location + objective text; the `Product record ID`, `Source sheet` and `Objective cell` columns may help). Report how many rows link cleanly.
- Map statuses to ratings: `Skill match` → Covered; `Scope to verify` and `Partial scope` → Check; `Related only` → Not found (keep as a related-only note). Keep the `Scope / reason` text as the scope note.

## Out of scope for now
NZ edition, the NZ 2025 matching run, Prime for Success, NSW codes, authentication, deployment.

## Core concepts

- **Hub model:** curricula never map to each other directly. Every curriculum objective maps to product objectives, and each product objective knows its edition, grade/book, chapter, unit, lesson and activity.
- **Ratings** (used everywhere):
  - **Covered:** a product objective explicitly states the skill.
  - **Check:** relevant teaching exists, but range, notation, method or components need confirming. Always carries a short scope note saying what to check.
  - **Not found:** no qualifying product objective located. This is not the same as a confirmed product gap.
- **Mapping statuses:** proposed → approved / rejected. Mappings are append-only: a change creates a new version with who, when, source (imported / matcher / human / reupload) and a note. Never overwrite history.
- **Best match:** for each curriculum objective × edition, one best product location plus alternatives. Preference order: strongest rating, then teaching content over review/assessment, then non-optional over optional, then product grade closest to the curriculum grade, then book order.
- **Stable IDs:** derive product objective IDs deterministically (e.g. UUIDv5 from edition + location + normalised objective text) so re-importing an updated scope-and-sequence keeps existing mappings attached. Report what changed on re-import instead of silently replacing.

## Data model (propose the final version in Phase 0)

Roughly: `curricula` (name, country, version), `curriculum_objectives` (grade, track, strand, sub-strand, topic, code, text), `editions`, `content` (shared lesson content, so PINE/PH reuse is stored once), `product_locations` (edition, grade/book, chapter, unit, lesson, section, activity ref, type: teaching/review/assessment, optional flag, source file/sheet/row), `product_objectives` (text, location, embedding), `mappings` + `mapping_versions` (curriculum objective, product objective, rating, scope note, status, source, reviewer, run), `matching_runs`.

## Matching pipeline (Phase 2)

For each objective in a new curriculum:
1. **Retrieve candidates per edition**, not overall: top N by embedding similarity (pgvector) combined with Postgres full-text search, within a grade window, excluding review/assessment content by default. Every edition must get its own candidate list.
2. **Reuse approved work:** if the new objective closely matches an already-approved objective from another curriculum, bring in its approved product mappings as strong candidates.
3. **Rule checks in code:** extract number ranges (e.g. "within 100", "up to 1 000 000"), decimal places, and similar explicit limits from both sides and flag mismatches as scope notes.
4. **LLM judge:** for each objective × edition, an LLM picks the best candidate (or none), assigns Covered / Check / Not found, and writes a one-line scope note. Return structured JSON; validate it.
5. **Output:** proposed mappings stored against a `matching_run`.

Do not show raw similarity scores to reviewers as confidence; they are not calibrated. Show the rating and the reason.

Providers must be configurable via `.env`:
- Embeddings: default to a local model via Ollama (e.g. `nomic-embed-text`), with an option for an API provider.
- LLM judge: Anthropic API via `ANTHROPIC_API_KEY`, model name in `.env`. Batch calls, cache results, and show estimated cost before a run starts.
- Tell me before any product content is sent to an external API for the first time.

**Accuracy test:** treat the approved AC9 and PH mappings as answer keys. Run each curriculum through the matcher with its approved mappings hidden and report agreement (best match found, found in top 3, rating agreement), broken down by grade and strand. AC9 needs the curriculum text; if it isn't available, build the test on PH first and tell me what AC9 text file to supply.

## Review and reupload (Phase 3)

- Review in the app: one decision per curriculum objective × edition (approve, change the chosen lesson, change the rating, edit the note, reject), with alternatives one click away. Filter by grade, strand, rating, status.
- Excel export in the same layout as the simplified crosswalk (Overview / Locations / Gaps sheets), with a hidden mapping ID and version on every row.
- Reupload of an edited export: show a diff preview ("42 approved, 5 rating changes, 3 locations changed, 2 rows unrecognised") and commit only after I confirm. Reject stale rows whose version changed since export.

## UI pages

1. Curricula: list, with counts by rating and status.
2. Coverage overview for a curriculum: one row per objective, one rating + best-match lesson per edition, colour-coded, filterable. Click through to the objective.
3. Objective detail: all candidate locations per edition, mapping history, related approved mappings from other curricula.
4. Product browser: browse PINE / AU / PH by grade, chapter and lesson; show which curriculum objectives map to each lesson.
5. New curriculum: upload an Excel file, choose which columns are grade, strand, code and objective text, preview the parsed rows, then start a matching run.
6. Review queue and Gaps view.
7. Export / reupload.

## Stack

- pnpm monorepo: `apps/web` (React + Vite + TypeScript), `apps/api` (TypeScript, Hono or Fastify, Drizzle ORM), `packages/shared` (shared types and validation).
- Postgres with pgvector via `docker-compose.yml` (`pgvector/pgvector:pg16`). I already run Postgres locally, so use port **5433** to avoid a clash.
- Excel parsing in TypeScript (SheetJS or ExcelJS). If a file is too messy for that, say so and propose a small Python ingestion script instead.
- Commands: `pnpm db:up`, `pnpm db:migrate`, `pnpm ingest` (idempotent; safe to re-run), `pnpm dev`, `pnpm test`.
- Unit tests for each parser using small fixtures copied from the real files.
- A README covering setup, `.env` variables and the ingestion report.

## Phases and checkpoints

**Phase 0 — Inspect and plan (stop after this).** Read all four files. Write `docs/data-findings.md`: per file, the real structure, row counts by grade, quirks, anything contradicting my notes, and how many PH activities link to PINE. Propose the final schema and project layout. Ask me anything you need answered.

**Phase 1 — Ingest and browse (stop after this).** Docker, schema, parsers, ingestion report (counts per edition/grade, rows skipped and why, crosswalk rows linked vs unlinked). UI pages 1, 2, 3 and 4 working on the imported data.

**Phase 2 — Matching (stop after this).** Upload + column mapping, the matching pipeline, and the accuracy test with a short results report.

**Phase 3 — Review and reupload.** Review queue, Gaps, export, reupload with diff.

At each checkpoint, give me a short summary of what works, what doesn't, and decisions you made that I should check.
