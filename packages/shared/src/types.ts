import { z } from 'zod';

export const RATINGS = ['covered', 'check', 'not_found'] as const;
export const Rating = z.enum(RATINGS);
export type Rating = z.infer<typeof Rating>;

export const MAPPING_STATUSES = ['proposed', 'approved', 'rejected'] as const;
export const MappingStatus = z.enum(MAPPING_STATUSES);
export type MappingStatus = z.infer<typeof MappingStatus>;

export const MAPPING_SOURCES = ['imported', 'matcher', 'human', 'reupload'] as const;
export type MappingSource = (typeof MAPPING_SOURCES)[number];

export const MAPPING_ROLES = ['best', 'alternative', 'related'] as const;
export type MappingRole = (typeof MAPPING_ROLES)[number];

export const LOCATION_TYPES = ['teaching', 'practice', 'problem_solving', 'review', 'assessment'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
/** Types the matcher searches by default. */
export const MATCHABLE_TYPES: LocationType[] = ['teaching', 'practice', 'problem_solving'];

export const REUSE_QUALITIES = ['exact', 'good', 'match', 'new', 'vendor_pending', 'settled'] as const;
export type ReuseQuality = (typeof REUSE_QUALITIES)[number];

export const EDITIONS = {
  PINE: { code: 'PINE', name: 'PR1ME International New Edition (PINE)', short: 'PINE' },
  AU2: { code: 'AU2', name: 'PR1ME Australia (2nd ed.)', short: 'AU' },
  PH_DPA: { code: 'PH_DPA', name: 'PR1ME PH Digital Practices & Assessments', short: 'PH DPA' },
} as const;
export type EditionCode = keyof typeof EDITIONS;

export const CURRICULA = {
  SG: { code: 'SG-MOE-2021', name: 'Singapore MOE Primary Mathematics 2021 (updated Oct 2025)', country: 'SG', version: '2021 / Oct 2025' },
  AC9: { code: 'AC9', name: 'Australian Curriculum: Mathematics v9.0', country: 'AU', version: '9.0' },
  PH: { code: 'PH-DEPED', name: 'Philippines DepEd K to 12 Mathematics (Grades 1–6)', country: 'PH', version: 'K to 12' },
} as const;

/** Status labels in the SG crosswalk -> rating. */
export const SG_STATUS_TO_RATING: Record<string, Rating> = {
  'Skill match': 'covered',
  'Scope to verify': 'check',
  'Partial scope': 'check',
  'Related only': 'not_found',
};

export const RATING_LABEL: Record<Rating, string> = { covered: 'Covered', check: 'Check', not_found: 'Not found' };
