export const CREATOR_ROLES = Object.freeze({ PAINTER: 'Painter', PHOTOGRAPHER: 'Photographer' });

export function normaliseCreatorRole(value) {
  return value === CREATOR_ROLES.PHOTOGRAPHER ? CREATOR_ROLES.PHOTOGRAPHER : CREATOR_ROLES.PAINTER;
}

export function creatorTitle(value) {
  return normaliseCreatorRole(value) === CREATOR_ROLES.PHOTOGRAPHER ? 'Photographer' : 'Artist';
}

export function creatorStudioTitle(value) {
  return normaliseCreatorRole(value) === CREATOR_ROLES.PHOTOGRAPHER ? 'Photography Studio' : 'Artist Studio';
}

export function creatorCommissionRate(value) {
  return normaliseCreatorRole(value) === CREATOR_ROLES.PHOTOGRAPHER ? 0.05 : 0.02;
}

export function creatorPayoutRate(value) {
  return 1 - creatorCommissionRate(value);
}
