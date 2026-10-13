# PR1ME Curriculum Mapper (local prototype)

Stores curriculum-to-product mappings in Postgres. Every curriculum objective maps to **product objectives and locations**, never to another curriculum (hub model). Products: PINE, PR1ME Australia (AU2), PR1ME PH DPA. Curricula: Singapore MOE 2021, Australian Curriculum v9 (AC9), Philippines DepEd.

Status: Phase 1 (ingest and browse) and Phase 2 (upload and matching) are built. Review and reupload (Phase 3) are not built yet.

## Run it on a Mac (for testers)

Everything runs inside Docker: the database, Ollama (search) and the app. You don't need Node, pnpm or Ollama on your Mac. Every command below goes in the **Terminal** app (press ⌘ Space, type "Terminal", press Return).

You need about 12 GB of free disk space (the Ollama download alone is 7 GB). Your GitHub account must have access to this private repository; accept the invitation email first.

### First time

1. **Install Homebrew** (skip this if `brew --version` already works):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   When it finishes, run the two or three commands it prints under **Next steps** (they add `brew` to your Terminal), then close the Terminal window and open a new one.

2. **Install Docker Desktop and the GitHub tool:**
   ```bash
   brew install --cask docker-desktop
   brew install gh
   ```

3. **Start Docker Desktop:**
   ```bash
   open -a Docker
   ```
   Accept the terms. You can skip signing in. Wait until the whale icon in the menu bar stops animating, then check it works:
   ```bash
   docker compose version
   ```

4. **Sign in to GitHub** (choose GitHub.com, HTTPS, and "Login with a web browser"):
   ```bash
   gh auth login
   ```

5. **Download the app:**
   ```bash
   cd ~/Documents
   gh repo clone aserjam100/mp_mapper
   cd mp_mapper
   ```

6. **Optional: turn on the AI check.** Skip this unless you were given an Anthropic API key. Everything else works without it.
   ```bash
   cp .env.example .env
   open -e .env
   ```
   Put the key after `ANTHROPIC_API_KEY=`, then save and close.

7. **Start the app:**
   ```bash
   docker compose up
   ```
   The first start downloads about 9 GB, loads the spreadsheets and builds the search index, so it can take 15 minutes or more on a slow connection. Later starts take a few seconds. It's ready when you see **Ready: open http://localhost:8080**. Leave this Terminal window open while you use the app.

8. **Open the app** in a new Terminal window (⌘ N), or just go to http://localhost:8080 in your browser:
   ```bash
   open http://localhost:8080
   ```

### Every day after that

| To | Run (in the `mp_mapper` folder: `cd ~/Documents/mp_mapper`) |
|---|---|
| Start the app | `open -a Docker`, then `docker compose up` |
| Stop the app | press Ctrl C in the Terminal window running it |
| Get the latest version | `git pull`, then `docker compose up --build` |
| Start over with fresh data (deletes your changes) | `docker compose down -v`, then `docker compose up` |

Your changes (reviewed mappings, uploaded curricula, runs) are kept between starts.

### If something goes wrong

- **"Cannot connect to the Docker daemon"**: Docker Desktop isn't running. Run `open -a Docker`, wait a minute, try again.
- **"port is already allocated"**: another program is using port 8080 or 5433. Quit it, or restart the Mac, then try again.
- **Anything else**: send the last 50 lines of `docker compose logs app`.

## Development setup

Requirements: Node 22+, pnpm 10+, Docker, Ollama.

```bash
pnpm install
cp .env.example .env        # defaults work as-is
pnpm db:up                  # only the Postgres 16 + pgvector service, on localhost:5433
pnpm db:migrate
pnpm ingest                 # reads data/source/*.xlsx; safe to re-run
ollama serve & ollama pull nomic-embed-text
pnpm embed                  # local embeddings for every objective (about 1 min); safe to re-run
pnpm dev                    # API http://localhost:3001, web http://localhost:5173
pnpm test
```

`pnpm db:up` and `docker compose up` use the same database, so stop one before starting the other's app.

The four source files live in `data/source/` with their original names and are committed. `data/uploads/` (files uploaded in the app) is git-ignored.

| File | Used for |
|---|---|
| `PINE learning objectives.xlsx` | PINE lessons and objectives (sheets Grade 1–6) |
| `PR1ME Scope and Sequence_AU2 Y1 to 6 030523.xlsx` | AU2 lessons, objectives, AC9 codes (approved mappings) |
| `PH DPA S&S_Final_2 Jan 2024 1 (1).xlsx` | PH activities (Grade 1–6 + hidden OPTIONAL), PH codes (approved), PH curriculum (`PH Curriculum` sheet) |
| `Singapore_Product_Curriculum_Crosswalk.xlsx` | SG curriculum (`SG objectives`) and proposed mappings (`Match detail`) |

**Docker files.** `Dockerfile` builds the app (API plus the built web pages, served together on port 8080). `docker-compose.yml` adds `ollama` and a one-off `ollama-pull` for the model. `scripts/docker-start.sh` runs migrations, loads `data/source` only if the database is empty, embeds anything missing, then starts the server. Settings in `.env` are passed in, except the database, Ollama and port settings, which the compose file sets.

