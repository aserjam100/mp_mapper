import { v5 as uuidv5 } from 'uuid';
import { normText } from './text.js';

/** Namespace for every deterministic ID in the mapper. Never change it: IDs would all move. */
export const MAPPER_NS = '6f1c2b8e-4a7d-5e3f-9b21-0c8d7a5e4f10';

export const stableId = (...parts: (string | number | null | undefined)[]) =>
  uuidv5(parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|'), MAPPER_NS);

export const curriculumId = (code: string) => stableId('curriculum', code);
export const curriculumObjectiveId = (curriculumCode: string, key: string) =>
  stableId('cobj', curriculumCode, key);
export const editionId = (code: string) => stableId('edition', code);
export const contentItemId = (originEdition: string, key: string) => stableId('content', originEdition, key);
export const locationId = (edition: string, key: string) => stableId('loc', edition, key);
/** Product objectives are identified by their content item + normalised text, so re-ordering bullets keeps IDs. */
export const productObjectiveId = (contentId: string, text: string) => stableId('pobj', contentId, normText(text));
export const mappingId = (
  curriculumObjectiveId: string,
  editionId: string,
  locationId: string,
  productObjectiveId: string | null,
) => stableId('map', curriculumObjectiveId, editionId, locationId, productObjectiveId);
