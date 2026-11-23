/**
 * What the pill over the tools says on hover while a scene is geolocated
 * (`components/GeolocatingPill.svelte`), one clause each.
 */
export const GEOLOCATING_HELP = {
  back: (file) => `Open the scene in Inspect, on ${file}`,
  make: 'Make the proof from its frames and captures',
  open: 'Open its proof, with the map captures it does not hold yet',
  makePicture: 'Make the proof from the picture and its captures',
  stop: 'Stop geolocating it, its captures stay with it',
  gathered: 'What this scene gathered',
  inspect: 'Open the scene in Inspect',
  satellite: 'Go to Satellite, its reference beside the map',
  horizon: 'Go to Horizon',
};

/** What the list of what a scene gathered says on hover (`components/GatheredPanel.svelte`). */
export const GATHERED_HELP = {
  showLead: 'Show it on the map',
  deleteLead: 'Delete this lead',
  open: 'Open it',
  deleteCapture: 'Move this capture to the Trash',
  removeFrame: "Take it off Inspect's strip",
  unsavedFrame: 'Not saved to the case yet: open the scene in Inspect',
  openCollage: 'Not exported yet: open it in Collage',
};
