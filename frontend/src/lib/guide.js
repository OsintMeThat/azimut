/**
 * The guide, as data: what the `?` in the topbar opens (components/GuideDialog.svelte).
 *
 * A menu down the left, the tools of a workspace as tabs, and on each tool's tab a
 * picture of it with numbered frames, a line per number and the subtleties under it.
 * A number can also open a second picture, the screen that control leads to, so a page
 * can be read as a sequence: press this, and this is what opens.
 *
 * The pictures are made, never taken by hand. `npm run guide:shots` (frontend/guide/)
 * opens a demo case in the real app, brings each tool into the state its page shows,
 * photographs it and writes where every `data-guide` anchor stood. A frame follows its
 * control when the layout moves; an anchor that disappears fails that run and
 * `guide.test.js` instead of leaving a frame that points at nothing.
 *
 * Journeys walk one goal across the tools, and each step reuses the picture of the tool
 * it happens in with only that step's frames on it, or a picture of its own when the
 * moment is not on the tool's page. A step may name itself (`label`) where every step
 * happens in one tool, and a journey ends on a picture of what it made (`result`).
 */
import { CASE_WORKSPACE, TOOL_LABELS, WORKSPACES } from './workspaces.js';

/** The full guide to Find, in the repository: what it does well, where it fails and how to use it. */
export const FIND_DOC = 'https://github.com/OsintMeThat/azimut/blob/main/docs/FIND.md';

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ src: string, width: number, height: number, anchors: Record<string, Rect> }} Shot
 * @typedef {{ shot: string, lead: string, marks?: Mark[] }} Sequel
 * @typedef {{ anchor: string, title: string, text: string, opens?: Sequel }} Mark
 * @typedef {{ title: string, text: string }} Tip
 * @typedef {{ lead: string, shot: string, marks: Mark[], tips?: Tip[] }} Page
 */

/** What each workspace is for, under its name. */
export const WORKSPACE_LEADS = {
  collect: 'Everything the case is built from lands here, hashed, deduplicated and carrying where it came from.',
  examine: 'Inspect reads one image or one video closely. Collage lays out frames and images from any number of files.',
  map: 'Where a finding gets a coordinate, and where a coordinate gets a picture.',
  compose: 'The ways work leaves a case: a proof, a thread, a map plate, a note.',
  case: 'Four readings of one case, and the first three share the same question.',
};

