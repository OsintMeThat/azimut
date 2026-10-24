/**
 * What each setting of a personal layer says when the pointer rests on it, in one
 * place, so a feature's sheet, its right-click menu, a group's settings, the
 * layer's menu, the "Add to a layer" steps and a plate's symbol word it alike.
 * One clause each: the label says what it is, this says what it does.
 */

/**
 * A marker's state, as every chooser offers it: `[value, label, hover]`. Nothing
 * said comes first and reads as How sure's does, since most markers are neither
 * a strike's target nor a building.
 */
export const STATUS_CHOICES = [
  ['', '–', 'No damage said, drawn plain'],
  ['damaged', 'Damaged', 'Drawn with a stroke across it'],
  ['destroyed', 'Destroyed', 'Drawn with a cross over it'],
];

export const LAYER_HELP = {
  // a feature's sheet
  group: 'The group it is listed and drawn with',
  status: 'What is left of it, drawn over the marker',
  confidence: 'How firm its position is',
  look: 'How it is drawn: its size, line, fill and name',
  size: 'Its size against the rest of its group',
  lineWidth: 'Its width in pixels',
  dash: 'Its own dash, over the one How sure draws',
  arrow: 'An arrowhead at the end it was drawn to, or at both',
  fill: 'Filled, hatched, or its outline only',
  strength: 'How strongly the fill covers the ground',
  name: 'Whether its name is written on the map',
  nameSize: 'The size its name is written at',
  day: 'The day the time strip and the Timeline file it under',
  days: 'Its history is kept while Track over time is off',
  facing: 'Where it points, set by the ring round it on the map',
  position: 'Type or paste another position to move it there',
  sources: 'The addresses it rests on, each opened in a tab of its own',
  origin: 'Who found where it stands',
  credit: 'Printed in the credits of a plate that draws it',
  note: 'What it shows and what it rests on',
  toGroup: 'Back to what its group says',
  // a group's settings
  groupName: 'Its name in the list and the legend',
  individual: 'Each feature keeps its own icon and colour',
  oneColour: "Each feature keeps its icon and takes the group's colour",
  uniform: "Every feature in it takes the group's icon and colour",
  groupStyle: 'The icon and colour of all its features',
  groupColour: 'The colour of all its features',
  labels: "Writes each feature's name beside it",
  events: 'Each one fades after its day, and stays unless the time cursor says how long',
  iconSize: 'Scales every marker in the group',
  groupLine: 'The width of its lines that set none of their own',
  lines: 'How its lines are drawn when they say nothing of their own',
  areas: 'How its areas are filled when they say nothing of their own',
  // the layer's menu
  track: 'Keeps each change as a dated state instead of overwriting it. Off hides the history and keeps it',
  precision: 'Whether a state holds a day, or a day and a time',
  clock: 'The time zone its states are read in',
};

/** How sure, as the sheet offers it: `[value, label, hover]`. */
export const CONFIDENCE_CHOICES = [
  ['', '–', 'Not said'],
  ['confirmed', 'Sure', 'Confirmed'],
  ['probable', 'Likely', 'Probable: a line is dashed, a marker fainter'],
  ['claimed', 'Claimed', 'Claimed: a line is dotted, a marker fainter'],
];

/** Who geolocated it, as the sheet offers it: `[value, label, hover]`. */
export const ORIGIN_CHOICES = [
  ['', 'Me', 'Geolocated by me'],
  ['external', 'Others', 'Geolocated by someone else, drawn with a dashed rim'],
];

/**
 * The analyst's own icons, as the palette, the copy steps, a layer's menu and
 * Settings › Icons word them.
 */
export const ICON_HELP = {
  keepsColours: 'This icon keeps its own colours.',
  layerIcons: "This layer's icons",
  layerIconsHint: 'Icons this layer holds that are not in your library',
  layerIcon: 'Icon from this layer',
  noLibrary: 'Your own icons go here.',
  openSettings: 'Settings › Icons takes PNG, JPEG, WebP, SVG or a zipped pack',
  itsOwn: 'Its own icon',
  itsOwnHint: 'The icon it wears on its map, copied with it',
  toLibrary: 'Add these icons to my library',
  toLibraryHint: "Files this layer's icons in Settings › Icons, for any layer of any case",
};

/** How an own icon is drawn, as Settings › Icons offers it: `[value, label, hover]`. */
export const ICON_MODES = [
  ['disc', 'In a disc', "Its shape inked on a disc of the marker's colour, as the app's icons are"],
  ['image', 'As it is', 'Drawn in its own colours'],
];
