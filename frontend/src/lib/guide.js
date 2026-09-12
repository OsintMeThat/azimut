/**
 * The guide, as data.
 *
 * One section per rail workspace plus the case, between two that set up — what a case
 * is, and the capture extension that feeds it, then three worked examples — and two
 * that close: every keystroke the app listens for, and what to do when something does
 * not work. Data rather than markup for two reasons: `guide.test.js` can then fail the
 * moment a tool joins a workspace and nobody wrote it down, and the per-tool `?` mark
 * in the topbar addresses a section by the tool it covers instead of the guide growing
 * a second copy of the same text.
 *
 * What belongs in a point: the controls whose icon does not say what they do, and the
 * promises a screen makes that are not visible on it. Not a feature list — the tool
 * itself is the feature list, and a guide that repeats it teaches nothing.
 *
 * What belongs in a recipe: the order the tabs are visited in. The sections describe
 * tools and somebody arriving has a goal, so three goals are walked end to end before
 * the reference starts. Each step names the tool it happens in, and the guide opens it.
 *
 * Static text rather than a tour, and no screenshots: a tour breaks silently on the
 * first layout change, a screenshot is stale the release after it was taken, and both
 * fail in a way nobody notices. A page of words is wrong in a way that can be read.
 */

/**
 * @typedef {{
 *   id: string,            // a workspace id, or a section of its own ('start', 'extension')
 *   title: string,
 *   icon?: string,         // only where the id names no workspace to read one off
 *   lead: string,          // one sentence
 *   tools: string[],       // the tool ids this section covers
 *   points?: Array<{ label: string, text: string }>,
 *   recipes?: Array<{ title: string, lead: string, steps: Array<{ tool: string, text: string }> }>,
 *   keymap?: Array<{ where: string, keys: Array<{ combo: string, does: string }> }>,
 *   fixes?: Array<{ symptom: string, fix: string }>,
 *   keys?: Array<{ combo: string, does: string }>,
 * }} GuideSection
 */