/** @type {Record<string, Page & { title?: string, icon?: string }>} */
export const PAGES = {
  // -- setting up -------------------------------------------------------------
  start: {
    title: 'Start here',
    icon: 'compass',
    lead: 'Azimut is a toolkit for open-source investigations, strongest at geolocation. Each investigation is a case: a folder on your disk where everything you do is filed.',
    shot: 'start',
    marks: [
      { anchor: 'start.home', title: 'Home', text: 'The open case at a glance: recent work, what waits for you, its to-do lists.' },
      { anchor: 'start.case', title: 'The case', text: 'Switch to another case or start one. Everything you save goes into the one shown here.' },
      { anchor: 'start.stages', title: 'Four stages', text: 'Sources, Examine, Map and Compose, top to bottom in the order an investigation runs.' },
      { anchor: 'start.case-rail', title: 'The case itself', text: 'Its Timeline, Board, Graph and Sheet, one press from any stage.' },
      { anchor: 'start.tabs', title: 'Tools are tabs', text: 'Each stage holds a few tools, and the tab says which one you are in.' },
      {
        anchor: 'start.goto',
        title: 'Go to',
        text: 'Ctrl+K finds a tool, a setting, a case or a document by name.',
        opens: {
          shot: 'start-goto',
          lead: 'Type a few letters: tools, settings, cases and documents answer together.',
          marks: [{ anchor: 'palette.search', title: 'One box for everything', text: 'Enter opens the first answer, the arrows walk the rest.' }],
        },
      },
      { anchor: 'start.event', title: 'Add event', text: 'Notes what happened from any tool, with what it shows already cited (Alt+N).' },
      { anchor: 'start.settings', title: 'Settings', text: 'Keys, imagery, templates, the extension and backups. A dot means something to install or update.' },
      { anchor: 'start.sidebar', title: 'The case sidebar', text: 'The case’s folders, to-do lists and recent work, beside every tool.' },
    ],
    tips: [
      { title: 'Install the capture extension first', text: 'It files what you see on other map sites into the case, and the Capture extension page sets it up.' },
      { title: 'You do not need a case to start', text: 'The first tool that saves something opens a scratch session, and Keep as case names it later.' },
      { title: 'The folder is half yours', text: 'Azimut owns the azimut/ directory inside a case and leaves the rest of the folder alone.' },
      { title: 'The network waits for you', text: 'Only an action that needs it reaches out, plus a check of GitHub and PyPI for new versions at start, which Settings turns off.' },
    ],
  },
  // The extension's page comes in tabs (EXTENSION_TABS): setting it up, then using it.
  extension: {
    title: 'Capture extension',
    icon: 'crop',
    lead: 'A browser add-on that files what you look at in another tab into the open case, and draws Azimut’s tools over the maps you already use.',
    shot: 'extension',
    marks: [
      { anchor: 'ext.status', title: 'Is it installed', text: 'Says whether this browser has it, and whether an update is ready.' },
      { anchor: 'ext.folder', title: 'Chrome, Edge, Brave', text: 'Copy the path, turn on developer mode, press Load unpacked and paste it, then reload the tab.' },
      { anchor: 'ext.firefox', title: 'Firefox', text: 'Download the signed .xpi, then Install Add-on From File in the gear menu of about:addons.' },
      { anchor: 'ext.pairing', title: 'Pairing', text: 'Paste this token in the extension’s options. Rotating it unpairs every copy.' },
    ],
    tips: [
      { title: 'It reaches outside only when you ask', text: 'It can fill a composer on X or Bluesky and hand a picture to a reverse-search engine. Everything else goes to Azimut on this computer.' },
      { title: 'Updates follow the browser', text: 'Chromium updates its folder from Settings, Firefox updates the signed add-on, and Settings warns when two copies are loaded.' },
    ],
  },
  'extension-capture': {
    lead: 'On a map site, Alt+Shift+A opens the extension. Everything it fills in comes from the page’s address.',
    shot: 'extension-capture',
    marks: [
      { anchor: 'ext.site', title: 'The site', text: 'The map site it recognised. On any other page it offers a bookmark instead.' },
      { anchor: 'ext.case', title: 'Case', text: 'The case the capture goes into.' },
      { anchor: 'ext.position', title: 'Lat / Lon', text: 'Read from the address, and yours to correct.' },
      { anchor: 'ext.bearing', title: 'Zoom / Bearing', text: 'Most sites write no bearing, so type one for the north arrow to point right.' },
      { anchor: 'ext.marks', title: 'Scale bar and north arrow', text: 'Drawn on the capture from the zoom, and remembered once ticked.' },
      { anchor: 'ext.capture', title: 'Select area to capture', text: 'Draw the rectangle to keep. It lands in Media with its address, date and coordinates.' },
      { anchor: 'ext.place', title: 'Save this place', text: 'Files the middle of the map as a place, with no picture.' },
      { anchor: 'ext.tools', title: 'Draw tools over this map', text: 'Puts the tools of the next tab over the map.' },
    ],
    tips: [
      { title: 'It reads the address, never the page', text: 'A capture’s coordinates are what the address bar says, so anyone with its saved link can check them.' },
      { title: 'Any other page becomes a bookmark', text: 'A page that is not a map is filed as a link, with nothing downloaded.' },
    ],
  },
  'extension-tools': {
    lead: 'Azimut’s tools drawn over another site’s map. Nothing goes into the case until you ask.',
    shot: 'extension-tools',
    marks: [
      { anchor: 'ext.measure', title: 'Measure', text: 'Distances, rings and lines of sight, to the map’s own scale.' },
      { anchor: 'ext.points', title: 'Points', text: 'The case’s media, places and captures where they stand, and new points to file.' },
      { anchor: 'ext.sky', title: 'Sun & moon', text: 'Where they stood at the hour you pick, to read a shadow.' },
      { anchor: 'ext.grid', title: 'Search grid', text: 'A grid to sweep cell by cell, kept with the case.' },
      { anchor: 'ext.refs', title: 'Refs', text: 'The case’s photos and videos held over the map while you pan.' },
      { anchor: 'ext.ref', title: 'A reference window', text: 'Drag it, pin it beside the map or fold it. A capture never includes it.' },
      { anchor: 'ext.fires', title: 'Fires', text: 'NASA FIRMS detections over whatever map is shown.' },
    ],
    tips: [
      { title: 'Measuring needs a flat map', text: 'Street View, a tilted 3D view or a globe zoomed far out keep the reference windows but refuse to measure, and say why.' },
      { title: 'The panel moves', text: 'Drag it by its header, and fold it to see the whole map.' },
    ],
  },
  // Settings comes in tabs (SETTINGS_TABS), one per section of the screen.
  settings: {
    title: 'Settings',
    icon: 'settings',
    lead: 'What applies to every case on this computer. General sets how points, units and the map tabs read.',
    shot: 'settings',
    marks: [
      { anchor: 'settings.nav', title: 'Sections', text: 'General, Publishing, Imagery, Templates, Icons, the extension, Storage and System. A dot means something to install or update.' },
      { anchor: 'settings.coordinates', title: 'Coordinates', text: 'How every tool writes a point, in decimal, in degrees or as MGRS. The case keeps decimal.' },
      { anchor: 'settings.units', title: 'Measurements', text: 'Metric, imperial or nautical, for the rulers and the readouts.' },
      { anchor: 'settings.home-view', title: 'Satellite home view', text: 'Where Satellite opens when the case gives it no place of its own.' },
      { anchor: 'settings.map-tabs', title: 'Map tabs', text: 'Satellite, Compare, Detect and Horizon look at the same place, or each at its own.' },
      { anchor: 'settings.quality-3d', title: '3D views', text: 'Full, Balanced or Light: how much the 3D globe and Horizon draw on this computer. Lighter for a slow one.' },
      { anchor: 'settings.proofs', title: 'Proofs', text: 'Whether saving a proof files its point as a place without asking.' },
      { anchor: 'settings.reverse', title: 'Reverse search', text: 'Whether the extension hands the picture to the engine it opens.' },
    ],
    tips: [
      { title: 'Hover to know', text: 'Each setting says what it does when the pointer rests on it.' },
      { title: 'The capture extension', text: 'Its section installs and pairs it, and the Capture extension page of this guide shows it at work.' },
    ],
  },
  'settings-publishing': {
    lead: 'What a new thread starts with, and how your work is signed.',
    shot: 'settings-publishing',
    marks: [
      { anchor: 'settings.report-defaults', title: 'Geo Report', text: 'The mention and the site a new thread starts with, and whether the extension may fill the composer.' },
      { anchor: 'settings.signature', title: 'Signature', text: 'Your handle and your logo, for the proofs and plates that carry them.' },
    ],
    tips: [{ title: 'Posting stays yours', text: 'Even with the extension, the composer is filled and Post is left to you.' }],
  },
  'settings-imagery': {
    lead: 'The imagery the maps can draw: free providers built in, keyed ones with your own keys.',
    shot: 'settings-imagery',
    marks: [
      { anchor: 'settings.providers', title: 'Providers', text: 'Each keyed provider says what it costs, what you used this month and how to get its key.' },
      { anchor: 'settings.eco', title: 'Eco mode', text: 'Zoomed out, a billed map draws free imagery instead, up to the zoom you set.' },
    ],
    tips: [
      { title: 'Most of the app needs no key', text: 'Esri, its Wayback archive, OpenStreetMap and OpenTopoMap work without one.' },
      { title: 'Copernicus is free', text: 'Sentinel-2 and radar need a free Copernicus account, and the tools that use them explain the setup field by field.' },
      { title: 'Layers of your own', text: 'The Sentinel Hub card keeps the Copernicus layers you add, a radar one included.' },
    ],
  },
  'settings-templates': {
    lead: 'Starting points shared by every case: how a proof looks, how a thread runs, how a plate is laid out.',
    shot: 'settings-templates',
    marks: [
      { anchor: 'settings.proof-templates', title: 'Geo Proof templates', text: 'Proof styles offered as a house style in every proof.' },
      { anchor: 'settings.report-templates', title: 'Geo Report templates', text: 'The structures a thread can follow, with words that fill themselves.' },
      { anchor: 'settings.plate-templates', title: 'Map plate templates', text: 'A plate’s layout, paper and colours without its ground, to share as a file.' },
    ],
    tips: [{ title: 'From a plate', text: 'Keep as template, in a plate, files its layout here.' }],
  },
  'settings-icons': {
    lead: 'Your own icons for the markers of your layers, offered in every layer’s palette and every case.',
    shot: 'settings-icons',
    marks: [
      { anchor: 'settings.icons-library', title: 'Your icons', text: 'Drop pictures or a .zip pack. A layer keeps a copy of each icon it wears, so removing one here changes no map.' },
    ],
    tips: [{ title: 'A pack at once', text: 'The folders of a .zip pack become groups of icons.' }],
  },
  'settings-storage': {
    lead: 'Where the cases live, where exports go, and the backup that moves Azimut to another computer.',
    shot: 'settings-storage',
    marks: [
      { anchor: 'settings.workspace', title: 'Workspace folder', text: 'Where every case is kept. Pick another folder and Azimut moves them there.' },
      { anchor: 'settings.export-folders', title: 'Export folders', text: 'Where each kind of export is written, the case’s exports folder until you choose.' },
      { anchor: 'settings.backup', title: 'Settings backup', text: 'Settings, keys, templates, icons and signature in one file. It holds your keys, so keep it private.' },
    ],
    tips: [{ title: 'Moving to another computer', text: 'Import backup on the new one, and the cases follow with the workspace folder.' }],
  },
  'settings-system': {
    lead: 'The version, the updates, and what to do when something breaks.',
    shot: 'settings-system',
    marks: [
      { anchor: 'settings.about', title: 'Azimut', text: 'The version, the ffmpeg in use, and what reaches the network.' },
      { anchor: 'settings.updates', title: 'Updates', text: 'Says when a new version is out, from GitHub and PyPI, and how to install it.' },
      { anchor: 'settings.issue', title: 'Report an issue', text: 'Writes a report with the version, the system and the last warnings, your paths and keys removed, and opens it on GitHub.' },
      { anchor: 'settings.downloaders', title: 'Downloaders', text: 'The tools that fetch media links, updated here when a link stops resolving.' },
    ],
    tips: [{ title: 'Offline is fine', text: 'Without a network the update check stays silent, and the switch turns it off for good.' }],
  },

  // -- Sources ----------------------------------------------------------------
  media: {
    lead: 'Every picture, video and file of the case, each with where it came from.',
    shot: 'media',
    marks: [
      { anchor: 'media.link', title: 'Paste a link', text: 'A post on X, Telegram or YouTube comes down with its address kept as the source.' },
      { anchor: 'media.import', title: 'Import', text: 'Files from your disk, or dropped anywhere on the page.' },
      { anchor: 'media.worklist', title: 'Worklist', text: 'Opens the pictures and videos still to place as a sheet, Files to geolocate.' },
      { anchor: 'media.browse', title: 'Search and filter', text: 'Search by name or source, sort, and narrow by type, folder or GPS.' },
      { anchor: 'media.views', title: 'Small, Large, List', text: 'Two sizes of grid or a list, kept from one visit to the next.' },
      {
        anchor: 'media.card',
        title: 'One card per file',
        text: 'Hashed on the way in, so a file never lands twice. A press opens it full screen.',
        opens: {
          shot: 'media-viewer',
          lead: 'Pictures, videos and sounds full screen, one after the other.',
          marks: [{ anchor: 'media.viewer', title: 'The viewer', text: '← and → walk the list as it is filtered, and Escape or Space closes it.' }],
        },
      },
      {
        anchor: 'media.open-in',
        title: 'Open in…',
        text: 'Sends a picture or a video on to another tool.',
        opens: {
          shot: 'media-open-in',
          lead: 'Inspect reads it closely, Reverse Search looks for earlier copies, Geo Proof argues where it was taken.',
          marks: [{ anchor: 'media.open-in-menu', title: 'Where it can go', text: 'Geo Proof takes pictures only, so a video offers the first two.' }],
        },
      },
    ],
    tips: [
      { title: 'A login only when needed', text: 'A download is first tried without cookies, and only a link that answers "This link needs a login" is retried with your browser.' },
      { title: 'State the origin once', text: 'A batch dropped without an origin is offered one for the whole import, and Details corrects a single file later.' },
      { title: 'Paste a screenshot', text: 'Ctrl+V files the picture on the clipboard, with a title and an origin if you have them.' },
      { title: 'Working files stay apart', text: 'Frames and collages made in the case are held back by a switch, so the grid shows what was collected.' },
      { title: 'Catch up an older import', text: 'The ⋮ menu holds Regenerate missing thumbnails and Read file metadata.' },
    ],
  },
  files: {
    lead: 'The case as folders, the tree the sidebar shows, with every kind of item in it.',
    shot: 'files',
    marks: [
      { anchor: 'files.tree', title: 'Folders', text: 'Drop items on a folder to file them. Unfiled lists what has none, and Trash keeps what you delete.' },
      { anchor: 'files.filters', title: 'By kind', text: 'Narrow to one kind of item, or to what is linked to nothing yet.' },
      {
        anchor: 'files.tile',
        title: 'An item',
        text: 'Double-click opens it, full screen for a picture or a video. Right-click for the rest.',
        opens: {
          shot: 'files-menu',
          lead: 'The right-click menu acts on the item, or on everything selected.',
          marks: [{ anchor: 'files.menu', title: 'What it can do', text: 'Open, rename or move it, start a folder with it, add an event about it, or show it in the Timeline.' }],
        },
      },
      { anchor: 'files.work', title: 'Work here', text: 'New files and saved work land in this folder until you press it again.' },
      { anchor: 'files.new-folder', title: 'New folder', text: 'Name it and press Add.' },
    ],
    tips: [
      { title: 'Search reads inside notes', text: 'The sidebar matches labels, and this search also reads what notes say.' },
      { title: 'Nothing is lost at once', text: 'A deleted item waits in the case trash with its links until you empty it.' },
      { title: 'The view is kept', text: 'Small, Large or List is remembered, for Files and for Media apart.' },
      { title: 'Keys', text: 'Space shows the selected picture or video, F2 renames it, and Delete removes it after asking.' },
    ],
  },
  reverse: {
    lead: 'Prepares a picture or a frame for the reverse-search engines. Nothing is sent until you press one.',
    shot: 'reverse',
    marks: [
      { anchor: 'reverse.picture', title: 'The picture', text: 'As it will be sent, adjustments included.' },
      { anchor: 'reverse.adjust', title: 'Adjust', text: 'Brightness and contrast before searching, so a dark frame still matches.' },
      { anchor: 'reverse.engines', title: 'Engines', text: 'Each says how it takes the picture: opened with it, pasted, or dragged in.' },
      { anchor: 'reverse.change', title: 'Another file', text: 'Pick a different picture or video from the case.' },
    ],
    tips: [
      { title: 'With the extension', text: 'The engine opens with the picture already in its uploader.' },
      { title: 'From anywhere', text: 'Open in… on a Media card, or Analyze on an Inspect frame, sends the picture here as you cropped it.' },
      { title: 'A video gives a frame', text: 'Pick the moment on the video, or step to it frame by frame in Inspect.' },
      { title: 'Nothing found', text: 'Crop to the rarest detail, a sign or a crane, and search again.' },
    ],
  },

  // -- Examine ----------------------------------------------------------------
  inspect: {
    lead: 'One image or one video, read closely: frames, adjustments, metadata and error levels.',
    shot: 'inspect',
    marks: [
      { anchor: 'inspect.player', title: 'The player', text: '← and → step one frame, J and L change the speed, M marks a moment.' },
      { anchor: 'inspect.loop', title: 'A and B', text: 'Bound a loop between two moments, to watch a passage again.' },
      { anchor: 'inspect.capture', title: 'Capture frame', text: 'Keeps the frame on screen with this video (C).' },
      {
        anchor: 'inspect.strip',
        title: 'The strip',
        text: 'The video first, then the frames cut from it. A frame can be adjusted, cropped or analysed.',
        opens: {
          shot: 'inspect-analyze',
          lead: 'Analyze reads a frame or a picture, and the searches that start from it.',
          marks: [
            { anchor: 'inspect.analyze', title: 'Readings', text: 'Error levels are laid over the picture, brightest where a JPEG was changed most.' },
          ],
        },
      },
      {
        anchor: 'inspect.tabs',
        title: 'Info, Adjust, Moments',
        text: 'What the file says about itself, how it looks, and where things happen in it.',
        opens: {
          shot: 'inspect-adjust',
          lead: 'Adjust turns, tunes and crops, with presets for a dark scene, haze, or text and plates.',
          marks: [{ anchor: 'inspect.panel', title: 'Sliders and crop', text: 'Hold O to see the frame without them.' }],
        },
      },
      { anchor: 'inspect.save', title: 'Save to case', text: 'The one step that files frames as media, marked as made here.' },
      { anchor: 'inspect.file', title: 'Change file, Clear work', text: 'Opens another file, or sends this one’s frames and edits to the Trash.' },
    ],
    tips: [
      { title: 'The work stays with the file', text: 'Frames and edits are kept as you make them, and opening the file again picks up where you left off.' },
      { title: 'Analyze a frame', text: 'Error levels show where a JPEG changed most, and the frame can go to Reverse Search or Horizon.' },
      { title: 'The original is never touched', text: 'An adjusted frame or video is saved as new media beside it.' },
      { title: 'Everything the file says', text: 'All metadata unfolds every field of the file, its GPS and its software included.' },
      { title: 'Keys', text: 'Space plays, C captures, O held shows the frame without its settings, and the keyboard button lists the rest.' },
    ],
  },
  collage: {
    lead: 'Frames and images from any number of files, laid out on one canvas and saved as a picture.',
    shot: 'collage',
    marks: [
      { anchor: 'collage.canvas', title: 'The canvas', text: 'Scroll to zoom, pull a corner to warp a piece, Shift-click to select several.' },
      { anchor: 'collage.add', title: 'Add pieces', text: 'Frames cut in Inspect and the case’s images.' },
      { anchor: 'collage.arrange', title: 'Auto panorama', text: 'Stitches overlapping pieces into one picture, planar, cylindrical or spherical.' },
      {
        anchor: 'collage.straighten',
        title: 'Straighten',
        text: 'Lays a bent pan flat along a line you know is level.',
        opens: {
          shot: 'collage-straighten',
          lead: 'Draw the line puts points along what should be level, a skyline or a shore, and Straighten bends the collage to it.',
          marks: [{ anchor: 'collage.canvas', title: 'The level line', text: 'A click adds a point, and Ctrl+Z takes the last one back.' }],
        },
      },
      { anchor: 'collage.save', title: 'Save to case', text: 'Files the collage as media at full resolution, while its layout stays editable.' },
    ],
    tips: [
      { title: 'A document of its own', text: 'Each collage keeps its layout, so it reopens from the Collage tab and edits.' },
      { title: 'The seams hold', text: 'Straighten bends the whole collage without opening its seams.' },
      { title: 'Never over the last one', text: 'A new export is filed beside the previous one rather than replacing it.' },
    ],
  },

  // -- Map --------------------------------------------------------------------
  satellite: {
    lead: 'Imagery of anywhere, from free and keyed providers, to search, measure and capture.',
    shot: 'satellite',
    marks: [
      { anchor: 'sat.search', title: 'Search', text: 'Saved places, a pasted coordinate and a bundled gazetteer answer as you type.' },
      {
        anchor: 'sat.tools',
        title: 'Tools',
        text: 'Measure, a search grid, sun and moon, and windows of case pictures over the map.',
        opens: {
          shot: 'satellite-refs',
          lead: 'Add reference holds a photo or video of the case over the map, to compare while you move the map under it.',
          marks: [{ anchor: 'map.ref', title: 'Reference window', text: 'Drag it, dock it beside the map or fold it. A capture never includes it.' }],
        },
      },
      {
        anchor: 'map.measure-tool',
        title: 'Measure',
        text: 'Distances, bearings and areas, drawn on the map and kept there.',
        opens: {
          shot: 'satellite-measure',
          lead: 'A click per point, a double click to end, a click on the first point to close an area.',
          marks: [
            { anchor: 'map.measure', title: 'A line of two points', text: 'Becomes rings round A, the cone a camera at A saw, a shadow read for its hour, or the ground in sight.' },
          ],
        },
      },
      { anchor: 'map.imagery', title: 'Imagery', text: 'The provider and the date of the picture. Free ones are built in, keyed ones use yours.' },
      { anchor: 'map.3d', title: '3D', text: 'Lifts the imagery onto the relief, and the middle button then tilts as well as turns.' },
      {
        anchor: 'map.ground',
        title: 'Right-click the ground',
        text: 'Everything Azimut can do with the point under the cursor.',
        opens: {
          shot: 'satellite-menu',
          lead: 'Copy the point in any format, save it, measure or read the sun from it, see its imagery history, or open it elsewhere.',
          marks: [{ anchor: 'map.menu', title: 'This point', text: 'Look from here opens Horizon standing on it.' }],
        },
      },
      {
        anchor: 'sat.panel',
        title: 'Layers and Saved',
        text: 'Folded here to give the map the room. Open it for the layers, your own maps and the case’s saved work.',
        opens: {
          shot: 'satellite-layers',
          lead: 'Layers switches overlays on and off, My layers holds the maps you draw, Added layers the files you bring. Saved lists the case’s places and captures.',
          marks: [
            { anchor: 'sat.panel', title: 'The panel', text: 'An eye switches a layer, and nothing is fetched until it is on.' },
            {
              anchor: 'sat.mylayers',
              title: 'My layers',
              text: 'Maps you draw yourself, kept with the case. The pencil on a row edits it.',
              opens: {
                shot: 'satellite-mylayer',
                lead: 'A layer of your own: markers, lines, areas, circles and boxes, each with its style, its icon and, once tracked, its days.',
                marks: [
                  { anchor: 'layer.tools', title: 'Draw', text: 'Markers, lines, areas, circles and boxes, or positions pasted and items of the case.' },
                  { anchor: 'layer.panel', title: 'The layer', text: 'Its features by group. A group sets their style, and a feature can wear its own.' },
                ],
              },
            },
          ],
        },
      },
      { anchor: 'sat.place', title: 'Save place', text: 'Files the point as a place, with a title and a note if you want.' },
      {
        anchor: 'sat.capture',
        title: 'Capture',
        text: 'Files the view as evidence, with its provider, coordinates, zoom and bearing.',
        opens: {
          shot: 'satellite-capture',
          lead: 'The arrow sets how a capture is taken: centred or drawn, its size, ratio and resolution.',
          marks: [{ anchor: 'sat.capture-menu', title: 'Capture settings', text: 'The main button repeats the last mode used.' }],
        },
      },
    ],
    tips: [
      { title: 'Layers cost nothing until they are on', text: 'Roads, railways, power lines, sea marks, GPS traces, fires and night lights are fetched only once switched on.' },
      { title: 'Somebody else’s map over yours', text: 'Add a layer opens a KML, KMZ, GeoJSON or GPX file, a public My Maps or a GeoConfirmed area, and keeps it with the case.' },
      { title: 'A map of your own', text: 'New layer under My layers puts drawing tools on the map: pick, drag, draw, merge.' },
      { title: 'Your footage on the map', text: 'Photos and videos stand where a relation, their GPS or a proof puts them. Press a mark to play what was filed there.' },
      { title: 'The map tabs look at one place', text: 'Satellite, Compare and Detect open where you last looked, and Settings, General turns that off.' },
      { title: 'A place has a shape', text: 'Trace footprint on a saved place draws what it really covers, a quay rather than a pin.' },
      { title: 'Layers travel', text: 'A layer of your own downloads as KMZ, KML or GeoJSON.' },
    ],
  },
  compare: {
    lead: 'Two locked views of the same ground, read side by side, by swipe, fade or blink.',
    shot: 'compare',
    marks: [
      { anchor: 'compare.modes', title: 'How to read them', text: 'Side by side, swipe, fade or blink. Difference shows what changed between the two dates.' },
      { anchor: 'compare.source', title: 'A and B', text: 'Each side picks its provider and its date.' },
      { anchor: 'compare.dates', title: 'All dates', text: 'With the same dated archive on both sides, every picture of the point, oldest first.' },
      { anchor: 'map.layers', title: 'Layers', text: 'One list over both maps, drawn on A, on B or on both.' },
      { anchor: 'compare.notes', title: 'Annotations', text: 'Arrows, boxes, measures, notes and numbered markers, kept in the saved comparison.' },
      { anchor: 'compare.mix', title: 'The divider', text: 'Drag the swipe, or set the fade and the blink speed.' },
      {
        anchor: 'compare.new',
        title: 'New',
        text: 'Starts from a pair that answers a common question.',
        opens: {
          shot: 'compare-new',
          lead: 'Each preset sets A and B for one question.',
          marks: [{ anchor: 'compare.new-menu', title: 'Presets', text: 'Those that read Sentinel-2 ask for the free Copernicus setup, and say so until it is done.' }],
        },
      },
      { anchor: 'compare.session', title: 'Open and Save', text: 'A saved comparison reopens with its views and marks, and exports as a PNG or an evolution GIF.' },
    ],
    tips: [
      { title: 'Difference reads one sky', text: 'Clouds are masked in the browser, and water counts only where both dates agree.' },
      { title: 'Keys', text: '1 to 4 switch the reading, 5 lays Difference over it, and Space pauses the blink.' },
      { title: 'Radar sees through cloud', text: 'Sentinel-1 comes through a layer added to your Copernicus setup, and A and B have to share a track.' },
      { title: 'From a difference to a detection', text: 'Save as a Detect analyzer keeps the reading that made the change stand out.' },
      { title: 'The annotations fold away', text: 'Their rail opens folded on each visit, and its arrow unfolds it.' },
    ],
  },
  detect: {
    lead: 'Sweeps ground in Sentinel imagery for change, once or on every new pass.',
    shot: 'detect',
    marks: [
      {
        anchor: 'detect.new',
        title: 'New detection',
        text: 'Pick the ground, what to look for, and one pass or a routine.',
        opens: {
          shot: 'detect-new',
          lead: 'A one-off pass is reviewed and done. A routine keeps its areas and runs again on each new pass.',
          marks: [{ anchor: 'detect.new-menu', title: 'Once or again', text: 'A routine gathers what you keep from one pass to the next.' }],
        },
      },
      { anchor: 'detect.tabs', title: 'Routines, Saved, Areas', text: 'What runs again, what you kept, and the ground the case watches.' },
      { anchor: 'detect.area', title: 'A watched area', text: 'Drawn or imported, it can be reshaped and shared with another case.' },
      {
        anchor: 'detect.analyzers',
        title: 'Analyzers',
        text: 'What a detection looks for. Copy a built-in to tune it, or write your own from rules.',
        opens: {
          shot: 'detect-library',
          lead: 'Your analyzers and the built-in ones, shared by every case, here over Al Udeid Air Base.',
          marks: [
            {
              anchor: 'detect.library-new',
              title: 'New analyzer',
              text: 'Starts from one blank rule, or from a ready example with its checks.',
              opens: {
                shot: 'detect-analyzer-new',
                lead: 'What it reads is fixed from here on, so its rules and checks always fit it.',
                marks: [
                  { anchor: 'detect.reads', title: 'What it reads', text: 'Sentinel-2 or Sentinel-1 radar, one date or two.' },
                  {
                    anchor: 'detect.start-from',
                    title: 'Start from',
                    text: 'A blank rule, or a ready example with the checks that prove it.',
                    opens: {
                      shot: 'detect-builder',
                      lead: 'An analyzer is the rules a pixel has to pass, proved by checks on real passes, here new aircraft on an apron.',
                      marks: [
                        { anchor: 'detect.rules', title: 'Rules', text: 'Each is a sentence: a band or an index, before, after or as the change, crossing a line.' },
                        {
                          anchor: 'detect.checks',
                          title: 'Checks',
                          text: 'Two real passes and pins where something must be found and where nothing may be.',
                          opens: {
                            shot: 'detect-check',
                            lead: 'A check on the map: the two passes, split or one at a time, and its pins.',
                            marks: [
                              { anchor: 'detect.bench', title: 'The passes', text: 'Before, after, or split to slide from one to the other.' },
                              { anchor: 'detect.pins', title: 'Pins', text: 'Should be found, or should stay empty. Turn one, or take it away.' },
                            ],
                          },
                        },
                        {
                          anchor: 'detect.display',
                          title: 'Display',
                          text: 'The passes in true colour, another Copernicus layer, or what a rule reads.',
                          opens: {
                            shot: 'detect-seeit',
                            lead: 'Both passes in colour infrared, where near infrared shows red. See it on a rule draws what that rule reads.',
                            marks: [{ anchor: 'detect.display', title: 'The layer shown', text: 'Any layer of your Copernicus account, on both passes at once.' }],
                          },
                        },
                        {
                          anchor: 'detect.test',
                          title: 'Test',
                          text: 'Reads every pinned tile and turns each check green or red. It never runs on its own.',
                          opens: {
                            shot: 'detect-tested',
                            lead: 'Tested: what the rules keep is outlined on the map, and each pin says whether it came out as it should.',
                            marks: [{ anchor: 'detect.verdict', title: 'The verdict', text: 'How many pins came out right, and what each rule adds.' }],
                          },
                        },
                        { anchor: 'detect.builder-save', title: 'Save', text: 'Needs one check with a pin found. Your analyzers are offered in every case.' },
                      ],
                    },
                  },
                ],
              },
            },
            { anchor: 'detect.library', title: 'The library', text: 'Built-ins are calibrated on real scenes. Copy one to change it.' },
          ],
        },
      },
      { anchor: 'map.layers', title: 'Layers', text: 'The same overlays and your own layers as on Satellite, over the ground being watched.' },
    ],
    tips: [
      { title: 'A free Copernicus account first', text: 'Detect reads Sentinel-2 bands, and until the account is set up it explains how, field by field.' },
      { title: 'Runs carry on', text: 'They queue in the case and continue while you work elsewhere.' },
      { title: 'An analyzer is a list of rules', text: 'Each rule is a line a pixel has to cross, before, after or as the change between them.' },
      { title: 'Checks prove an analyzer', text: 'Pins where something should and should not be found turn green or red when tested, and one is needed to save it.' },
      { title: 'Review one by one', text: 'Pin, keep or dismiss each finding, and what you keep is remembered.' },
      { title: 'Review by keyboard', text: 'K keeps, D dismisses and P pins the finding under review, and the arrows walk the queue.' },
      { title: 'Findings on the map', text: 'Export as layer puts the findings you kept on the map as a layer.' },
    ],
  },
  horizon: {
    lead: 'Stands you on the ground and draws what you would see, from a terrain model with the curve of the Earth.',
    shot: 'horizon',
    marks: [
      {
        anchor: 'horizon.modes',
        title: 'View and Overlay',
        text: 'Look around from the eye, or lay a photo over the view to see where it was taken from.',
        opens: {
          shot: 'horizon-overlay',
          lead: 'A photo laid over the terrain. Drag the terrain under it until the ridges meet, and Fit closes the gap.',
          marks: [
            { anchor: 'horizon.overlay', title: 'Photo and terrain', text: 'The photo, the terrain, a blink between them, or one above the other.' },
            { anchor: 'horizon.trace', title: 'The trace', text: 'The skyline drawn or detected on the photo, which Fit matches against the terrain.' },
          ],
        },
      },
      {
        anchor: 'horizon.find',
        title: 'Find, in beta',
        text: 'Searches an area of the map for where a photo was taken.',
        opens: {
          shot: 'horizon-find',
          lead: 'Find ranks the places whose relief fits the skyline of the photo. It proves nothing on its own, so check each place it gives.',
          marks: [
            {
              anchor: 'find.photo',
              title: 'The photo and its trace',
              text: 'Trace the skyline, and mark only what you are sure of.',
              opens: {
                shot: 'find-setup',
                lead: 'The skyline traced a stretch at a time, the ridges seen in front of farther land, and what is known of each line.',
                marks: [
                  { anchor: 'find.skyline', title: 'Skyline', text: 'Where the land meets the sky, one line per stretch.' },
                  { anchor: 'find.ridge', title: 'Ridge', text: 'A ridge seen in front of farther land, on which each place found is judged too.' },
                  { anchor: 'find.key', title: 'Key line', text: 'A line anyone would know, which weighs most. Three at most.' },
                  { anchor: 'find.hazy', title: 'Far land hidden', text: 'Brushed where haze may hide higher land behind the line.' },
                  { anchor: 'find.far', title: 'Distance', text: 'How far a line stands, said wide, with several bands when unsure.' },
                ],
              },
            },
            { anchor: 'find.map', title: 'The area', text: 'Draw it as small as your other clues allow, since a larger one meets more look-alikes.' },
            {
              anchor: 'find.steps',
              title: 'The search',
              text: 'Its setup and what you know of the photo, then the places it found.',
              opens: {
                shot: 'find-know',
                lead: 'What you know of the photo, under Help the search. Each line ticked leaves out the places that cannot be it.',
                marks: [
                  { anchor: 'find.stands', title: 'Eye on', text: 'The ground the camera stood on, read off the terrain.' },
                  { anchor: 'find.over', title: 'Eye stands', text: 'Above or below the land round it.' },
                  { anchor: 'find.zoom', title: 'Zoom', text: 'How zoomed the photo looks, with several ticked when unsure.' },
                  { anchor: 'find.grid', title: 'Grid', text: 'How far apart the points searched stand, under More settings.' },
                ],
              },
            },
            { anchor: 'find.trust', title: 'How far to trust it', text: 'Solid, Check it or Weak, and why.' },
            { anchor: 'find.places', title: 'The places', text: 'Best first. Open one to lay the photo from there.' },
            { anchor: 'find.save', title: 'Save', text: 'Keeps the setup in the case without searching.' },
            { anchor: 'find.beta', title: 'Beta', text: 'Says again what the beta means.' },
          ],
          tips: [
            { title: 'Far relief reads best', text: 'Ridges a few kilometres away or more are sharp on the 30 m terrain, while near slopes, trees and buildings are not.' },
            { title: 'Leave out what you doubt', text: 'A wrong distance, Sky only or Far land hidden can rule the true place out, where no mark costs nothing.' },
            { title: 'Read the first five', text: 'The true place is often second or third, so lay the photo from each one.' },
            { title: 'Solid, Check it or Weak', text: 'How far the best place stands above what the area fits by chance.' },
            { title: 'Rule out look-alikes', text: 'Facing, the sun or an alignment tell apart two places whose skylines look the same.' },
          ],
          more: { text: 'The full guide to Find', href: FIND_DOC },
          walk: 'search-with-find',
        },
      },
      { anchor: 'horizon.picture', title: 'Ground', text: 'Relief, satellite or plain, with ridge lines and summit names.' },
      { anchor: 'horizon.strip', title: 'The whole turn', text: 'All the way round the eye, with the part on screen framed. Drag to turn.' },
      { anchor: 'horizon.views', title: 'Open and Save', text: 'A saved view reopens its eye, its look, its ground and its photo.' },
      { anchor: 'horizon.capture', title: 'Capture', text: 'Files the view into the case as a picture.' },
      {
        anchor: 'horizon.side',
        title: 'Map and settings',
        text: 'Folds away for a wider view, or opens the map and the viewpoint beside it.',
        opens: {
          shot: 'horizon-side',
          lead: 'The column beside the view: where the eye stands, what it measures, and who stands there.',
          marks: [
            { anchor: 'horizon.map', title: 'The map', text: 'Where the eye stands and what it sees. Drag the dot to move it.' },
            { anchor: 'horizon.viewpoint', title: 'Viewpoint', text: 'On foot, by drone or from an aircraft, and how high the eye is.' },
          ],
        },
      },
    ],
    tips: [
      { title: 'Look from anywhere', text: 'Right-click any map and choose Look from here.' },
      { title: 'A photo says where it was taken from', text: 'In Overlay, drag the terrain under the photo until the ridges meet, and Fit closes the gap.' },
      { title: 'Keys', text: 'The arrows walk and turn, Page Up and Down tilt, N faces north and T traces the skyline.' },
      { title: 'Buildings stand up', text: 'In a city, buildings rise from open sources, and a saved view keeps them.' },
      { title: 'Fit makes no promise', text: 'Explains 80% says how much of the trace fits, not how likely the place is.' },
    ],
  },
  coordinates: {
    lead: 'Reads any coordinate in every notation, and the sun and moon over it on a date.',
    shot: 'coordinates',
    marks: [
      { anchor: 'coords.paste', title: 'Paste a coordinate', text: 'Decimal, DMS, DDM, UTM, MGRS, plus code or geohash.' },
      { anchor: 'coords.saved', title: 'From the case', text: 'Open a place or a capture the case has saved.' },
      { anchor: 'coords.formats', title: 'Every notation', text: 'Click a line to copy it.' },
      { anchor: 'coords.open', title: 'Open on', text: 'The same point in Google, Apple, Bing, Yandex, Copernicus Browser and more.' },
      { anchor: 'coords.sky', title: 'Sun and moon', text: 'Sunrise, noon, sunset, twilight and the moon for the day, computed here, offline.' },
      { anchor: 'coords.show-map', title: 'Show on map', text: 'Draws the day’s path of the sun on the map.' },
    ],
    tips: [
      { title: 'Two clocks', text: 'Each time is given in the place’s own zone and in UTC.' },
      { title: 'Read a shadow', text: 'In Satellite, a measure used as a shadow gives the hour from the shadow’s direction.' },
    ],
  },

  // -- Compose ----------------------------------------------------------------
  proof: {
    lead: 'Puts pictures side by side, marks what agrees, and files the point it proves.',
    shot: 'proof',
    marks: [
      { anchor: 'proof.tools', title: 'Marks', text: 'Boxes, arrows, lines, text, numbered markers, callouts, view cones, zoom insets and blur boxes. The same colour means the same feature.' },
      { anchor: 'proof.layout', title: 'Layout', text: 'Panels in a grid or free, and a preview of the crop X makes at 16:9 or square.' },
      { anchor: 'proof.canvas', title: 'The page', text: 'A mark dragged into the margin stays put, and an arrow between two pictures follows both.' },
      { anchor: 'proof.coords', title: 'The point', text: 'Filled from a satellite panel or typed. Each place can be named, and one can be the camera.' },
      { anchor: 'proof.meta', title: 'Source, description, date', text: 'Several sources, a description, and a date read on a clock, at the point or in UTC.' },
      { anchor: 'proof.panels', title: 'Panels', text: 'The pictures, each with a caption, a crop and a zoom.' },
      { anchor: 'proof.save', title: 'Save and post', text: 'Saves the PNG with its spec, so it reopens and edits. To Post carries it into Geo Report.' },
    ],
    tips: [
      { title: 'A blur hides for real', text: 'A blur box redraws the picture under it, so what is hidden is hidden in the exported file.' },
      { title: 'Numbers count by colour', text: 'Each colour counts its own series from 1, to tie a spot to a line of your text.' },
      { title: 'Paste a screenshot', text: 'Ctrl+V lays a picture over the proof, and it stays in this proof only.' },
      { title: 'The point becomes a place', text: 'Saving files its coordinates as a place on the map, and says the proof shows it.' },
      { title: 'A house style', text: 'A template made in Settings, Templates gives every proof the same look.' },
      { title: 'Right-click the page', text: 'Brings forward, sends back, duplicates or deletes the mark under the cursor.' },
    ],
  },
  post: {
    lead: 'Writes the sourced thread that publishes a finding. Pressing Post is left to you.',
    shot: 'post',
    marks: [
      { anchor: 'post.ingredients', title: 'What goes in', text: 'Where to publish, the thread style, the description, the point, the place, a mention and the source.' },
      { anchor: 'post.first', title: 'The geolocation post', text: 'Written from those fields, counted against the site’s limit, with the proof attached.' },
      { anchor: 'post.more', title: 'More posts', text: 'Add the media post and context posts, or copy the whole thread.' },
      { anchor: 'post.report', title: 'Save report', text: 'Writes the finding up as a Notebook note.' },
      { anchor: 'post.publish', title: 'Publish', text: 'Copies the posts and opens the site. With the extension it fills the composer box by box, and pressing Post stays yours.' },
    ],
    tips: [
      { title: 'Drafts', text: 'Save as draft keeps the thread to reopen and edit here.' },
      { title: 'Thread styles', text: 'Settings, Templates holds the structures a thread can follow.' },
      { title: 'Counted for the site', text: 'Each post counts its characters against the limit of the site picked.' },
      { title: 'The point, every way', text: 'The geolocation post gives the point in decimal, DMS and plus code, with links to the maps.' },
    ],
  },
  plate: {
    lead: 'A page laid out round the case’s maps, exported as an image, a PDF or a video.',
    shot: 'plate',
    marks: [
      {
        anchor: 'plate.add',
        title: 'Add',
        text: 'Puts a new element on the page.',
        opens: {
          shot: 'plate-add',
          lead: 'Maps, legend, scale, north, inset, text, pictures and credits, searchable.',
          marks: [{ anchor: 'plate.add-groups', title: 'The catalogue', text: 'Search it, or browse it by kind.' }],
        },
      },
      { anchor: 'plate.list', title: 'On the page', text: 'Every element in stacking order. Pick one to set it.' },
      { anchor: 'plate.page', title: 'The page', text: 'A drag inside a map moves its ground, and its edge moves the frame.' },
      { anchor: 'plate.inspector', title: 'Inspector', text: 'Paper, fonts and colours, or the settings of the element picked.' },
      { anchor: 'plate.looks', title: 'Looks', text: 'A whole look in one press: Press, Night, Newsroom, Humanitarian, Tactical and more.' },
      {
        anchor: 'plate.export',
        title: 'Export',
        text: 'A PNG, a PDF, or a video of the plate’s days.',
        opens: {
          shot: 'plate-made',
          lead: 'A ready plate on the case’s own layer, in one of the looks, as it leaves the app.',
          marks: [],
        },
      },
      {
        anchor: 'plate.home',
        title: 'Plates',
        text: 'Back to the plates of the case, where a new one starts.',
        opens: {
          shot: 'plate-home',
          lead: 'The plates of the case, your templates, and plates ready to fill from the map.',
          marks: [{ anchor: 'plate.ready', title: 'Ready plates', text: 'Ten layouts, from a situation map to a line of sight, laid out from the map in one press.' }],
        },
      },
    ],
    tips: [
      { title: 'A new plate starts from the Map', text: 'A ready plate opens at once; New plate first picks its layout, layers, paper and look.' },
      { title: 'Days and steps', text: 'A tracked layer is drawn on the plate’s day, and the video plays through its days.' },
      { title: 'Templates', text: 'Keep as template saves the layout without its data, to start other plates from.' },
      { title: 'Texts that fill themselves', text: '{date}, {case}, {title}, {scale} and {imagery} are written in when the page is drawn.' },
      { title: 'Focus', text: 'F sets one element apart, to adjust it without the rest of the page.' },
      { title: 'A day left out of the video', text: 'Its ⋯ menu hides it from the play and every export, and it stays on the bar to edit.' },
      { title: 'In relief', text: 'Show the map in 3D lays a map on the terrain, with its ridge lines.' },
    ],
  },
  notebook: {
    lead: 'Markdown notes with the case’s media, Mermaid diagrams and a PDF export.',
    shot: 'notebook',
    marks: [
      { anchor: 'notebook.notes', title: 'Notes', text: 'The case notes, and every note filed in a folder.' },
      { anchor: 'notebook.insert', title: 'Insert', text: 'A reference to an item of the case, or one of its pictures.' },
      { anchor: 'notebook.write', title: 'Write', text: 'Markdown, saved as you type.' },
      { anchor: 'notebook.preview', title: 'Preview', text: 'As it will export, diagrams drawn.' },
      { anchor: 'notebook.pdf', title: 'PDF', text: 'Exports this note. The bar above exports several at once.' },
    ],
    tips: [
      { title: 'Diagrams', text: 'A mermaid code block becomes a diagram, in the preview and in the PDF.' },
      { title: 'Remote images say so', text: 'An image from the web contacts its host each time the preview opens, and the editor warns you.' },
      { title: 'Several notes, one PDF', text: 'The bar above exports several notes at once, in the order you pick.' },
    ],
  },

  // -- Case -------------------------------------------------------------------
  timeline: {
    lead: 'Every dated statement and file of the case on one axis, in the place’s own time.',
    shot: 'timeline',
    marks: [
      { anchor: 'timeline.range', title: 'The window', text: 'Step earlier or later, or pick a span. Scroll to zoom, Shift-scroll to pan.' },
      { anchor: 'timeline.zone', title: 'Whose clock', text: 'Opens on the zone of the case’s places. UTC, this computer or any zone is one pick away.' },
      { anchor: 'case.views', title: 'Views', text: 'Keeps the window and its tracks to come back to, live or frozen.' },
      { anchor: 'timeline.axis', title: 'The axis', text: 'Files at the date you gave them, events on their own track. Click an empty spot to date a new entry.' },
      { anchor: 'timeline.entry', title: 'The entry line', text: 'Type what happened. @ mentions a subject, and only a date you give is used.' },
      { anchor: 'timeline.list', title: 'The list', text: 'The same entries as rows, with subjects, places, sources and confidence.' },
    ],
    tips: [
      { title: 'Shapes say how sure the date is', text: 'A point is an instant, a bracket a day, month or year, a dashed line a moment between two dates, a bar a period.' },
      { title: 'Keys', text: '+ and - zoom, Home shows everything, and Alt with an arrow walks a track.' },
      { title: 'Correct a date', text: 'Right-click an entry and choose Correct this date.' },
      { title: 'How far apart', text: 'Ctrl-click a second entry to measure the time between the two, or its range when a date is broad.' },
      { title: 'The files’ own dates', text: 'File dates shows what the files themselves say, when you ask for it.' },
    ],
  },
  board: {
    lead: 'The case as an index: people, accounts, places and things first, events and files below.',
    shot: 'board',
    marks: [
      { anchor: 'case.filter', title: 'The question', text: 'Search, or + Filter for six standing questions whose terms land as chips you can edit.' },
      { anchor: 'board.waiting', title: 'Waiting', text: 'What needs you, counted, one click from the rows.' },
      { anchor: 'board.totals', title: 'Rows or Totals', text: 'The rows, or what they add up to, ranked.' },
      {
        anchor: 'board.group',
        title: 'A group of rows',
        text: 'Each row says how many events name it, and when. Press one to read it.',
        opens: {
          shot: 'board-details',
          lead: 'Details opens beside the rows, and ↑ and ↓ walk them with Details following.',
          marks: [{ anchor: 'board.details', title: 'Details', text: 'Its top line counts the events that name it, and Add event notes the next one.' }],
        },
      },
      { anchor: 'board.new', title: 'New entity', text: 'Adds a person, an account, a place or a thing by hand.' },
    ],
    tips: [
      { title: 'The count is a proportion', text: '23 of 1204 keeps the whole case as the denominator, so it never shrinks with the answer.' },
      { title: 'One table', text: 'Group: None shows everything as a single table.' },
      { title: 'Keep a reading', text: 'Views keeps the question and its columns, live or frozen as a snapshot.' },
      { title: 'Take it out', text: 'Export writes the reading as an SVG, a PNG or a copied picture.' },
    ],
  },
  graph: {
    lead: 'The same question drawn as a network. The drawing is yours and never writes to the case.',
    shot: 'graph',
    marks: [
      { anchor: 'graph.lens', title: 'Lens', text: 'Decides what the drawing reads.' },
      { anchor: 'graph.find', title: 'Find a node', text: 'Jumps to it by name.' },
      { anchor: 'case.filter', title: 'The question', text: 'The Board’s filter, received as a question, so the drawing stays live as the case changes.' },
      { anchor: 'graph.zoom', title: 'Zoom', text: '0 fits the drawing, + and - zoom.' },
      { anchor: 'graph.canvas', title: 'The drawing', text: 'Expand, hide, fold and drag. Undo reaches all of it and nothing in the case.' },
      { anchor: 'graph.legend', title: 'Legend', text: 'Each family is a switch, counted.' },
    ],
    tips: [
      { title: 'The case proposes links', text: 'Who posted a file and points under 300 m apart are proposed, and N proposed lists them to confirm or drop.' },
      { title: 'Keys', text: '1, 2 and 3 light the hops around the selected node, and the arrows nudge it.' },
      { title: 'Lenses', text: 'Everything, Subjects, Ground, Claims and My work read the same case differently.' },
    ],
  },
  sheet: {
    lead: 'Real CSV files in the case folder, worked down as lists or compared as grids.',
    shot: 'sheet',
    marks: [
      {
        anchor: 'sheet.new',
        title: 'New',
        text: 'Rows from a blank sheet, a file, a pasted table or the case itself.',
        opens: {
          shot: 'sheet-new',
          lead: 'Every way rows come in, under one button.',
          marks: [{ anchor: 'sheet.new-menu', title: 'Where rows come from', text: 'From the case starts the sheet from what the case already holds.' }],
        },
      },
      { anchor: 'sheet.search', title: 'Search the rows', text: 'Narrows the grid as you type.' },
      { anchor: 'sheet.columns', title: 'Columns', text: 'Show, hide and give a column a role: a state, coordinates, a date.' },
      { anchor: 'sheet.grid', title: 'The grid', text: 'Each column’s role shows on its head, with its filter beside it.' },
      { anchor: 'sheet.progress', title: 'Progress', text: 'How many rows have the tracked column filled, and how many are left.' },
    ],
    tips: [
      { title: 'Sheets the case could start', text: 'The Sheet home offers lists like Files to geolocate, built from what the case holds.' },
      { title: 'Into the case', text: 'A declared sheet turns into entities, places and dated claims, read as a plan first.' },
      { title: 'A whole workbook', text: 'An .xlsx comes in as one sheet per tab, under the tabs’ own names.' },
      { title: 'A colour can mean something', text: 'Tell a row colour what it stands for, and the sheet says it in its legend.' },
      { title: 'Every gesture', text: 'Press ? in a sheet for the full list.' },
    ],
  },
};

