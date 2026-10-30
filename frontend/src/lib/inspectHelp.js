/**
 * What Inspect's controls say on hover, one clause each, kept here so the player,
 * the panel and the viewer say the same thing about the same control.
 * `inspectHelp.test.js` holds every key to a sentence.
 */
export const INSPECT_HELP = {
  // the player
  play: 'Play or pause (Space or K)',
  frameBack: 'Back one frame (← or ,), one second with Shift',
  frameForward: 'Forward one frame (→ or .), one second with Shift',
  clock: 'The frame on screen and its number in the clip',
  speed: 'Playback speed (J slower, L faster)',
  loopA: 'Start the loop here',
  loopB: 'End the loop here, and play it over',
  loopClear: 'Stop looping',
  mute: 'Sound on or off',
  fullscreen: 'Full screen',
  captureIcon: 'Capture this frame (C)',
  bar: 'Click or drag to move through the clip',
  keys: 'Space play · ←/→ frame · Shift+←/→ second · J/L speed · C capture · M mark · hold O for the original',

  // the panel
  capture: 'Keep the frame on screen with this video (C)',
  saveAll: 'Save every frame not in the case yet',
  tabInfo: 'What the file says about itself',
  tabAdjust: 'Turn, tune and crop',
  tabMoments: 'Marks, shots and the sharpest frames',
  tabAnalyze: 'Error levels and searches from this frame',
  resize: 'Resize the panel',

  // info
  copyHash: 'Copy the SHA-256',
  copyCoords: 'Copy the coordinates',
  showOnMap: 'Open Satellite at this point',
  allMetadata: 'Every field the file carries',

  // adjust
  preset: 'Set the sliders for this kind of picture',
  resetAdjust: 'Put every slider back',
  histogram: 'Brightness of the picture as shown, dark on the left',
  orientation: 'Turn by right angles',
  crop: 'Draw the part of the frame to keep',
  resetFrame: 'Back to the frame as it was cut',
  duplicate: 'A second copy to crop or adjust differently',
  original: 'Hold to see it without adjustments (O)',
  fit: 'Reset zoom, pan and turn',

  // moments
  addMark: 'Mark where the video is (M)',
  markLabel: 'What happens here',
  markSeek: 'Go to this mark',
  markRemove: 'Remove this mark',
  scan: 'Read every frame once to find the shot changes and the sharpest frames',
  shot: 'Go to the sharpest frame of this shot',
  captureHere: 'Capture this frame',
  seekHere: 'Go here',

  // analyze
  ela: 'Resave the frame as JPEG and show where it changes most',
  elaOpacity: 'How strongly the error levels cover the frame',
  elaShow: 'Show the error levels over the frame',
  reverse: 'Search the web for this frame as shown',
  horizon: 'Lay this frame over the Horizon view, to find where it was taken from',
};

/** What a filter's slider says on hover, by filter id. */
export const FILTER_HELP = {
  brightness: 'Lighter or darker overall',
  contrast: 'Spread between dark and light',
  saturation: 'Strength of the colours',
  gamma: 'Lifts the shadows without burning the highlights',
  sharpness: 'Crisper edges',
  denoise: 'Smooths grain from a dark or compressed picture',
  autolevels: 'Stretches the darkest and brightest 1% to black and white',
  clahe: 'Brings out detail in dark and bright areas separately',
  channel: 'Shows one colour channel alone',
  grayscale: 'Drops the colour',
  invert: 'Swaps dark and light',
};
