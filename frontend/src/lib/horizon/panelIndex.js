/**
 * The Horizon inspector's groups and the settings in them, by name, so the
 * inspector and the command palette say the same words: a setting typed in
 * the palette (Ctrl+K) opens Horizon on its group, its row lit.
 *
 * Only the groups shown once an eye stands are listed; the Photo group's rows
 * are reached from the photo itself.
 */

/** The inspector's groups, by id, in their order. */
export const HORIZON_GROUPS = Object.freeze({
  measures: 'Measures',
  viewpoint: 'Viewpoint',
  view: 'What the view shows',
});

/** Each setting: its row's id in the inspector, its name, its group, and other words it is looked up by. */
export const HORIZON_SETTINGS = Object.freeze([
  { id: 'marked', label: 'Marked point', group: 'measures', words: 'in sight hidden line of sight target' },
  { id: 'pointed', label: 'Clicked in the view', group: 'measures', words: 'ground distance stand here' },
  { id: 'position', label: 'Position', group: 'viewpoint', words: 'coordinates eye where move the viewpoint' },
  { id: 'who', label: 'Who is looking', group: 'viewpoint', words: 'ground drone aircraft person' },
  { id: 'height', label: 'Eye height', group: 'viewpoint', words: 'altitude drone aircraft height' },
  { id: 'width', label: 'Field of view', group: 'viewpoint', words: 'lens width focal length zoom mm' },
  { id: 'frame', label: 'Frame', group: 'viewpoint', words: 'photo panorama strip projection' },
  { id: 'tilt', label: 'Tilt and roll', group: 'viewpoint', words: 'level lean pitch' },
  { id: 'peaks', label: 'Summit names', group: 'view', words: 'peaks mountains labels openstreetmap' },
  { id: 'ridges', label: 'Ridge lines', group: 'view', words: 'lines density contours fewer more' },
  { id: 'buildings', label: 'Buildings', group: 'view', words: '3d heights houses beta' },
  { id: 'sky', label: 'Sun and moon paths', group: 'view', words: 'sun moon shadows time day light' },
  { id: 'visibility', label: 'Visibility', group: 'view', words: 'haze air distance fog' },
  { id: 'near', label: 'Hide nearer than', group: 'view', words: 'near ground foreground wall' },
]);

/** A setting by its id, or null. */
export function horizonSetting(id) {
  return HORIZON_SETTINGS.find((one) => one.id === id) ?? null;
}
