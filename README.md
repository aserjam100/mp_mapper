# PR1ME Curriculum Mapper (local prototype)

Stores curriculum-to-product mappings in Postgres. Every curriculum objective maps to **product objectives and locations**, never to another curriculum (hub model). Products: PINE, PR1ME Australia (AU2), PR1ME PH DPA. Curricula: Singapore MOE 2021, Australian Curriculum v9 (AC9), Philippines DepEd.

Phase 1 status: ingestion and browsing. Matching (Phase 2) and review/reupload (Phase 3) are not built yet.

## Setup

Requirements: Node 22+, pnpm 10+, Docker.

```bash
pnpm install
cp .env.example .env        # defaults work as-is
pnpm db:up                  # Postgres 16 + pgvector on localhost:5433
pnpm db:migrate
pnpm ingest                 # reads data/source/*.xlsx; safe to re-run
pnpm dev                    # API http://localhost:3001, web http://localhost:5173
pnpm test
```

Put the four source files in `data/source/` with their original names (`data/` is git-ignored):

| File | Used for |
|---|---|
| `PINE learning objectives.xlsx` | PINE lessons and objectives (sheets Grade 1–6) |
| `PR1ME Scope and Sequence_AU2 Y1 to 6 030523.xlsx` | AU2 lessons, objectives, AC9 codes (approved mappings) |
| `PH DPA S&S_Final_2 Jan 2024 1 (1).xlsx` | PH activities (Grade 1–6 + hidden OPTIONAL), PH codes (approved), PH curriculum (`PH Curriculum` sheet) |
| `Singapore_Product_Curriculum_Crosswalk.xlsx` | SG curriculum (`SG objectives`) and proposed mappings (`Match detail`) |

## `.env`

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://mapper:mapper@localhost:5433/mapper` | Postgres (docker-compose maps 5433 → 5432) |
| `API_PORT` | `3001` | API port; the Vite dev server proxies `/api` to it |
| `SOURCE_DIR` | `data/source` | Where `pnpm ingest` reads the source files |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `OLLAMA_URL` | `ollama`, `nomic-embed-text`, `768` | Phase 2 embeddings. `EMBEDDING_DIM` sizes the `vector` columns at migration time |
| `ANTHROPIC_API_KEY`, `JUDGE_MODEL` | — | Phase 2 LLM judge. Nothing is sent to an external API in Phase 1 |

## Layout

```
apps/api            Hono + Drizzle (postgres-js)
  src/db            schema.ts, migrations/ (0001 mapping_current view, 0003 coverage_best view)
  src/ingest        pine.ts, au.ts, ph.ts, phCurriculum.ts, sg.ts (parsers) · load.ts (DB) · report.ts · cli.ts
  src/routes        read-only API for the four Phase 1 pages
  scripts/          make-fixtures.ts (cuts test fixtures from the real files)
  test/             parser tests on fixtures; re-import test against the dev DB
apps/web            React + Vite + TanStack Query
packages/shared     text normalisation, objective splitter, PH code parser, stable IDs (UUIDv5), enums
docs/               data-findings.md (Phase 0), ingestion-report.md (written by every `pnpm ingest`)
```

## Data model (short)

- `curricula` → `curriculum_objectives` (code, grade, track, strand, sub-strand, topic, text; `meta.stub` for code-only rows).
- `editions` → `product_locations` (grade/book, chapter, unit, lesson, section, activity ref, type, `optional`, `supplement`, `reuse_quality`, source file/sheet/row).
- `content_items` hold shared teaching content. A PH activity that reuses a PINE lesson points at the **same** content item and the same `product_objectives`, so a match is stored once. The UI then shows "PINE G1 Ch 1 · 1.1 …, also delivered in PH as PH_G1_C01_P1.1.1". `location_objectives` records which objectives each location delivers (`direct`, or `reworded_of` when PH rewords a PINE bullet).
- `mappings` hold the identity of a link (curriculum objective × edition × location × optional product objective; a null objective means a whole-lesson mapping). `mapping_versions` is **append-only** and records rating, role, status, scope note, source, actor, batch/run and note. The `mapping_current` view gives the latest version of each mapping. The `coverage_best` view picks the best mapping per objective × edition: reviewer's pick first, then rating, then teaching over review/assessment, then non-optional, then non-supplement, then closest grade, then book order.
- IDs are UUIDv5 over canonical keys: edition + location key, content item + normalised objective text, curriculum + code. Re-importing an updated file keeps existing mappings attached.

