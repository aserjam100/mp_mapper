# Project status / handoff

Last updated 2026-10-12. The brief is `CLAUDE_CODE_PROMPT.md`. Work proceeds in phases, with a stop for the user's confirmation at each checkpoint.

| Phase | State |
|---|---|
| 0: inspect and plan | Done: `docs/data-findings.md`, whose section 8 records the decisions |
| 1: ingest and browse | **Done; waiting for the user to approve Phase 2** |
| 2: matching | Not started |
| 3: review and reupload | Not started |

## Post-Phase-1 UI changes (2026-10-12, made at the user's request)
- **Product browser crash fixed** (`apps/web/src/pages/Products.tsx`). A `useEffect` arrow returned the result of `scrollIntoView`, and Chrome now returns a Promise from it, so React threw "destroy is not a function". Effects must use a block body.
- **"How to use" page added** at `/about` (`apps/web/src/pages/About.tsx`), linked from the top nav. The user found the first version confusing, so it was simplified to a quick start, a colour legend, one line per page, and "good to know". Keep it short and non-technical; technical detail goes in the README.
- **Theme**: the user wants light only, Facebook-style blue and white. The dark-mode media query was removed. The palette is `--bg #f0f2f5`, `--accent #1877f2`, `--text #1c1e21`, `--muted #65676b`, and the top bar is solid blue with white text (`apps/web/src/styles.css`). Don't add dark mode back.

## Open question from the user (2026-10-12)
- The user asked why PINE isn't in the Curricula list. It was explained that PINE is a **product** (per the brief), so it appears as a coverage column and in the Product browser. Two follow-ups were offered and are **unanswered**:
  - add a "Products" section to the Curricula home page (PINE / AU2 / PH with counts, linking to the Product browser);
  - or, if the user meant it, treat PINE objectives like a curriculum. That would be a model change and needs design first.

## Running locally
- `pnpm dev` starts the API on :3001 and the web app on :5173. If it fails with `EADDRINUSE`, an old dev server is still running: run `lsof -nP -iTCP:3001 -iTCP:5173 -sTCP:LISTEN` and kill it. This happened on 2026-10-06.
- The DB container `mapper-db` and the ingested data were in place as of 2026-10-06.

## Decisions confirmed by the user (2026-10-06)
1. AU AC9 codes map to the **whole lesson** (`product_objective_id` null). Let's Remember is mapped per bullet. Hub practice pages become `practice` locations under their Bk lesson and fold their codes into it.
2. The PH curriculum comes from the `PH Curriculum` sheet (521 competencies). The 6 codes used in DPA but missing from the sheet are created as stubs.
3. The PH colour legend is imported as `reuse_quality`.
4. The 43 SG `Missing Practices` rows are dropped.
5. SG crosswalk rows produce **one mapping per quoted bullet**.
6. Location types are teaching / practice / problem_solving / review / assessment. The matcher excludes review and assessment.
7. The **accuracy test uses PH** as the answer key. AC9 objectives stay code-only stubs until the user supplies the ACARA v9 F–8 text.
8. Lettered chapters, units and lessons are flagged as `supplement`. In best-match they rank like `optional`.

## Decisions still to be checked by the user (flagged at the Phase 1 checkpoint)
- `supplement` is applied to PINE labels only, not AU lesson numbers like `1A`. PH activities are flagged only when the PH label itself is lettered.
- PH activities have type `practice`.
- A PH objective counts as the same as a PINE bullet when Dice similarity ≥ 0.85; below that it is stored as a rewording (`reworded_of`).
- Best-match grade distance uses the edition's own grade.

## Phase 2 to-do (from the brief)
- Upload page with column mapping (grade / strand / code / text) and a preview.
- Embeddings via Ollama `nomic-embed-text`, with an API provider as an option. Ollama was **not running** on this machine at the end of Phase 1.
- Retrieve candidates **per edition**: pgvector + full-text search, a grade window, and exclusion of review/assessment.
- Reuse approved mappings from other curricula via similar objectives.
- Rule checks for numeric ranges and decimal places.
- LLM judge using Anthropic, with the model set by `JUDGE_MODEL`:
  - batch the calls, cache results in `llm_cache`, and show an estimated cost before a run starts;
  - **ask the user before product content is first sent to the API.**
- Accuracy test on PH with its approved mappings hidden: best match, top 3 and rating agreement, broken down by grade and strand.

## Known issues
- In the objective page's side panel, related approved codes are repeated per location rather than grouped by code.
- SG crosswalk PH Grade 3 row 25 is mapped through the PH-wording fallback and is flagged in the report.
- The SG crosswalk file can't be opened by ExcelJS (absolute paths inside the file), so it is read with SheetJS through `loadGrids`.
- No git commits yet. The user commits and pushes themselves; never run git commit or push, just give them the commands.
