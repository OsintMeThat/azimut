/**
 * What Geo Proof's scene says on hover, one clause each: its field, its player and
 * its time. The time editor is Inspect's (`components/SceneTimeEditor`), so what
 * stays true here is Inspect's own words, and only what points at the frame on
 * screen differs, since Geo Proof has a player where Inspect has S and a bar.
 * `proofSceneHelp.test.js` holds every key to a sentence and to a control.
 */
import { INSPECT_HELP } from './inspectHelp.js';

export const PROOF_SCENE_HELP = {
  // the field
  star: 'The video this proof is about, which its date states',
  makeStar: 'Make this the video the proof is about, which its date states',
  time: 'Change when in the video the place shows',
  show: 'Play it in the player',
  addMoment: 'Add an instant at the frame of each panel outside these moments',
  badge: 'Prints the scene\'s timecode on its panels',
  matched: 'Every frame of this video falls in this scene, which the save takes up',
  onlyScene: 'The one scene of this video to geolocate, which the save takes up',
  notThisScene: 'Keep this proof apart from that scene',

  // the player
  play: 'Play or pause (Space)',
  frameBack: 'Back one frame (←), one second with Shift',
  frameForward: 'Forward one frame (→), one second with Shift',
  loop: 'Play the scene\'s moments over and over',
  mute: 'Sound on or off',
  bar: 'Click or drag to move through the clip',
  panelFrame: 'Go to the frame of this panel',
  clock: 'The frame on the player',
  addFrame: 'Save the frame on the player to the case, and add it as a panel',
};

/** The time editor's words in Geo Proof: Inspect's, and the frame on the player for S. */
export const PROOF_TIME_HELP = {
  whole: INSPECT_HELP.sceneWhole,
  instant: INSPECT_HELP.sceneInstant,
  passage: INSPECT_HELP.scenePassage,
  field: INSPECT_HELP.sceneField,
  startHere: 'Start at the frame on the player',
  endHere: 'End at the frame on the player',
  add: 'Another moment the place shows in, at the frame on the player',
  remove: INSPECT_HELP.momentRemove,
  apply: INSPECT_HELP.sceneApply,
};

/** The line under the editor's moments, about the frame on screen. */
export const PROOF_TIME_TIPS = {
  whole: 'No timecode, the proof is about the whole video',
  instant: 'Here takes the frame on the player',
  passage: 'Here takes the frame on the player, for the start or the end',
};
