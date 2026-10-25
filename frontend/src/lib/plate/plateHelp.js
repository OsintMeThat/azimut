/**
 * What each setting of a plate's inspector says when the pointer rests on it, in one
 * place, so the words are read and changed together. One clause each: the label says
 * what it is, this says what it does.
 *
 * A setting is found by its name: a control by its `aria-label`, a checkbox by the
 * words beside it, a row's key by the control it names (or by `key:` and its own
 * words when it names none). `hoverHelp` sets them as titles on everything under a
 * panel, and keeps them as the panel changes; a title written in the markup wins.
 */

export const PLATE_HELP = {
  // the page
  Paper: 'The paper the page is laid out on, its size in millimetres',
  'Page width': 'The page\'s width, in millimetres',
  'Page height': 'The page\'s height, in millimetres',
  Orientation: 'The paper turned wide or upright',
  'Paper background': 'A plain colour, a gradient or a picture under everything',
  'Gradient colour': 'The colour the paper fades to',
  'Gradient direction': 'Which way the gradient runs',
  'Paper grain': 'Fine specks over the whole page, as printed paper shows them',
  'Country lit': 'The country this map keeps lit while the rest of the world is drawn back',
  'The rest of the world': 'Darkened toward black, or faded toward the paper',
  'Focus strength': 'How far the rest of the world is drawn back',
  'key:Picture': 'A picture under everything on the page',
  'A rule round the page': 'A thin line round the page\'s edge',
  'Show the margins and the feed crop': 'Guides on the screen only, never printed',
  'See-through paper in a PNG': 'A PNG leaves the paper out, for a picture laid over something else',
  Font: 'The face the page writes in, Arabic included',
  'Paper colour': 'The colour of the paper',
  'Ink colour': 'The colour the page writes in',
  'Accent colour': 'The colour that picks things out: numbers, arrows, a banner',
  'Between the days and the steps': 'The MP4 goes from one day or step to the next by a transition',
  'Transition length': 'How long each transition takes',
  'What is new on a day or a step': 'How what a day or a step adds comes in',
  'The page fades into the next': 'The whole page fades from one picture to the next',
  'A map framed otherwise moves there': 'A map framed otherwise on the next day flies there',
  'Blurred as it moves': 'The moving map blurs as it goes fastest',
  // one picked
  'Element name': 'What the element list calls it',
  'Steps it is shown on': 'Shown on this step only, or on the steps after it too',
  'First day shown': 'The first day it is shown on, when the plate plays',
  'Last day shown': 'The last day it is shown on, when the plate plays',
  // a map
  'Keep the previous framing': 'This day or step shows the map as the one before it does',
  'Detail of': 'The map this detail shows a part of',
  Ground: 'What the map is drawn on',
  'Wayback release': 'Which dated release of Esri\'s imagery it shows',
  'Cloudless year': 'Which year\'s cloud-free picture it shows; each has its own licence',
  'Sentinel-2 layer and date': 'The Sentinel-2 pass the map is drawn on: its layer, its day and the cloud it may hold',
  Zoom: 'How close the map is, to the decimal',
  Bearing: 'How far the map is turned from north, in degrees',
  'Map frame': 'A line round the map',
  'Frame weight': 'How thick the line round the map is',
  'Show the map in 3D': 'Stands it on its heights, tilted',
  'Map tilt': 'How far the map leans, from flat to the horizon',
  'Height exaggeration': 'The heights drawn as they are or up to three times as tall',
  'Ridge lines': 'The crests traced from the heights, over the map',
  Grid: 'Lines of latitude and longitude, UTM or MGRS over the map',
  'Grid step': 'How far apart the grid lines are',
  'Grid labels': 'Degrees and minutes, or decimal degrees',
  'Grid colour': 'The grid\'s colour; Auto reads the ground',
  'Labels on all four sides': 'The grid\'s values written on every side, not two',
  'Ticks on the frame only': 'Short ticks on the frame instead of lines across',
  'Land colour': 'The colour of the land',
  'Water colour': 'The colour of seas, lakes and rivers',
  'Woods colour': 'The colour of woods and parks',
  'Towns colour': 'The colour of built-up ground',
  'Roads colour': 'The colour of roads',
  'Borders colour': 'The colour of borders',
  'Names colour': 'The colour place names are written in',
  'Heights in colour': 'The heights tinted from lowland green to rock and snow',
  'Contour lines': 'Lines of equal height, every fifth one written',
  'Summits and their heights': 'Peaks named, with their heights',
  Roads: 'Roads drawn on the plain ground',
  Railways: 'Railway lines drawn on the map',
  Buildings: 'Building outlines, at close zooms',
  'Place names': 'Towns and villages named on the map',
  'Road numbers': 'The main roads\' numbers on small shields',
  'Airfields and runways': 'Runways, taxiways and aprons, and the airfields\' names',
  'Military ground': 'Ground mapped as military, tinted and edged',
  'Fields, sand and ice': 'Farmland, sand, ice and marsh, each in a quiet tint',
  'Borders drawn': 'Countries only, their regions, or the districts in them too; disputed ones dotted',
  'Place names language': 'The language and script the names are written in',
  'Ground detail': 'How much the ground draws: names, small roads and buildings',
  'Ground presence': 'How far the ground\'s colours come forward; less leaves the land almost alone',
  'Relief strength': 'How strongly the hills are shaded',
  'Imagery strength': 'How strongly the imagery shows over the paper',
  'Imagery colour': 'Its colour, from grey to vivid',
  'Imagery light': 'How light the imagery is',
  'Imagery contrast': 'Its contrast, flatter or harder',
  'Imagery tint': 'A tint turned round the colour wheel',
  'Relief shading': 'Hills shaded from the heights',
  'Borders and big names': 'Borders, countries and big cities, over the ground',
  'Town and village names': 'Every town and village named, over the ground',
  'Roads, drawn over imagery': 'Roads drawn over the imagery',
  'Power lines and plants': 'Power lines, pylons and plants',
  'Sea marks': 'Buoys, beacons and lights at sea',
  'GPS traces': 'Tracks people have recorded with GPS',
  'Night lights': 'Lights seen from space at night',
  'Draw the layer': 'Draws this layer of the case on the map',
  'Lines on this plate': 'Its lines drawn thinner or thicker on this plate only',
  'Marks on this plate': 'Its marks drawn smaller or larger on this plate only',
  // an inset
  'Inset zoom': 'How far out the inset looks; empty, four and a half levels out',
  'Inset of': 'The map whose ground the inset outlines',
  'Inset frame': 'A line round the inset',
  'Drawn as a globe': 'A small globe turned to the map, its country in the accent, in place of a map',
  // a legend
  'Legend title': 'The words over the legend\'s rows',
  'Legend of': 'The map whose layers it lists',
  Columns: 'How many columns the rows run in',
  'Legend frame': 'A line round the legend',
  'List what the layers hold off the map too': 'Lists what is outside the frame too, not only what the map shows',
  'Row name': 'The row\'s words',
  'Row mark': 'How the row is drawn: a mark, a line or an area',
  'Row colour': 'The row\'s colour',
  // words
  Text: 'The words; {date}, {case} and the other tokens are filled in',
  'Words filled in': 'Words the page fills in, each put where the cursor is by a press',
  'Text role': 'A kicker, a title, a standfirst, a caption, a badge…: its size, weight and colour at once',
  'Text size': 'The words\' size, in points',
  'Element font': 'The face these words are set in; empty, the page\'s',
  'Text weight': 'Regular, semi-bold or bold',
  'Text style': 'Italic, or capitals',
  'Text colour': 'The colour of the words',
  'What stands behind the words': 'Nothing, a halo or a box behind the words, so they read on any ground',
  'Box colour': 'The colour of what stands behind the words',
  'Letter spacing': 'Space between the letters',
  'Line spacing': 'Space between the lines',
  Align: 'Where the lines sit across the box',
  'Vertical alignment': 'Where the words sit down the box',
  'Label style': 'Plain words, a bubble, a box or a numbered disc',
  'Fill colour': 'The colour of the bubble, the box or the disc',
  Leader: 'How the line from the words reaches its point',
  'Leader end': 'What the line ends in at its point',
  'Text frame': 'A line round the box',
  'QR address': 'The link the code holds, for a phone to read from the print',
  'QR colour': 'The code\'s colour; keep it dark for phones to read',
  'QR fill': 'The colour behind the code; keep it light',
  'Table lists': 'The dated features as a chronology, or the sources they cite',
  'Table layer': 'The layer the table reads',
  'Table rows': 'At most this many rows',
  'Table title': 'The words over the table',
  'List title': 'The words over the numbered list',
  // a symbol, a signature, the mark
  'Symbol size': 'Its size on the page, in millimetres',
  'Signature words': 'The words beside the signature; {handle} and {today} are filled in',
  'Signature side': 'Which side of the words the picture stands',
  'Words before the mark': 'The words written before the app\'s mark',
  'Mark alignment': 'Where the mark sits in its box',
  // the scale, the north
  'Scale units': 'Kilometres, miles or both',
  'Scale look': 'A bar, a line or ticks',
  'North arrow look': 'How the north is drawn',
  'North backing': 'A disc of the paper\'s colour behind it',
  // a picture, a video
  'Picture fit': 'The whole picture in the box, or the box filled and the picture cropped',
  'Picture frame': 'A line round the picture',
  'Clip start': 'Where the clip starts in the video, as minutes and seconds',
  'Clip end': 'Where the clip ends in the video, as minutes and seconds',
  'key:Runs': 'How long the clip runs, of the whole video',
  'key:Shown': 'A video plays on its step only',
  'key:Points at': 'The point of the map it points at, by a leader',
  'key:Colours': 'The page\'s paper, ink and accent',
  'key:Size, mm': 'The page\'s width and height, in millimetres',
  'In the video': 'Keeps the video\'s own sound in the MP4',
  Volume: 'How loud its sound is in the MP4',
  'Said on the video': 'A line over the bottom of the video saying where it comes from',
  'Source line': 'Who posted it, where and when; read from the file, rewritten at will',
  'Video fit': 'The whole video in the box, or the box filled and the video cropped',
  'Video frame': 'A line round the video',
  // a shape, what stands on the ground
  Shape: 'A box, an ellipse or a rule',
  'Line colour': 'The colour of its line',
  'Line weight': 'How thick its line is',
  'Line dash': 'Solid, dashed or dotted',
  'Shape fill': 'The colour inside it; None leaves it empty',
  Colour: 'Its colour',
  Weight: 'How thick its line is',
  Dash: 'Solid, dashed or dotted',
  'Line path': 'Straight from point to point, or curved through them',
  'Line heads': 'Arrowheads at its end, at both ends or none',
  'Head size': 'How large its heads are',
  'Arrow kind': 'A line, or the broad tapered arrow of an advance',
  'Arrow bend': 'How far it bows, to either side',
  'Arrow heads': 'A head at its end, at both ends or none',
  'Ring distances': 'Each ring\'s distance from the centre, in kilometres, commas between',
  'Cone bearing': 'Where the view looks, in degrees from north',
  'Cone opening': 'How wide the view opens, in degrees',
  'Cone reach': 'How far the view reaches, in kilometres',
  Look: 'Filled, hatched, glowing or outlined',
  Words: 'The words written along it',
  'Dim the ground round it': 'Darkens the ground outside the zone, so the zone stands out',
  'Dim strength': 'How dark the ground round it goes',
  // every element
  Opacity: 'How strongly it shows; less lets the page through',
  Rotation: 'How far it is turned, in degrees',
};

