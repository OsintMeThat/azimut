/**
 * How the 3D views are drawn on this computer (Settings, General): Full as they always were,
 * Balanced and Light lighter for a slow graphics card or little memory. It is this machine's,
 * so the settings backup leaves it behind. Plates and their exports never read it.
 */

/** The levels, as Settings offers them. */
export const QUALITIES_3D = [
  { id: 'full', label: 'Full', title: 'Every detail the screen can show' },
  { id: 'balanced', label: 'Balanced', title: 'A little less detail, for an average computer' },
  { id: 'light', label: 'Light', title: 'Less detail and no edge smoothing, for an old computer' },
];

/**
 * What the 3D globe draws at each level (lib/globe): how many picture pixels a screen pixel may
 * show before a tile is split (`sharpness`, and `round` for the ground all round the eye), pixels
 * per CSS pixel at most, edge smoothing, pictures laid per frame, and what the GPU may hold.
 * Full holds the values the globe always had.
 */
export const GLOBE_QUALITY = {
  full: { sharpness: 1.25, round: 6, pixelsMax: 2, antialias: true, uploads: 6, pictureBytes: 192 * 1024 * 1024, drapeBytes: 128 * 1024 * 1024, meshes: 700 },
  balanced: { sharpness: 1.6, round: 8, pixelsMax: 1.5, antialias: true, uploads: 4, pictureBytes: 192 * 1024 * 1024, drapeBytes: 128 * 1024 * 1024, meshes: 700 },
  light: { sharpness: 2.5, round: 12, pixelsMax: 1, antialias: false, uploads: 2, pictureBytes: 96 * 1024 * 1024, drapeBytes: 64 * 1024 * 1024, meshes: 400 },
};

/** Horizon's pixels per CSS pixel at most: Full as many as the screen has. */
export const HORIZON_PIXELS = { full: Infinity, balanced: 1.5, light: 1 };

/** A level the app knows, Full for anything else. */
export const qualityOf = (id) => (QUALITIES_3D.some((one) => one.id === id) ? id : 'full');
