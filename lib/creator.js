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

/** Non-founding artists receive 75% of artwork value; founding artists receive 80%. */
export function creatorCommissionRate(_role, isFoundingArtist = false) {
  return isFoundingArtist ? 0.20 : 0.25;
}

export function creatorPayoutRate(role, isFoundingArtist = false) {
  return 1 - creatorCommissionRate(role, isFoundingArtist);
}

export function artworkPhotoLimit(role) {
  return normaliseCreatorRole(role) === CREATOR_ROLES.PHOTOGRAPHER ? 2 : 4;
}