/** Goals walked across the tools, each step on the picture of the tool it happens in. */
export const JOURNEYS = [
  {
    id: 'geolocate-a-photo',
    title: 'Geolocate a photo',
    lead: 'From a picture with no caption to a published proof of where it was taken.',
    steps: [
      { tool: 'media', text: 'Import the photo, or paste the link of the post it came from so its origin comes with it.', marks: ['media.link', 'media.import'] },
      { tool: 'inspect', text: 'Crop and adjust what is hard to read, and look for edits in the error levels.', marks: ['inspect.tabs', 'inspect.strip'] },
      {
        tool: 'reverse',
        text: 'Optional for some pictures, but worth doing: an earlier copy found by an engine often dates the picture better than the post.',
        marks: ['reverse.adjust', 'reverse.engines'],
      },
      {
        tool: 'satellite',
        shot: 'satellite-refs',
        text: 'Search the area and hold the photo over the map in a reference window. Use whichever Map tool helps, Compare, Horizon, Measure or the sun, then capture the view.',
        marks: ['sat.search', 'map.ref', 'sat.tools', 'sat.capture'],
      },
      { tool: 'proof', text: 'Put the photo beside the capture, mark what agrees in one colour per feature, and name the point. It is filed as a place.', marks: ['proof.panels', 'proof.tools', 'proof.coords'] },
      { tool: 'post', text: 'Turn the proof into a sourced thread, then Publish copies the posts and opens the site.', marks: ['post.first', 'post.publish'] },
    ],
    result: {
      shot: 'proof-result',
      text: 'The proof as it leaves the case: the photo beside the imagery, each match in its own colour, the point named.',
    },
  },
  {
    id: 'create-an-analyzer',
    title: 'Create your analyzer',
    lead: 'Aircraft on the apron of Al Udeid Air Base: from a change you want Detect to find to an analyzer proved on real scenes, offered in every case.',
    steps: [
      { tool: 'detect', label: 'Library', shot: 'detect-library', text: 'In Detect, Analyzers at the top of the panel opens the library. New analyzer starts one; a built-in can be copied to tune instead.', marks: ['detect.analyzers', 'detect.library-new'] },
      { tool: 'detect', label: 'What it reads', shot: 'detect-analyzer-new', text: 'New aircraft on the apron: Sentinel-2, two dates, from a blank rule. What it reads is fixed from here on.', marks: ['detect.reads', 'detect.start-from'] },
      { tool: 'detect', label: 'First rule', shot: 'detect-first-rule', text: 'Name it, and keep ground whose colour moved by at least 4.5% in the visible bands.', marks: ['detect.rules', 'detect.builder-save'] },
      { tool: 'detect', label: 'Check', shot: 'detect-check', text: 'In Checks, New check: pick a pass before and a pass after, slide between them, and pin where aircraft appeared and where nothing changed.', marks: ['detect.bench', 'detect.pins'] },
      { tool: 'detect', label: 'Second rule', shot: 'detect-builder', text: 'A second rule keeps a drop in near infrared against the ground around it, where an aircraft stands on the concrete.', marks: ['detect.rules'] },
      { tool: 'detect', label: 'Display', shot: 'detect-seeit', text: 'Look at the passes through another layer, here colour infrared, or press See it on a rule to draw what it reads, and set its line where aircraft stand out.', marks: ['detect.display'] },
      { tool: 'detect', label: 'Test', shot: 'detect-tested', text: 'Test reads the pinned tiles. When a pin is missed, ease the rule’s line and test again until every pin comes out right.', marks: ['detect.verdict'] },
      { tool: 'detect', label: 'Save', shot: 'detect-tested', text: 'Add to my analyzers. New detection then offers it in every case, and Share hands it to someone else as a file.', marks: ['detect.builder-save'] },
    ],
    result: {
      shot: 'detect-mine',
      text: 'Aircraft activity in your library with its check, ready for a pass or a routine over the apron, or any ground.',
    },
  },
  {
    id: 'search-with-find',
    title: 'Search with Find',
    lead: 'The 1901 photo of Half Dome: from its skyline to the point it was taken from, each mark set for a reason.',
    steps: [
      {
        tool: 'horizon',
        label: 'Skyline',
        shot: 'find-setup',
        text: 'In Horizon, lay the photo in Overlay and press Find. With Skyline, trace where the land meets the sky, a stretch at a time: the far ridge, the Dome, the far range, the ridge on the right.',
        marks: ['find.skyline'],
      },
      {
        tool: 'horizon',
        label: 'Ridges',
        shot: 'find-setup',
        text: 'With Ridge, trace the lines seen in front of farther land: the wooded ridge, the shoulder of the Dome and Liberty Cap. Each place found is judged on them too.',
        marks: ['find.ridge'],
      },
      { tool: 'horizon', label: 'Key line', shot: 'find-setup', text: 'With Key line, click the Dome: anyone would know its shape, so it weighs most.', marks: ['find.key'] },
      {
        tool: 'horizon',
        label: 'Haze',
        shot: 'find-setup',
        text: 'Brush Far land hidden over the far range. It is pale under a milky sky, so higher land may stand behind it.',
        marks: ['find.hazy'],
      },
      {
        tool: 'horizon',
        label: 'Distances',
        shot: 'find-setup',
        text: 'Say distances wide: the Dome and Liberty Cap under 10 km, the far range past it. The Dome looks close but stands 4 km off, so 1 to 3 km alone would rule the true place out.',
        marks: ['find.far'],
      },
      {
        tool: 'horizon',
        label: 'Area',
        shot: 'find-setup',
        text: 'Draw the area round where the photo may have been taken, here the valley and its rims, about 10 km across.',
        marks: ['find.map'],
      },
      {
        tool: 'horizon',
        label: 'What you know',
        shot: 'find-know',
        text: 'The camera looks down into a deep valley from its rim: Summit or ridge and Slope, and Above the land round. The lens is a camera’s usual one or a little longer, so ×1 and ×2–3.',
        marks: ['find.stands', 'find.over', 'find.zoom'],
      },
      { tool: 'horizon', label: 'Grid', shot: 'find-know', text: 'In More settings, a point every 50 m, then Search.', marks: ['find.grid'] },
      {
        tool: 'horizon',
        label: 'Places',
        shot: 'horizon-find',
        text: 'Read how far the best place can be trusted and why, then open it to lay the photo from there.',
        marks: ['find.trust', 'find.places'],
      },
    ],
    result: {
      shot: 'find-look',
      text: 'The photo laid over the terrain from the first place, by Glacier Point, where it was taken in 1901.',
      example: true,
    },
  },
];

