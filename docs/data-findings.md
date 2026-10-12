# Phase 0 — Data findings and plan

Inspected 2026-10-06 with openpyxl, reading cached cell values plus formulas and cell styles where relevant. All counts below come from the real files in `data/source/`. **⚠ marks a place where the file disagrees with the brief.**

---

## 1. PINE learning objectives.xlsx (PINE, Grades 1–6)

**Structure (matches the brief):** one sheet per grade. Title in row 1, header in row 3 (`Lesson`, `Objectives`), content from row 4. Column A holds chapter headings, unit headings, lesson rows and `Let's Remember` rows. Column B holds the bullets.

| Grade | Chapters | Units | Lessons | Teaching bullets | Let's Remember rows | Review bullets |
|---|---|---|---|---|---|---|
| 1 | 21 | 58 | 163 | 253 | 21 | 40 |
| 2 | 18 | 66 | 164 | 263 | 18 | 41 |
| 3 | 18 | 64 | 161 | 236 | 18 | 42 |
| 4 | 17 | 58 | 192 | 258 | 17 | 56 |
| 5 | 22 | 72 | 219 | 278 | 22 | 63 |
| 6 | 25 | 84 | 250 | 320 | 25 | 63 |
| **Total** | **121** | **402** | **1,149** | **1,608** | **121** | **305** |

That is 1,913 product objectives in total.

**Quirks**
- ⚠ **Grade 5 and Grade 6 extra columns are empty.** `max_column` is 15, but columns C–O contain no values; only the formatting extends that far. There is nothing to import from them.
- ⚠ **Some chapters are lettered:** 19 chapters such as `Chapter 15A: Addition and Subtraction Within 100` and `Chapter 12B: Temperature`. They look like supplementary or US-customary chapters and hold 155 lessons. A `Chapter \d+:` pattern misses them, so the chapter number must be stored as text.
- Some units and lessons are lettered too: `Unit 2A: Line Plots` with lesson `2A.1`, `Unit 1B`, and lessons `1.A`, `2.A`, `3.A` (word problems). The lesson code must also be stored as text.
- Both apostrophes appear in `Let's` / `Let’s Remember`, as expected. Each chapter has exactly one Let's Remember row, placed before Unit 1.
- Bullets use either `•\t` or `• ` (G5–G6 use only `• `). There are two kinds of cells without bullets:
  - **Wrapped bullets:** a line with no bullet continues the previous bullet (e.g. G1 row 211: `…into` / `2 equal groups`; G2 row 132: `…equality,` / `e.g. 16 + 4 = 17 + 3`). These lines are joined back.
  - **Cells with no bullet at all** (6 cells, e.g. G1 `3.4 Making 10` → `Make 10`): the whole cell is one objective.
- "Mind stretcher" lessons (non-routine problem solving) appear 210 times, roughly one per unit, with generic objectives. I propose a location type `problem_solving` for them (see Q6).
- Repeated text: about 140 bullets repeat within a grade, e.g. the same Let's Remember bullet under several chapters. Stable IDs include the location, so the repeats stay distinct objectives.

---

## 2. PR1ME Scope and Sequence_AU2 Y1 to 6 030523.xlsx (PR1ME Australia)

**Structure:** the main sheet is `PR1ME AUS 1-6 objectives`, with a header in row 4 and 4,210 data rows. Row 1 contains the note "NSW columns: Ignore NSW curriculum codes". There is also a `Counts` sheet with extent and lesson-count planning; I will not import it.

**Columns (row 4):** `2E BOOK | 2E Bk/HUB | No. | TOPIC | No. | UNIT | No. | LESSON | OBJECTIVE | V9Strand | CD9 | NSW Strand | Stage | Heading | Sub heading | Indicator | Content source | New / update | Lesson count | Estimated page count | Writer`.

| Year | Rows | Book lessons and Hub items with objectives | Teaching bullets | Let's Remember items | Review bullets | Hub practice items (no objective) |
|---|---|---|---|---|---|---|
| 1 | 454 | 179 | 239 | 22 | 78 | 172 |
| 2 | 510 | 197 | 284 | 21 | 59 | 198 |
| 3 | 731 | 251 | 367 | 25 | 107 | 253 |
| 4 | 819 | 296 | 449 | 24 | 84 | 325 |
| 5 | 929 | 310 | 489 | 28 | 128 | 341 |
| 6 | 754 | 272 | 402 | 23 | 78 | 312 |