## Ingestion rules

- **PINE.** Chapter, unit and lesson rows are filled down. Bullets are split, and wrapped lines are joined to the bullet before them. `Let's Remember` → `review`. `Mind stretcher` → `problem_solving`. Lettered chapters, units or lessons (`15A`, `2A.1`, `1.A`) → `supplement`.
- **AU2.**
  - One location is created per book/topic/unit/lesson/section/title. Continuation rows add their AC9 codes to the lesson as approved **whole-lesson** mappings. Let's Remember codes map to the bullet on their row.
  - Hub `More Practice` / `Think About It` / `Create Your Own` pages become `practice` locations under their Bk lesson. They share its content, and their codes fold into the lesson.
  - NSW columns are ignored. Editorial columns are kept in `meta`.
- **PH DPA.**
  - Grade sheets and the hidden OPTIONAL sheet are read; OPTIONAL activities get `optional = true`.
  - `PINE_G…` references link to the PINE lesson's content. Each PH objective is compared to that lesson's bullets: at Dice similarity ≥ 0.85 it reuses the PINE objective; below that it is stored as a PH rewording.
  - `PH_…` references and blank references become PH-native content.
  - The column-D colour legend becomes `reuse_quality` (exact / good / match / new / vendor_pending / settled).
  - PH codes become approved mappings.
  - The `PH Curriculum` sheet (521 competencies) is the PH curriculum. 6 codes used in DPA but missing from the sheet are created as flagged stubs.
- **SG crosswalk.**
  - `SG objectives` becomes the SG curriculum (288 objectives).
  - `Match detail` rows become **proposed** mappings, one per quoted bullet. Statuses map to ratings: Skill match → Covered; Scope to verify / Partial scope → Check (`Scope / reason` kept as the scope note); Related only → Not found, with a related note.
  - `PR1ME NZ` rows and rows sourced from PH `Missing Practices` are dropped.
- **AC9.** Only codes are available, so AC9 objectives are code-only stubs until the ACARA v9 F–8 content descriptions are supplied.
- **Re-runs are idempotent.**
  - Unchanged links add no versions.
  - A link that changed in the source gets a new `imported` version.
  - A link whose latest version came from a reviewer is left alone and counted as "held".
  - A link that disappeared from the source gets a `rejected` version.
  - Locations and objectives that disappear are marked `removed`, never deleted.
- `docs/ingestion-report.md` lists counts per edition/grade, the load diff, PH→PINE linkage, crosswalk linkage, and every skipped row with its reason.

## Pages

1. **Curricula** (`/`): objectives and approved/proposed counts per curriculum, plus best-match coverage per edition.
2. **Coverage overview** (`/curricula/:id`): one row per objective and one best-match cell per edition, colour-coded. Filters for grade, track, strand, edition, rating, status and text are kept in the URL.
3. **Objective detail** (`/objectives/:id`):
   - every mapped location per edition, best match first, with the scope note, the quoted product objective, where the same content is also delivered, and the version history;
   - approved mappings from other curricula on the same content.
4. **Product browser** (`/products`): edition → grade → chapter/unit → lesson or activity. It shows objectives, shared content in other editions, and every curriculum objective mapped to that content.
5. **How to use** (`/about`): a short plain-language guide for non-technical users.

Similarity scores are never shown as confidence. Only ratings and notes are shown.