/** Settings, in the tabs of its own screen. The extension's section has a page of its own. */
export const SETTINGS_TABS = [
  { id: 'settings', label: 'General' },
  { id: 'settings-publishing', label: 'Publishing' },
  { id: 'settings-imagery', label: 'Imagery' },
  { id: 'settings-templates', label: 'Templates' },
  { id: 'settings-icons', label: 'Icons' },
  { id: 'settings-storage', label: 'Storage' },
  { id: 'settings-system', label: 'System' },
];

/** The extension's page, in the tabs it is read in: setting it up, then using it. */
export const EXTENSION_TABS = [
  { id: 'extension', label: 'Install' },
  { id: 'extension-capture', label: 'Capture' },
  { id: 'extension-tools', label: 'Tools on the map' },
  { id: 'extension-sites', label: 'Where it works' },
];

/**
 * What the extension does where, read off `engine/mapsites.py`: every site it reads
 * draws a flat map it can measure, and the views that are not flat keep everything
 * but the drawing tools. A cell is `yes`, `no` or the sentence the extension says.
 */
export const EXTENSION_SITES = {
  lead: 'The extension reads the page’s address, never its content. What it can do depends on the view.',
  sites: [
    'Google Maps',
    'Google Earth',
    'Bing Maps',
    'Yandex Maps',
    'OpenStreetMap',
    'Apple Maps',
    'Zoom Earth',
    'Satellites.pro',
    'Copernicus Browser',
  ],
  columns: ['Capture and save the place', 'Measure, grid, sun and fires', 'Points and Refs'],
  rows: [
    { view: 'A flat map on any of these sites', cells: ['yes', 'yes', 'yes'] },
    { view: 'Street View', cells: ['yes', 'Work on the map, not in Street View', 'Refs, and points at the address’s coordinate'] },
    { view: 'A tilted 3D view', cells: ['yes', 'Turn 3D off', 'Refs, and points at the address’s coordinate'] },
    { view: 'A globe zoomed far out', cells: ['yes', 'Zoom in', 'Refs, and points at the address’s coordinate'] },
    { view: 'Any other page', cells: ['Saved as a bookmark', 'no', 'no'] },
  ],
  elsewhere: [
    { where: 'X and Bluesky', text: 'When Geo Report publishes, it fills the composer with the thread and the proof. Posting stays yours.' },
    { where: 'Google Lens, Bing, Yandex, TinEye', text: 'When Reverse Search opens an engine, it hands the picture to the engine’s uploader.' },
  ],
};