## `.env`

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://mapper:mapper@localhost:5433/mapper` | Postgres (docker-compose maps 5433 → 5432) |
| `API_PORT` | `3001` | API port; the Vite dev server proxies `/api` to it. Docker uses 8080 |
| `SOURCE_DIR` | `data/source` | Where `pnpm ingest` reads the source files |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `OLLAMA_URL` | `ollama`, `nomic-embed-text`, `768` | Phase 2 embeddings. `EMBEDDING_DIM` sizes the `vector` columns at migration time |
| `OPENAI_API_KEY` | — | Only with `EMBEDDING_PROVIDER=openai` (sends text to an external API, so it needs the consent below) |
| `ANTHROPIC_API_KEY`, `JUDGE_MODEL`, `JUDGE_EFFORT`, `JUDGE_CONCURRENCY` | —, `claude-opus-5-5`, `low`, `4` | LLM judge. Nothing is sent until a user agrees on the run page (or passes `--consent` to `pnpm match`); the consent is stored in `app_settings` |

## Layout

```
apps/api            Hono + Drizzle (postgres-js)
  src/db            schema.ts, migrations/ (0001 mapping_current view, 0003 coverage_best view)
  src/ingest        pine.ts, au.ts, ph.ts, phCurriculum.ts, sg.ts (parsers) · load.ts (DB) · report.ts · cli.ts
  src/routes        read.ts (Phase 1 pages) · match.ts (upload, curricula, runs)
  src/matching      embed.ts · retrieve.ts · rules.ts · judge.ts · run.ts · accuracy.ts · upload.ts · cli.ts
  scripts/          make-fixtures.ts (cuts test fixtures from the real files) · curricula-count.ts (Docker start-up)
  test/             parser tests on fixtures; re-import test against the dev DB
apps/web            React + Vite + TanStack Query
scripts/            docker-start.sh (container start-up)
Dockerfile, docker-compose.yml   the full app in Docker (see "Run it on a Mac")
packages/shared     text normalisation, objective splitter, PH code parser, stable IDs (UUIDv5), enums
docs/               data-findings.md (Phase 0), ingestion-report.md (written by every `pnpm ingest`),
                    accuracy-PH-DEPED*.md (written by `pnpm match --accuracy`)
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

## Matching (Phase 2)

A **matching run** has two stages, so the cost is known before anything leaves the machine:

1. **Find candidates** (local, free). For each objective and **each edition separately**:
   - vector search (pgvector, Ollama `nomic-embed-text`) and Postgres full-text search over product objectives, fused by rank (RRF) and rolled up to lessons;
   - only lessons within the grade window (default ±1) and of type teaching / practice / problem-solving (review and assessment are skipped);
   - closer grades and teaching lessons rank a little higher;
   - **reuse**: lessons approved for a near-identical objective (cosine ≥ 0.9) in another curriculum are added first, in any edition sharing the content;
   - **rule checks** (`rules.ts`): number ranges ("within 100", "up to 1 000 000", "4- to 5-digit") and decimal places are read from both sides, and mismatches become scope notes.
   The run stores the 10 best candidates per objective × edition in `match_results` and estimates the judge cost.
2. **AI check** (optional, needs consent). One Claude call per objective covers all its editions. It picks the best candidate or none, rates it Covered / Check / Not found, writes a one-line note and names up to 2 alternatives. The output is JSON checked against a schema and the candidate keys. Results are cached in `llm_cache`, so re-running costs nothing. Server-side refusal fallbacks are on.

When the run finishes, **propose** runs write one proposed mapping per objective × edition (`source = matcher`, role `best`, or `related` for Not found). Existing imported or reviewed mappings are never overwritten. Older matcher proposals the run did not pick are marked rejected ("superseded"). **Accuracy** runs write nothing; they hide the curriculum's own approved mappings and score the run against them.

```bash
pnpm match --curriculum PH-DEPED --accuracy               # retrieval only, free
pnpm match --curriculum PH-DEPED --accuracy --judge --consent   # with the AI check (costs money)
pnpm match --curriculum MY-CODE                           # propose mappings for a curriculum
```

## Pages

1. **Curricula** (`/`): objectives and approved/proposed counts per curriculum, plus best-match coverage per edition.
2. **Coverage overview** (`/curricula/:id`): one row per objective and one best-match cell per edition, colour-coded. Filters for grade, track, strand, edition, rating, status and text are kept in the URL. **Export CSV** downloads the rows shown: one row per objective, and rating, status, best match, scope note and related note for each edition.
3. **Objective detail** (`/objectives/:id`):
   - every mapped location per edition, best match first, with the scope note, the quoted product objective, where the same content is also delivered, and the version history;
   - approved mappings from other curricula on the same content.
4. **Product browser** (`/products`): edition → grade → chapter/unit → lesson or activity. It shows objectives, shared content in other editions, and every curriculum objective mapped to that content.
5. **New curriculum** (`/new`): upload an Excel or CSV file, choose the sheet, header row and the grade / strand / sub-strand / code / text columns, preview the parsed objectives, then create it.
6. **Matching runs** (`/runs`, `/runs/:id`): start a run (propose or accuracy test), watch progress, see the AI check's estimated cost, give consent, and browse the results with every candidate. Accuracy runs show tables by grade and strand.
7. **How to use** (`/about`): a short plain-language guide for non-technical users.

Similarity scores are never shown as confidence. Only ratings and notes are shown.