That is about 2,230 teaching bullets plus 534 review bullets, and 3,609 distinct (location, AC9 code) pairs to import as approved.

**Quirks**
- ⚠ **There are no multi-code cells.** Each `CD9` cell holds exactly one code. When a lesson has several codes, they sit on **continuation rows** directly below it: the same book, topic, unit and lesson, with an empty OBJECTIVE and another code. 1,896 rows are continuation rows that only add a code.
- ⚠ **AC9 codes therefore attach to the whole lesson, not to individual bullets.** A lesson with four bullets and three codes does not say which bullet goes with which code. Let's Remember is the exception: it is written as one row per bullet, each with its own code. See Q1.
- ⚠ **`BOOK 1A` header rows exist only for 1A, 1B, 2A and 2B.** From 3A onward, books are separated by blank rows (8 rows where everything is blank except column A).
- ⚠ **About 1,500 Hub rows have no objective.** They are `More Practice` (1,494), `Create Your Own` (249) and `Think About It` (147), and most carry an AC9 code. They are practice pages belonging to the Book lesson above them. See Q1.
- The `Bk/Hub` column holds `Hub` (3,038), `Bk` (1,155), `CB` (4), `BK` (1) and blank (8). I will normalise `CB` and `BK` to `Bk`.
- Lesson numbers are mostly integers, but 282 are text such as `1A`, `2A` and `1D`.
- **Off-year AC9 codes:** Year 1 books use Foundation codes (`AC9MF…`, 35 rows). Years 4–6 books use Year 7 codes (383 rows) and Year 8 codes (36 rows). These are valid; the AC9 curriculum needs F and Years 7–8 objectives as well.
- The strand column has the value `Probability ` with a trailing space (15 rows). 280 rows have no strand.
- Objective cells use `• ` bullets, with 4 exceptions: `•To`, no bullet, and one wrapped line. These are handled with the PINE rules.
- I will keep `Content source`, `New / update`, `Writer`, `Lesson count` and `Estimated page count` as metadata (JSON) and ignore the NSW columns (L–P).

---

## 3. PH DPA S&S_Final_2 Jan 2024 1 (1).xlsx (PR1ME PH DPA)