/** Every keystroke the app listens for, by where it is pressed. */
export const KEYMAP = [
  {
    where: 'Anywhere',
    keys: [
      { combo: 'Ctrl+K / ⌘K', does: 'opens Go to for tools, cases and documents' },
      { combo: 'Ctrl+V', does: 'files a screenshot or a copied address, on Media, Files, Board and Graph' },
      { combo: 'Escape', does: 'closes whatever is open, shallowest first' },
      { combo: 'Ctrl+Enter', does: 'adds the entry line, from any of its fields' },
      { combo: 'Alt+N', does: 'opens Add event over the tool on screen, with what it shows already cited' },
    ],
  },
  {
    where: 'Satellite, Compare, Detect',
    keys: [
      { combo: 'Middle-drag', does: 'turns the map like a wheel round the point grabbed, as does Shift-drag' },
      { combo: 'Ctrl (turning)', does: 'turns in 15° steps' },
      { combo: 'Middle-click', does: 'puts north back up' },
      { combo: 'Shift+← / →', does: 'turns the map 15°' },
      { combo: 'Shift+↑', does: 'puts north back up' },
    ],
  },
  {
    where: 'Satellite',
    keys: [
      { combo: 'Page Up / Down', does: 'tilts the map in 3D toward the horizon and back' },
      { combo: 'Double-click or Enter', does: 'ends the measure being drawn' },
      { combo: 'Backspace', does: 'takes back the last point of a measure, or removes the selected one' },
      { combo: 'Alt (measuring)', does: 'keeps a click off the place or pin under it' },
      { combo: 'C or Space', does: 'clears the grid cell under review and flies to the next' },
      { combo: 'F', does: 'flags the cell under review' },
      { combo: 'S', does: 'skips to the next unchecked cell' },
      { combo: 'P', does: 'flags the cell and saves it as a place' },
      { combo: 'Enter', does: 'confirms a polygon grid area' },
      { combo: 'Escape', does: 'stops the review, or the area being drawn' },
    ],
  },
  {
    where: 'Horizon',
    keys: [
      { combo: 'Drag', does: 'turns the view, as does the strip under it' },
      { combo: 'Wheel', does: 'narrows or widens the lens about the pointer' },
      { combo: 'Shift+drag', does: 'rolls the view' },
      { combo: 'Double-click', does: 'goes to the ground clicked, facing the same way' },
      { combo: '↑ / ↓', does: 'walks forward and back, Shift for five steps' },
      { combo: '← / →', does: 'turns by a tenth of the lens' },
      { combo: 'Page Up / Down', does: 'tilts up and down' },
      { combo: '+ / -', does: 'narrows and widens the lens' },
      { combo: 'N', does: 'faces north' },
      { combo: 'Alt+wheel', does: 'raises or lowers the eye' },
      { combo: 'T', does: 'traces the skyline on a photo laid over the view, or stops' },
      { combo: 'B', does: 'blinks between the photo and the terrain' },
      { combo: 'Ctrl+Z', does: 'takes the last stroke of the trace back' },
      { combo: 'Space', does: 'plays or pauses a video laid over the view' },
      { combo: ', / .', does: 'steps the video a frame back or on' },
      { combo: 'Escape', does: 'stops tracing, or leaves Move the viewpoint with the eye where it was' },
    ],
  },
  {
    where: 'Compare',
    keys: [
      { combo: '1 / 2 / 3 / 4', does: 'side by side, swipe, fade or blink' },
      { combo: '5', does: 'lays Difference over the view, or lifts it' },
      { combo: 'Space', does: 'pauses the blink, or resumes it' },
      { combo: '[', does: 'folds the column to a rail and back' },
      { combo: 'V A R E P M L D T N S', does: 'picks select, arrow, box, ellipse, area, measure, line, freehand, note, numbered marker and symbol' },
      { combo: '← / →, Home / End', does: 'moves the focused swipe divider, or sends it to an edge' },
      { combo: 'Delete', does: 'removes the selected mark' },
      { combo: 'Ctrl+Z', does: 'undoes the last mark' },
      { combo: 'Ctrl+Shift+Z or Ctrl+Y', does: 'redoes it' },
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
      { combo: 'Alt+← / →', does: 'moves from a focused entry to the one before or after it on its track' },
      { combo: '↑ / ↓', does: 'walks the rows of the list under the axis' },
      { combo: 'Enter', does: 'opens the focused row in the inspector' },
      { combo: 'Escape', does: 'closes the menu that is open' },
    ],
  },
  {
    where: 'Board',
    keys: [
      { combo: '↑ / ↓', does: 'walks the rows, and Details beside them follows' },
      { combo: 'Enter', does: 'opens the focused row in Details' },
      { combo: 'Escape', does: 'closes Details beside the rows' },
    ],
  },
  {
    where: 'Timeline, Board, Graph',
    keys: [
      { combo: '@', does: 'mentions a subject on the entry line, one the case holds or a new one' },
      { combo: '↑ / ↓, Enter or Tab', does: 'moves through the mentions offered and picks one' },
      { combo: 'Escape', does: 'closes the mentions and keeps the @ as text' },
      { combo: 'Enter', does: 'adds the entry, from its sentence' },
      { combo: 'Alt+↓', does: 'moves a focused mention to its next seat' },
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
      { combo: 'V R E A L C D T K S N B Z O', does: 'picks select, rectangle, ellipse, arrow, line, curve, freehand, text, callout, icon, numbered marker, blur box, zoom inset and view cone' },
      { combo: 'Ctrl+↑ / Ctrl+↓', does: 'brings the picked marks forward or sends them back, all the way with Shift' },
      { combo: 'Right-click', does: 'opens what can be done to the mark, the picture or the page under the pointer' },
      { combo: 'F', does: 'fits the document' },
      { combo: 'Space (held)', does: 'pans, whatever tool is in hand' },
      { combo: 'Delete', does: 'removes what is selected' },
      { combo: 'Ctrl+Z', does: 'undoes the last change' },
      { combo: 'Ctrl+Shift+Z', does: 'redoes it' },
      { combo: 'Escape', does: 'drops the shape being drawn, then the selection, then the pen' },
    ],
  },
  {
    where: 'Detect',
    keys: [
      { combo: ']', does: 'folds the column to a rail and back' },
      { combo: '← / →', does: 'walks the review queue' },
      { combo: 'K D P', does: 'keeps, dismisses or pins the candidate under review' },
      { combo: 'H', does: 'hides the candidates and areas, or shows them again' },
      { combo: 'B', does: 'blinks A and B on the map, when the run read two passes' },
      { combo: 'M', does: 'picks up the ruler, or puts it down' },
      { combo: 'Delete or Backspace', does: 'removes the selected measure' },
    ],
  },
  {
    where: 'Inspect',
    keys: [
      { combo: '← / →', does: 'steps one video frame, Shift for a second' },
      { combo: ', / .', does: 'the same step, on the keys mpv uses' },
      { combo: 'Space or K', does: 'plays and pauses' },
      { combo: 'J / L', does: 'slows the video down or speeds it up' },
      { combo: 'C', does: 'captures the frame on screen' },
      { combo: 'M', does: 'marks the moment in Moments' },
      { combo: 'O, held', does: 'shows the picture without its adjustments' },
      { combo: 'Enter / Escape', does: 'applies the crop, or leaves it' },
      { combo: 'Middle-drag', does: 'turns the frame or the video, Ctrl for 15° steps' },
      { combo: 'Middle-click', does: 'stands it upright again' },
    ],
  },
  {
    where: 'Collage',
    keys: [
      { combo: 'Delete', does: 'removes the selected pieces' },
      { combo: 'Ctrl+Z', does: 'undoes the last change' },
      { combo: 'Ctrl+Shift+Z', does: 'redoes it' },
    ],
  },
  {
    where: 'Media',
    keys: [
      { combo: 'Enter', does: 'opens the picture, video or sound under the cursor' },
      { combo: '← / →', does: 'walks the viewer through the list' },
      { combo: 'Escape or Space', does: 'closes the viewer' },
    ],
  },
  {
    where: 'Files',
    keys: [
      { combo: 'Space', does: 'shows the selected picture, video or sound, and closes it again' },
      { combo: '← / →', does: 'walks the viewer through the folder' },
      { combo: 'F2', does: 'renames the selected item' },
      { combo: 'Delete', does: 'deletes the selected items, after asking' },
    ],
  },
];

