/**
 * What the pill over the tools says on hover while a scene is geolocated
 * (`components/GeolocatingPill.svelte`), one clause each.
 */
export const GEOLOCATING_HELP = {
  back: (file) => `Open the scene in Inspect, on ${file}`,
  make: 'Make the proof from its frames and captures',
  makePicture: 'Make the proof from the picture and its captures',
  stop: 'Stop geolocating it, its captures stay with it',
  none: 'Nothing captured for it yet',
  one: '1 capture gathered for it',
  some: (n) => `${n} captures gathered for it`,
};