/** Help for names built from what they name: a layer's, a legend row's. */
const PATTERNS = [
  [/ colour on this plate$/, 'This layer\'s colour on this plate only; None keeps its own'],
  [/ lines on this plate$/, 'This layer\'s lines on this plate: its own, dashed or dotted'],
  [/ areas on this plate$/, 'This layer\'s areas on this plate: its own fill, a full tint, hatched, or the outline alone'],
  [/^Name of /, 'What the legend calls this row; empty, its own name'],
];

const words = (node) => String(node.textContent ?? '').replace(/\s+/g, ' ').trim();
const named = (name, help) => help[name] ?? PATTERNS.find(([test]) => test.test(name))?.[1] ?? '';

/**
 * The help a node of a panel says: a named control by its name, a checkbox or a
 * swatch by what it holds, a row's key by the control beside it, else by its words.
 */
export function helpFor(node, help = PLATE_HELP) {
  const name = node.getAttribute?.('aria-label');
  if (name) return named(name, help);
  if (node.classList?.contains('key')) {
    const beside = node.nextElementSibling;
    const control = beside?.getAttribute?.('aria-label') ? beside : beside?.querySelector?.('[aria-label]');
    if (control) return named(control.getAttribute('aria-label'), help) || help[`key:${words(node)}`] || '';
    // a checkbox beside the key says it by its words
    return (beside?.tagName === 'LABEL' && help[words(beside)]) || help[`key:${words(node)}`] || '';
  }
  if (node.tagName === 'LABEL') {
    const inner = node.querySelector('[aria-label]');
    if (inner) return named(inner.getAttribute('aria-label'), help);
    return help[words(node)] ?? '';
  }
  return '';
}

/**
 * Hover help on everything under `root` that has a name, a key or a checkbox's words,
 * kept up as the panel changes. A title written in the markup is left as it is.
 */
export function hoverHelp(root, help = PLATE_HELP) {
  const scan = () => {
    for (const node of root.querySelectorAll('[aria-label], label, .key')) {
      if (node.hasAttribute('title') && !node.dataset.help) continue;
      const said = helpFor(node, help);
      if (said) {
        if (node.getAttribute('title') !== said) node.setAttribute('title', said);
        node.dataset.help = '1';
      } else if (node.dataset.help) {
        node.removeAttribute('title');
        delete node.dataset.help;
      }
    }
  };
  scan();
  const watch = new MutationObserver(scan);
  watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  return { destroy: () => watch.disconnect() };
}