/** The frictions worth knowing about before you hit them, and where each is fixed. */
export const FIXES = [
  {
    symptom: 'A download answers "This link needs a login"',
    fix: 'The site wants a session. Pick a browser you are signed in to there, or give an exported cookies.txt.',
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
    symptom: 'The app opens on "Another Azimut has this workspace"',
    fix: 'Close the other Azimut and reload, or press "Take it anyway" if it is already gone.',
  },
  {
    symptom: 'The 3D globe or Horizon stutters',
    fix: 'Restart the computer if it has run for days, and close what else is open. Then Settings, General, 3D views: Balanced or Light draws less. Captures stay at full quality.',
  },
  {
    symptom: 'The tab is closed and the app seems gone',
    fix: 'Azimut is a local server plus a browser tab. Closing the tab stops nothing: open the address the launcher printed again, and the work is where you left it.',
  },
];

const REFERENCE = {
  shortcuts: { title: 'Shortcuts', icon: 'keyboard', lead: 'The keys worth knowing, by where they are pressed.' },
  trouble: { title: 'When something does not work', icon: 'alert', lead: 'The frictions worth knowing about before you hit them, and where each is fixed.' },
};

const page = (id) => ({ id, label: PAGES[id].title, icon: PAGES[id].icon, kind: 'page', tools: [] });
const reference = (id) => ({ id, label: REFERENCE[id].title, icon: REFERENCE[id].icon, kind: id, tools: [], lead: REFERENCE[id].lead });
// a page read in tabs: its tabs stand where a workspace's tools do
const tabbed = (id, tabs) => ({ id, label: PAGES[id].title, icon: PAGES[id].icon, kind: 'tabs', tools: tabs.map((tab) => tab.id) });