/** @type {GuideSection[]} */
export const GUIDE = [
  {
    id: 'start',
    title: 'Start here',
    icon: 'compass',
    lead: 'A case is one folder on your disk, and everything in this app files into it.',
    tools: [],
    points: [
      {
        label: 'Install the capture extension first',
        text: 'The one setup step worth doing before any work. Without it, a map open in another tab has to be screenshotted and imported by hand. Settings, then Capture extension.',
      },
      {
        label: 'The folder is half yours',
        text: 'Azimut owns the azimut/ directory inside a case and leaves the rest of the folder alone. A closed case can be copied as it is.',
      },
      {
        label: 'Nothing leaves this machine',
        text: 'Network access follows an action that needs it, such as a map tile or a download. The one call made on its own is an optional check for a new release, and Settings turns it off.',
      },
      {
        label: 'The rail is a sequence',
        text: 'Sources, Examine, Map and Compose read top to bottom in the order an investigation runs. Tools are tabs inside a workspace.',
      },
      {
        label: 'The case is in the topbar, not the rail',
        text: 'It is not a stage. It is what every stage files into, so it hangs off the case name beside the Board button.',
      },
      {
        label: 'You do not need a case to start',
        text: 'The first tool that saves something opens a scratch session, and Keep as case names it once the work is worth keeping.',
      },
    ],
  },
  {
    id: 'extension',
    title: 'Extension',
    icon: 'crop',
    lead: 'A browser add-on that files what you are looking at in another tab straight into the open case.',
    tools: [],
    points: [
      {
        label: 'Azimut writes the folder for you',
        text: 'Settings, then Capture extension: press Install, copy the path it gives you, and load it unpacked in your browser. The pairing token on the same tab is what ties it to this workspace.',
      },
      {
        label: 'It files three things',
        text: 'A screenshot of the map you are on with the coordinates read off its URL, the point itself as a saved place, and any other page as a bookmark. Each arrives with where it came from already written.',
      },
      {
        label: 'It draws tools over maps Azimut does not provide',
        text: 'Measure, media pins, sun and moon, a search grid and windows holding the case images, on the map sites you were going to use anyway. A pitched or panoramic view switches the geometry off rather than guessing at it.',
      },
      {
        label: 'It reaches past this machine in exactly one place',
        text: 'Filling the composer on X or Bluesky with a thread Geo Report prepared. It types what the app handed it and reads nothing back. Everything else it does talks to Azimut on localhost.',
      },
      {
        label: 'Updating it is one click',
        text: 'The app owns the folder, so a new release rewrites the files in place and the extension restarts. Settings says when two copies are loaded and which one to remove.',
      },
    ],
  },
  {
    id: 'recipes',
    title: 'Worked examples',
    icon: 'layers',
    lead: 'Three whole jobs, tab by tab, in the order the tabs are visited.',
    tools: [],
    recipes: [
      {
        title: 'Geolocate a photo',
        lead: 'From a picture with no caption to a proof that states where it was taken.',
        steps: [
          { tool: 'media', text: 'Import the photo, or paste the URL of the post it came from to pull it down with its origin already written.' },
          { tool: 'inspect', text: 'Crop and adjust what is hard to read, and run the error-level view over anything that looks composited.' },
          { tool: 'reverse', text: 'Prepare the image and press an engine. Nothing is sent until you do.' },
          { tool: 'satellite', text: 'Search the area, switch providers and dates until the ground matches, and capture the view.' },
          { tool: 'proof', text: 'Put the photo beside the capture, mark what agrees, and name the point. It is filed as a place.' },
        ],
      },
      {
        title: 'Source a video from a post',
        lead: 'From a URL to a dated claim the case can argue with.',
        steps: [
          { tool: 'media', text: 'Paste the post URL. The first attempt is made without cookies, and only an "unavailable" answer offers your saved browser session.' },
          { tool: 'inspect', text: 'Step the video frame by frame and pull the stills the argument rests on. Each is filed as media made here.' },
          { tool: 'board', text: 'Confirm what the import proposed, then link the frames to the place, the account and the people.' },
          { tool: 'timeline', text: 'Date the claim, and read it in UTC, in your own clock, or in local time at the place itself.' },
        ],
      },
      {
        title: 'Publish a finding',
        lead: 'From work in the case to something somebody else can check.',
        steps: [
          { tool: 'proof', text: 'Export the panels as a PNG. The spec is saved beside it, so next week the same proof reopens and edits.' },
          { tool: 'post', text: 'Build the sourced thread. With the extension it fills the composer on X or Bluesky box by box, and stops before Post.' },
          { tool: 'notebook', text: 'Write the note around it, embed the case media and a diagram, and export the PDF.' },
        ],
      },
    ],
  },
  {
    id: 'collect',
    title: 'Sources',
    lead: 'Everything the case is built from lands here, hashed, deduplicated and carrying where it came from.',
    tools: ['media', 'files', 'reverse'],
    points: [
      {
        label: 'Import or download',
        text: 'The Media Library takes files off your disk and pulls posts from a URL. The first attempt is always made without cookies, and only a download that answers "unavailable" is retried with the browser session you saved.',
      },
      {
        label: 'State the origin once',
        text: 'A batch that landed without one is offered the origin for the whole import, and any single file can be corrected later from its Details.',
      },
      {
        label: 'Files searches what the sidebar cannot',
        text: 'The sidebar matches labels. Note contents are searched in the Files tab, which is also the tiled view of the same folder tree.',
      },
      {
        label: 'Reverse Search picks no engine for you',
        text: 'It prepares an image or a frame, and nothing moves until you press an engine. With the capture extension that press opens the engine with the picture already in its uploader.',
      },
    ],
  },
  {
    id: 'examine',
    title: 'Examine',
    lead: 'Inspect reads one image or one video closely, and saves the reading as a session you can reopen.',
    tools: ['inspect'],
    points: [
      {
        label: 'Four modes on one file',
        text: 'Selection crops and adjusts, Frame pulls stills out of a video, Collage stitches, and Analyze runs the error-level view.',
      },
      {
        label: 'What you make is case material',
        text: 'A frame or a collage is filed as ordinary media and marked as made here, so the graph can say what it came out of.',
      },
      {
        label: 'The session is the artifact',
        text: 'Reopening one puts every adjustment back where it was. The file on disk is never overwritten.',
      },
    ],
  },
  {
    id: 'map',
    title: 'Map',
    lead: 'Where a finding gets a coordinate, and where a coordinate gets a picture.',
    tools: ['satellite', 'coordinates'],
    points: [
      {
        label: 'Four providers need no key',
        text: 'Esri, OSM, OpenTopoMap and Sentinel-2 are built in, dated passes included. A keyed provider uses your own key, and a custom XYZ template is accepted.',
      },
      {
        label: 'The search bar answers before it asks',
        text: 'Saved places, a pasted coordinate and a bundled gazetteer answer while you type. The geocoder is only asked once you stop.',
      },
      {
        label: 'A capture is evidence',
        text: 'It records its provider, coordinates, zoom and bearing, so the view can be reproduced and the attribution is already written.',
      },
      {
        label: 'Coords & Sky is the other tab',
        text: 'It converts between coordinate formats and reads sun, moon, twilight and local time for one point on a date.',
      },
      {
        label: 'The sidebar starts closed here',
        text: 'The map wants the width. The toggle in the topbar brings it back, and this workspace remembers your choice for the session.',
      },
    ],
  },
  {
    id: 'compose',
    title: 'Compose',
    lead: 'The three ways work leaves a case: a proof, a thread, a note.',
    tools: ['proof', 'post', 'notebook'],
    points: [
      {
        label: 'Geo Proof stays editable',
        text: 'Panels, marks and boxes are saved as a spec beside the exported PNG, so a proof exported last week can be reopened and changed.',
      },
      {
        label: 'A proof can argue several points',
        text: 'Each place is optionally named and one of them can be the camera. They are filed as places and carried into the thread and onto the picture.',
      },
      {
        label: 'Geo Report stops before posting',
        text: 'It prepares a sourced thread and, with the extension, fills the composer on X or Bluesky box by box. Pressing Post is left to you.',
      },
      {
        label: 'Notebook is Markdown with case material',
        text: 'Local media, Mermaid diagrams and a PDF export. Remote images in a note contact their host every time the preview opens, and the editor says so.',
      },
    ],
  },
  {
    id: 'case',
    title: 'Case',
    lead: 'Four readings of one case, and the first three share the same question.',
    tools: ['board', 'graph', 'timeline', 'sheet'],
    points: [
      {
        label: 'The filter is a sentence you can edit',
        text: 'The + Filter menu opens on four standing questions. Picking one drops its terms into the bar as ordinary chips, which is also how the filter language is learned.',
      },
      {
        label: 'The count is a proportion',
        text: '23 of 1204 means the whole case is the denominator. It never shrinks with the answer, because that is the information a count carries.',
      },
      {
        label: 'Draw these N hands over the question',
        text: 'The Graph receives the filter rather than the rows it matched, so the drawing answers at any case size and stays live as the case changes.',
      },
      {
        label: 'The Graph never writes to the case',
        text: 'Expanding, hiding, folding and dragging are your picture. Undo reaches all of them and reaches nothing the case holds.',
      },
      {
        label: 'Timeline reads in a clock you choose',
        text: 'UTC, this computer, any zone in the world, or local time at a place the case saved. Undated work is counted apart rather than hidden.',
      },
      {
        label: 'Sheet works on real CSV files',
        text: 'The sheets the case holds, in a grid. A declared sheet can be promoted into entities, places and dated statements, read as a plan first.',
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    icon: 'keyboard',
    lead: 'Every key the app listens for, by where it is pressed.',
    tools: [],
    keymap: [
      {
        where: 'Anywhere',
        keys: [
          { combo: 'Ctrl+V', does: 'files a screenshot or a copied address, on Media, Files, Board and Graph' },
          { combo: 'Escape', does: 'closes whatever is open, shallowest first' },
        ],
      },
      {
        where: 'Graph',
        keys: [
          { combo: '0', does: 'fits the whole drawing' },
          { combo: '+ / -', does: 'zooms in and out' },
          { combo: '1 / 2 / 3', does: 'how many hops around the selected node stay lit' },
          { combo: 'Arrows', does: 'nudges the selected node, Shift for a longer step' },
          { combo: 'Ctrl+Z', does: 'takes back a change to the drawing' },
          { combo: 'Ctrl+Shift+Z', does: 'puts it back' },
          { combo: 'Escape', does: 'lets go of a menu, a search, a narrowing, then the selected node' },
        ],
      },
      {
        where: 'Timeline',
        keys: [
          { combo: 'Arrows', does: 'pans the window' },
          { combo: 'Page Up / Down', does: 'pans most of a screen' },
          { combo: '+ / -', does: 'narrows and widens the window' },
          { combo: 'Home', does: 'shows the whole filtered extent' },
          { combo: 'Shift-wheel', does: 'pans, as does a horizontal trackpad gesture' },
        ],
      },
      {
        where: 'Sheet',
        keys: [
          { combo: '?', does: 'opens the full list of grid gestures' },
          { combo: 'Ctrl+F', does: 'jumps to the search box' },
          { combo: 'Ctrl+S', does: 'saves the sheet' },
          { combo: 'Ctrl+Enter', does: 'appends a row' },
          { combo: 'Tab / Enter', does: 'commits the cell and moves right, or down' },
          { combo: 'Ctrl+Z', does: 'undoes the last change' },
          { combo: 'Ctrl+Shift+Z', does: 'redoes it' },
        ],
      },
      {
        where: 'Geo Proof',
        keys: [
          { combo: 'V R E A L C D T S', does: 'picks select, rectangle, ellipse, arrow, line, curve, freehand, text and icon' },
          { combo: 'F', does: 'fits the document' },
          { combo: 'Space (held)', does: 'pans, whatever tool is in hand' },
          { combo: 'Delete', does: 'removes what is selected' },
          { combo: 'Ctrl+Z', does: 'undoes the last change' },
          { combo: 'Ctrl+Shift+Z', does: 'redoes it' },
          { combo: 'Escape', does: 'drops the shape being drawn, then the selection, then the pen' },
        ],
      },
      {
        where: 'Inspect',
        keys: [
          { combo: '← / →', does: 'steps one video frame, Shift for a second' },
          { combo: ', / .', does: 'the same step, on the keys mpv uses' },
          { combo: 'Space', does: 'plays and pauses' },
          { combo: 'Enter / Escape', does: 'applies the crop, or leaves it' },
        ],
      },
      {
        where: 'Media',
        keys: [
          { combo: 'Enter', does: 'opens the image under the cursor' },
          { combo: '← / →', does: 'walks the preview through the folder' },
        ],
      },
    ],
  },
  {
    id: 'trouble',
    title: 'When something does not work',
    icon: 'alert',
    lead: 'The frictions worth knowing about before you hit them, and where each is fixed.',
    tools: [],
    fixes: [
      {
        symptom: 'A download answers "unavailable"',
        fix: 'The site wants a session. The Media Library offers your browser cookies at that point, and only at that point: the first attempt is always made without them.',
      },
      {
        symptom: 'A video has no thumbnail, and frames will not export',
        fix: 'That is ffmpeg. The downloadable builds carry their own; a pip install uses the one on your PATH. Settings, System says which was found.',
      },
      {
        symptom: 'The extension is installed and its buttons do nothing',
        fix: 'A tab opened before the install has no content script in it, so reload it. If two copies are loaded they fight, and Settings, Capture extension says which one to remove.',
      },
      {
        symptom: 'A map provider draws nothing',
        fix: 'Four providers need no key. The rest use yours, entered in Settings, Imagery, and the tab says which ones are missing one.',
      },
      {
        symptom: 'The app opens on "this workspace is in use"',
        fix: 'Another Azimut holds the folder. Close it, or take the lock from the screen offering it. Two copies writing one workspace is the one thing the app refuses.',
      },
      {
        symptom: 'The tab is closed and the app seems gone',
        fix: 'Azimut is a local server plus a browser tab. Closing the tab stops nothing: open the address the launcher printed again, and the work is where you left it.',
      },
    ],
  },
];

/** One section by its id, or null. */
export function guideSection(id) {
  return GUIDE.find((section) => section.id === id) ?? null;
}

/**
 * Which section the reader is in, from where each heading sits against a line near the
 * top of the column.
 *
 * A line rather than the top edge: a heading that has just scrolled past the edge is
 * the one being read, not the one above it. `marks` arrives in document order with each
 * heading's offset from the column's own top, so the last one at or above the line
 * wins and everything below it is still ahead of the reader.
 *
 * `atBottom` is not a detail. The final section is usually shorter than the column, so
 * its heading can never reach the line however far down you scroll, and without this
 * the list would stick on the second to last entry at the end of the page.
 *
 * Pure so it can be tested at all: the component reads the rectangles, this decides.
 */
export function readingSection(marks, { line = 0, atBottom = false } = {}) {
  if (!marks?.length) return null;
  if (atBottom) return marks[marks.length - 1].id;
  let current = marks[0].id;
  for (const mark of marks) {
    if (mark.top <= line) current = mark.id;
  }
  return current;
}

/**
 * The section covering one tool, for the per-tool mark that opens the guide on it.
 *
 * By tool rather than by workspace: the mark lives in a toolbar, and the analyst
 * pressing it is asking about the tab they are standing in.
 */
export function guideFor(tool) {
  return GUIDE.find((section) => section.tools.includes(tool)) ?? null;
}
