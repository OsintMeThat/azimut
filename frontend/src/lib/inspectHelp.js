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
  bar: 'Click or drag to move through the clip, the wheel zooms in on its time',
  barScene: 'Drag a handle to move the scene, or click to move through the clip',
  barZoom: 'The bar zoomed by the wheel or + and -, click for the whole clip',
  keys: 'Space play · ←/→ frame · Shift+←/→ second · J/L speed · C capture · S scene · M mark · +/- bar zoom · hold O unadjusted',

  // the panel
  capture: 'Keep the frame on screen with this video (C)',
  saveAll: 'Save every frame not in the case yet',
  tabScenes: 'The places to find in this file, and where each one stands',
  tabInfo: 'What the file says about itself',
  tabAdjust: 'Turn, tune and crop',
  tabMoments: 'Marks and the shots of the video',
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

  // scenes
  markHere: 'Keep the frame on screen as a scene to geolocate (S)',
  markMenu: 'Mark this instant or the whole video',
  markMoment: 'A scene at the frame on screen (S)',
  markWhole: 'A scene about the whole video, with no timecode',
  markWholeTaken: 'The whole video is marked already',
  markWholeTimed: 'Scenes already hold passages of this video, so the whole of it is not one place',
  markPicture: 'Keep the whole picture as a place to geolocate',
  inviteWhole: 'One scene about the whole video, with no timecode',
  inviteSeveral: 'Press S where each place shows as the video plays',
  inviteLater: 'Stop asking on this video',
  sceneOpen: 'Open this scene',
  sceneLabel: 'What to find in this scene',
  scenePlay: 'Play this scene on a loop',
  sceneWhole: 'The whole video, with no timecode',
  sceneWholeTimed: 'Another scene holds passages of this video, so the whole of it is not one place',
  sceneInstant: 'One instant of the video',
  scenePassage: 'A stretch of the video, from a start to an end',
  sceneField: 'Like 1:05 or 65, nudged a frame with ↑ and ↓, a second with Shift',
  sceneStartHere: 'Start at the frame on screen',
  sceneEndHere: 'End at the frame on screen',
  sceneApply: 'Keep this time (Enter)',
  momentAdd: 'Another passage the place shows in, from the frame on screen',
  momentRemove: 'Remove this passage',
  samePlace: 'Join it with another scene of this place',
  samePlaceAs: 'Both passages and their captures in one scene',
  sceneEnd: 'End the scene at the frame on screen (Shift+S)',
  sceneRemove: 'Remove this scene',
  sceneProof: 'Open the proof of this scene in Geo Proof',
  pictureProof: 'Open the proof laying out this picture',
  sceneMakeProof: 'Make the proof of this scene in Geo Proof, from its frames and captures',
  pictureMakeProof: 'Make the proof in Geo Proof, from the picture and its captures',
  sceneGeolocate: 'Find it on the map, the video open beside it',
  pictureGeolocate: 'Find it on the map, the picture open beside it',
  sceneStopGeolocating: 'Stop geolocating it; its captures stay',
  proofUnplaced: 'Its proof states no place yet: open it to add the point, or abandon it',
  sceneAbandon: 'Give up on it, with a word if you like',
  sceneAbandonWord: 'Enter abandons it, Escape keeps it',
  sceneAbandonConfirm: 'Set it aside with the abandoned scenes',
  scenesAbandoned: 'The scenes given up on, each with its word',
  sceneGo: 'Go to this scene',
  sceneRestore: 'Bring it back to geolocate, captures and all',
  shotScene: 'Keep this shot as a scene to geolocate',

  // moments
  addMark: 'Mark where the video is (M)',
  markLabel: 'What happens here',
  markSeek: 'Go to this mark',
  markRemove: 'Remove this mark',
  scan: 'Read every frame once to find where the camera changes shot',
  shot: 'Go to the sharpest frame of this shot',
  captureHere: 'Capture this frame',
  seekHere: 'Go here',

  // a collage's scene, in the Collage tool
  collageMarkVideo: 'Mark the whole video its pieces come from',
  collageMarkMenu: 'Mark the whole video or the stretch its pieces span',
  collageMarkPeriod: 'A scene over the stretch its pieces span',
  collageMarkPicture: 'Keep its picture as a place to geolocate, saved first if need be',
  collageGeolocate: 'Find it on the map, the video and the collage open beside it',
  collageMakeProof: 'Make the proof of this scene, from its frames, collages and captures',
  collageOpen: 'Open this collage',
  collageTime: 'Change when in the video the scene happens, the video playing it beside',
  collagePieceFrame: 'Go to the frame of this piece',
  // make the proof
  proofCollages: 'Collages cut from this scene, their saved picture laid out',
  proofCollageStale: 'Changed since its picture was saved: the saved one is laid out',
  proofFramesAll: 'Tick or untick every frame',
  proofFramesMake: 'Save the ticked frames and open a proof of the scene on them',
  proofFrameUnsaved: 'Not in the case yet, saved on the way',
  proofCaptures: 'Captures filed on the map while the scene was geolocated',

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

/**
 * The line under the time editor in the Collage tool, about the frame on its player
 * (`tools/inspect/CollageMoment.svelte`), as Geo Proof says it of its own.
 */
export const COLLAGE_TIME_TIPS = {
  whole: 'No timecode, the scene is about the whole video',
  instant: 'Here takes the frame on the player',
  passage: 'Here takes the frame on the player, for the start or the end',
};