/** The label of a tab, a workspace's tool or one of a tabbed page's own tabs. */
export const tabLabel = (id) => [...EXTENSION_TABS, ...SETTINGS_TABS].find((tab) => tab.id === id)?.label ?? toolLabel(id);

/**
 * The menu, in the order somebody arriving reads it: what a case is, then a goal walked
 * end to end, then the tools by workspace, then the reference.
 */
export const MENU = [
  { title: null, items: [page('start'), tabbed('extension', EXTENSION_TABS)] },
  {
    title: 'Journeys',
    items: JOURNEYS.map((journey) => ({
      id: `journey:${journey.id}`,
      label: journey.title,
      icon: 'flag',
      kind: 'journey',
      tools: [],
      lead: journey.lead,
    })),
  },
  {
    title: 'Tools',
    items: [...WORKSPACES, CASE_WORKSPACE].map((ws) => ({
      id: ws.id,
      label: ws.label,
      icon: ws.icon,
      kind: 'workspace',
      tools: ws.tools,
      lead: WORKSPACE_LEADS[ws.id],
    })),
  },
  { title: 'Reference', items: [reference('shortcuts'), tabbed('settings', SETTINGS_TABS), reference('trouble')] },
];

export const MENU_ITEMS = MENU.flatMap((group) => group.items);

