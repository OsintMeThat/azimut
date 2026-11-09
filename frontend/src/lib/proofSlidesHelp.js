/**
 * What Geo Proof's slides say on hover, one clause each: the strip under the canvas,
 * its tiles and their menus, and the page a scene still to prove shows in place of a
 * proof. `proofSlidesHelp.test.js` holds every key to a short clause and to a control.
 */
export const PROOF_SLIDES_HELP = {
  // the strip
  video: 'Show the video in the Scene tab',
  previous: 'Previous slide (Alt+←)',
  next: 'Next slide (Alt+→)',
  before: 'Scroll to the slides before',
  after: 'Scroll to the slides after',
  tally: 'The slide on screen, of the video\'s slides',
  newScene: 'A new slide of this video, in the look of this one',
  list: 'Every slide of the video',
  search: 'Find a slide by its name or its time',
  fold: 'Hide the slides',
  unfold: 'Show the slides',
  more: 'More for this slide',
  series: 'More for the slides of this video',
  export: 'Copy every slide\'s saved picture into one folder, numbered in clip order',

  // a tile
  current: 'The slide on screen',
  open: 'Open this slide',
  scene: 'Show this scene to geolocate',
  heading: 'Opens once this slide is saved',
  unsaved: 'Not saved yet',
  dirty: 'Changed since it was saved',

  // what a tile's menu does
  rename: 'Give this slide another name',
  name: 'The slide\'s new name, its file following it',
  delete: 'Send this proof to the Trash, asking about its scene',
  inspect: 'Open the video in Inspect on this passage',
  unplaced: 'This slide states no place yet',
  make: 'Make the proof of this scene from its frames',
  geolocate: 'Find this scene on the map, its captures kept with it',
  abandon: 'Give up on this scene, kept greyed at the end',
  restore: 'Take this scene up again',
  reason: 'Why it is given up, optional',
};