**Sheets:** `Grade 1`–`Grade 6` and `OPTIONAL` will be read. ⚠ `OPTIONAL` is a **hidden** sheet. All other sheets are ignored as instructed. ⚠ There is also a visible **`PH Curriculum`** sheet: the full DepEd competency list, **521 codes** across Grades 1–6 (Phase 1 correction: my Phase 0 count of 539 split codes that wrap across lines; 521 matches the sheet's own "Total LC" row), laid out as a grade-by-column grid (see Q2).

**Grade sheets:** two header rows. Row 1 holds group headers and row 2 the field names. 44 columns (A–AR). The ones that matter:

| Col | Field |
|---|---|
| A / B / C | Chapter / Unit / Lesson. Filled down through **merged cells** and blanks. |
| D | Activity Reference (revised), e.g. `PINE_G1_C01_P1.1.1` |
| E | Activity Title (revised). Q is the `=E3` formula; ✅ cached values are present for every row. |
| F | Objective |
| G / H / I | Chapter assessment / Review / Mid-Year-EOY flags |
| K, M | PH curriculum code; "code: text" |
| P | PH Reference ID, e.g. `PH_G1_C01_P1.1.1` |
| S / T | Activity type (always `Practice`) / Product code (always `MATHPRO`) |
| U–AA | PH grade, chapter, ISBN, page, strand, substrand, unit |
| AP | Status update (e.g. `Published`) |

| Sheet | Activities | Non-empty rows skipped |
|---|---|---|
| Grade 1 | 201 | 6 |
| Grade 2 | 186 | 6 |
| Grade 3 | 214 | 6 |
| Grade 4 | 238 | 6 |
| Grade 5 | 249 | 6 |
| Grade 6 | 147 | 7 |
| **Total** | **1,235** | |
| OPTIONAL | 417 rows with ref/objective (by grade marker: G1 22, G2 21, G3 28, G4 96, G5 64, G6 185) | |

The skipped rows are a **colour legend** at the bottom of each sheet: "No colour code – Exact match", "Orange cell with black text – Good match", "Orange cell with red text – Match", "Orange cell with brown text – To be created (new creation)", "Green – Created by vendor, pending editing" and "Blue – Settled by Anshul". The fill and font colours on column D follow this legend. In other words, the sheet records how closely each PH activity matches its PINE source (see Q3).

### PH → PINE linkage

The reference format is `PINE_G{grade}_C{chapter}_P{unit}.{lesson}.{n}`. It is resolved against the parsed PINE file by grade, chapter (including lettered chapters) and `unit.lesson`.

| Grade sheets (1,235 activities) | Count | % |
|---|---|---|
| **Linked to a PINE lesson** | **910** | **73.7%** |
| … of which the PH objective = a PINE bullet (similarity ≥ 0.9) | 513 | |
| … of which the PH objective ≈ a PINE bullet (0.75–0.9) | 160 | |
| … of which the PH objective is reworded or different (< 0.75) | 237 | |
| ⚠ **PH-native reference** (`PH_G…` in the PINE-reference column) | **323** | 26.2% |
| Blank reference (G4 row 83) | 1 | |
| Unparseable (`PINE_G4_C12_P1.2.1/PINE_G…`, two refs in one cell) | 1 | |

| OPTIONAL (417 rows) | Count |
|---|---|
| Linked to a PINE lesson | 395 (objective = bullet 299, ≈ 40, differs 56) |
| Blank reference | 21 |
| Note text in the reference cell ("Covered in P1.2.1 – shoul…") | 1 |

- Every well-formed `PINE_…` reference resolves to an existing PINE lesson, with no dangling references.
- ⚠ **"PH activities reuse PINE content" is true for only about 74% of grade-sheet activities.** 323 activities have their own `PH_…` reference in the PINE column. Most of these are formatted brown ("to be created") or green (vendor-created), so they are PH-only content. They become PH-only content items.
- ⚠ **PH renumbers lessons.** PH lesson `1.2 Comparing numbers of objects` uses `PINE_G1_C01_P1.3.1`. The link must come from the reference, not from the lesson number.
- ⚠ **Cross-grade reuse is common.** 289 PH activities use PINE content from a different grade. For example, PH Grade 5 draws 82 activities from PINE G5 and 82 from PINE G6, and PH Grade 3 draws 60 from PINE G4. The "closest grade" rule in best-match should therefore use the **PH grade**, not the PINE grade.
- ⚠ **237 linked activities have reworded objectives.** Examples: PINE's "Add two numbers, one of which is 1, 2 or 3, within 10 using the 'counting on' method" becomes PH's "Use the 'counting on' method to add two numbers within 10, one of which…". I propose linking these to the PINE *lesson* (shared content) but keeping the PH wording as its own objective, so it can still be matched (see Data model).
- 41 activities have no PH Reference ID (column P). I will generate an ID from the column D reference for these.

**PH curriculum codes**
- 429 distinct codes are used across the grade sheets. 420 of them are in the `PH Curriculum` sheet. 9 are not, mostly typos: `M4NS-Iif-82.2` (lowercase f), `M4NS-IIc_x0002_68.1` (an encoding artefact), `M7SP-IVf-1` (Grade 7).
- 119 codes in the `PH Curriculum` sheet are never mapped to an activity. These are useful as known gaps.
- ⚠ **Multi-code cells use `/`**, e.g. `M5ME-IVa-72/M5ME-IVa-73` (181 rows). Codes also contain stray spaces and NBSPs (`M1NS- Id-5`, `M4NS-Ia- 10.4`), which I will normalise.
- 66 codes have more than one text variant: trailing spaces, an appended second code, and in a few cases the text of a *different* code. When the `PH Curriculum` sheet is used, its text is canonical.

**OPTIONAL sheet quirks**
- There is no header row. `GRADE 1` … `GRADE 6` marker rows divide the sections.
- The chapter column holds the chapter name without its number (`Graphs`, `Mental Strategies`). The number comes from the activity reference.
- ⚠ **Column layout changes inside the sheet.** In Grades 1–5, the code is in G, the strand in H and the text in I. In parts of the Grade 6 section, the code is in J and W, the strand in T and the text in X. Codes are present on only about 125 of 417 rows.
- Some rows hold only a code (e.g. rows 101–105, 206–207, 362–363). These are PH competencies with no activity, which I will record as gaps rather than activities.
- Objective text starts with a space (`' To present data…'`).

**Objective cells** hold a single objective in 1,182 of 1,235 rows. Of the other 53: 30 are several `To …` lines, which I will split, and 23 are wrapped lines or `e.g.` lines, which I will join to the line before.

---

## 4. Singapore_Product_Curriculum_Crosswalk.xlsx

- **`SG objectives`** (header row 5): **288 objectives**. ✅ This matches the brief: Standard P1 32, P2 30, P3 34, P4 42, P5 37, P6 27 (202), and Foundation P5 63, P6 23 (86). Strands are Number And Algebra (166), Measurement And Geometry (109) and Statistics (13). Columns: SG ID (`SG-P1-001`, generated by the crosswalk), grade, track, strand, sub-strand, topic, objective no., objective, PDF page, plus per-edition evidence summary columns, which I won't import because they are recomputed.
- **`Match detail`** (header row 5): **11,361 rows.**

| Edition | Rows | Skill match | Scope to verify | Partial scope | Related only |
|---|---|---|---|---|---|
| PINE | 2,361 | 550 | 1,494 | 263 | 54 |
| PR1ME Australia | 3,865 | 895 | 2,457 | 416 | 97 |
| PR1ME PH DPA | 2,737 | 553 | 1,907 | 214 | 63 |
| PR1ME NZ | 2,398 | — dropped — | | | |

  Mapped to ratings, the 8,963 kept rows give: Covered 1,998; Check 6,751; Not found (related-only note) 214.
- Each row points to a **whole source cell**. It records `Source sheet` and `Objective cell` (e.g. `B62`, `I20`, `F130`); `Matching evidence` holds one or more bullets from that cell, separated by newlines. 1,247 rows quote 2–4 bullets.
- AU rows already **combine continuation rows**: `Curriculum mapping rows` = `20, 21, 22, 23, 24`, and the AC9 codes are joined with newlines. That is where "several codes per cell separated by newlines" comes from; it is not in the AU source itself.
- PH rows carry both `PH activity ID` and `Reused PINE activity ID`.

**Link test, using source sheet + cell row, then evidence text against the parsed bullets in that cell:**

| Edition | Row linked to a source cell | All evidence bullets found in that cell |
|---|---|---|
| PINE | 2,361 / 2,361 | 2,338 (99.0%) |
| PR1ME Australia | 3,865 / 3,865 | 3,865 (100%) |
| PR1ME PH DPA | 2,694 / 2,737 | 2,492 (92.5%) |

- The 23 PINE misses and 202 PH misses come from **line-splitting differences**. The crosswalk split PH cells on every newline; I join wrapped lines. Once both sides use the same splitter I expect about 99%. Any remaining misses will be linked at lesson level and flagged.
- ⚠ **43 PH rows come from the `Missing Practices` sheet**, which the brief says to ignore, so they cannot link. I propose importing them as unlinked notes on the SG objective, not as mappings (see Q4).
- ⚠ **520 PH rows come from `OPTIONAL`.** They link fine and will carry the `optional` flag.
- `Review gaps` and `Summary` are derived from Match detail, so I will not import them; the app regenerates them. `Method` is documentation.

---

## 5. Answers to the brief's questions, in short

| Brief said | Reality |
|---|---|
| PINE G5/G6 have extra columns | They are empty (formatting only) |
| AU AC9 cell may hold several codes separated by newlines | One code per cell; extra codes are on continuation rows. The newline form exists only in the SG crosswalk |
| AU book header rows like `BOOK 1A` | Only for 1A, 1B, 2A, 2B; later books are separated by blank rows |
| PH activities reuse PINE content | 910 of 1,235 (74%) grade-sheet activities and 395 of 417 OPTIONAL rows link to PINE; 323 are PH-native |
| Ignore sheets other than Grade 1–6 / OPTIONAL | Done, but `PH Curriculum` holds the full PH competency list (539 codes) and is the best source of PH curriculum text |
| PH title is a formula | Yes (`Q = E`); cached values are present, so no resolving is needed |
| Python might be needed | Not needed. ExcelJS reads cached formula values, merged ranges and cell styles (for the PH colour legend), so everything stays in TypeScript |

---

## 6. Proposed data model

Postgres 16 + pgvector. All IDs are UUIDs. Product and curriculum IDs are **UUIDv5** over a canonical key, so re-imports keep them stable.

```
curricula               id, code ('SG-MOE-2021','AC9','PH-DEPED'), name, country, version,
                        publisher_owned bool, source_file, created_at
curriculum_objectives   id (v5: curriculum.code + objective code | grade+no+norm text),
                        curriculum_id, code, grade_label ('P1','Year 3','Foundation'), grade_num (F=0),
                        track ('Standard'|'Foundation'|null), strand, sub_strand, topic, objective_no,
                        text, text_norm, tsv tsvector, embedding vector(768), sort_key, meta jsonb, status ('active'|'removed')

editions                id, code ('PINE','AU2','PH_DPA'), name, curriculum_id (the edition's home curriculum, nullable)

content_items           id (v5), origin_edition_id, kind ('lesson'|'activity'), title
                        -- the shared teaching unit: one per PINE lesson, AU lesson, PH-native activity
product_locations       id (v5: edition + location key), edition_id, content_item_id,
                        grade_num, book ('1A'), chapter_no text, chapter_title, unit_no text, unit_title,
                        lesson_no text, lesson_title, section ('Bk'|'Hub'|null), activity_ref, external_id ('PH_G1_C01_P1.1.1'),
                        type ('teaching'|'practice'|'problem_solving'|'review'|'assessment'),
                        optional bool, supplement bool (lettered chapter/unit/lesson), parent_location_id (Hub practice → its Bk lesson),
                        reuse_quality ('exact'|'good'|'match'|'new'|null)  -- PH colour legend
                        sort_key, source_file, source_sheet, source_row, meta jsonb, status ('active'|'removed')
product_objectives      id (v5: origin edition + content key + norm text), content_item_id, ordinal,
                        text, text_norm, tsv, embedding vector(768), status
location_objectives     location_id, product_objective_id, link ('direct'|'reworded_of')
                        -- PINE lesson → its bullets; PH activity → the PINE bullet it delivers (or its own reworded objective)

mappings                id, curriculum_objective_id, edition_id, product_location_id,
                        product_objective_id (nullable = whole-lesson mapping), unique(all four)
mapping_versions        id, mapping_id, version int, rating ('covered'|'check'|'not_found'),
                        role ('best'|'alternative'|'related'), status ('proposed'|'approved'|'rejected'),
                        scope_note, related_note, source ('imported'|'matcher'|'human'|'reupload'),
                        matching_run_id, import_batch_id, actor, note, created_at
                        -- append-only; current state = latest version per mapping (view mapping_current)
coverage_decisions_v    view: per curriculum objective × edition → best mapping + alternatives,
                        applying the preference order from the brief

import_batches          id, kind ('pine'|'au'|'ph'|'sg_crosswalk'|'curriculum_upload'), file, sha256, started_at,
                        report jsonb (counts, skipped rows with reasons, diff vs previous import)
matching_runs           id, curriculum_id, params jsonb, embed_model, llm_model, status,
                        est_cost, actual_cost, started_at, finished_at, report jsonb
llm_cache               key (sha256 of model+prompt), response jsonb, tokens_in, tokens_out, created_at
```

**Notes**
- **No double counting.** A PH activity that reuses PINE gets its own `product_location` (edition PH_DPA) pointing to the **same** `content_item` and the same `product_objectives` as the PINE lesson. Results can then say "PINE G1 Ch 1 lesson 1.1, also delivered in PH as PH_G1_C01_P1.1.1". When the PH objective is reworded (237 + 56), the PH wording becomes an extra `product_objective` on the same content item, linked as `reworded_of`. The PINE wording stays canonical.
- **Ratings vs status.** `rating` is the coverage judgement and `status` is the review state; both live in `mapping_versions`. Imported AC9/PH codes become `approved`, `covered`, `source=imported`. SG rows become `proposed`, with the rating mapped from the status, the "Scope / reason" text as `scope_note`, and Related only as `not_found` + `related_note`.
- **Re-import.** Stable IDs mean an unchanged objective keeps its ID. Objectives that disappear are set to `status='removed'` (not deleted) and their mappings are flagged. The batch report lists what was added, removed or changed.
- Embeddings use `vector(768)`, matching nomic-embed-text. The dimension is configurable at migration time if an API model is chosen.

## 7. Project layout

```
mapper/
  docker-compose.yml            pgvector/pgvector:pg16 on 5433
  .env.example
  package.json                  pnpm workspace scripts: db:up, db:migrate, ingest, dev, test
  pnpm-workspace.yaml
  apps/
    api/                        Hono + Drizzle
      src/db/schema.ts, migrations/
      src/ingest/               pine.ts, au.ts, ph.ts, sgCrosswalk.ts, phCurriculum.ts, report.ts, cli.ts
      src/matching/             (Phase 2) retrieve.ts, rules.ts, judge.ts, run.ts, accuracy.ts
      src/routes/               curricula, objectives, products, mappings, runs, export
      test/fixtures/            small xlsx files cut from the real sources
    web/                        React + Vite + TS (TanStack Query, TanStack Table)
  packages/shared/              zod schemas, types, text normalisation, bullet splitter, ID derivation
  data/source/                  (as now; git-ignored)
  docs/data-findings.md
```

---

## 8. Decisions (confirmed 2026-10-06)

1. **AU AC9 mappings target the whole lesson** (`product_objective_id` null). Let's Remember is mapped per bullet. Hub practice rows become `practice` locations under their Book lesson, and their codes fold into the parent lesson.
2. **The PH curriculum comes from the `PH Curriculum` sheet** (539 competencies). Grade sheets and OPTIONAL supply the approved mappings. Codes used but not in the sheet (9) are created as flagged stubs.
3. **The PH colour legend is imported** as `reuse_quality` on PH locations.
4. **The 43 SG `Missing Practices` rows are dropped**, and the ingestion report counts them.
5. **SG multi-bullet rows: one mapping per quoted bullet** (recommended; see the reasoning in chat). The review UI groups mappings by location, so a lesson still appears once.
6. **Location types:** teaching / practice / problem_solving / review / assessment. The matcher excludes review and assessment by default.
7. **The accuracy test uses PH** as the answer key. AC9 objectives stay code-only stubs until the ACARA text is supplied.
8. **Lettered chapters, units and lessons** (`15A`, `2A`, `1.A`) are imported with `supplement = true` on `product_locations`. They count as available content. In best-match they rank like `optional`: after non-supplement content and before grade distance. Filters can hide them.

## 9. Original questions

1. **AU mapping granularity.** AC9 codes attach to lessons, not bullets. I propose that imported AC9 mappings target the **lesson location with no specific objective** (whole-lesson mapping), with Let's Remember mapped per bullet. Hub practice rows (`More Practice` etc.) would become `practice` locations under their Book lesson; their codes fold into the parent lesson, and the Hub page stays visible as an extra location. Is that OK, or do you want lesson codes copied onto every bullet?
2. **PH curriculum source.** May I use the `PH Curriculum` sheet (539 competencies, clean code + text) as the PH curriculum, and take mappings from the grade and OPTIONAL sheets? Otherwise only the 429 codes actually used would exist, and the 119 unmapped competencies would be invisible as gaps.
3. **PH colour legend.** Should I import the column-D colours as `reuse_quality` (exact / good / match / new / vendor-pending)? This is cheap and tells you how faithful each PH activity is to PINE.
4. **SG rows from `Missing Practices` (43).** Drop them, or keep them as notes on the SG objective?
5. **SG rows quoting several bullets (1,247).** I propose one mapping per quoted bullet, all sharing the same rating and note. The alternative is one whole-lesson mapping per row. Which do you prefer?
6. **Location types.** I propose `teaching`, `practice` (AU Hub practice), `problem_solving` (Mind stretcher), `review` (Let's Remember) and `assessment`. The matcher would search teaching + practice + problem_solving and exclude review and assessment by default. The PH G/H/I assessment columns would be flags on a teaching activity, not a separate type. Does that work?
7. **AC9 curriculum text (for the accuracy test and the AC9 curriculum).** Please supply the ACARA v9.0 Mathematics content descriptions for **Foundation to Year 8** (the books use F and Year 7–8 codes), as XLSX or CSV with code + description + strand + year. The "Mathematics F–10 curriculum content" export from v9.australiancurriculum.edu.au is ideal. Until then, AC9 objectives exist as code-only stubs, and the accuracy test starts with PH as you suggested.
8. **Lettered chapters and units** (`15A`, `2A`, `1.A`). I will treat them as normal content. Tell me if they should be flagged, for example as US-only supplements to exclude for some markets.