const SHOT_IMAGES = import.meta.glob('../assets/guide/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const SHOT_MAPS = import.meta.glob('../assets/guide/*.json', { eager: true, import: 'default' });
const SHOT_FILMS = import.meta.glob('../assets/guide/*.webm', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** A picture, the film that plays in its place if it has one, and the rectangles measured on it, or null when it was never made. */
export function shotOf(name) {
  const src = SHOT_IMAGES[`../assets/guide/${name}.webp`];
  const map = SHOT_MAPS[`../assets/guide/${name}.json`];
  if (!src || !map) return null;
  const film = SHOT_FILMS[`../assets/guide/${name}.webm`];
  return { src: /** @type {string} */ (src), ...(film ? { film: /** @type {string} */ (film) } : {}), ...map };
}

/**
 * Where the guide opens for whatever asked: a page by its id (`start`, `settings`, a
 * `journey:` id), the tab of a tool a workspace holds, the screen a number opens by
 * that number's anchor (`horizon.find`), or the start.
 */
export function landingFor(at) {
  // an entry with tabs opens on its first, as choosing it from the menu does
  const item = MENU_ITEMS.find((entry) => entry.id === at);
  if (item) return { item: item.id, tool: item.tools[0] ?? null };
  const holder = MENU_ITEMS.find((entry) => entry.tools.includes(at));
  if (holder) return { item: holder.id, tool: at };
  // a number that leads on, asked by its anchor: its page, on the screen it opens
  const page = Object.keys(PAGES).find((id) => opensFrom(id, at));
  if (page) return { ...landingFor(page), opens: at };
  return { item: MENU_ITEMS[0].id, tool: null };
}

/** The screen a number of a page opens, with the way back, as a press on it shows it; null when it opens none. */
export function opensFrom(page, anchor) {
  const mark = PAGES[page]?.marks.find((one) => one.anchor === anchor && one.opens);
  return mark ? { ...mark.opens, from: mark.title } : null;
}

/** The journeys that pass through a tool, each with the step it is used at. */
export function journeysThrough(tool) {
  return JOURNEYS.flatMap((journey) => {
    const at = journey.steps.findIndex((step) => step.tool === tool);
    return at < 0 ? [] : [{ id: journey.id, title: journey.title, step: at + 1 }];
  });
}

/** The marks a journey step frames, read off the page of the tool it happens in. */
export function stepMarks(step) {
  const marks = [];
  const gather = (list) => {
    for (const mark of list ?? []) {
      marks.push(mark);
      gather(mark.opens?.marks);
    }
  };
  gather(PAGES[step.tool]?.marks);
  return step.marks.map((anchor) => marks.find((mark) => mark.anchor === anchor)).filter(Boolean);
}

/** The picture a journey step is read on: its own, or its tool's. */
export const stepShot = (step) => step.shot ?? PAGES[step.tool].shot;

/**
 * Every picture the guide shows, with the marks drawn on it: what `guide:shots` makes.
 * A journey step taken on a picture of its own adds its frames to that picture's.
 */
export function allShots() {
  const shots = [];
  const add = (shot, anchors) => {
    const known = shots.find((one) => one.shot === shot);
    if (known) known.anchors.push(...anchors.filter((anchor) => !known.anchors.includes(anchor)));
    else shots.push({ shot, anchors: [...anchors] });
  };
  const walk = (shot, marks) => {
    add(shot, marks.map((mark) => mark.anchor));
    for (const mark of marks) if (mark.opens) walk(mark.opens.shot, mark.opens.marks ?? []);
  };
  for (const one of Object.values(PAGES)) walk(one.shot, one.marks);
  for (const journey of JOURNEYS) {
    for (const step of journey.steps) if (step.shot) add(step.shot, step.marks);
    if (journey.result) add(journey.result.shot, []);
  }
  return shots;
}

export const toolLabel = (tool) => TOOL_LABELS[tool] ?? tool;

/** How far apart two numbers sit, in pixels on screen, so neither covers the other. */
export const PIN_ROOM = 30;

/**
 * Where each number sits on a picture. A panel takes it on its top left corner, which is
 * padding; a small control, a button or an icon, takes it just off that corner, where it
 * hides none of what it explains. When that spot is taken, the next corner or middle of
 * an edge clear of the numbers already placed: beside a rail, and under anything wider
 * rather than between it and the next control in its row.
 *
 * Spots are tried best first: one on no other numbered control, then one on another,
 * and last, for a small control, one the picture's edge would push back onto it. A
 * frame covering most of the picture, such as the map itself, takes its number in its
 * middle, where no control's number is. When nothing is clear, the spot furthest from
 * the others wins.
 *
 * `frames` are `{ x, y, w, h }` and `apart` the room between two numbers, both in the
 * picture's pixels; each frame comes back with its `pin`.
 */
export function pinSpots(frames, shot, apart = PIN_ROOM) {
  const taken = [];
  const half = apart / 2;
  const big = (frame) => frame.w * frame.h > shot.width * shot.height * 0.4;
  const inside = ({ x, y }) => ({
    x: Math.min(Math.max(x, half), shot.width - half),
    y: Math.min(Math.max(y, half), shot.height - half),
  });
  const stays = (spot) => {
    const kept = inside(spot);
    return Math.abs(kept.x - spot.x) + Math.abs(kept.y - spot.y) < 1;
  };
  // on the seam between two controls is beside both; inside one is on it
  const within = (spot, f) => spot.x > f.x && spot.x < f.x + f.w && spot.y > f.y && spot.y < f.y + f.h;
  const holds = (outer, inner) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  const room = (spot) => Math.min(Infinity, ...taken.map((other) => Math.hypot(other.x - spot.x, other.y - spot.y)));
  return frames.map((frame) => {
    // a button, an icon, a field: a long bar or a rail is a panel, whatever its width
    const small = frame.w * frame.h < (apart * 3) ** 2;
    // just off a small control's corner, so the number touches it and no more
    const off = small ? apart * 0.2 : 0;
    // the controls this number must not sit on: neither the map behind everything nor
    // a frame round this one, which any spot near this control is inside of
    const others = frames.filter((other) => other !== frame && !big(other) && !holds(other, frame));
    const [x, y, w, h] = [frame.x - off, frame.y - off, frame.w + off * 2, frame.h + off * 2];
    const corners = { tl: { x, y }, tr: { x: x + w, y }, bl: { x, y: y + h }, br: { x: x + w, y: y + h } };
    const [left, right, top, bottom] = [{ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y }, { x: x + w / 2, y: y + h }];
    const around =
      h > w * 2
        ? [corners.tl, corners.tr, left, right, corners.bl, corners.br, top, bottom]
        : [corners.tl, corners.bl, corners.tr, corners.br, top, bottom, left, right];
    const free = (spot) => !others.some((other) => within(spot, other));
    // a panel's number pushed in from the picture's edge lands on its padding; a small
    // control's lands on the control
    const fits = (spot) => !small || stays(spot);
    const ordered = [
      ...around.filter((spot) => fits(spot) && free(spot)),
      ...around.filter((spot) => fits(spot) && !free(spot)),
      ...around.filter((spot) => !fits(spot)),
    ];
    const middle = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
    const tries = (big(frame) ? [middle, ...ordered] : [...ordered, middle]).map(inside);
    const spot = tries.find((one) => room(one) >= apart) ?? tries.reduce((best, one) => (room(one) > room(best) ? one : best));
    taken.push(spot);
    return { ...frame, pin: spot };
  });
}
