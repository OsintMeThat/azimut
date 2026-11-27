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
 *
 * A journey is drawn as a map of its steps (`journeyNodes`, `journeyEdges`). Walked
 * straight through, it is one row. One that forks places its steps (`at`), says where
 * each leads (`next`), asks its questions (`ask`, whose `choices` lead on) and marks what
 * may be skipped (`optional`). A step's frames read as what to press there, in order
 * (`does`), one of them on the screen it opens when it names its own `shot`; `then`
 * says where that lands and `tip` adds what helps. A journey that starts from a photo
 * or a video changes what differs for a video under the step's `video`.
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
      { title: 'A note on the side', text: 'The note in the top bar pins a case note on the right, open as you switch tools.' },
      { title: 'One scene at a time', text: 'While a scene is geolocated, a pill in the top bar follows it from tool to tool.' },
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
      { anchor: 'ext.pairing', title: 'Pairing', text: 'Press the extension’s button and paste this token where it asks. Rotating it unpairs every copy.' },
    ],
    tips: [
      { title: 'It reaches outside only when you ask', text: 'It can fill a composer on X or Bluesky and hand a picture to a reverse-search engine. Everything else goes to Azimut on this computer.' },
      { title: 'Updates follow the browser', text: 'Chromium updates its folder from Settings, Firefox updates the signed add-on, and Settings warns when two copies are loaded.' },
    ],
  },
  'extension-capture': {
    lead: 'On a map site, the Azimut button opens its panel over the map. Everything a capture is filed with comes from the page’s address.',
    shot: 'extension-capture',
    marks: [
      { anchor: 'ext.site', title: 'On the ground or not', text: 'Green once what the panel draws sits on the map. Hover it to read why not.' },
      { anchor: 'ext.case', title: 'Case', text: 'The case the captures, the points and the note go into.' },
      { anchor: 'ext.capture', title: 'Capture an area', text: 'Draw the rectangle to keep. It lands in Media with its address, date and coordinates.' },
    ],
    tips: [
      { title: 'Scale bar and north arrow', text: 'Ticked on the bar shown while you draw, drawn from the zoom, and remembered.' },
      { title: 'A bearing for the arrow', text: 'Most sites write none, so type the map’s bearing on that bar for the arrow to point right.' },
      { title: 'No position in the address', text: 'The panel then asks for Lat and Lon, or they can be added later in Azimut.' },
      { title: 'It reads the address, never the page', text: 'A capture’s coordinates are what the address bar says, so anyone with its saved link can check them.' },
      { title: 'Scenes to find', text: 'The panel lists the case’s scenes to geolocate, and the one being found gathers what you capture here.' },
      { title: 'Any other page opens the note', text: 'The Azimut button opens the case note beside it, and Save this page files the page as a link.' },
      { title: 'Keys', text: 'Alt+Shift+A opens Azimut on the page, Alt+Shift+N the note, and Alt+Shift+S captures the map into it.' },
    ],
  },
  'extension-tools': {
    lead: 'Azimut’s tools drawn over another site’s map. Nothing goes into the case until you ask.',
    shot: 'extension-tools',
    marks: [
      { anchor: 'ext.measure', title: 'Measure', text: 'A path’s length or an area’s size, to the map’s own scale.' },
      { anchor: 'ext.points', title: 'Points', text: 'The case’s places and media where they stand, new points to file, and leads while a scene is geolocated.' },
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
      { anchor: 'settings.nav', title: 'Sections', text: 'General, Publishing, Website, Imagery, Templates, Icons, the extension, Storage and System. A dot means something to install or update.' },
      { anchor: 'settings.coordinates', title: 'Coordinates', text: 'How every tool writes a point, in decimal, in degrees or as MGRS. The case keeps decimal.' },
      { anchor: 'settings.units', title: 'Measurements', text: 'Metric or imperial, for the rulers and the readouts.' },
      { anchor: 'settings.home-view', title: 'Satellite home view', text: 'Where Satellite opens when the case gives it no place of its own.' },
      { anchor: 'settings.map-tabs', title: 'Map tabs', text: 'Satellite, Compare, Detect and Horizon look at the same place, or each at its own.' },
      { anchor: 'settings.quality-3d', title: '3D views', text: 'Full, Balanced or Light: how much the 3D globe and Horizon draw on this computer. Lighter for a slow one.' },
      { anchor: 'settings.reverse', title: 'Reverse search', text: 'Whether the extension hands the picture to the engine it opens.' },
    ],
    tips: [
      { title: 'Hover to know', text: 'Each setting says what it does when the pointer rests on it.' },
      { title: 'Your colour', text: 'Appearance, at the top, picks the accent of the interface among eleven.' },
      { title: 'The capture extension', text: 'Its section installs and pairs it, and the Capture extension page of this guide shows it at work.' },
    ],
  },
  'settings-publishing': {
    lead: 'What a new post starts with, and how your notes and proofs are signed.',
    shot: 'settings-publishing',
    marks: [
      { anchor: 'settings.report-defaults', title: 'Post', text: 'The mention on X and on Bluesky, the site a new thread starts with, and whether the extension may fill the composer.' },
      { anchor: 'settings.signature', title: 'In reports', text: 'Your logo, framed with Edit, and your name, role, organisation and website, which a note prints where it says so.' },
      { anchor: 'settings.note-styles', title: 'Styles', text: 'How a new note looks, and the styles you made.' },
    ],
    tips: [
      { title: 'Posting stays yours', text: 'Even with the extension, the composer is filled and Post is left to you.' },
      { title: 'Your handle on proofs', text: 'On proofs, at the foot of the tab, is the account a proof names when it asks for one.' },
    ],
  },
  'settings-website': {
    lead: 'The site Azimut makes of the notes you publish, hosted free on GitHub Pages. Everything here is optional.',
    shot: 'settings-website',
    marks: [
      { anchor: 'settings.website', title: 'The site at a glance', text: 'Its name, its address and its last change, with Open the site and Update the site.' },
      { anchor: 'settings.website-hub', title: 'Panels', text: 'Overview says what is left to set up. Then its name and logo, hosting, articles, categories, readers and upkeep.' },
    ],
    tips: [
      { title: 'From a note', text: 'Export, Web folder, then Publish to GitHub Pages puts the note on the site, as an article, a page or unlisted.' },
      { title: 'GitHub only when you press', text: 'Nothing here reaches GitHub until a button that needs it is pressed.' },
      { title: 'WordPress stands apart', text: 'Its own panel sends a note as a draft to a WordPress site.' },
    ],
  },
  'settings-imagery': {
    lead: 'The imagery the maps can draw: free providers built in, keyed ones with your own keys.',
    shot: 'settings-imagery',
    marks: [
      { anchor: 'settings.providers', title: 'Providers', text: 'Each keyed provider says what it costs, what you used this month and how to get its key.' },
      { anchor: 'settings.eco', title: 'Eco mode', text: 'Zoomed out, a billed map draws free imagery instead, up to the zoom you set.' },
    ],
    tips: [
      { title: 'Most of the app needs no key', text: 'Esri, its Wayback archive, Sentinel-2 cloudless, OpenStreetMap and OpenTopoMap work without one.' },
      { title: 'Free is not free of terms', text: 'Free imagery says what each provider lets you publish, Esri’s limits included.' },
      { title: 'Copernicus is free', text: 'Sentinel-2 and radar need a free Copernicus account, and the tools that use them explain the setup field by field.' },
      { title: 'Layers of your own', text: 'The Sentinel Hub card keeps the Copernicus layers you add, a radar one included.' },
    ],
  },
  'settings-templates': {
    lead: 'Starting points shared by every case: how a proof looks, how a thread runs, how a note, a figure or a plate is laid out.',
    shot: 'settings-templates',
    marks: [
      { anchor: 'settings.proof-templates', title: 'Geo Proof templates', text: 'House styles for proofs, each started from a ready one and shown on a sample. New proof starts with the one marked as the default.' },
      { anchor: 'settings.report-templates', title: 'Post templates', text: 'The structures a post can follow, by kind of post, each kind with its default, and words that fill themselves.' },
      { anchor: 'settings.note-templates', title: 'Notebook templates', text: 'A note to start others from, with how it prints.' },
    ],
    tips: [
      { title: 'Further down', text: 'Figure templates keep a chart’s, an infographic’s or a map’s look without its data, and Map plate templates a plate’s layout without its ground.' },
      { title: 'From a plate', text: 'Keep as template, in a plate, files its layout here.' },
    ],
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
      { anchor: 'settings.workspace', title: 'Workspace folder', text: 'Where every case is kept. Pick another folder, then use it or move every case there.' },
      { anchor: 'settings.export-folders', title: 'Export folders', text: 'Where each kind of export is written, the case’s exports folder until you choose.' },
      { anchor: 'settings.backup', title: 'Settings backup', text: 'Settings, keys, templates, icons, your logo and signature in one file. It holds your keys, so keep it private.' },
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
      { anchor: 'media.link', title: 'Paste a link', text: 'A post on X or Telegram comes down with its address kept as the source.' },
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
          marks: [{ anchor: 'media.open-in-menu', title: 'Where it can go', text: 'Geo Proof takes pictures only. Mark to geolocate adds the file to the To-do.' }],
        },
      },
    ],
    tips: [
      { title: 'A login only when needed', text: 'A download is first tried without cookies, and only a link that answers "This link needs a login" is retried with your browser.' },
      { title: 'State the origin once', text: 'A batch dropped without an origin is offered one for the whole import, and Details corrects a single file later.' },
      { title: 'Paste a screenshot', text: 'Ctrl+V files the picture on the clipboard, with a title and an origin if you have them.' },
      { title: 'Working files stay apart', text: 'Frames and collages made in the case are held back by a switch, so the grid shows what was collected.' },
      { title: 'What nothing uses', text: 'Unused lists the files nothing in the case uses, and every delete says first what it touches.' },
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
          marks: [{ anchor: 'files.menu', title: 'What it can do', text: 'Open it, send it to a tool, mark it to geolocate, rename or move it, or show it on the map or in the Timeline.' }],
        },
      },
      { anchor: 'files.work', title: 'Work here', text: 'New files and saved work land in this folder until you press it again.' },
      { anchor: 'files.new-folder', title: 'New folder', text: 'Name it and press Add.' },
    ],
    tips: [
      { title: 'Search reads inside notes', text: 'The sidebar matches labels, and this search also reads what notes say.' },
      { title: 'Nothing is lost at once', text: 'A delete says first what it touches, and the item waits in the case trash with its links until you empty it.' },
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
      { title: 'From anywhere', text: 'Open in… on a Media card or a file sends the picture here.' },
      { title: 'A part of a frame', text: 'In Inspect, R searches a zone of the picture without leaving it.' },
      { title: 'A video gives a frame', text: 'Pick the moment on the video, or step to it frame by frame in Inspect.' },
      { title: 'Nothing found', text: 'Crop to the rarest detail, a sign or a crane, and search again.' },
    ],
  },

  // -- Examine ----------------------------------------------------------------
  inspect: {
    lead: 'One image or one video, read closely: frames, adjustments, metadata and error levels.',
    shot: 'inspect',
    marks: [
      { anchor: 'inspect.player', title: 'The player', text: '← and → step one frame, J and L change the speed, M marks a moment, R searches a part of the picture.' },
      { anchor: 'inspect.loop', title: 'A and B', text: 'Bound a loop between two moments, to watch a passage again.' },
      { anchor: 'inspect.capture', title: 'Capture frame', text: 'Keeps the frame on screen with this video (C).' },
      {
        anchor: 'inspect.scene',
        title: 'Mark to geolocate',
        text: 'Keeps the whole video, a passage dragged across the bar, or the instant on screen (S) as a scene to find.',
        opens: {
          shot: 'inspect-scenes',
          lead: 'Scenes lists each place to find in the video, in the colour the bar draws it in.',
          marks: [
            { anchor: 'inspect.scenes', title: 'A scene', text: 'Geolocate opens the map with the video beside it. Make the proof lays out what it gathered.' },
            { anchor: 'geo.pill', title: 'Geolocating', text: 'Follows the scene from tool to tool. Its counts list the captures, frames and leads it gathered.' },
          ],
        },
      },
      {
        anchor: 'inspect.strip',
        title: 'The strip',
        text: 'The video first, then the frames cut from it, dotted in the colour of the scene they fall in. A frame can be adjusted, cropped or analysed.',
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
        title: 'Scenes, Adjust, Moments, Info',
        text: 'The places to find in it, how it looks, where things happen, and what the file says about itself.',
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
      { title: 'A scene waits for its proof', text: 'It stays in the To-do until a proof shows where it is, or until you abandon it.' },
      { title: 'A picture too', text: 'A photo has a Scenes tab of its own, where Mark to geolocate keeps the whole picture.' },
      { title: 'The work stays with the file', text: 'Frames and edits are kept as you make them, and opening the file again picks up where you left off.' },
      { title: 'Analyze a frame', text: 'Error levels show where a JPEG changed most. Reverse image search sends a zone of it to the engines, and Match in Horizon lays it over the terrain.' },
      { title: 'The original is never touched', text: 'An adjusted frame or video is saved as new media beside it.' },
      { title: 'Everything the file says', text: 'All metadata unfolds every field of the file, its GPS and its software included.' },
      { title: 'Keys', text: 'Space plays, C captures, O held shows the frame without its settings, and the keyboard button lists the rest.' },
    ],
  },
  collage: {
    lead: 'Frames and images from any number of files, laid out on one canvas and saved as a picture.',
    shot: 'collage',
    marks: [
      { anchor: 'collage.canvas', title: 'The canvas', text: 'Scroll to zoom and drag to pan. Click a piece to move it, or Ctrl+A for all.' },
      { anchor: 'collage.add', title: 'Add pieces', text: 'A video plays in a rail under the canvas, and the case’s images go on in one press.' },
      { anchor: 'collage.arrange', title: 'Auto-stitch', text: 'Stitches overlapping pieces into one picture, and its arrow picks planar, cylindrical or spherical.' },
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
      { anchor: 'collage.save', title: 'Save to case', text: 'One press files the collage as media at full resolution, and its arrow sets the name, folder and note.' },
    ],
    tips: [
      { title: 'A panorama from a pan', text: 'Set A and B around the pan in the video rail, and Panorama picks the frames and stitches them.' },
      { title: 'A document of its own', text: 'Each collage keeps its layout, so it reopens from the Collage tab and edits.' },
      { title: 'The seams hold', text: 'Straighten bends the whole collage without opening its seams.' },
      { title: 'Cut the saved picture', text: 'Cut frames what the export keeps, and Trim edges cuts to the largest frame the pieces fill.' },
      { title: 'A panorama has a place', text: 'Mark to geolocate in its panel keeps the stretch of video its pieces span as a scene.' },
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
        text: 'Measure, Align, a search grid, sun and moon, and windows of case pictures over the map.',
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
            { anchor: 'map.measure', title: 'A line of two points', text: 'Becomes rings round A, the cone a camera at A saw, or the ground in sight.' },
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
      { anchor: 'sat.place', title: 'Save place', text: 'Click to drop a pin and name it. Its arrow offers Save zone, to draw an area. While a scene is geolocated it reads Drop a lead.' },
      {
        anchor: 'sat.capture',
        title: 'Capture',
        text: 'Files the view as evidence, with its provider, coordinates, zoom and bearing.',
        opens: {
          shot: 'satellite-capture',
          lead: 'The arrow sets how a capture is taken: centred or drawn, its size, ratio and resolution.',
          marks: [{ anchor: 'sat.capture-menu', title: 'Capture settings', text: 'The main button starts on Capture an area and repeats the last mode used.' }],
        },
      },
    ],
    tips: [
      { title: 'Layers cost nothing until they are on', text: 'Roads, railways, power lines, sea marks, GPS traces, fires and night lights are fetched only once switched on.' },
      { title: 'Somebody else’s map over yours', text: 'Add a layer opens a KML, KMZ, GeoJSON or GPX file, a public My Maps or a GeoConfirmed area, and keeps it with the case.' },
      { title: 'A map of your own', text: 'New layer under My layers puts drawing tools on the map: pick, drag, draw, merge.' },
      { title: 'Your places and media are layers', text: 'Places and Media switch on and off like the others, and Names writes each name under its pin.' },
      { title: 'Your footage on the map', text: 'Photos and videos stand where a relation, their GPS or a proof puts them. Press a mark to play what was filed there.' },
      { title: 'Leads', text: 'Numbered pins in the scene’s colour, kept with it and erased once it is proved. Click one and press Delete to remove it.' },
      { title: 'The map tabs look at one place', text: 'Satellite, Compare and Detect open where you last looked, and Settings, General turns that off.' },
      { title: 'A place card', text: 'Move place picks the pin up, a colour sets it apart, and Trace footprint draws what it really covers.' },
      { title: 'Captures with their layers', text: 'Tick Layers on the map in the capture settings to keep the map as drawn, each source credited.' },
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
      { title: 'A routine over time', text: 'Dashboard reads every pass together in a window: counts, and spots that stay or come and go.' },
      { title: 'Passes it missed', text: 'Catch up lists them and reads the ones you tick, oldest first.' },
      { title: 'Findings out', text: 'Its export menu puts the dashboard in a note as charts, downloads a CSV, or keeps what you kept as a SAT layer.' },
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
            { anchor: 'horizon.overlay', title: 'Photo and terrain', text: 'The photo, the terrain, a blink between them, or Side by side, the photo above the terrain, locked together or each on its own.' },
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
      { title: 'Reference windows here too', text: 'Add reference holds a picture of the case over the view, as on the map.' },
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
      { title: 'Read a shadow', text: 'In Satellite, Sun and moon reads the hour from a shadow’s direction.' },
    ],
  },

  // -- Compose ----------------------------------------------------------------
  proof: {
    lead: 'Puts pictures side by side, marks what agrees, and files the point it proves.',
    shot: 'proof',
    marks: [
      { anchor: 'proof.tools', title: 'Marks', text: 'Boxes, ellipses, arrows, lines and curves, text, callouts, icons, numbered markers, view cones, zoom insets and blur boxes. The same colour means the same feature.' },
      { anchor: 'proof.layout', title: 'Layout', text: 'Panels in a grid or free, and a preview of the crop X makes at 16:9 or 4:5.' },
      { anchor: 'proof.canvas', title: 'The page', text: 'A mark dragged into the margin stays put, and an arrow between two pictures follows both.' },
      { anchor: 'proof.coords', title: 'The point', text: 'Filled from a satellite panel or typed. Each place can be named, and one can be the camera.' },
      { anchor: 'proof.meta', title: 'Source, description, date', text: 'Several sources, a description, and a date read on a clock, at the point or in UTC.' },
      { anchor: 'proof.tabs', title: 'Tabs', text: 'Proof holds the facts, Layout the pictures and their marks, Style the look. A proof on a video adds Scene.' },
      { anchor: 'proof.save', title: 'Save proof', text: 'Saves the PNG with its spec, so it reopens and edits.' },
      { anchor: 'proof.to-post', title: 'To Post', text: 'Carries the proof into Post, its thread written from it.' },
    ],
    tips: [
      { title: 'A blur hides for real', text: 'A blur box redraws the picture under it, so what is hidden is hidden in the exported file.' },
      { title: 'Numbers count per picture', text: 'Each picture counts from 1 in each colour, so one number marks one point on two pictures.' },
      { title: 'Paste a screenshot', text: 'Ctrl+V lays a picture over the proof, and it stays in this proof only.' },
      { title: 'Made from the scene', text: 'Make the proof, in the Geolocating pill, lays out the frames and the captures the scene gathered.' },
      { title: 'The point becomes a place', text: 'Saving files its coordinates as a place on the map, proves the scene and erases its leads.' },
      { title: 'A house style', text: 'A template made in Settings, Templates gives every proof the same look.' },
      { title: 'Right-click the page', text: 'Brings forward, sends back, duplicates or deletes the mark under the cursor.' },
      { title: 'A proof from a video', text: 'Its Scene tab plays the passages the place shows in, and Add this frame makes the frame on screen a panel.' },
      { title: 'One slide per scene', text: 'Under a video’s proof, + New scene starts the next place, and Post as a thread sends them together.' },
      { title: 'Back to the proofs', text: '‹ Proofs lists the case’s proofs, where New proof and Open proof start the next.' },
    ],
  },
  post: {
    lead: 'Writes the sourced thread that publishes a finding. Pressing Post is left to you.',
    shot: 'post',
    marks: [
      {
        anchor: 'post.home',
        title: 'Posts',
        text: 'Back to the case’s posts, where the next one starts.',
        opens: {
          shot: 'post-home',
          lead: 'The case’s posts: in progress, the proofs waiting for one, and what went out.',
          marks: [{ anchor: 'post.new', title: 'New post', text: 'A geolocation, a video thread, a map plate, a comparison or your own words.' }],
        },
      },
      { anchor: 'post.ingredients', title: 'What goes in', text: 'Where to publish, the thread style, the description, the point, the place, a mention and the source.' },
      { anchor: 'post.first', title: 'The geolocation post', text: 'Written from those fields, counted against the site’s limit, with the proof attached.' },
      { anchor: 'post.more', title: 'More posts', text: 'Add the media post and context posts, or copy the whole thread.' },
      { anchor: 'post.report', title: 'Add to notes', text: 'Writes the post into a case note, with its proof and media.' },
      { anchor: 'post.publish', title: 'Publish', text: 'Copies the posts and opens the site. With the extension it fills the composer box by box, and pressing Post stays yours.' },
    ],
    tips: [
      { title: 'It saves itself', text: 'Once it holds something, a post is saved as you write. Its name is the draft’s.' },
      { title: 'One press from a proof', text: 'On the Posts home, a proof with no post yet writes its geolocation in one press.' },
      { title: 'Mark as posted', text: 'Once it is out, say so beside Saved, with its link if you have it. The link dates the post, and its proof keeps it.' },
      { title: 'A video thread', text: 'The proofs of one video in one thread, recap, video or proof first, or all in one.' },
      { title: 'Reply under the source', text: 'A geolocation whose source is an X or Bluesky post can go out as a reply under it, without the link to the source.' },
      { title: 'Thread styles', text: 'Settings, Templates holds the structures a post can follow, for each kind of post.' },
      { title: 'Counted for the site', text: 'Each post counts its characters against the limit of the site picked.' },
      { title: 'See it before it goes out', text: 'Preview, over the posts, shows the thread as X or Bluesky will, with its pictures and its counts.' },
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
          lead: 'The case’s own work first (comparisons, Geo Proofs, footage), then maps, legend, scale, text and pictures, searchable.',
          marks: [{ anchor: 'plate.add-groups', title: 'The catalogue', text: 'Search it, or browse it by kind.' }],
        },
      },
      { anchor: 'plate.list', title: 'On the page', text: 'Every element in stacking order. Pick one to set it.' },
      {
        anchor: 'plate.layers',
        title: 'Layers',
        text: 'Where the maps get what they draw: the case’s layers, ticked on and off.',
        opens: {
          shot: 'plate-layers',
          lead: 'Each map, its ground and the day its picture was taken, and the case’s layers it draws.',
          marks: [],
        },
      },
      { anchor: 'plate.slides', title: 'Slides', text: '+ Slide adds a picture played after the page. Slides make it a video.' },
      { anchor: 'plate.page', title: 'The page', text: 'A drag on a map moves its frame. A double click goes into it to move its ground.' },
      { anchor: 'plate.inspector', title: 'Inspector', text: 'Paper, fonts and colours, or the settings of the element picked.' },
      { anchor: 'plate.looks', title: 'Looks', text: 'A whole look in one press: Press, Night, Newsroom, Humanitarian, Tactical and more.' },
      {
        anchor: 'plate.export',
        title: 'Export',
        text: 'A PNG, a PDF, or a video of the plate’s days. To Post carries it into Post.',
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
      { title: 'A new plate starts from the Map', text: 'A ready plate opens at once; New plate sorts the layouts by what the plate shows, then picks its layers, paper and look.' },
      { title: 'Days and slides', text: 'A dated layer is drawn on the plate’s day; the video plays its days, each followed by its slides.' },
      { title: 'From the case', text: 'Add › From the case lays a comparison, a Geo Proof or placed footage on the page, each pointing at its place.' },
      { title: 'Templates', text: 'Keep as template saves the layout without its data, to start other plates from.' },
      { title: 'Texts that fill themselves', text: '{date}, {case}, {title}, {scale} and {imagery} are written in when the page is drawn.' },
      { title: 'The whole screen', text: 'F gives the page the whole window, and F or Escape gives it back.' },
      { title: 'A day left out of the video', text: 'Its ⋯ menu hides it from the play and every export, and it stays on the bar to edit.' },
      { title: 'In relief', text: 'Show the map in 3D lays a map on the terrain, with its ridge lines.' },
    ],
  },
  notebook: {
    lead: 'The case’s notes, written in place and citing what the case holds.',
    shot: 'notebook',
    marks: [
      { anchor: 'notebook.new', title: 'New note', text: 'What to start from, the case’s geolocations included, and a folder. A title is optional.' },
      { anchor: 'notebook.search', title: 'Find words', text: 'Looks inside every note, and opens the one you pick at the line.' },
      { anchor: 'notebook.case', title: 'Case notes', text: 'The case’s own page, always there. A log of the work fits it.' },
      {
        anchor: 'notebook.cards',
        title: 'One card per note',
        text: 'Its first words, what is left to do and what it cites. Tick cards to export them or make a report of them.',
        opens: {
          shot: 'notebook-note',
          lead: 'Headings, chips and pictures drawn as you type, with no Markdown on any line; Ctrl+Shift+M shows it.',
          marks: [
            { anchor: 'notebook.toolbar', title: 'Formatting', text: 'Headings, lists, tasks and callouts, or the same from /.' },
            { anchor: 'notebook.cite', title: 'Cite', text: '@ and a few letters put in a place, a person or a file as a chip.' },
            { anchor: 'notebook.write', title: 'The page', text: 'Saved as you type. A chip opens what it names, ⌖ shows coordinates on the map.' },
            { anchor: 'notebook.dock', title: 'Pin to the side', text: 'The note stays open on the right as you work on the Map or a video.' },
            { anchor: 'notebook.look', title: 'Look', text: 'How the note prints: its style, text, page, cover, header and footer.' },
            { anchor: 'notebook.pdf', title: 'Export', text: 'A PDF, an HTML page that reads offline, a web folder or a WordPress draft. Page shows the first two as you type.' },
          ],
        },
      },
      { anchor: 'notebook.ready', title: 'Start from', text: 'A geolocation report, a brief, a fact-check, a log or your own templates, each shown by its first page.' },
    ],
    tips: [
      { title: 'Cited in Details', text: 'A place a note cites lists the note and the sentence in its Details, and in the Graph.' },
      { title: 'Tasks', text: 'A to-do written in a note shows in the case’s To-do, where it can be ticked.' },
      { title: 'Without Markdown', text: 'Select words for a bar that sets bold, a heading, a link or Internal. / or the + of an empty line opens everything else.' },
      { title: 'Callouts', text: '/confirmed, /unverified, /lead: a coloured block, in the PDF too.' },
      { title: 'Cite in note', text: 'Details puts anything it shows into the note being written.' },
      { title: 'Columns, charts, diagrams', text: '/ lays two things side by side, or draws a chart, a table, steps or a diagram from a form.' },
      { title: 'Reports', text: 'A report includes other notes as chapters: tick them on the home, or type / and pick Include a note.' },
      { title: 'On your site', text: 'Export, Web folder, then Publish to GitHub Pages puts the note online, once Settings, Website is set up.' },
      { title: 'Remote images say so', text: 'An image from the web contacts its host each time the note opens, and the note warns you.' },
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

/** Said on every journey's welcome, and by its title: a journey is one example, not all there is. */
export const JOURNEY_CAVEAT =
  'One example, walked one way, to show how the tools fit together. A real case rarely runs this cleanly: try every branch and every tool yourself, and press everywhere.';

/** Goals walked across the tools, each step on the picture of the tool it happens in. */
export const JOURNEYS = [
  {
    id: 'geolocate',
    title: 'Geolocate a photo or a video',
    lead: 'From a picture with no caption to a published proof of where it was taken.',
    // where the open case stands is read off its scenes (`lib/journeyHere.js`)
    reads: 'scene',
    practice: true,
    steps: [
      {
        id: 'photo',
        at: [0, -1],
        tool: 'media',
        icon: 'image',
        label: 'A photo',
        next: ['where'],
        shot: 'media-rail',
        text: 'Practising? Press Practise on a real photo at the top of this guide, and the photo lands in Media.',
        marks: [
          { anchor: 'rail.collect', title: 'Sources' },
          { anchor: 'media.link', title: 'Paste a link', typed: true },
          { anchor: 'media.viewer', shot: 'media-viewer', title: 'The photo', look: true },
        ],
        does: {
          'rail.collect': 'Press Sources on the left rail, then the Media tab.',
          'media.link': 'Paste the post’s link and press Download, or use Import for a file on disk. Practising? It is already here.',
          'media.viewer': 'Click the photo to open it. Note the name on the stern, YM SUCCESS, and the green suspension bridge over a container port. A web search for that bridge gives the Vincent Thomas Bridge, Los Angeles.',
        },
        then: 'Media, once Escape closes the photo.',
      },
      {
        id: 'video',
        at: [0, 1],
        tool: 'media',
        icon: 'video',
        label: 'A video',
        kind: 'video',
        next: ['where'],
        shot: 'media-rail',
        text: 'Bring the video into the case and watch it through. Practise on a real photo only brings the photo.',
        marks: [
          { anchor: 'rail.collect', title: 'Sources' },
          { anchor: 'media.link', title: 'Paste a link', typed: true },
          { anchor: 'media.viewer', shot: 'media-viewer-video', title: 'The video', look: true },
        ],
        does: {
          'rail.collect': 'Press Sources on the left rail, then the Media tab.',
          'media.link': 'Paste the post’s link and press Download. The video is filed with its source. For a file on disk, use Import.',
          'media.viewer': 'Click the video to play it. The demo clip leaves the same port as the practice photo, so the map search will use the port’s name. Note what you can match later: two cranes on the left bank, a tall building far ahead on the right, open sea at the end of the channel.',
        },
        then: 'Media, once Escape closes the video.',
      },
      {
        id: 'where',
        at: [1, 0],
        tool: 'media',
        label: 'Where?',
        ask: true,
        shot: 'media-rail',
        text: 'Do you know where it is?',
        choices: [
          { to: 'reverse', label: 'Not yet', text: 'Search for older copies. A hit may name the place.' },
          { to: 'mark', label: 'I have an idea of the area', text: 'Mark it to geolocate, then go there on the map.' },
        ],
      },
      {
        id: 'reverse',
        at: [1.5, 1],
        tool: 'reverse',
        label: 'Reverse search',
        optional: true,
        next: ['mark'],
        shot: 'reverse-photo',
        text: 'Look for earlier copies. The first upload often carries a caption or a place name.',
        marks: [
          { anchor: 'media.open-in', shot: 'media-rail', tool: 'media', place: 'Media', title: 'The arrow (Open in…)' },
          { anchor: 'media.open-reverse', shot: 'media-rail-menu', tool: 'media', place: 'Media', title: 'Reverse Search' },
          {
            anchor: 'reverse.engines',
            title: 'Google Lens, Yandex, Bing, TinEye',
            tip: 'No hit? Crop to the rarest detail, like a sign or a crane, and search again. Read the account and the replies too; they often name the place.',
          },
          { anchor: 'tab.media', title: 'The Media tab' },
        ],
        does: {
          'media.open-in': 'Press the arrow on the photo’s card.',
          'media.open-reverse': 'Press Reverse Search.',
          'reverse.engines': 'Press an engine. Google Lens takes the picture with Ctrl+V in its tab; for the others, drag in the file Azimut saved. If a hit names a place, note it.',
          'tab.media': 'Press the Media tab to go back.',
        },
        then: 'Media, the photo’s card in it.',
        video: {
          shot: 'reverse-video',
          marks: [
            { anchor: 'media.open-in-video', shot: 'media-rail', tool: 'media', place: 'Media', title: 'The arrow (Open in…)' },
            { anchor: 'media.open-reverse', shot: 'media-rail-video-menu', tool: 'media', place: 'Media', title: 'Reverse Search' },
            {
              anchor: 'reverse.engines',
              title: 'Google Lens, Yandex, Bing, TinEye',
              tip: 'No hit? Try another frame, or crop to the rarest detail.',
            },
            { anchor: 'tab.media', title: 'The Media tab' },
          ],
          does: {
            'media.open-in-video': 'Press the arrow on the video’s card.',
            'media.open-reverse': 'Press Reverse Search.',
            'reverse.engines': 'Scrub to the frame with the most detail, then press an engine. Google Lens takes the frame with Ctrl+V; for the others, drag in the file Azimut saved.',
            'tab.media': 'Press the Media tab to go back.',
          },
          then: 'Media, the video’s card in it.',
        },
      },
      {
        id: 'mark',
        at: [2, 0],
        tool: 'media',
        icon: 'crosshair',
        label: 'Mark it',
        shot: 'media-rail',
        text: 'A scene is one place to find, from a photo or a moment of a video.',
        marks: [
          { anchor: 'media.open-in', title: 'The arrow (Open in…)' },
          { anchor: 'media.mark', shot: 'media-rail-menu', title: 'Mark to geolocate' },
        ],
        does: {
          'media.open-in': 'Press the arrow on the photo’s card.',
          'media.mark': 'Press Mark to geolocate. The photo goes into the To-do as a scene.',
        },
        then: 'Media, a Marked to geolocate notice at the bottom.',
        video: {
          tool: 'inspect',
          shot: 'inspect-video',
          text: 'The clip stays in one place, so the full video is one scene.',
          marks: [
            // the first two presses happen in Media, where Show me takes them
            { anchor: 'media.open-in-video', shot: 'media-rail', tool: 'media', place: 'Media', title: 'The arrow (Open in…)' },
            { anchor: 'media.open-inspect', shot: 'media-rail-video-menu', tool: 'media', place: 'Media', title: 'Inspect' },
            {
              anchor: 'inspect.whole',
              title: 'Whole video',
              tip: 'Several places in one video? Passage marks the stretch you drag on the bar, and Instant or S marks the frame on screen.',
            },
            { anchor: 'inspect.capture', shot: 'inspect-video-scene', title: 'Capture frame' },
          ],
          does: {
            'media.open-in-video': 'Press the arrow on the video’s card.',
            'media.open-inspect': 'Press Inspect. The proof needs a still frame, and Inspect is where you capture it.',
            'inspect.whole': 'Press Whole video, under Mark to geolocate.',
            'inspect.capture': 'Play to where the cranes show best, then press Capture frame or C. The proof is built from the frames you capture here.',
          },
          tip: null,
          then: 'Inspect, your scene and its frame in the Scenes tab.',
        },
      },
      {
        id: 'geolocate',
        at: [3, 0],
        tool: 'media',
        icon: 'check',
        label: 'Geolocate',
        shot: 'todo-geolocate',
        // the To-do is a view of the case panel, which Show me opens on it
        sidebar: 'todo',
        place: 'To-do',
        text: 'The To-do lists the scenes still to find.',
        marks: [
          { anchor: 'toast.action', shot: 'media-marked', place: 'Media', title: 'Show' },
          { anchor: 'todo.go', title: 'Geolocate' },
          { anchor: 'geo.pill', shot: 'satellite-landed', tool: 'satellite', place: 'Satellite', title: 'The pill', look: true },
        ],
        does: {
          'toast.action': 'Press Show on the notice. The case panel opens on the To-do.',
          'todo.go': 'Press Geolocate on your photo’s Whole picture scene.',
          'geo.pill': 'The pill at the top follows your scene from tool to tool. The map icon counts captures, the picture icon your photo, and a pin counts leads once you drop one. The other icons open Inspect, this map and Horizon.',
        },
        tip: 'Missed the notice? The case panel button at the top right shows a dot. Press it, then the To-do tab.',
        then: 'Satellite, your photo beside the map.',
        video: {
          tool: 'inspect',
          shot: 'video-scene',
          sidebar: null,
          place: null,
          text: 'From the Scenes tab, Geolocate takes your scene to the map.',
          marks: [
            { anchor: 'scene.geolocate', title: 'Geolocate' },
            { anchor: 'geo.pill', shot: 'satellite-video', tool: 'satellite', place: 'Satellite', title: 'The pill', look: true },
          ],
          does: {
            'scene.geolocate': 'Press Geolocate on your scene.',
            'geo.pill': 'The pill at the top follows your scene from tool to tool. The map icon counts captures, the video icon your frames, and a pin counts leads once you drop one. The other icons open Inspect, this map and Horizon.',
          },
          tip: null,
          then: 'Satellite, your video beside the map.',
        },
      },
      {
        id: 'satellite',
        at: [4, 0],
        tool: 'satellite',
        label: 'Search the map',
        shot: 'satellite-landed',
        text: 'Your photo stays beside the map while you search.',
        marks: [
          { anchor: 'sat.search', title: 'Search', typed: true },
          { anchor: 'sat.answer', shot: 'satellite-search', title: 'Its answer' },
          { anchor: 'map.ground', shot: 'satellite-port', title: 'The channel', look: true },
        ],
        does: {
          'sat.search': 'Type a place in the area you suspect, such as Vincent Thomas Bridge for this photo, or drag and zoom the map there.',
          'sat.answer': 'Press the first answer under Places.',
          'map.ground': 'Zoom in until the bridge and cranes are clear. Match on what never moves, such as the bridge towers, the shoreline and the crane rows. Ships and containers move.',
        },
        then: 'Satellite, the bridge and the terminal in view.',
        video: {
          shot: 'satellite-video',
          text: 'Your video stays beside the map while you search.',
          marks: [
            { anchor: 'sat.search', title: 'Search', typed: true },
            { anchor: 'sat.answer', shot: 'satellite-video-search', title: 'Its answer' },
            { anchor: 'map.ground', shot: 'satellite-video-port', title: 'The channel', look: true },
          ],
          does: {
            'sat.search': 'Type a place in the area you suspect, such as Port of Los Angeles, or drag and zoom the map there.',
            'sat.answer': 'Press its answer under Places.',
            'map.ground': 'Follow the Main Channel south of the bridge toward the sea. Match on what never moves: the two cranes on a pier’s tip on the left bank, the tall building at the end of the west pier, the open sea beyond. Ships move.',
          },
          then: 'Satellite, the channel in view.',
        },
      },
      {
        id: 'sure',
        at: [5, 0],
        tool: 'satellite',
        label: 'Does it match?',
        ask: true,
        shot: 'satellite-port',
        text: 'Does the place match your picture?',
        choices: [
          { to: 'spot', label: 'Yes, it matches', text: 'The fixed features line up. Now find where the camera stood.' },
          { to: 'compare', label: 'It looked different', text: 'Buildings came or went. Compare finds when it looked like your picture.' },
          { to: 'horizon', label: 'Only a skyline to go on', text: 'Nothing built to match. Horizon lays your picture over the terrain.' },
          { to: 'satellite', label: 'No, wrong place', text: 'Search again under another name.' },
        ],
        video: { shot: 'satellite-video-port' },
      },
      {
        id: 'horizon',
        at: [5.5, -1],
        tool: 'horizon',
        label: 'Skyline',
        optional: true,
        next: ['how'],
        shot: 'horizon-scene',
        text: 'A side example away from the port: Half Dome, Yosemite, in 1901. With nothing built to match, only the skyline is left, and Horizon’s Overlay tests it against the terrain.',
        marks: [
          { anchor: 'media.viewer', shot: 'media-viewer-halfdome', tool: 'media', place: 'Media', title: 'The photo', look: true },
          { anchor: 'map.look', shot: 'glacier-menu', tool: 'satellite', place: 'Satellite', title: 'Look from here' },
          { anchor: 'horizon.lay', shot: 'horizon-view', title: 'Overlay' },
          { anchor: 'horizon.photos', shot: 'horizon-pick', title: 'The photo, in Photos' },
          { anchor: 'horizon.overlay', title: 'Photo and terrain' },
          { anchor: 'tab.satellite', title: 'The Satellite tab' },
        ],
        does: {
          'media.viewer': 'A granite dome over a valley, ridges behind it. It is in the demo case.',
          'map.look': 'Right-click where the camera may have stood, then press Look from here. For this photo, try Glacier Point across the valley.',
          'horizon.lay': 'Press Overlay.',
          'horizon.photos': 'Press Photos above the list, then the photo.',
          'horizon.overlay': 'Slide between photo and terrain. If the ridges line up, you are standing where it was taken. If not, use Move the viewpoint and slide again.',
          'tab.satellite': 'On your own case, press the Satellite tab and drop a lead where the ridges lined up. The Camera step uses it.',
        },
        then: 'Satellite, your lead on the map.',
      },
      {
        id: 'compare',
        at: [5.5, 1],
        tool: 'compare',
        label: 'Date',
        optional: true,
        next: ['spot'],
        shot: 'compare-scene',
        text: 'Compare shows the spot at two dates. Use it to bracket when it looked like your picture.',
        marks: [
          { anchor: 'tab.compare', shot: 'satellite-port', tool: 'satellite', place: 'Satellite', title: 'The Compare tab' },
          {
            anchor: 'imagery.wayback',
            shot: 'compare-menu',
            title: 'Esri Wayback',
            tip: 'These pictures use public USGS imagery, as the guide may not show Esri’s.',
          },
          { anchor: 'compare.dates', title: 'All dates', look: true },
          { anchor: 'tab.satellite', title: 'The Satellite tab' },
        ],
        does: {
          'tab.compare': 'Press the Compare tab beside Satellite. It opens on the same spot, with an Esri Wayback release from a year back on A and today’s World Imagery on B.',
          'imagery.wayback': 'Press the imagery chip beside B, then Esri Wayback. Use each side’s date chip to pick a release, the older one on A.',
          'compare.dates': 'With Wayback on both sides, All dates lists every release for the spot, oldest first. Compare fixed features, like a crane row, a building or the shore. Wayback only goes back to 2014, and this photo is from 2009.',
          'tab.satellite': 'Press the Satellite tab, then pick the same archive and date with its imagery chip.',
        },
        then: 'Satellite, the channel in view.',
        video: {
          marks: [
            { anchor: 'tab.compare', shot: 'satellite-video-port', tool: 'satellite', place: 'Satellite', title: 'The Compare tab' },
            {
              anchor: 'imagery.wayback',
              shot: 'compare-menu',
              title: 'Esri Wayback',
              tip: 'These pictures use public USGS imagery, as the guide may not show Esri’s.',
            },
            { anchor: 'compare.dates', title: 'All dates', look: true },
            { anchor: 'tab.satellite', title: 'The Satellite tab' },
          ],
          does: {
            'tab.compare': 'Press the Compare tab beside Satellite. It opens on the same spot, with an Esri Wayback release from a year back on A and today’s World Imagery on B.',
            'imagery.wayback': 'Press the imagery chip beside B, then Esri Wayback. Use each side’s date chip to pick a release, the older one on A.',
            'compare.dates': 'With Wayback on both sides, All dates lists every release for the spot, oldest first. Compare fixed features, like a crane row, a building or the shore. Wayback only goes back to 2014.',
            'tab.satellite': 'Press the Satellite tab, then pick the same archive and date with its imagery chip.',
          },
        },
      },
      {
        id: 'spot',
        at: [6, 0],
        tool: 'satellite',
        icon: 'pin',
        label: 'Camera spot',
        shot: 'tower-menu',
        text: 'Two features that line up in the photo put the camera somewhere on one line.',
        marks: [
          { anchor: 'map.measure-from', title: 'Measure from here' },
          { anchor: 'map.ground', shot: 'tower-line', title: 'The line' },
          { anchor: 'map.drop-lead', shot: 'lead-menu', title: 'Drop a lead here' },
        ],
        does: {
          'map.measure-from': 'In the photo, the bridge’s east tower stands right behind the green Evergreen cranes. On the map, the tower sits where the deck meets the east bank. Right-click it and press Measure from here.',
          'map.ground': 'Click the green crane just south of the bridge on the east bank, then double-click in town past the west bank. The angle at the crane must read 180°, or the line is bent. Fold the Measure panel with its arrow at the top right to see your photo again.',
          'map.drop-lead': 'The camera stood somewhere on this line, and high up, since the photo looks down on a car park and palms. Right-click where the line leaves the car park for the first buildings, then press Drop a lead here. No need to press Keep; the lead holds the spot.',
        },
        then: 'Satellite, lead 1 on the line, in your scene’s colour. The pill counts it.',
        video: {
          shot: 'satellite-video-port',
          text: 'The camera is on the ship, so its spot is on the water.',
          marks: [{ anchor: 'sat.place', title: 'Drop a lead' }],
          does: {
            'sat.place': 'The ship heads south toward open sea, so its left bank is on the right of this map. Press Drop a lead, then click mid-channel level with the two cranes on the pier’s tip.',
          },
          then: 'Satellite, lead 1 on the water, in your scene’s colour. The pill counts it.',
        },
      },
      {
        id: 'how',
        at: [7, 0],
        tool: 'satellite',
        label: 'Capture where?',
        ask: true,
        shot: 'satellite-scene',
        text: 'Where will you capture the place?',
        choices: [
          { to: 'capture', label: 'Here, on Satellite', text: 'Capture the imagery you matched on.' },
          { to: 'elsewhere', label: 'On Google or Apple Maps', text: 'Often sharper. It needs the free capture extension, set up in Settings › Capture extension.' },
        ],
        video: { shot: 'satellite-video-leads' },
      },
      {
        id: 'capture',
        at: [8, 0],
        tool: 'satellite',
        label: 'Capture',
        next: ['proof'],
        shot: 'satellite-scene',
        text: 'A capture is the map half of your proof.',
        marks: [
          { anchor: 'sat.capture', title: 'Capture an area' },
          { anchor: 'geo.counts', shot: 'satellite-captured', title: 'The pill’s count', look: true },
        ],
        does: {
          'sat.capture': 'Press Capture an area, then drag a box over the bridge, the cranes and your lead.',
          'geo.counts': 'The map icon on the pill now reads 1.',
        },
        tip: 'Too blurry? Switch the source with the imagery chip at the top right of the map.',
        then: 'Satellite, one capture in the pill.',
        video: {
          shot: 'satellite-video-leads',
          marks: [
            { anchor: 'sat.capture', title: 'Capture an area' },
            { anchor: 'geo.counts', shot: 'satellite-video-captured', title: 'The pill’s count', look: true },
          ],
          does: {
            'sat.capture': 'Press Capture an area, then drag a box from your lead and the two cranes down to the building at the channel’s end.',
            'geo.counts': 'The map icon on the pill now reads 1.',
          },
        },
      },
      {
        id: 'elsewhere',
        at: [8, 1],
        tool: 'satellite',
        label: 'Another map',
        optional: true,
        next: ['proof'],
        shot: 'scene-menu',
        text: 'The free capture extension takes the capture from another map site.',
        marks: [
          { anchor: 'map.open-in', title: 'Open in…' },
          { anchor: 'map.google-satellite', shot: 'scene-open-in', title: 'Google Satellite' },
          { anchor: 'ext.capture', shot: 'extension-scene', place: 'Another map', title: 'Capture an area' },
          { anchor: 'geo.counts', shot: 'satellite-captured', title: 'The pill’s count', look: true },
        ],
        does: {
          'map.open-in': 'Right-click the spot, then press Open in…',
          'map.google-satellite': 'Press Google Satellite. Apple Maps and the others open on the same spot too.',
          'ext.capture': 'On that site, press Capture an area in the extension’s panel. The view is added to your scene. The picture shows OpenStreetMap, as the guide may not show Google’s imagery.',
          'geo.counts': 'Back in Azimut, the map icon on the pill reads 1.',
        },
        then: 'Satellite, one capture in the pill.',
        video: {
          shot: 'scene-menu-video',
          marks: [
            { anchor: 'map.open-in', title: 'Open in…' },
            { anchor: 'map.google-satellite', shot: 'scene-open-in-video', title: 'Google Satellite' },
            { anchor: 'ext.capture', shot: 'extension-scene-video', place: 'Another map', title: 'Capture an area' },
            { anchor: 'geo.counts', shot: 'satellite-video-captured', title: 'The pill’s count', look: true },
          ],
        },
      },
      {
        id: 'proof',
        at: [9, 0],
        tool: 'proof',
        label: 'Proof',
        shot: 'proof-blank',
        text: 'A proof shows why your photo is this place.',
        marks: [
          { anchor: 'geo.make', shot: 'satellite-captured', tool: 'satellite', place: 'Satellite', title: 'Make the proof' },
          {
            anchor: 'proof.box',
            title: 'The box tool',
            tip: 'You can switch tools with the proof open. Open the proof on the pill brings you back, and anything you capture meanwhile is added.',
          },
          {
            anchor: 'proof.canvas',
            shot: 'proof-boxes',
            title: 'Box the tower',
            text: 'Drag a box round the bridge’s east tower on your photo. Press R, then box the same tower on the capture.',
          },
          { anchor: 'proof.colour', shot: 'proof-tower', title: 'The colour swatch' },
          {
            anchor: 'proof.canvas',
            shot: 'proof-cranes',
            title: 'Box the cranes',
            text: 'Drag a box round the green Evergreen cranes on your photo. Press R, then box the same cranes on the capture.',
            tip: 'Layout and Style, at the top right, set how the pictures sit and the colours and fonts.',
          },
        ],
        does: {
          'geo.make': 'Press Make the proof on the pill. Your photo and capture open side by side.',
          'proof.box': 'Press the square box tool, or R.',
          'proof.colour': 'Press R for the box tool again. Then press the colour swatch, the dot lower in the same toolbar, and pick blue. One colour per feature keeps the pairs readable.',
        },
        then: 'Geo Proof, the tower in red and the cranes in blue on both pictures.',
        video: {
          shot: 'proof-video',
          text: 'A proof shows why your video is this place.',
          marks: [
            { anchor: 'geo.make', shot: 'satellite-video-captured', tool: 'satellite', place: 'Satellite', title: 'Make the proof' },
            { anchor: 'proof.make', shot: 'proof-chooser', tool: 'inspect', place: 'Inspect', title: 'Make the proof, in Inspect' },
            {
              anchor: 'proof.box',
              title: 'The box tool',
              tip: 'You can switch tools with the proof open. Open the proof on the pill brings you back, and anything you capture meanwhile is added.',
            },
            {
              anchor: 'proof.canvas',
              title: 'Box the cranes',
              text: 'Drag a box round the two cranes on the left bank in your frame. Press R, then box the same cranes on the capture, at the tip of the pier.',
            },
            { anchor: 'proof.colour', shot: 'proof-video-cranes', title: 'The colour swatch' },
            {
              anchor: 'proof.canvas',
              shot: 'proof-video-cranes',
              title: 'Box the building',
              text: 'Drag a box round the tall building far ahead on the right of your frame. Press R, then box it on the capture, at the end of the west pier.',
              tip: 'Layout and Style, at the top right, set how the pictures sit and the colours and fonts.',
            },
          ],
          does: {
            'geo.make': 'Press Make the proof on the pill. Inspect opens first and asks what goes in.',
            'proof.make': 'Your frame and capture are ticked. Press Make the proof.',
            'proof.box': 'Press the square box tool, or R.',
            'proof.colour': 'Press R for the box tool again. Then press the colour swatch, the dot lower in the same toolbar, and pick blue. One colour per feature keeps the pairs readable.',
          },
          then: 'Geo Proof, the cranes in red and the building in blue on both pictures.',
        },
      },
      {
        id: 'camera',
        at: [10, 0],
        tool: 'proof',
        icon: 'eye',
        label: 'Two points',
        shot: 'proof-marked',
        text: 'Name two points: what the photo shows, and where the camera stood.',
        marks: [
          { anchor: 'proof.first-label', title: 'The first row’s label', typed: true },
          { anchor: 'proof.add-point', shot: 'proof-labelled', title: 'The plus' },
          { anchor: 'proof.new-pin', shot: 'proof-row2', title: 'The pin icon' },
          { anchor: 'point.lead', shot: 'proof-camera-map', title: 'Lead 1' },
          { anchor: 'point.use', shot: 'proof-camera-lead', title: 'Use this point' },
          { anchor: 'proof.new-label', shot: 'proof-camera', title: 'The new row’s label', typed: true },
          {
            anchor: 'proof.new-pov',
            shot: 'proof-camera-named',
            title: 'The eye icon',
            tip: 'To put a point on one of your layers, linked to this proof, use Layers and more, the ⋯ at the end of its row.',
          },
        ],
        does: {
          'proof.first-label': 'The first row is what the photo shows. It starts at the middle of your capture, and Save asks you to check it. Type YM Success as its label.',
          'proof.add-point': 'Press the plus beside Coordinates to add a second row.',
          'proof.new-pin': 'Press the pin icon beside the new row’s lat, lon field. A map opens with your lead beside it.',
          'point.lead': 'Press lead 1, the one on the tower line.',
          'point.use': 'The pin is now on lead 1. Press Use this point.',
          'proof.new-label': 'Type Camera as the new row’s label.',
          'proof.new-pov': 'Press the eye icon, Point of view, to mark this row as where the camera stood.',
        },
        then: 'Geo Proof, two named points, the second marked as the camera.',
        video: {
          shot: 'proof-video-marked',
          text: 'Name two points: what the video shows, and where the camera was at your frame.',
          marks: [
            { anchor: 'proof.first-label', title: 'The first row’s label', typed: true },
            { anchor: 'proof.add-point', shot: 'proof-video-labelled', title: 'The plus' },
            { anchor: 'proof.new-pin', shot: 'proof-video-row2', title: 'The pin icon' },
            { anchor: 'point.lead', shot: 'proof-video-camera-map', title: 'Lead 1' },
            { anchor: 'point.use', shot: 'proof-video-camera-lead', title: 'Use this point' },
            { anchor: 'proof.new-label', shot: 'proof-video-camera', title: 'The new row’s label', typed: true },
            {
              anchor: 'proof.new-pov',
              shot: 'proof-video-named',
              title: 'The eye icon',
              tip: 'To put a point on one of your layers, linked to this proof, use Layers and more, the ⋯ at the end of its row.',
            },
          ],
          does: {
            'proof.first-label': 'The first row is what the video shows. It starts at the middle of your capture, and Save asks you to check it. Type Main Channel as its label.',
            'proof.add-point': 'Press the plus beside Coordinates to add a second row.',
            'proof.new-pin': 'Press the pin icon beside the new row’s lat, lon field. A map opens with your lead beside it.',
            'point.lead': 'Press lead 1, on the water where the ship was.',
            'point.use': 'The pin is now on lead 1. Press Use this point.',
            'proof.new-label': 'Type Camera as the new row’s label.',
            'proof.new-pov': 'Press the eye icon, Point of view, to mark this row as where the camera was at your frame.',
          },
        },
      },
      {
        id: 'save',
        at: [11, 0],
        tool: 'proof',
        label: 'Save',
        shot: 'proof-camera-done',
        text: 'Saving puts your points on the map as places.',
        marks: [
          { anchor: 'proof.meta', title: 'Description and date', typed: true },
          { anchor: 'proof.save', shot: 'proof-typed', title: 'Save proof' },
          { anchor: 'point.use', shot: 'proof-check', title: 'Use this point' },
          {
            anchor: 'proof.to-post',
            shot: 'proof',
            title: 'To Post',
            tip: 'If a line says the case holds other points nearby, See in the graph shows them.',
          },
        ],
        does: {
          'proof.meta': 'The source came in with the photo. In Description, type over the grey example: The YM Success under the Vincent Thomas Bridge, seen from the west bank of the Main Channel. Set the date to 3 February 2009, typed 03/02/2009, day first.',
          'proof.save': 'Press Save proof. It asks you to check the first row.',
          'point.use': 'The pin sits in the middle of the capture, on the channel the YM Success sails in, which is what the photo shows. Press Use this point.',
          'proof.to-post': 'The proof is saved and the scene leaves the To-do. Press To Post to draft the post from the proof.',
        },
        then: 'Post, drafted from your proof.',
        video: {
          shot: 'proof-video-done',
          marks: [
            { anchor: 'proof.meta', title: 'Description and date', typed: true },
            { anchor: 'proof.save', shot: 'proof-video-typed', title: 'Save proof' },
            { anchor: 'point.use', shot: 'proof-video-check', title: 'Use this point' },
            {
              anchor: 'proof.to-post',
              shot: 'proof-video-saved',
              title: 'To Post',
              tip: 'If a line says the case holds other points nearby, See in the graph shows them.',
            },
          ],
          does: {
            'proof.meta': 'The source came in with the video. In Description, type over the grey example: A ship leaves the port by the Main Channel, two tugs ahead of it. Set the date to 15 May 2020, typed 15/05/2020, day first.',
            'proof.save': 'Press Save proof. It asks you to check the first row.',
            'point.use': 'The pin sits in the middle of the capture, on the channel the ship sails down, which is what the video shows. Press Use this point.',
            'proof.to-post': 'The proof is saved and the scene leaves the To-do. Press To Post to draft the post from the proof.',
          },
        },
      },
      {
        id: 'post',
        at: [12, 0],
        tool: 'post',
        label: 'Publish',
        shot: 'post',
        text: 'Read the post before it goes out. Check the place, both named points and the source.',
        marks: [
          { anchor: 'post.mention', title: 'Mention', typed: true },
          {
            anchor: 'post.copy-image',
            shot: 'post-cleared',
            title: 'Copy image',
            tip: 'Practising? Stop here. A practice post is not for publishing.',
          },
          {
            anchor: 'post.publish',
            shot: 'post-cleared',
            title: 'Publish on X',
            tip: 'With the free capture extension, X’s box is filled with the post and the proof. Set it up in Settings › Capture extension.',
          },
          { anchor: 'post.posted', shot: 'post-cleared', title: 'Mark as posted' },
        ],
        does: {
          'post.mention': 'Clear @GeoConfirmed from Mention, since a practice post would tag a real account. The grey text left behind is only a placeholder.',
          'post.copy-image': 'Press Copy image to put the proof on the clipboard.',
          'post.publish': 'Press Publish on X. X opens with the text in place; paste the proof and post.',
          'post.posted': 'Back in Azimut, press Mark as posted, paste your post’s link, then press Mark as posted under it. The link dates the post and is kept with the proof.',
        },
        video: {
          shot: 'post-video',
          marks: [
            { anchor: 'post.mention', title: 'Mention', typed: true },
            {
              anchor: 'post.copy-image',
              shot: 'post-video-cleared',
              title: 'Copy image',
              tip: 'Practising? Stop here. A practice post is not for publishing.',
            },
            {
              anchor: 'post.publish',
              shot: 'post-video-cleared',
              title: 'Publish on X',
              tip: 'To post the clip too, press Video under Media in post 2 before you publish.',
            },
            { anchor: 'post.posted', shot: 'post-video-cleared', title: 'Mark as posted' },
          ],
        },
      },
    ],
    result: {
      shot: 'proof-result',
      text: 'The proof as it leaves the case.',
      video: { shot: 'proof-video-result', text: 'The video’s proof as it leaves the case.' },
    },
  },
  {
    id: 'make-a-layer',
    title: 'Build a layer of your own',
    lead: 'From an empty map to your own points, lines and areas, grouped, described, with a proof on them and dated if they change, kept in Azimut to add to whenever you want.',
    steps: [
      {
        id: 'go',
        at: [0, 0],
        tool: 'satellite',
        icon: 'stack',
        label: 'Layers',
        shot: 'layer-start',
        text: 'A layer is a map of your own, drawn over the imagery in Satellite.',
        marks: [
          { anchor: 'rail.map', shot: 'layer-home', title: 'Map' },
          { anchor: 'sat.search', title: 'Search', typed: true },
          {
            anchor: 'sat.panel-open',
            title: 'Open the Layers panel',
            tip: 'The panel lists Azimut’s layers first, then My layers for your own, then Added layers for maps you follow.',
          },
        ],
        does: {
          'rail.map': 'Press Map on the left rail. It opens on Satellite.',
          'sat.search': 'Type the place you will map, or paste a coordinate, then press Go.',
          'sat.panel-open': 'Press the arrow at the top of the LAYERS strip on the right.',
        },
        then: 'The Layers panel, My layers still empty.',
      },
      {
        id: 'new',
        at: [1, 0],
        tool: 'satellite',
        icon: 'plus',
        label: 'New layer',
        shot: 'layer-new-fresh',
        text: 'Make the layer and name it.',
        marks: [
          {
            anchor: 'layer.new',
            shot: 'layer-panel',
            title: 'New layer',
            tip: 'Only watching someone else’s public map? Add a layer, at the foot of the panel, follows it read-only.',
          },
          {
            anchor: 'layer.name',
            title: 'Name',
            typed: true,
            tip: 'Leave Track over time off for now. Turn it on once the fixed features are drawn, so they show on every day.',
          },
          {
            anchor: 'layer.create',
            shot: 'layer-new',
            title: 'Create layer',
            tip: 'Starting from a colleague’s KML, KMZ, GeoJSON or GPX? Press From a file and choose it. A public My Maps? Press From a My Maps link.',
          },
        ],
        does: {
          'layer.new': 'Press New layer, under My layers.',
          'layer.name': 'Type Channel survey over My layer.',
          'layer.create': 'Press Create layer.',
        },
        then: 'Your empty layer, its tools on the map.',
      },
      {
        id: 'draw',
        at: [2, 0],
        tool: 'satellite',
        icon: 'pin',
        label: 'Draw',
        shot: 'layer-points',
        text: 'Draw what you see. Each marker, line or area is a feature, and it saves as you draw.',
        marks: [
          {
            anchor: 'layer.markers',
            title: 'Add markers',
            tip: 'Style, the coloured marker on the bar, sets the look of the next feature or of the one you picked.',
          },
          { anchor: 'layer.line', shot: 'layer-line', title: 'Draw a line', tip: 'To drag instead of clicking, press Freehand, which shows on the bar while you draw.' },
          { anchor: 'layer.area', shot: 'layer-area', title: 'Draw an area', tip: 'The circle and square icons on the bar draw a circle or a box in two clicks.' },
        ],
        does: {
          'layer.markers': 'Press Add markers, the pin icon, and click once per place. Esc stops.',
          'layer.line': 'Press Draw a line, the line icon, click each point along it, then press Enter.',
          'layer.area': 'Press Draw an area, the pentagon icon, click each corner, then press Enter.',
        },
        then: 'Your features in the list, all under Features.',
      },
      {
        id: 'groups',
        at: [3, 0],
        tool: 'satellite',
        icon: 'folder',
        label: 'Sort them',
        shot: 'layer-drawn',
        text: 'Sort your features into groups, which work like folders.',
        marks: [
          { anchor: 'layer.new-group', title: 'New group' },
          { anchor: 'layer.group-field', shot: 'layer-group-new', title: 'Group name', typed: true },
          {
            anchor: 'layer.feature',
            shot: 'layer-group-made',
            title: 'Area 1',
            typed: true,
            tip: 'Wrong group? Undo, the curved arrow on the bar, takes it back.',
          },
        ],
        does: {
          'layer.new-group': 'Everything you drew went into Features, the first group. Press New group under the list.',
          'layer.group-field': 'Type Port and press Enter.',
          'layer.feature': 'Drag the Area 1 row onto the Port row, then the Line 1 row.',
        },
        then: 'The markers in Features, the line and the area in Port.',
      },
      {
        id: 'group-style',
        at: [4, 0],
        tool: 'satellite',
        icon: 'brush',
        label: 'Style a group',
        shot: 'layer-group-menu',
        text: 'Style a group once and every feature in it follows.',
        marks: [
          { anchor: 'layer.group-more', shot: 'layer-sorted', title: 'Group settings' },
          { anchor: 'layer.group-name', title: 'Name', typed: true },
          {
            anchor: 'layer.group-style',
            shot: 'layer-group-named',
            title: 'One style',
            tip: 'Port’s ⋮ has the same menu, where Dashed draws its lines dashed and Hatched its areas hatched.',
          },
          { anchor: 'layer.group-look', shot: 'layer-group-onestyle', title: 'Its look' },
          { anchor: 'layer.style-more', shot: 'layer-group-palette', title: 'A colour' },
          { anchor: 'layer.style-find', shot: 'layer-group-coloured', title: 'Find an icon', typed: true },
          { anchor: 'layer.style-icon', shot: 'layer-group-found', title: 'The anchor icon' },
          { anchor: 'layer.group-names', shot: 'layer-group-styled', title: 'Names on the map' },
        ],
        does: {
          'layer.group-more': 'Press the ⋮ at the end of the Features row.',
          'layer.group-name': 'Type Cranes over Features.',
          'layer.group-style': 'Press One style. Each its own keeps every feature’s look; One colour only sets the group’s colour.',
          'layer.group-look': 'Press the marker beside Style.',
          'layer.style-more': 'Press + beside the colour, then green.',
          'layer.style-find': 'Type harbour in Find an icon. There is no crane icon, and the anchor reads as a port.',
          'layer.style-icon': 'Press the anchor, the only icon left. Every crane takes it.',
          'layer.group-names': 'Tick Names on the map to write each name beside its feature.',
        },
        then: 'Your cranes in one look, each named on the map.',
      },
      {
        id: 'describe',
        at: [5, 0],
        tool: 'satellite',
        icon: 'edit',
        label: 'Describe it',
        shot: 'layer-sheet',
        text: 'Say what each feature is and which source shows it.',
        marks: [
          { anchor: 'layer.feature', shot: 'layer-grouped', title: 'A feature' },
          { anchor: 'layer.sheet-name', title: 'Name', typed: true, tip: 'Under Status, Sure, Likely or Claimed says how firm the position is.' },
          { anchor: 'layer.sheet-sources', shot: 'layer-sheet-named', title: 'Sources' },
          {
            anchor: 'layer.sheet-add-source',
            shot: 'layer-sheet-sources',
            title: 'Add a source',
            typed: true,
            tip: 'Leave Geolocated by me ticked if you located it yourself. Untick it for someone else’s geolocation; its marker gets a dashed rim.',
          },
          { anchor: 'layer.sheet-note', shot: 'layer-sheet-sourced', title: 'Note', typed: true },
        ],
        does: {
          'layer.feature': 'Click Marker 3 on the map or in the list. Its sheet opens under the row.',
          'layer.sheet-name': 'Type Crane 3 over Marker 3.',
          'layer.sheet-sources': 'Press Sources.',
          'layer.sheet-add-source': 'Press + Add, paste the post’s address and press Enter.',
          'layer.sheet-note': 'Press Note and type what it is. Do the same for Crane 1 and Crane 2, then name the line Route and the area Yard.',
        },
        then: 'Every feature named and described, nothing picked.',
      },
      {
        id: 'has-proof',
        at: [6, 0],
        tool: 'satellite',
        label: 'A proof?',
        ask: true,
        shot: 'layer-built',
        text: 'Is there a proof in this case?',
        choices: [
          { to: 'proof', label: 'Yes', text: 'Put it on the layer. A proof shows where a picture was taken and how you know.' },
          { to: 'time', label: 'No', text: 'Go on without one. The Geolocate journey shows how to make a proof.' },
        ],
      },
      {
        id: 'proof',
        at: [6.5, -1],
        optional: true,
        next: ['time'],
        tool: 'satellite',
        icon: 'link',
        label: 'Its proof',
        shot: 'layer-link-fresh',
        text: 'Add the proof to the layer as a marker that stays linked to it.',
        marks: [
          { anchor: 'layer.link', shot: 'layer-built', title: 'Add from the case' },
          { anchor: 'layer.link-proofs', title: 'Proofs' },
          { anchor: 'layer.link-row', shot: 'layer-link-proofs', title: 'Your proof' },
          {
            anchor: 'layer.link-add',
            shot: 'layer-link',
            title: 'Add',
            tip: 'Next time, do it from Geo Proof as you go, with Add to a layer in a point row’s ⋯ menu.',
          },
        ],
        does: {
          'layer.link': 'Press Add from the case, the chain icon on the bar. It lists everything filed in the case.',
          'layer.link-proofs': 'Press Proofs to list only proofs.',
          'layer.link-row': 'Tick YM Success, the point the photo shows. The Camera row under it is where it was taken from.',
          'layer.link-add': 'Press Add 1. The marker goes into Port, the group of the last feature you picked.',
        },
        then: 'Your layer, the proof’s marker in Port, named with the proof’s description.',
      },
      {
        id: 'time',
        at: [7, 0],
        tool: 'satellite',
        label: 'Over time?',
        ask: true,
        shot: 'layer-proofed',
        text: 'Does anything on this layer come, go or move over time?',
        choices: [
          { to: 'track', label: 'Yes', text: 'Something is there only on some days, like the proof’s ship: in port on 3 Feb 2009, gone the next day.' },
          { to: 'send', label: 'No', text: 'It looks the same every day.' },
        ],
      },
      {
        id: 'track',
        at: [8, -1],
        tool: 'satellite',
        icon: 'clock',
        label: 'Track it',
        shot: 'layer-menu',
        next: ['date'],
        text: 'Give each feature the days it was there.',
        marks: [
          { anchor: 'layer.more', shot: 'layer-proofed', title: 'Layer actions' },
          {
            anchor: 'layer.track-on',
            title: 'Track over time',
            tip: 'Once it is on, From on the bar dates new drawings to the day shown. The ∞ beside it is for what never moves.',
          },
        ],
        does: {
          'layer.more': 'Press the ⋮ beside the layer’s name.',
          'layer.track-on': 'Press Track over time.',
        },
        then: 'A date box over the list, set to today. What you drew reads Always, the proof’s marker its own day.',
      },
      {
        id: 'date',
        at: [9, -1],
        tool: 'satellite',
        icon: 'calendar',
        label: 'Date it',
        shot: 'layer-tracked',
        next: ['send'],
        text: 'End the ship on the day it left, then enlarge the yard as of today. The layer then shows what changed.',
        marks: [
          {
            anchor: 'layer.previous',
            title: 'Previous change',
            tip: 'Only your layer follows the date; the satellite picture does not. For dated imagery, such as Wayback, use the imagery menu at the top.',
          },
          { anchor: 'layer.linked', shot: 'layer-back', title: 'The proof’s marker' },
          { anchor: 'layer.feature-end', shot: 'layer-ship', title: 'Still there' },
          { anchor: 'layer.today', shot: 'layer-ended', title: 'Today' },
          { anchor: 'layer.sheet-name', shot: 'layer-yard-picked', title: 'The yard grows' },
          { anchor: 'layer.past', shot: 'layer-yard-grown', title: 'The past' },
          {
            anchor: 'layer.past',
            shot: 'layer-yard-hatched',
            title: 'What changed',
            look: true,
            tip: 'Show the state before, dashed, in the same menu, draws each feature as it was before its last change.',
          },
        ],
        does: {
          'layer.previous': 'Press Previous change, the ‹ left of the date. The layer steps back to its last change, 3 Feb 2009, the proof’s day.',
          'layer.linked': 'Click the proof’s marker on the map, or its row in Port, to open its sheet.',
          'layer.feature-end': 'Press Still there under its name and pick 4, the first day the ship was gone.',
          'layer.today': 'Press Today beside the date. The ship drops off the map, but its row keeps its days.',
          'layer.sheet-name': 'The yard has grown since. Click inside it on the map and drag its south-east corner out to where the stacks reach now. The edit is dated to the day shown.',
          'layer.past': 'Press the past menu right of the date, then Since the state before.',
        },
        then: 'Your layer on today, the ship gone and the yard’s new ground hatched.',
      },
      {
        id: 'send',
        at: [10, 0],
        tool: 'satellite',
        label: 'Send it?',
        ask: true,
        shot: 'layer-yard-hatched',
        text: 'Your layer is kept in Azimut. Do you also need it as a file to send?',
        choices: [
          { to: 'out', label: 'Yes, as a file', text: 'A KMZ for Google Earth or My Maps, or GeoJSON for a GIS.' },
          { to: 'keep', label: 'No', text: 'Close it. It stays under My layers for later.' },
        ],
      },
      {
        id: 'out',
        at: [10.5, 1],
        tool: 'satellite',
        icon: 'download',
        label: 'Download',
        optional: true,
        next: ['keep'],
        shot: 'layer-export-tracked',
        text: 'Export the layer as a file.',
        marks: [
          { anchor: 'layer.more', shot: 'layer-yard-hatched', title: 'Layer actions' },
          { anchor: 'layer.download-item', shot: 'layer-menu-tracked', title: 'Download layer' },
          { anchor: 'layer.export-history', title: 'Every state' },
          {
            anchor: 'layer.export-kmz',
            shot: 'layer-export-history',
            title: 'KMZ',
            tip: 'GeoJSON, two cards down, is for QGIS and other GIS tools. Send to My Maps, under them, saves a KMZ of one day and opens your My Maps.',
          },
        ],
        does: {
          'layer.more': 'Press the ⋮ beside the layer’s name.',
          'layer.download-item': 'Press Download layer. Leave Dated to and Clock as they are.',
          'layer.export-history': 'For a tracked layer, press Every state to export each day for a time slider. The ship was only there on 3 Feb 2009, so an export of today would drop it. An untracked layer has no such choice.',
          'layer.export-kmz': 'Press KMZ. Google Earth and My Maps read each feature’s name, note, group, look and sources, and Google Earth plays the days on its time slider. The file goes to your browser’s downloads.',
        },
        then: 'Your layer still open, its file in your downloads.',
      },
      {
        id: 'keep',
        at: [11, 0],
        tool: 'satellite',
        icon: 'check',
        label: 'Keep it',
        shot: 'layer-yard-hatched',
        text: 'Your layer saves as you draw. Done puts it away.',
        marks: [{ anchor: 'layer.done', title: 'Done' }],
        does: {
          'layer.done': 'Press Done on the bar or at the top of the panel. The layer closes and stays under My layers until you have more to add.',
        },
        then: 'The map with your layer drawn, the Layers panel on the right.',
      },
      {
        id: 'reuse',
        at: [12, 0],
        tool: 'satellite',
        icon: 'stack',
        label: 'Use it',
        shot: 'layer-kept',
        text: 'Use your layer wherever Azimut shows a map.',
        marks: [
          {
            anchor: 'sat.mylayers',
            title: 'My layers',
            look: true,
            tip: 'Ticked, it draws on every map of the case, Compare and Detect included.',
          },
        ],
        does: {
          'sat.mylayers': 'Your layer sits ticked under My layers. Its ⋮ downloads it again. To publish it, use the Notebook’s Web map for an interactive page, or a Map plate for a report or post.',
        },
      },
    ],
    result: {
      shot: 'layer-made-tracked',
      text: 'Your layer, kept under My layers. Open it to add more; a new proof goes on it from Geo Proof, with Add to a layer in a point’s ⋯ menu.',
    },
  },
  {
    id: 'make-a-plate',
    title: 'Make a Map plate',
    lead: 'From a place in the Map to a page ready to print, post or play.',
    steps: [
      {
        id: 'go',
        at: [0, 0],
        tool: 'plate',
        icon: 'plate',
        label: 'Map plate',
        shot: 'plate-go-home',
        text: 'A plate is a page laid out round your maps. It opens on the Map’s current view.',
        marks: [
          { anchor: 'sat.search', shot: 'plate-go-map', tool: 'satellite', place: 'Satellite', title: 'Your place', typed: true },
          {
            anchor: 'rail.compose',
            shot: 'plate-go-map',
            tool: 'satellite',
            place: 'Satellite',
            title: 'Compose',
            tip: 'The plate draws the layers you drew in the Map, and a layer with a clock adds a day bar. No layer yet? Start with the Build a layer of your own journey.',
          },
          { anchor: 'tab.plate', shot: 'plate-go-compose', tool: 'proof', place: 'Geo Proof', title: 'Map plate' },
          { anchor: 'plate.new', title: 'New plate' },
        ],
        does: {
          'sat.search': 'Search for your place at the top left of Satellite and pick it.',
          'rail.compose': 'Press Compose on the left rail.',
          'tab.plate': 'Press the Map plate tab.',
          'plate.new': 'Press New plate. Saved plates are listed under it.',
        },
        then: 'New plate, with the layouts on the left and the map, paper and look on the right.',
      },
      {
        id: 'shows',
        at: [1, 0],
        tool: 'plate',
        label: 'Shows what?',
        ask: true,
        shot: 'plate-new',
        text: 'What does your plate show?',
        choices: [
          { to: 'card', label: 'A geolocation', text: 'Footage beside where it was filmed, the matches numbered.' },
          { to: 'stand', label: 'A situation', text: 'A place, a site or a front line, on a day you pick.' },
          { to: 'pair', label: 'A change between two dates', text: 'The same ground before and after, side by side.' },
        ],
      },

      // -- a Geolocation card, to its own end
      {
        id: 'card',
        at: [2, -1],
        tool: 'plate',
        icon: 'video',
        label: 'A geolocation',
        shot: 'plate-new-geolocation',
        text: 'Each chip narrows the layouts to the ones that fit.',
        marks: [
          {
            anchor: 'plate.ask-geolocation',
            shot: 'plate-new',
            title: 'A geolocation',
            tip: 'Line of sight, next to it, shows where the camera stood and what it could see over the relief.',
          },
          { anchor: 'plate.paper', title: 'Paper', typed: true },
          { anchor: 'plate.create', shot: 'plate-new-geo-paper', title: 'Create plate' },
          { anchor: 'plate.picture', shot: 'plate-geo', title: 'The picture' },
          { anchor: 'plate.from-case', shot: 'plate-geo-picked', title: 'From the case' },
          { anchor: 'plate.case-pictures', shot: 'plate-geo-pictures', title: 'Your photo' },
        ],
        does: {
          'plate.ask-geolocation': 'Press the A geolocation chip above the layouts. Geolocation card is already picked.',
          'plate.paper': 'Pick "Report, A4" for a report or "Feed post, 4:5" for a post.',
          'plate.create': 'Press Create plate.',
          'plate.picture': 'Press the empty picture box. The map beside it uses World Imagery; the guide shows public USGS imagery instead.',
          'plate.from-case': 'Press From the case on the right.',
          'plate.case-pictures': 'Pick your photo, or your video’s frame, from the case’s pictures.',
        },
        then: 'Your card, the photo beside its map.',
      },
      {
        id: 'matches',
        at: [3, -1],
        tool: 'plate',
        icon: 'pin',
        label: 'Its matches',
        shot: 'plate-geo-number',
        text: 'Number each match on the map, so a reader can find it in the photo.',
        marks: [
          { anchor: 'plate.add', shot: 'plate-geo-done', title: 'Add' },
          { anchor: 'plate.add-number', shot: 'plate-geo-add', title: 'Number' },
          {
            anchor: 'plate.map',
            title: 'Place it',
            tip: 'A number is a label drawn as a numbered dot, so the app’s hint and the panel call it a label.',
          },
          {
            anchor: 'plate.text',
            shot: 'plate-geo-numbered',
            title: 'What it marks',
            typed: true,
            tip: 'Numbers go on the map only. To number the photo too, do it in Geo Proof and pick that proof here instead of the photo.',
          },
        ],
        does: {
          'plate.add': 'Press Add at the top.',
          'plate.add-number': 'Press Number, under On the map.',
          'plate.map': 'Press the map on the first match, the bridge’s east tower.',
          'plate.text': 'Write what it marks in the box on the right. It also goes into the Matches list under the map.',
        },
        then: 'Number 1 on the map, and in the Matches list.',
      },
      {
        id: 'card-words',
        at: [4, -1],
        tool: 'plate',
        icon: 'text',
        label: 'Its words',
        shot: 'plate-geo-title',
        text: 'Replace the card’s sample words with your own.',
        marks: [
          { anchor: 'plate.title', shot: 'plate-geo-matched', title: 'The title' },
          { anchor: 'plate.text', title: 'Its words', typed: true },
          { anchor: 'plate.source-line', shot: 'plate-geo-titled', title: 'The source line' },
          {
            anchor: 'plate.source-text',
            shot: 'plate-geo-source',
            title: 'Its words',
            typed: true,
            tip: 'A ! on the page marks a box whose words overflow. Press the box, then Fit the box.',
          },
        ],
        does: {
          'plate.title': 'Press the title on the page.',
          'plate.text': 'Write the title in the box on the right.',
          'plate.source-line': 'Press Filmed by, the line under the photo.',
          'plate.source-text': 'In the box on the right, write who filmed it and where it was posted.',
        },
        then: 'Your card, its words written.',
      },
      {
        id: 'card-out',
        at: [5, -1],
        tool: 'plate',
        icon: 'download',
        label: 'Card out',
        // its own end: what follows is the House layout's
        next: [],
        shot: 'plate-geo-export',
        text: 'Export the card as a picture.',
        marks: [
          {
            anchor: 'plate.export',
            shot: 'plate-geo-sourced',
            title: 'Export',
            tip: 'To move the map in its frame, press it, then Frame on its bar.',
          },
          { anchor: 'plate.export-go', title: 'Export', tip: 'PNG is picked. To Post, beside Export, files it in the case and opens a post with it.' },
        ],
        does: {
          'plate.export': 'Press Export at the top right.',
          'plate.export-go': 'Press Export. It runs in the background, with progress in the top bar.',
        },
        then: 'A note says the file is written. Its Show button opens the folder.',
      },

      // -- Before and after, to its own end
      {
        id: 'pair',
        at: [2, 1],
        tool: 'plate',
        icon: 'compare',
        label: 'Two dates',
        shot: 'plate-new-change',
        text: 'Each chip narrows the layouts to the ones that fit.',
        marks: [
          { anchor: 'plate.ask-change', shot: 'plate-new', title: 'A change between two dates' },
          {
            anchor: 'plate.from-pair',
            title: 'From a comparison',
            typed: true,
            tip: 'It lists the pairs saved in Compare. Set A and B to two Wayback dates there and press Save. With None, both maps start undated.',
          },
          { anchor: 'plate.map-layer', shot: 'plate-new-paired', title: 'Channel survey' },
          { anchor: 'plate.create', shot: 'plate-new-paired-ticked', title: 'Create plate' },
        ],
        does: {
          'plate.ask-change': 'Press the A change between two dates chip above the layouts. Before and after is already picked.',
          'plate.from-pair': 'Pick your pair under From a comparison.',
          'plate.map-layer': 'Under Map, tick Channel survey, a layer tracked over time.',
          'plate.create': 'Press Create plate. Both maps open on the pair’s view, each on its own date.',
        },
        then: 'Your two maps, each with its date on its badge.',
      },
      {
        id: 'pair-dates',
        at: [3, 1],
        tool: 'plate',
        icon: 'calendar',
        label: 'Each map’s date',
        shot: 'plate-pair-picked',
        text: 'Each map draws your tracked layers on its own date, not the page’s.',
        marks: [
          { anchor: 'plate.map-before', shot: 'plate-pair', title: 'Before' },
          {
            anchor: 'plate.layers-that-day',
            title: 'Layers as they stood that day',
            tip: 'Ticked, the map ignores the day bar under the page and takes its date from its Release.',
          },
          { anchor: 'plate.map-after', shot: 'plate-pair-before-dated', title: 'After' },
          { anchor: 'plate.ground-day', shot: 'plate-pair-after', title: 'Its date' },
          { anchor: 'plate.layers-that-day-menu', shot: 'plate-pair-after-menu', title: 'Layers as they stood that day' },
        ],
        does: {
          'plate.map-before': 'Press the Before map. The guide shows the same USGS imagery on both maps; yours shows each date’s Wayback release.',
          'plate.layers-that-day': 'Tick Layers as they stood that day, under its Release.',
          'plate.map-after': 'Press the After map.',
          'plate.ground-day': 'Press its date, the clock on the map’s bar.',
          'plate.layers-that-day-menu': 'Tick Layers as they stood that day, under its releases.',
        },
        then: 'Both maps dated, their layers on their own days.',
      },
      {
        id: 'pair-words',
        at: [4, 1],
        tool: 'plate',
        icon: 'text',
        label: 'Its samples',
        shot: 'plate-pair-figure',
        text: 'Replace the sample figure and legend with your own.',
        marks: [
          { anchor: 'plate.figure', shot: 'plate-pair-dated', title: 'The figure' },
          { anchor: 'plate.figure-text', title: 'Its count', typed: true, tip: 'The line beside it is a sample too. Press it and do the same.' },
          { anchor: 'plate.legend', shot: 'plate-pair-figured', title: 'The legend' },
          { anchor: 'plate.legend-name', shot: 'plate-pair-legend', title: 'Rows', typed: true },
          { anchor: 'plate.handle-w', shot: 'plate-pair-legend-named', title: 'Its width', typed: true },
          { anchor: 'plate.legend-columns', shot: 'plate-pair-widened', title: 'Columns', typed: true },
          {
            anchor: 'plate.fit',
            shot: 'plate-pair-columns',
            title: 'Fit the box',
            tip: 'A ! on the page marks a box whose words or rows overflow.',
          },
        ],
        does: {
          'plate.figure': 'Press the sample figure, the 0 under the maps.',
          'plate.figure-text': 'Write your count in the box on the right, or press Delete to remove it.',
          'plate.legend': 'Press the Key legend at the bottom right.',
          'plate.legend-name': 'Rename each row under Rows. They start as the layers’ group names.',
          'plate.handle-w': 'Drag the legend’s left handle to the left margin, where the figure was.',
          'plate.legend-columns': 'Set Columns to 4 to run the rows side by side.',
          'plate.fit': 'The rows now run just past the box. Press Fit the box.',
        },
        then: 'Your before and after, in your own words.',
      },
      {
        id: 'pair-out',
        at: [5, 1],
        tool: 'plate',
        icon: 'download',
        label: 'Pair out',
        // its own end: what follows is the House layout's
        next: [],
        shot: 'plate-pair-export',
        text: 'Export the page as a picture.',
        marks: [
          {
            anchor: 'plate.export',
            shot: 'plate-pair-fitted',
            title: 'Export',
            tip: 'To move both maps, frame one with Frame on its bar, then press Same view on the other’s.',
          },
          { anchor: 'plate.export-go', title: 'Export', tip: 'PNG is picked. To Post, beside Export, files it in the case and opens a post with it.' },
        ],
        does: {
          'plate.export': 'Press Export at the top right.',
          'plate.export-go': 'Press Export. It runs in the background, with progress in the top bar.',
        },
        then: 'A note says the file is written. Its Show button opens the folder.',
      },

      // -- a situation on the House layout, the trunk
      {
        id: 'stand',
        at: [2, 0],
        tool: 'plate',
        icon: 'mapArea',
        label: 'A situation',
        shot: 'plate-new-situation',
        text: 'Each chip narrows the layouts to the ones that fit.',
        marks: [
          {
            anchor: 'plate.ask-situation',
            shot: 'plate-new',
            title: 'A situation',
            tip: 'An evolution over time, next to it, keeps the layouts that play a tracked layer day by day.',
          },
          { anchor: 'plate.layout-house', title: 'House layout', look: true },
          {
            anchor: 'plate.map-layer',
            title: 'Your layer',
            tip: 'Where the Map is looking starts the plate on your current view. Round the layers picked starts it on everything those layers hold.',
          },
          { anchor: 'plate.paper', shot: 'plate-new-ticked', title: 'Paper', typed: true },
          { anchor: 'plate.look', shot: 'plate-new-ticked', title: 'Look', look: true },
          { anchor: 'plate.create', shot: 'plate-new-ticked', title: 'Create plate' },
        ],
        does: {
          'plate.ask-situation': 'Press the A situation chip above the layouts.',
          'plate.layout-house': 'House layout is already picked: the usual report figure, with the map, a legend, an inset map and the title.',
          'plate.map-layer': 'Under Map, tick your layer, Channel survey.',
          'plate.paper': 'Pick the paper. "Report, A4" or "A4, wide" suit a report, "Feed post, 4:5" or "Story, 9:16" a post, "Screen or post, 16:9" a video, "Print, A3" a wall. A video takes the paper’s shape.',
          'plate.look': 'A look sets the page’s fonts, colours and plain ground. "Its own" keeps the layout’s.',
          'plate.create': 'Press Create plate.',
        },
        then: 'Your plate on the Map’s view, a day bar under it.',
      },
      {
        id: 'frame',
        at: [3, 0],
        tool: 'plate',
        icon: 'move',
        label: 'Frame it',
        next: ['day', 'layers'],
        shot: 'plate-framing',
        text: 'Frame the port inside the page’s map.',
        marks: [
          { anchor: 'plate.map', shot: 'plate-house', title: 'The map' },
          { anchor: 'plate.frame', shot: 'plate-picked', title: 'Frame', tip: 'A double click on the map frames it too.' },
          { anchor: 'plate.framing', title: 'Move it', typed: true },
          { anchor: 'plate.frame-done', shot: 'plate-moved', title: 'Done' },
        ],
        does: {
          'plate.map': 'Press the map on the page to pick it and bring up its bar.',
          'plate.frame': 'Press Frame, the four-arrows button on the map’s bar.',
          'plate.framing': 'Drag to move and scroll to zoom until the port fills the frame.',
          'plate.frame-done': 'Press Done on the bar, or Esc.',
        },
        then: 'The port framed, the map still picked.',
      },
      {
        id: 'layers',
        at: [4, 0],
        tool: 'plate',
        icon: 'layers',
        label: 'Its layers',
        optional: true,
        next: ['day'],
        shot: 'plate-layers-tab',
        text: 'The Layers tab picks which of the case’s layers each map draws.',
        marks: [
          { anchor: 'plate.layers', shot: 'plate-framed', title: 'Layers' },
          { anchor: 'plate.layer-page', title: 'How it is drawn', look: true },
          { anchor: 'plate.on-page', title: 'On the page' },
        ],
        does: {
          'plate.layers': 'Press the Layers tab at the top of the list.',
          'plate.layer-page': 'Tick a layer to draw it on this map. The arrow beside a drawn one sets its colours, groups, which features show and their names.',
          'plate.on-page': 'Press On the page to go back to the page’s list.',
        },
        then: 'Back on the page’s list.',
      },
      {
        id: 'day',
        at: [5, 0],
        tool: 'plate',
        icon: 'calendar',
        label: 'The day',
        shot: 'plate-day',
        text: 'The page shows one day at a time. Set it to the day of your claim.',
        tip: 'No day bar because your layers have no clock? Skip to the next step.',
        marks: [
          { anchor: 'plate.days-track', shot: 'plate-framed', title: 'The days', look: true },
          {
            anchor: 'plate.day-prev',
            shot: 'plate-days',
            title: 'The day before',
            tip: 'Before, right of the bar, sets whether the state before shows dashed, and how long an event stays.',
          },
          { anchor: 'plate.map-stays', title: 'Map stays where it was', look: true },
        ],
        does: {
          'plate.days-track': 'Each notch on the bar is a day a tracked layer changes.',
          'plate.day-prev': 'Press ‹, left of the date, twice. It jumps notch to notch, from today to 15 May 2020, then to 3 Feb 2009, the photo’s day.',
          'plate.map-stays': 'After the first day, Map stays where it was keeps your framing. Untick it only to frame that day on its own.',
        },
        then: 'The plate on 3 February 2009, the map still picked, its grounds on the right.',
      },
      {
        id: 'ground',
        at: [6, 0],
        tool: 'plate',
        label: 'Imagery or plain?',
        ask: true,
        shot: 'plate-ground',
        text: 'Imagery, or a plain map under your layers?',
        choices: [
          { to: 'imagery', label: 'Imagery', text: 'Ships, cranes and berths as Wayback last saw them, though they compete with your colours.' },
          { to: 'plain', label: 'Another plain map', text: 'A quiet ground where your lines and zones stand out.' },
          { to: 'title', label: 'Keep it', text: 'House layout is on a plain map already.' },
        ],
      },
      {
        id: 'imagery',
        at: [6.5, -1],
        tool: 'plate',
        icon: 'satellite',
        label: 'Imagery',
        optional: true,
        next: ['title'],
        shot: 'plate-wayback',
        text: 'Wayback dates its imagery; World Imagery alone does not.',
        marks: [
          {
            anchor: 'plate.ground-wayback',
            shot: 'plate-ground',
            title: 'World Imagery Wayback',
            tip: 'Sentinel-2 gives a dated pass every few days, but at 10 m a pixel it is too coarse for a port. It needs a free Copernicus account; press it to see how.',
          },
          {
            anchor: 'plate.wayback-release',
            title: 'Release',
            typed: true,
            tip: 'Wayback starts in February 2014. For an earlier day, use a plain map, or state the imagery’s own date in the source line.',
          },
          {
            anchor: 'plate.layers-that-day',
            shot: 'plate-wayback-dated',
            title: 'Layers as they stood that day',
            tip: 'A release is the day Esri published the picture. It was taken on or before that day.',
          },
        ],
        does: {
          'plate.ground-wayback': 'Press World Imagery Wayback, under Ground.',
          'plate.wayback-release': 'Pick the Release nearest the page’s day. The guide shows USGS imagery in its place.',
          'plate.layers-that-day': 'Tick Layers as they stood that day, so your tracked layers follow the release’s day rather than the page’s.',
        },
        then: 'The map on Wayback, still picked. The next pictures use Light grey.',
      },
      {
        id: 'plain',
        at: [6.5, 1],
        tool: 'plate',
        icon: 'mapArea',
        label: 'Plain map',
        optional: true,
        next: ['title'],
        shot: 'plate-ground',
        text: 'On a plain map your lines and zones stand out.',
        marks: [
          {
            anchor: 'plate.ground-grey',
            title: 'Light grey',
            tip: 'Shaded relief, Topographic and Staff map show the heights, for when the terrain matters. A plain ground carries no date.',
          },
        ],
        does: { 'plate.ground-grey': 'Press Light grey under Ground.' },
        then: 'The map on Light grey, still picked.',
      },
      {
        id: 'title',
        at: [7, 0],
        tool: 'plate',
        icon: 'text',
        label: 'Its title',
        shot: 'plate-title',
        text: 'Replace the layout’s sample words with your own.',
        marks: [
          { anchor: 'plate.name', shot: 'plate-grey', title: 'The plate’s name', typed: true, tip: 'The exported file takes this name.' },
          { anchor: 'plate.title', shot: 'plate-named', title: 'The title' },
          { anchor: 'plate.text', title: 'Its words', typed: true },
        ],
        does: {
          'plate.name': 'Name the plate in the field at the top.',
          'plate.title': 'Press the title on the page.',
          'plate.text': 'Write the title in the box on the right. {case} inserts the case’s name and {date} the day shown.',
        },
        then: 'Your title on the page.',
      },
      {
        id: 'legend',
        at: [8, 0],
        tool: 'plate',
        icon: 'list',
        label: 'Its legend',
        shot: 'plate-legend',
        text: 'The legend and the cartouche are samples too.',
        marks: [
          {
            anchor: 'plate.legend',
            shot: 'plate-titled',
            title: 'The legend',
            tip: 'Its last row, New on 3 Feb 2009, rings what appears on the day shown.',
          },
          { anchor: 'plate.legend-name', title: 'Rows', typed: true, tip: 'The × beside a row takes it off the legend, and the arrows move it.' },
          { anchor: 'plate.handle', shot: 'plate-legend-named', title: 'Its size', typed: true, tip: 'Every box resizes by its handles.' },
          { anchor: 'plate.cartouche', shot: 'plate-legend-fit', title: 'The cartouche' },
          {
            anchor: 'plate.cartouche-text',
            shot: 'plate-cartouche',
            title: 'Its words',
            typed: true,
            tip: 'The Credits line under the map fills itself in and stays.',
          },
        ],
        does: {
          'plate.legend': 'Press the legend beside the map.',
          'plate.legend-name': 'Rename each row under Rows. They start as the layers’ group names.',
          'plate.handle': 'Drag the legend’s bottom handle up to just under its last row.',
          'plate.cartouche': 'Press the cartouche, the box under the inset map.',
          'plate.cartouche-text': 'Write your source line in the box on the right.',
        },
        then: 'The page with your legend and source line.',
      },
      {
        id: 'mark',
        at: [9, 0],
        tool: 'plate',
        icon: 'pin',
        label: 'A label',
        shot: 'plate-label',
        text: 'Add a label on the map. Numbers, arrows and zones go on the same way.',
        marks: [
          { anchor: 'plate.add', shot: 'plate-sourced', title: 'Add' },
          { anchor: 'plate.add-label', shot: 'plate-add-label', title: 'Label' },
          { anchor: 'plate.map', shot: 'plate-mark', title: 'Place it' },
          { anchor: 'plate.text', title: 'Its words', typed: true },
          {
            anchor: 'plate.every-day',
            shot: 'plate-label-typed',
            title: 'Show it every day',
            tip: 'Leave it off for a mark that belongs to one day only.',
          },
        ],
        does: {
          'plate.add': 'Press Add at the top, or A.',
          'plate.add-label': 'Press Label, under On the map.',
          'plate.map': 'Press the map where the label points.',
          'plate.text': 'Write the label in the box on the right.',
          'plate.every-day': 'Press Show it every day, on the line above the page, to keep the label on every day the plate shows.',
        },
        then: 'Your label on the map, on every day.',
      },
      {
        id: 'play',
        at: [10, 0],
        tool: 'plate',
        label: 'Picture or video?',
        ask: true,
        shot: 'plate-marked',
        text: 'A picture, or a video?',
        choices: [
          { to: 'still', label: 'A picture', text: 'A PNG or a PDF of the page on its day, or its days side by side.' },
          { to: 'video', label: 'A video', text: 'Its days in turn, in the paper’s shape. For a post, set the Size to 16:9 first.' },
          { to: 'slides', label: 'A video with slides', text: 'A slide holds the page for a few seconds after a day, with its own marks, like an arrow or a zone.' },
        ],
      },
      {
        id: 'still',
        at: [11, -1],
        tool: 'plate',
        icon: 'image',
        label: 'A picture',
        // the picture is the plate out: the journey ends here, as it does after the video
        next: [],
        shot: 'plate-export',
        text: 'Export the page as a file.',
        marks: [
          { anchor: 'plate.export', shot: 'plate-marked', title: 'Export', tip: 'The file takes the plate’s name. Change it under File name, at the top of the dialog.' },
          { anchor: 'plate.export-formats', title: 'Format', look: true },
          { anchor: 'plate.export-quality', title: 'Resolution', typed: true },
          { anchor: 'plate.export-go', title: 'Export', tip: 'To Post, beside it, files the picture in the case and opens a post with it.' },
        ],
        does: {
          'plate.export': 'Press Export at the top right.',
          'plate.export-formats': 'For a report, take PNG, or Copy image to paste it straight in. Take PDF when the plate is a page on its own, and Evolution sheet to lay its days side by side.',
          'plate.export-quality': 'Pick Print, 300 dpi, for a report or paper, or Screen, 150 dpi, for a post.',
          'plate.export-go': 'Press Export. It runs in the background, with progress in the top bar.',
        },
        then: 'A note says the file is written. Its Show button opens the case’s exports folder, or the one set in Settings › Storage › Views and comparisons.',
      },
      {
        id: 'slides',
        at: [10.5, 1],
        tool: 'plate',
        icon: 'stack',
        label: 'Slides',
        optional: true,
        next: ['video'],
        shot: 'plate-slide',
        text: 'Add a slide after a day, with marks of its own.',
        marks: [
          { anchor: 'plate.slide-add', shot: 'plate-marked', title: 'Add a slide' },
          { anchor: 'plate.add', title: 'Add' },
          { anchor: 'plate.add-arrow', shot: 'plate-add-arrow', title: 'Arrow' },
          { anchor: 'plate.map', shot: 'plate-arrow', title: 'Draw it', typed: true },
        ],
        does: {
          'plate.slide-add': 'Press + after the day’s tile under the page.',
          'plate.add': 'Press Add.',
          'plate.add-arrow': 'Press Arrow, under On the map.',
          'plate.map': 'Drag on the map from where the arrow starts to where it points.',
        },
        then: 'Slide 1 with its arrow, after 3 February 2009. The next pictures show the plate without it.',
      },
      {
        id: 'video',
        at: [11, 1],
        tool: 'plate',
        icon: 'play',
        label: 'A video',
        shot: 'plate-export-video',
        text: 'The video plays each day a layer changes, in order, each followed by its slides.',
        marks: [
          { anchor: 'plate.export', shot: 'plate-marked', title: 'Export' },
          { anchor: 'plate.export-mp4', title: 'MP4', tip: 'Days sets the first and last day it plays.' },
          { anchor: 'plate.export-hold', shot: 'plate-export-mp4', title: 'Each day', typed: true },
          { anchor: 'plate.export-name', shot: 'plate-export-held', title: 'File name', typed: true },
          { anchor: 'plate.export-go', shot: 'plate-export-named', title: 'Export' },
        ],
        does: {
          'plate.export': 'Press Export at the top right.',
          'plate.export-mp4': 'Press MP4. GIF, under it, makes a loop for a post.',
          'plate.export-hold': 'Set how long each day holds. 2 to 3 seconds reads well.',
          'plate.export-name': 'Rename the file for the span it covers, as it still reads 3 February 2009.',
          'plate.export-go': 'Press Export. It runs in the background, with progress in the top bar.',
        },
        then: 'A note says the file is written. Its Show button opens the folder.',
      },
    ],
    result: {
      shot: 'plate-result',
      text: 'Your plate on 3 February 2009, as it leaves the app.',
      after: {
        video: { shot: 'plate-video-result', text: 'Your video, each day in turn, the label on every day and the slide after its day.' },
        'card-out': { shot: 'plate-card-result', text: 'Your card, the photo beside its place and the match numbered.' },
        'pair-out': { shot: 'plate-pair-result', text: 'Your before and after, each map on its date.' },
      },
    },
  },
  {
    id: 'write-an-article',
    title: 'Write an article',
    lead: 'From a template to a sourced article that places the photo of the YM Success, checked, then out as a PDF, a web page or a WordPress draft, and corrected.',
    steps: [
      {
        id: 'go',
        at: [0, 0],
        tool: 'notebook',
        icon: 'note',
        label: 'Notebook',
        shot: 'article-home',
        text: 'An article is a case note, written in the Notebook.',
        marks: [
          { anchor: 'rail.compose', shot: 'article-go-map', tool: 'satellite', place: 'Satellite', title: 'Compose' },
          { anchor: 'tab.notebook', shot: 'article-go-compose', tool: 'proof', place: 'Geo Proof', title: 'Notebook' },
        ],
        does: {
          'rail.compose': 'Press Compose on the left rail.',
          'tab.notebook': 'Press the Notebook tab.',
        },
        then: 'Notes, the case’s notes above the templates a new one starts from.',
      },
      {
        id: 'start',
        at: [1, 0],
        tool: 'notebook',
        icon: 'file',
        label: 'Web article',
        shot: 'article-new',
        text: 'The template lays out an article’s parts, each with a grey line saying what goes there.',
        marks: [
          { anchor: 'notebook.start-article', shot: 'article-home', title: 'Web article' },
          { anchor: 'notebook.name', title: 'Note name', typed: true },
          { anchor: 'notebook.view-page', shot: 'article-titled', title: 'Page' },
        ],
        does: {
          'notebook.start-article': 'Press Web article under Start from.',
          'notebook.name': 'Type the headline over the selected name. Lead with the finding: A photo of the YM Success, placed on the west bank of the Main Channel.',
          'notebook.view-page': 'Press Page in the header. The page as readers will get it appears beside your words and updates as you type.',
        },
        tip: 'Writing a report to print instead? Geolocation report, next to it, works the same way, laid out for pages.',
        then: 'Your article under its headline, its page beside it.',
      },
      {
        id: 'lead',
        at: [2, 0],
        tool: 'notebook',
        icon: 'text',
        label: 'Lead',
        shot: 'article-paged',
        text: 'In two sentences, say what you found and what it rests on.',
        marks: [{ anchor: 'notebook.guidance', title: 'The first grey line', typed: true }],
        does: {
          'notebook.guidance': 'Click the first grey line and type the lead: A photo of the container ship YM Success, posted with no caption, was taken from the west bank of the Main Channel, in the Port of Los Angeles. The bridge and the cranes behind the ship line up only from there.',
        },
        tip: 'Grey lines never print. Each part keeps its own until you type over it.',
        then: 'The lead under the headline, What happened below it.',
      },
      {
        id: 'cite',
        at: [3, 0],
        tool: 'notebook',
        icon: 'at',
        label: 'Cite',
        shot: 'article-cited',
        text: 'Cite every fact. The post and the photo are already in the case.',
        marks: [
          {
            anchor: 'notebook.text',
            shot: 'article-lead',
            title: 'Type @',
            text: 'Click the grey line under What happened and type the first fact: The photo was posted with no caption and no place. Before the full stop, type @ and harb, then press harbor_watch post, the post the photo came from.',
          },
          {
            anchor: 'notebook.text',
            shot: 'article-fact',
            title: 'The photo, cited',
            text: 'Type the full stop and the next fact: The name YM Success reads on the ship’s stern in the photo. Cite the photo the same way, with @ and bridge, then press bridge_channel.',
          },
          {
            anchor: 'notebook.cite-card',
            shot: 'article-cited',
            title: 'The source’s card',
            look: true,
            text: 'With the cursor just after a chip, its card shows what the case knows of the source. For the post, Posted reads Not recorded, since its own date is unknown. Not archived is dealt with at the Check step.',
          },
        ],
        tip: 'A chip opens what it names. On the web page, readers get the same card over the words.',
        then: 'Both facts cited, What the evidence shows below.',
      },
      {
        id: 'figure',
        at: [4, 0],
        tool: 'notebook',
        label: 'Which figure?',
        ask: true,
        shot: 'article-evidence-grey',
        text: 'Which figure shows the evidence?',
        choices: [
          { to: 'table', label: 'A table', text: 'Rows side by side, such as the three ports checked and which has the bridge.' },
          { to: 'chart', label: 'A chart', text: 'Dated rows on a timeline, in this example the case’s photos of this channel.' },
          { to: 'diagram', label: 'A diagram', text: 'Steps joined by arrows, to show how the port was found.' },
          { to: 'map-ask', label: 'No figure', text: 'The proof and the words carry the evidence.' },
        ],
      },
      {
        id: 'chart',
        at: [5, -1],
        tool: 'notebook',
        icon: 'chart',
        label: 'Chart',
        optional: true,
        next: ['map-ask'],
        shot: 'article-chart-added',
        text: 'A timeline of the case’s dated photos of this channel, filled from the case.',
        marks: [
          {
            anchor: 'notebook.guidance',
            shot: 'article-evidence-grey',
            title: 'The grey line',
            typed: true,
            text: 'Click the grey line under What the evidence shows and type: The case holds three dated photos of this stretch of the channel, from 2006 to 2020. Press Enter.',
          },
          { anchor: 'notebook.text', shot: 'article-chart-evidence', title: 'Type /' },
          { anchor: 'notebook.chart-timeline', shot: 'article-chart-kinds', title: 'Timeline' },
          { anchor: 'notebook.chart-fill', shot: 'article-chart-form', title: 'Fill from the case' },
          { anchor: 'notebook.fill-add', shot: 'article-chart-fill', title: 'Add' },
          { anchor: 'notebook.chart-source', title: 'Source', typed: true },
        ],
        does: {
          'notebook.text': 'On the empty line, type / and chart, then press Chart.',
          'notebook.chart-timeline': 'Press Timeline under From scratch. Its form opens on the chart.',
          'notebook.chart-fill': 'Press Fill from the case… to list what the case dates.',
          'notebook.fill-add': 'Untick The photo was taken from the west bank of the Main Channel. It is the same photo as the line above, and would count twice. Then press Add 3 events.',
          'notebook.chart-source': 'In Source, type where the dates come from: The posts the three photos came from, in the case. Press Enter. Export flags a chart with no source.',
        },
        then: 'The timeline in the article, its source under it.',
      },
      {
        id: 'table',
        at: [5, 0],
        tool: 'notebook',
        icon: 'table',
        label: 'Table',
        next: ['map-ask'],
        shot: 'article-table-empty',
        text: 'A table of the three ports checked shows why only one fits.',
        marks: [
          {
            anchor: 'notebook.guidance',
            shot: 'article-evidence-grey',
            title: 'The grey line',
            typed: true,
            text: 'Click the grey line under What the evidence shows and type: Of the three ports checked, only Los Angeles has a green suspension bridge over its berths. Press Enter.',
          },
          { anchor: 'notebook.insert-table', shot: 'article-insert-table', title: 'Table' },
          { anchor: 'notebook.table-size', shot: 'article-table-size', title: 'Its size' },
          { anchor: 'notebook.table', title: 'Its cells', typed: true },
        ],
        does: {
          'notebook.insert-table': 'On the empty line, type /tab and press Table.',
          'notebook.table-size': 'Click the square two across and three down, for two columns and three rows under their names.',
          'notebook.table': 'Fill the cells, pressing Tab between them: Port and Green suspension bridge, then Los Angeles, Main Channel and Yes, the Vincent Thomas Bridge, then Charleston, Wando Welch Terminal and No, then Miami and No. Press Escape to leave the table.',
        },
        tip: 'Cells copied from a spreadsheet and pasted on an empty line make a table too.',
        then: 'The table in the article, the empty line under it.',
      },
      {
        id: 'diagram',
        at: [5, 1],
        tool: 'notebook',
        icon: 'network',
        label: 'Diagram',
        optional: true,
        next: ['map-ask'],
        shot: 'article-diagram-form',
        text: 'A diagram of how the port was found, drawn from a form.',
        marks: [
          {
            anchor: 'notebook.guidance',
            shot: 'article-evidence-grey',
            title: 'The grey line',
            typed: true,
            text: 'Click the grey line under What the evidence shows and type: The port was found in three steps. Press Enter.',
          },
          { anchor: 'notebook.insert-diagram', shot: 'article-insert-diagram', title: 'Diagram' },
          { anchor: 'notebook.diagram-flow', shot: 'article-diagram-kinds', title: 'Flow' },
          { anchor: 'notebook.diagram-form', title: 'Its boxes', typed: true },
        ],
        does: {
          'notebook.insert-diagram': 'On the empty line, type /diag and press Diagram.',
          'notebook.diagram-flow': 'Press Flow, for steps and decisions joined by arrows.',
          'notebook.diagram-form': 'Type your steps over the example’s four boxes: Photo posted with no place, A green suspension bridge over the berths?, Los Angeles, Main Channel, then Charleston or Miami, ruled out. The drawing updates as you type.',
        },
        then: 'The diagram in the article, drawn from its boxes.',
      },
      {
        id: 'map-ask',
        at: [6, 0],
        tool: 'notebook',
        label: 'A map?',
        ask: true,
        shot: 'article-after-figure',
        text: 'Does the article need a map?',
        choices: [
          { to: 'map', label: 'A live map', text: 'Your layers, live on the web page and as a picture in the PDF. A WordPress draft leaves it out.' },
          { to: 'proof', label: 'No map', text: 'The proof already shows the place.' },
        ],
      },
      {
        id: 'map',
        at: [6.5, -1],
        tool: 'notebook',
        icon: 'mapArea',
        label: 'Map',
        optional: true,
        next: ['proof'],
        shot: 'article-map-ground',
        text: 'Put the case’s layers in the article as an interactive map.',
        marks: [
          { anchor: 'notebook.insert-map', shot: 'article-insert-map', title: 'Interactive map' },
          { anchor: 'notebook.map-title', shot: 'article-map-picker', title: 'Title', typed: true },
          { anchor: 'notebook.map-layer', shot: 'article-map-titled', title: 'Channel observations' },
          { anchor: 'notebook.map-ground', shot: 'article-map-ticked', title: 'Ground' },
          {
            anchor: 'notebook.map-put',
            title: 'Put the map',
            tip: 'The ground is fetched once, when you put the map, and kept in the case.',
          },
        ],
        does: {
          'notebook.insert-map': 'On the empty line, type /map and press Interactive map.',
          'notebook.map-title': 'Type the title Where the photo was taken.',
          'notebook.map-layer': 'Tick Channel observations, the layer with the camera’s spot, the berth and the line of sight between them.',
          'notebook.map-ground': 'Pick USGS Imagery under Ground. Sentinel-2, offered first, is too coarse for a port.',
          'notebook.map-put': 'Press Put the map.',
        },
        then: 'The map in the article, the empty line under it.',
      },
      {
        id: 'proof',
        at: [7, 0],
        tool: 'notebook',
        icon: 'image',
        label: 'The proof',
        shot: 'article-proof',
        text: 'The proof is the picture Geo Proof made of the match, the same tower and cranes marked on the photo and on the imagery.',
        marks: [
          {
            anchor: 'notebook.text',
            shot: 'article-proof-line',
            title: 'What it shows',
            typed: true,
            text: 'On the empty line under your figure or map, type what the proof shows: From high on the west bank at 33.741680, -118.279460, the bridge’s east tower stands right behind the Evergreen cranes, as in the photo. The ship is in the channel at 33.745500, -118.274000, the point the proof gives. Press Enter.',
          },
          { anchor: 'notebook.picture', shot: 'article-proof-icon', title: 'The picture icon' },
          { anchor: 'notebook.picture-proof', shot: 'article-picture-menu', title: 'Your proof' },
        ],
        does: {
          'notebook.picture': 'Press the picture icon, Put in a case picture.',
          'notebook.picture-proof': 'Type proof, then press your proof in the list. The photo alone, or a map capture, goes in the same way.',
        },
        tip: 'No figure? Type on the grey line under What the evidence shows instead. A decimal point gets a ⌖ that shows it on the map.',
        then: 'The proof in the article, under your sentence.',
      },
      {
        id: 'limits',
        at: [8, 0],
        tool: 'notebook',
        icon: 'alert',
        label: 'Limits',
        shot: 'article-link-field',
        text: 'State what is still unverified and how you checked, then link the source the case does not hold.',
        marks: [
          { anchor: 'notebook.unverified', shot: 'article-limits', title: 'Unverified', typed: true },
          { anchor: 'notebook.guidance', shot: 'article-limits-method', title: 'Method and limits', typed: true },
          { anchor: 'notebook.bubble-link', shot: 'article-link-select', title: 'Link' },
          { anchor: 'notebook.link-go', title: 'Link the address' },
        ],
        does: {
          'notebook.unverified': 'In the UNVERIFIED box, select What is not settled yet. and type over it: The photo was taken on 3 February 2009, the day the post gives.',
          'notebook.guidance': 'Click the grey line under Method and limits and type: The bridge and the cranes were matched by eye on USGS imagery from The National Map, which does not say when it was taken. The account’s other port photos are not checked yet.',
          'notebook.bubble-link': 'Select The National Map in your words, then press Link in the bar above them.',
          'notebook.link-go': 'Paste https://www.usgs.gov/programs/national-geospatial-program/national-map and press Link, since the case does not hold that page.',
        },
        tip: 'Write every figure as a minimum, as the grey line says: at least 60, not 60.',
        then: 'The National Map, linked in your words.',
      },
      {
        id: 'internal',
        at: [9, 0],
        tool: 'notebook',
        icon: 'lock',
        label: 'For the team',
        shot: 'article-look',
        text: 'A passage marked Internal stays with the team and never publishes.',
        marks: [
          {
            anchor: 'notebook.text',
            shot: 'article-team-line',
            title: 'The line for the team',
            typed: true,
            text: 'On the empty line at the end, type what only the team needs: Ask the Port of Los Angeles for the YM Success’s berth dates in early 2009.',
          },
          {
            anchor: 'notebook.bubble-internal',
            shot: 'article-internal',
            title: 'Internal',
            tip: 'A PDF for the team prints internal passages in marked boxes. A web page or a WordPress draft always leaves them out.',
          },
        ],
        does: {
          'notebook.bubble-internal': 'With that line selected, press Internal, the lock in the bar above it.',
        },
        then: 'The line in its own colour, marked Internal.',
      },
      {
        id: 'look',
        at: [10, 0],
        tool: 'notebook',
        icon: 'brush',
        label: 'Look',
        shot: 'article-look-done',
        text: 'Look sets how the article prints and reads online, and is saved with it.',
        marks: [
          { anchor: 'notebook.look', title: 'Look' },
          {
            anchor: 'notebook.look-cover',
            shot: 'article-look-style',
            title: 'Cover',
            tip: 'Beside Cover, Text sets the typeface, and Page the paper and the accent colour.',
          },
          { anchor: 'notebook.cover-style', shot: 'article-look-cover', title: 'The style’s' },
          { anchor: 'notebook.cover-subtitle', shot: 'article-look-styled', title: 'Subtitle', typed: true },
          { anchor: 'notebook.cover-picture', shot: 'article-look-subtitled', title: 'Choose a picture' },
          {
            anchor: 'notebook.cover-pick',
            shot: 'article-look-pictures',
            title: 'The photo',
            tip: 'Day, under it, sets the date the cover prints. Signed adds your name from Settings › Publishing.',
          },
        ],
        does: {
          'notebook.look': 'Press Look in the header. It opens on Style, already set to Web article by the template.',
          'notebook.look-cover': 'Press the Cover tab.',
          'notebook.cover-style': 'Press The style’s, for a cover with the title, a line under it and a picture.',
          'notebook.cover-subtitle': 'Credit the photo on the line under the title. Type Photo: posted by @harbor_watch, cited below.',
          'notebook.cover-picture': 'Press Choose a picture.',
          'notebook.cover-pick': 'Type bridge to find the photo, then press it. Press Escape to close Look.',
        },
        then: 'Your article, Look closed, the photo on its cover.',
      },
      {
        id: 'read',
        at: [11, 0],
        tool: 'notebook',
        icon: 'eye',
        label: 'Read it',
        shot: 'article-page-public',
        text: 'The page beside your words is the PDF. Check the web version too.',
        marks: [
          {
            anchor: 'notebook.page-html',
            shot: 'article-look-done',
            title: 'HTML',
            tip: 'The corners icon at the end of that bar shows the page full screen, at phone or desktop width.',
          },
          {
            anchor: 'notebook.page-public',
            shot: 'article-page-html',
            title: 'Public',
            tip: 'Look’s Web page row also offers Story, which holds each picture still while the words after it scroll by.',
          },
        ],
        does: {
          'notebook.page-html': 'Press HTML above the pages to see the web page.',
          'notebook.page-public': 'Press Public, beside Internal, to see what readers outside the team get, without the line for the team.',
        },
        then: 'The public web page beside the article.',
      },
      {
        id: 'check',
        at: [12, 0],
        tool: 'notebook',
        icon: 'check',
        label: 'Check',
        shot: 'article-archive',
        text: 'Before it goes out, a panel lists what needs a look and how to fix each one.',
        marks: [
          { anchor: 'notebook.ready-badge', shot: 'article-page-public', title: 'To look at' },
          {
            anchor: 'notebook.ready-archive',
            shot: 'article-ready',
            title: 'Archive every link…',
            tip: 'Bookmark it, on the line below, files the page in the case so its card records when you read it.',
          },
          { anchor: 'notebook.archive-go', title: 'Archive' },
        ],
        does: {
          'notebook.ready-badge': 'Press the count in the header, 2 to look at. It reads Ready once nothing is left.',
          'notebook.ready-archive': 'Press Archive every link… beside the line about links with no archived copy.',
          'notebook.archive-go': 'Press Archive 1 link. The Internet Archive keeps a copy in case the page goes down, and the source card then reads Archived.',
        },
        tip: 'Want a colleague to check it first? Export › For review writes a file with only what its page needs.',
        then: 'The dialog counts the links as they are archived. Close returns to the article.',
      },
      {
        id: 'where',
        at: [13, 0],
        tool: 'notebook',
        label: 'Where to?',
        ask: true,
        shot: 'article-page-public',
        text: 'Where does the article go?',
        choices: [
          { to: 'pdf', label: 'A PDF', text: 'Pages to print, attach or send, its map as a picture.' },
          { to: 'site', label: 'My own site', text: 'A free web page on GitHub Pages. It shows your GitHub name until the site has its own.' },
          { to: 'wordpress', label: 'A WordPress site', text: 'A draft on a WordPress you host, not WordPress.com. The live map stays out.' },
        ],
      },
      {
        id: 'pdf',
        at: [14, -1],
        tool: 'notebook',
        icon: 'file',
        label: 'PDF',
        next: ['correct'],
        shot: 'article-export',
        text: 'A PDF for readers outside the team leaves the internal passage out.',
        marks: [
          { anchor: 'notebook.pdf', shot: 'article-page-public', title: 'Export' },
          { anchor: 'notebook.edition-public', title: 'Public' },
          {
            anchor: 'notebook.export-go',
            shot: 'article-export-public',
            title: 'Export PDF',
            tip: 'Each export is a new file in the case’s exports folder; earlier ones are kept.',
          },
        ],
        does: {
          'notebook.pdf': 'Press Export in the header. It opens on PDF.',
          'notebook.edition-public': 'Press Public beside Edition to leave the internal passage out.',
          'notebook.export-go': 'Press Export PDF. It reads Export anyway while Before you export still lists something.',
        },
        then: 'The article, its PDF in the exports folder.',
      },
      {
        id: 'site',
        at: [14, 0],
        tool: 'notebook',
        icon: 'globe',
        label: 'Your site',
        next: ['publish'],
        shot: 'article-export',
        text: 'GitHub Pages hosts your site for free. Connect it once from the export.',
        marks: [
          { anchor: 'notebook.pdf', shot: 'article-page-public', title: 'Export' },
          {
            anchor: 'notebook.format-web',
            title: 'Web folder',
            tip: 'A web folder exported again under the same name replaces the last one on disk. Editions still lists each export.',
          },
          { anchor: 'notebook.publish', shot: 'article-export-web', title: 'Publish to GitHub Pages' },
          { anchor: 'notebook.website-open', shot: 'article-export-setup', title: 'Open Settings › Website' },
          { anchor: 'settings.hub-hosting', shot: 'article-website', tool: 'settings', settings: 'website', place: 'Settings', title: 'Hosting' },
          {
            anchor: 'settings.github',
            shot: 'article-hosting',
            tool: 'settings',
            settings: 'website',
            place: 'Settings',
            title: 'GitHub Pages',
            typed: true,
            tip: 'A GitHub account, a public repository and Pages cost nothing. The token stays on this computer.',
          },
        ],
        does: {
          'notebook.pdf': 'Press Export in the header.',
          'notebook.format-web': 'Press Web folder beside Format.',
          'notebook.publish': 'Press Publish to GitHub Pages.',
          'notebook.website-open': 'GitHub is not connected yet, and the dialog says what it needs. Press Open Settings › Website.',
          'settings.hub-hosting': 'Press the Hosting tab.',
          'settings.github': 'Enter your GitHub account, the repository and a token. How to make the repository and the token, under them, walks through each step. Test connection checks them.',
        },
        then: 'Settings, Hosting, your GitHub Pages filled in.',
      },
      {
        id: 'publish',
        at: [15, 0],
        tool: 'notebook',
        icon: 'upload',
        label: 'Publish',
        next: ['correct'],
        shot: 'article-export-github',
        text: 'With GitHub connected, the article goes online in one press.',
        marks: [
          { anchor: 'rail.compose', shot: 'article-hosting-set', tool: 'settings', settings: 'website', place: 'Settings', title: 'Compose' },
          { anchor: 'notebook.pdf', shot: 'article-page-public', title: 'Export' },
          {
            anchor: 'notebook.site-role',
            title: 'On the site',
            look: true,
            tip: 'Until the site has a name, its address and Author show your GitHub account. Change that with Name the site, under it, and Author.',
          },
          { anchor: 'notebook.publish', title: 'Publish to GitHub Pages' },
        ],
        does: {
          'rail.compose': 'Press Compose on the left rail. The article is still open.',
          'notebook.pdf': 'Press Export. It opens on Web folder now.',
          'notebook.site-role': 'Unlisted, the default, puts the page online without listing it, so you can read it there first. It is not private, since the repository is public. Article lists it on the site the next time you publish.',
          'notebook.publish': 'Press Publish to GitHub Pages.',
        },
        then: 'The dialog follows GitHub building the page, then shows Live with its address, Open and Copy link. Done returns to the article.',
      },
      {
        id: 'wordpress',
        at: [14, 1],
        tool: 'notebook',
        icon: 'edit',
        label: 'WordPress',
        next: ['send'],
        shot: 'article-export',
        text: 'A WordPress site takes the article as a draft. Connect it once from the export.',
        marks: [
          { anchor: 'notebook.pdf', shot: 'article-page-public', title: 'Export' },
          { anchor: 'notebook.format-wordpress', title: 'WordPress draft' },
          { anchor: 'notebook.website-open', shot: 'article-export-wp', title: 'Open Settings › Website' },
          { anchor: 'settings.hub-wordpress', shot: 'article-website', tool: 'settings', settings: 'website', place: 'Settings', title: 'WordPress' },
          {
            anchor: 'settings.wordpress',
            shot: 'article-wordpress',
            tool: 'settings',
            settings: 'website',
            place: 'Settings',
            title: 'Your site',
            typed: true,
            tip: 'Application passwords are free and built into WordPress. A site hosted on WordPress.com cannot take one.',
          },
        ],
        does: {
          'notebook.pdf': 'Press Export in the header.',
          'notebook.format-wordpress': 'Press WordPress draft beside Format.',
          'notebook.website-open': 'No site is connected yet, and the dialog says what it needs. Press Open Settings › Website.',
          'settings.hub-wordpress': 'Press the WordPress tab, the last one.',
          'settings.wordpress': 'Enter the site’s address, your username and an application password made in your WordPress profile. Test connection checks them.',
        },
        then: 'Settings, WordPress, your site filled in.',
      },
      {
        id: 'send',
        at: [15, 1],
        tool: 'notebook',
        icon: 'upload',
        label: 'Send',
        next: ['correct'],
        shot: 'article-export-wp-set',
        text: 'The draft goes over with its pictures and sources. You publish it from WordPress.',
        marks: [
          { anchor: 'rail.compose', shot: 'article-wordpress-set', tool: 'settings', settings: 'website', place: 'Settings', title: 'Compose' },
          { anchor: 'notebook.pdf', shot: 'article-page-public', title: 'Export' },
          { anchor: 'notebook.send-draft', title: 'Send as a draft' },
        ],
        does: {
          'rail.compose': 'Press Compose on the left rail. The article is still open.',
          'notebook.pdf': 'Press Export. It opens on WordPress draft now.',
          'notebook.send-draft': 'Press Send as a draft. It lists what stays out, the live map included. Nothing goes public.',
        },
        then: 'Draft saved in WordPress, with Preview and Open in WordPress. Close returns to the article.',
      },
      {
        id: 'correct',
        at: [16, 0],
        tool: 'notebook',
        icon: 'edit',
        label: 'Correct',
        shot: 'article-compare',
        text: 'Every export is kept, so a correction can show what changed, in this example the day of the photo.',
        marks: [
          { anchor: 'notebook.unverified', shot: 'article-correct', title: 'The day', typed: true },
          { anchor: 'notebook.more', shot: 'article-corrected', title: 'More' },
          { anchor: 'notebook.editions', shot: 'article-more', title: 'Editions' },
          { anchor: 'notebook.compare', shot: 'article-editions', title: 'Compare' },
        ],
        does: {
          'notebook.unverified': 'Select the words in the UNVERIFIED box and type the correction: The post gives 3 February 2009 as the day of the photo. Nothing in the photo confirms it.',
          'notebook.more': 'Press More, the three dots at the end of the header.',
          'notebook.editions': 'Press Editions. It lists every PDF, page and draft of the article, newest first.',
          'notebook.compare': 'Press Compare to set that edition against the article as it stands.',
        },
        then: 'What changed, removed words struck through and added words in green.',
      },
      {
        id: 'changed',
        at: [17, 0],
        tool: 'notebook',
        icon: 'download',
        label: 'Say what changed',
        shot: 'article-export-corrected',
        text: 'Tell readers about the correction in one line at the end of the page.',
        marks: [
          { anchor: 'notebook.correction', shot: 'article-compare', title: 'Write the correction from this' },
          { anchor: 'notebook.correction-line', shot: 'article-correction', title: 'What changed', typed: true },
          { anchor: 'notebook.correction-export', shot: 'article-correction-typed', title: 'Export with this line…' },
          {
            anchor: 'notebook.export-go',
            title: 'Export HTML',
            tip: 'The line goes into the next HTML page or web folder. A PDF or a WordPress draft is just exported again, corrected.',
          },
        ],
        does: {
          'notebook.correction': 'Press Write the correction from this.',
          'notebook.correction-line': 'Type over the drafted line what a reader needs to know: An earlier version said the photo was taken on 3 February 2009. That day is only the one the post gives.',
          'notebook.correction-export': 'Press Export with this line… to open the export on an HTML page, the line under What changed.',
          'notebook.export-go': 'Press Export HTML, which reads Export anyway because the link to The National Map is not bookmarked yet. For your site, Web folder then Publish to GitHub Pages carry the line too.',
        },
        then: 'The HTML page written to the case’s exports folder.',
      },
    ],
    result: {
      shot: 'article-result',
      text: 'The web page as readers get it, from the headline to the correction, the map live.',
    },
  },
  {
    id: 'search-with-find',
    title: 'Search with Find',
    lead: 'The 1901 photo of Half Dome: from its skyline to the spot it was taken from, each mark set for a reason.',
    steps: [
      {
        id: 'find',
        at: [0, 0],
        tool: 'horizon',
        icon: 'search',
        label: 'Find',
        shot: 'find-go-horizon',
        text: 'Find matches the skyline you trace on a photo against the terrain, to point at where it may have been taken.',
        marks: [
          { anchor: 'rail.map', shot: 'find-go-home', title: 'Map' },
          { anchor: 'tab.horizon', shot: 'find-go-map', title: 'Horizon' },
          { anchor: 'horizon.find', title: 'Find' },
          {
            anchor: 'picker.search',
            shot: 'find-go-pick',
            title: 'Search names',
            typed: true,
            tip: 'Your own photo? Drop it on this window, or press Choose on this computer…',
          },
          { anchor: 'picker.first', shot: 'find-go-typed', title: 'Your photo', tip: 'The first time, a notice says Find is in beta. Press Got it.' },
        ],
        does: {
          'rail.map': 'Press Map on the left rail.',
          'tab.horizon': 'Press the Horizon tab.',
          'horizon.find': 'Press Find at the top left. It asks for the photo first.',
          'picker.search': 'Type half to find the photo by its name.',
          'picker.first': 'Press the photo.',
        },
        tip: 'Find ranks places to check. It proves none on its own.',
        then: 'Find, your photo on the left, the map in the middle, the steps on the right.',
      },
      {
        id: 'clear',
        at: [1, 0],
        tool: 'horizon',
        label: 'Clear skyline?',
        ask: true,
        shot: 'find-photo',
        text: 'Does the photo show a skyline far off, a few kilometres or more?',
        choices: [
          { to: 'skyline', label: 'Yes, far relief', text: 'Peaks and notches in the distance. If only part of it shows, trace only that part.' },
          { to: 'by-eye', label: 'Near slopes, or flat', text: 'Hills a few hundred metres off, a plain or only the sea. Many places look alike.' },
        ],
      },
      {
        id: 'by-eye',
        at: [1.5, 1],
        tool: 'horizon',
        icon: 'image',
        label: 'By eye',
        optional: true,
        next: ['skyline'],
        shot: 'find-eye-view',
        text: 'On a skyline like this, Find hits many look-alikes. Check your suspects by eye first.',
        marks: [
          { anchor: 'find.overlay', shot: 'find-photo', title: 'Overlay' },
          { anchor: 'horizon.map', shot: 'find-eye-pick', title: 'Where to stand' },
          { anchor: 'horizon.overlay', title: 'Photo and terrain', typed: true, tip: 'If they meet, Save at the top right keeps the view in the case.' },
          { anchor: 'horizon.find', title: 'Find' },
        ],
        does: {
          'find.overlay': 'Press Overlay at the top left.',
          'horizon.map': 'Click a suspected spot on the map, or type its coordinates in the search box. The view opens there with your photo over it.',
          'horizon.overlay': 'Drag the terrain under the photo and wheel to zoom until the ridges could meet, then slide from Photo to Terrain. Nothing meets here, so it is not this spot.',
          'horizon.find': 'Press Find to go back. Trace anyway over the smallest area your clues allow, and expect Weak.',
        },
        then: 'Find, your photo on the left.',
      },
      {
        id: 'skyline',
        at: [2, 0],
        tool: 'horizon',
        icon: 'freehand',
        label: 'Skyline',
        shot: 'find-tracing',
        text: 'Find reads only the lines you trace, never the photo itself.',
        marks: [
          { anchor: 'find.enlarge', shot: 'find-photo', title: 'Enlarge the photo' },
          {
            anchor: 'find.skyline',
            shot: 'find-big',
            title: 'Trace',
            tip: 'Detect, on the same bar, drafts a line from the colours of sky and land. Rub out anything that is not land.',
          },
          {
            anchor: 'find.canvas',
            title: 'The skyline',
            typed: true,
            tip: 'Leave out trees, roofs and clouds. A gap does less harm than a wrong line. The line snaps to the nearest edge, so hold Alt where it jumps to the wrong one.',
          },
        ],
        does: {
          'find.enlarge': 'Press the enlarge icon at the bottom right of the photo to trace it large.',
          'find.skyline': 'Press Trace at the top left of the photo.',
          'find.canvas': 'Drag along the edge of the land against the sky. Lift where one mountain passes behind another, and at each end of a peak you will mark. This photo takes four lines, the Dome on its own.',
        },
        then: 'The skyline in four yellow lines, Trace still lit.',
      },
      {
        id: 'ridges',
        at: [3, 0],
        tool: 'horizon',
        icon: 'ridge',
        label: 'Ridges',
        shot: 'find-ridging',
        text: 'A ridge is an edge of land seen in front of farther land, not against the sky.',
        marks: [
          { anchor: 'find.ridge', shot: 'find-sky', title: 'Trace a ridge' },
          {
            anchor: 'find.canvas',
            title: 'The ridges',
            typed: true,
            tip: 'Skip snow lines, forest edges, shadows and falls; a ridge has farther land right behind it. Find picks the spot from the skyline, so a doubtful ridge only lowers the true place.',
          },
        ],
        does: {
          'find.ridge': 'Press Trace a ridge, the icon just right of Trace.',
          'find.canvas': 'Drag along each ridge you see clearly: the dark wooded ridge under the far range, the Dome’s right flank, and Liberty Cap, the rounded dome on the right.',
        },
        then: 'Seven lines: four of skyline in yellow, three ridges in blue.',
      },
      {
        id: 'key',
        at: [4, 0],
        tool: 'horizon',
        icon: 'star',
        label: 'Key line',
        shot: 'find-keying',
        text: 'A key line is a stretch of skyline you would know anywhere. Find weighs it most.',
        marks: [
          { anchor: 'find.key', shot: 'find-ridged', title: 'Mark a key line' },
          { anchor: 'find.canvas', title: 'The Dome', tip: 'Pick a peak or a notch you traced closely, three at most. On a dull stretch a key line adds nothing.' },
        ],
        does: {
          'find.key': 'Press Mark a key line, the star icon.',
          'find.canvas': 'Click the Dome’s yellow line, its skyline.',
        },
        then: 'A pink Key tag on the Dome’s line.',
      },
      {
        id: 'far',
        at: [5, 0],
        tool: 'horizon',
        icon: 'ruler',
        label: 'Distances',
        shot: 'find-ruler',
        text: 'Give each line a generous range of distance. A wrong range rules the true spot out.',
        marks: [
          { anchor: 'find.far', shot: 'find-keyed', title: 'Say how far a line stands' },
          {
            anchor: 'find.bands',
            title: 'The How far bar',
            typed: true,
            tip: 'The Dome looks close but stands 4 km off, so 1–3 km alone would rule the true spot out.',
          },
          {
            anchor: 'find.canvas',
            shot: 'find-far-one',
            title: 'The far range',
            typed: true,
            tip: 'Haze grows with distance, so pale land with no detail is far. Unsure? Leave the line unmarked; that costs nothing.',
          },
        ],
        does: {
          'find.far': 'Press Say how far a line stands, the ruler icon.',
          'find.bands': 'On the How far bar, tick < 1 km and 3–10 km beside 1–3 km. Then click the Dome’s yellow line and Liberty Cap to mark both under 10 km.',
          'find.canvas': 'Untick those three, tick 10–30 km and > 30 km, then click the far range’s yellow line to mark it over 10 km.',
        },
        then: 'A distance tag just under each line you marked.',
      },
      {
        id: 'hazy',
        at: [6, 0],
        tool: 'horizon',
        label: 'Hazy?',
        ask: true,
        shot: 'find-marked',
        text: 'Is the far land pale, under a milky sky?',
        choices: [
          { to: 'haze', label: 'Yes, pale', text: 'Find then reads that line as a ridge that may hide higher land.' },
          { to: 'place', label: 'No, crisp', text: 'Skip it. On a crisp skyline it throws the best evidence away.' },
        ],
      },
      {
        id: 'haze',
        at: [6.5, -1],
        tool: 'horizon',
        icon: 'haze',
        label: 'Far land hidden',
        optional: true,
        next: ['place'],
        shot: 'find-hazing',
        text: 'Haze may hide higher land behind the pale far range.',
        marks: [
          { anchor: 'find.hazy', shot: 'find-marked', title: 'Far land hidden' },
          { anchor: 'find.canvas', title: 'The far range', typed: true },
        ],
        does: {
          'find.hazy': 'Press the haze icon, four short lines just left of the eraser.',
          'find.canvas': 'Brush along the pale range, just covering its yellow line. Then press the haze icon again.',
        },
        then: 'A pale blue wash over the far range, the brush put away.',
      },
      {
        id: 'place',
        at: [7, 0],
        tool: 'horizon',
        icon: 'polygon',
        label: 'Area',
        shot: 'find-drawing',
        text: 'Draw where the camera could stand, not where the peaks are. Go round a named place, or over a region when nothing names one.',
        marks: [
          {
            anchor: 'find.enlarge',
            shot: 'find-hazed',
            title: 'Back to three columns',
            tip: 'Skipped the haze? Your photo shows no blue wash; the rest is the same.',
          },
          { anchor: 'find.place', shot: 'find-columns', title: 'The map’s search', typed: true },
          { anchor: 'sat.answer', shot: 'find-place-typed', title: 'Half Dome, California' },
          { anchor: 'find.draw', shot: 'find-place', title: 'Draw the area' },
          {
            anchor: 'find.map',
            title: 'The corners',
            typed: true,
            tip: 'Stay within the farthest distance you marked. The Dome is under 10 km, so draw about 10 km round it. A larger area meets more look-alikes.',
          },
        ],
        does: {
          'find.enlarge': 'Press the enlarge icon again to bring the map back.',
          'find.place': 'Type a name from the photo in the map’s search box, such as Half Dome. Nothing to go on? Skip to Draw the area, with the map zoomed out over the widest region your clues allow.',
          'sat.answer': 'Press Half Dome, California. Then zoom out until the valley and its rims fill the map.',
          'find.draw': 'Press Draw the area under 2 Area.',
          'find.map': 'Click each corner round where the camera could stand, then press Enter.',
        },
        then: 'About 85 km², the points Find will try drawn as cells, coloured by ground like the dots under Eye on.',
      },
      {
        id: 'scale',
        at: [8, 0],
        tool: 'horizon',
        label: 'How wide?',
        ask: true,
        shot: 'find-area',
        text: 'How wide is the area you drew?',
        choices: [
          { to: 'grid', label: 'Round a name', text: 'About 10 km round it. Go straight to a close search.' },
          { to: 'wide', label: 'A whole region', text: 'Search it roughly first, then closely where it points.' },
        ],
      },
      {
        id: 'grid',
        at: [8.5, -1],
        next: ['clues'],
        tool: 'horizon',
        icon: 'grid',
        label: 'Grid',
        shot: 'find-more',
        text: 'The grid sets the spacing of the points Find tries.',
        marks: [
          { anchor: 'find.more', shot: 'find-area', title: 'More settings' },
          { anchor: 'find.grid', title: 'Grid' },
        ],
        does: {
          'find.more': 'Press More settings at the foot of the steps.',
          'find.grid': 'Under Grid, press 50 m. On a small area a finer grid costs little time.',
        },
        then: 'A point every 50 m. What you know sits just above.',
      },
      {
        id: 'wide',
        at: [8.5, 1],
        tool: 'horizon',
        icon: 'polygon',
        label: 'Wide area',
        next: ['clues'],
        shot: 'find-wide-drawn',
        text: 'Search a large region coarsely first, then close in.',
        marks: [
          {
            anchor: 'find.quick',
            title: 'Quick',
            tip: 'After the search, Finer zone under 2 Area draws a zone round the best places. Then Search again to search them closely.',
          },
        ],
        does: {
          'find.quick': 'Press Quick under 3 Mesh. Its grid is twice as wide, to find where to look first.',
        },
        then: 'Your area on a Quick grid. The next pictures show the small area round Half Dome.',
      },
      {
        id: 'clues',
        at: [9, 0],
        tool: 'horizon',
        label: 'Clues?',
        ask: true,
        shot: 'find-grid-set',
        text: 'Can you tell what the camera stood on, a summit, a slope or a valley floor, or how zoomed the photo is?',
        choices: [
          { to: 'know', label: 'Some of it', text: 'Each answer rules out places that cannot be it.' },
          { to: 'search', label: 'Not really', text: 'Skip it. A wrong answer rules the true spot out.' },
        ],
      },
      {
        id: 'know',
        at: [9.5, 1],
        tool: 'horizon',
        icon: 'eye',
        label: 'What you know',
        optional: true,
        next: ['search'],
        shot: 'find-know-open',
        text: 'In this photo the camera stands on a valley’s rim, above the land round it.',
        marks: [
          { anchor: 'find.know', shot: 'find-grid-set', title: 'What you know' },
          { anchor: 'find.stands', title: 'Eye on', tip: 'A valley’s rim can read as either, so press both.' },
          {
            anchor: 'find.over',
            shot: 'find-stands',
            title: 'Eye stands',
            tip: 'Camera › Looking down is for a skyline sitting very low in the frame. Here it sits high, so leave it off.',
          },
          {
            anchor: 'find.zoom',
            shot: 'find-over',
            title: 'Zoom',
            tip: 'A cropped photo hides its zoom, so leave Zoom alone then. Facing and Sun, higher up, rule out the most look-alikes when you know them.',
          },
        ],
        does: {
          'find.know': 'Press What you know under Help the search.',
          'find.stands': 'Under Eye on, press Summit or ridge, then Slope.',
          'find.over': 'Under Eye stands, press Above the land round.',
          'find.zoom': 'Under Zoom, press ×1 and ×2–3. It looks like a normal lens, or a little longer.',
        },
        tip: 'Tick several when unsure, and leave out what you doubt.',
        then: 'Fewer points to search: those ruled out leave the grid.',
      },
      {
        id: 'search',
        at: [10, 0],
        tool: 'horizon',
        icon: 'search',
        label: 'Search',
        shot: 'find-zoomed',
        text: 'Find scores every point of the grid against your lines.',
        marks: [
          { anchor: 'find.search', title: 'Search', tip: 'Skipped What you know? Your panel shows nothing ticked there.' },
          { anchor: 'find.map', title: 'The search running', look: true },
          {
            anchor: 'find.trust',
            shot: 'horizon-find',
            title: 'How far to trust it',
            look: true,
            tip: 'Check against decoys tries the places with your trace mirrored and upside down. A real place explains its own trace far better.',
          },
        ],
        does: {
          'find.search': 'Press Search under 4 Search.',
          'find.map': 'It runs on your computer, about five minutes for this area. Scores replace the ground colours, the best in yellow, and the places come at the end.',
          'find.trust': 'Solid, Check it or Weak says how far the first place stands above a chance fit. This one scores 76% against 41% by chance, and 56% for the second.',
        },
        then: 'The places, best first.',
      },
      {
        id: 'trust',
        at: [11, 0],
        tool: 'horizon',
        label: 'One place?',
        ask: true,
        shot: 'horizon-find',
        text: 'Does the first place explain clearly more than the second, and than chance?',
        choices: [
          { to: 'places', label: 'Yes', text: '76% against 56% for the second, and 41% by chance.' },
          { to: 'again', label: 'No, or Weak', text: 'Close numbers mean look-alikes fit nearly as well.' },
        ],
      },
      {
        id: 'again',
        at: [11.5, 1],
        tool: 'horizon',
        icon: 'undo',
        label: 'Search again',
        optional: true,
        next: ['places'],
        shot: 'find-prepare',
        text: 'Tell the look-alikes apart, then search again.',
        marks: [
          { anchor: 'find.again', shot: 'find-again', title: 'Change and search again' },
          { anchor: 'find.facing', title: 'Facing', tip: 'A smaller area helps too, with Draw again under 2 Area.' },
          {
            anchor: 'find.search',
            shot: 'find-faced',
            title: 'Search',
            tip: 'Still Weak? The skyline alone cannot decide. Check the first places by eye, or find more clues.',
          },
        ],
        does: {
          'find.again': 'Press Change and search again, under the places.',
          'find.facing': 'Under Facing, tick the way the camera looked and its neighbours, NE, E and SE for this photo.',
          'find.search': 'Press Search.',
        },
        then: 'The places of the new search.',
      },
      {
        id: 'places',
        at: [12, 0],
        tool: 'horizon',
        icon: 'pin',
        label: 'Places',
        shot: 'horizon-find',
        text: 'Open the places one at a time, best first.',
        marks: [
          {
            anchor: 'find.first',
            title: 'The first place',
            tip: 'Explains 76% means 76% of your trace fits there. It is a score, not a probability. A place on a peak the photo shows from afar cannot be it.',
          },
        ],
        does: { 'find.first': 'Press the first place. Find takes you there, your photo over the terrain.' },
        then: 'Overlay, your photo over the terrain seen from the first place.',
      },
      {
        id: 'verify',
        at: [13, 0],
        tool: 'horizon',
        icon: 'check',
        label: 'Verify',
        shot: 'find-look',
        text: 'A true place meets every peak and notch. A look-alike misses one somewhere.',
        marks: [
          { anchor: 'horizon.overlay', title: 'Photo and terrain', typed: true, tip: 'Fit, at the top right, judges the skyline alone. A higher Fit does not make a better place.' },
          { anchor: 'horizon.legend', title: 'The colours', look: true },
          { anchor: 'horizon.satellite', title: 'Satellite', look: true },
          {
            anchor: 'find.confirm',
            title: 'This is the place',
            tip: 'Not sure? Press Back to Find, beside it, and open the next place the same way.',
          },
        ],
        does: {
          'horizon.overlay': 'Drag the slider from Photo to Terrain and back. The peaks and notches should meet.',
          'horizon.legend': 'Green lies on the terrain, orange near it, red off it. Red on a peak or a notch means a look-alike. Your blue ridges should sit on the terrain’s thin ridge lines.',
          'horizon.satellite': 'Satellite, beside Relief, drapes imagery on the terrain. The falls and cliffs should land on the photo’s. Relief brings the shading back.',
          'find.confirm': 'Press This is the place. The search stops and the view is kept in the case.',
        },
        then: 'Place confirmed, the view kept in the case.',
      },
    ],
    result: {
      shot: 'find-confirmed',
      text: 'The first place, confirmed, about 200 m from Glacier Point, where the photo was taken in 1901.',
      example: true,
    },
  },
  {
    id: 'create-an-analyzer',
    title: 'Create your analyzer',
    lead: 'Aircraft on the aprons of Al Udeid Air Base: AVIATION, an analyzer of your own, proved on two real passes, then run once or as a routine.',
    steps: [
      {
        id: 'library',
        at: [0, 0],
        tool: 'detect',
        label: 'Library',
        shot: 'detect-library',
        text: 'Your own analyzers start in the library.',
        marks: ['detect.analyzers', 'detect.library', 'detect.library-new'],
        does: {
          'detect.analyzers': 'Press Analyzers, the sliders at the top of the panel.',
          'detect.library': 'Look through Built in first. One that nearly fits can be copied and tuned.',
          'detect.library-new': 'If none does, press New analyzer.',
        },
        tip: 'Detect needs a free Copernicus account. Until it is set up, its map shows the steps.',
        then: 'New analyzer, asking what it reads.',
      },
      {
        id: 'imagery',
        at: [1, 0],
        tool: 'detect',
        label: 'Imagery?',
        ask: true,
        shot: 'detect-analyzer-new',
        text: 'Does the sky stay clear over your ground?',
        choices: [
          { to: 'optical', label: 'Mostly clear', text: 'Sentinel-2 reads colour and infrared, and masks cloud.' },
          { to: 'radar', label: 'Cloud or night', text: 'Sentinel-1 radar sees through both.' },
        ],
      },
      {
        id: 'optical',
        at: [1.5, -1],
        tool: 'detect',
        icon: 'sun',
        label: 'Sentinel-2',
        next: ['start'],
        shot: 'detect-analyzer-new',
        text: 'Pick the optical satellite and how many dates it compares.',
        marks: ['detect.reads'],
        does: { 'detect.reads': 'Press Sentinel-2 · optical, then Two dates.' },
        tip: 'One date spots what is there on a day, like a ship. Two dates find what changed, like aircraft that arrived.',
        then: 'Start from, under the dates.',
      },
      {
        id: 'radar',
        at: [1.5, 1],
        tool: 'detect',
        icon: 'moon',
        label: 'Sentinel-1',
        next: ['start'],
        shot: 'detect-analyzer-radar',
        text: 'Pick the radar satellite and how many dates it compares.',
        marks: ['detect.reads'],
        does: { 'detect.reads': 'Press Sentinel-1 · radar, then One date or Two dates.' },
        tip: 'Radar needs one more layer in your Copernicus setup; Settings › Imagery shows how. A check’s two passes must also share a track.',
        then: 'Start from, under the dates.',
      },
      {
        id: 'start',
        at: [2, 0],
        tool: 'detect',
        label: 'Start from?',
        ask: true,
        shot: 'detect-analyzer-new',
        text: 'Is one of the examples close to what you look for?',
        choices: [
          { to: 'example', label: 'One is close', text: 'It comes with its rules and checks.' },
          { to: 'rule', label: 'None is', text: 'Blank starts you on one rule.' },
        ],
      },
      {
        id: 'example',
        at: [2.5, -1],
        tool: 'detect',
        icon: 'copy',
        label: 'Example',
        next: ['rule'],
        shot: 'detect-analyzer-new',
        text: 'An example is a ready-made analyzer, with checks that prove it.',
        marks: ['detect.start-from'],
        does: { 'detect.start-from': 'Press the example closest to yours. It joins your analyzers, checks included.' },
        tip: 'Each of its empty pins is a trap for one rule. Take that rule out, test, and the pin turns red.',
        then: 'The builder, with its rules and checks.',
      },
      {
        id: 'rule',
        at: [3, 0],
        tool: 'detect',
        icon: 'edit',
        label: 'First rule',
        shot: 'detect-first-rule',
        text: 'A rule is a line a pixel has to cross.',
        marks: ['detect.rules'],
        does: { 'detect.rules': 'Name it AVIATION, then set the rule: Brightness, Change, Dropped, 7%.' },
        tip: 'A parked aircraft darkens bright concrete: brightness that drops by 7% or more between the passes is what this rule keeps.',
        then: 'The rule, read as a sentence above the tabs.',
      },
      {
        id: 'passes',
        at: [4, 0],
        tool: 'detect',
        icon: 'calendar',
        label: 'Passes',
        shot: 'detect-passes',
        text: 'A check is two real passes with pins on them.',
        marks: [{ anchor: 'detect.checks', shot: 'detect-first-rule' }, { anchor: 'detect.passes', title: 'The passes' }],
        does: {
          'detect.checks': 'Press Checks under the rule, then New check.',
          'detect.passes': 'Press Find passes, then Before on 15 Sep 2026 and After on 25 Sep 2026. Then press Place the pins.',
        },
        tip: 'Take passes with little cloud, from the same season. Under another sun, shadows change length and buildings read as changed.',
        then: 'The map split between the two passes.',
      },
      {
        id: 'pins',
        at: [5, 0],
        tool: 'detect',
        icon: 'pin',
        label: 'Pins',
        shot: 'detect-pinning',
        text: 'Pins say where something must be found, and where nothing may be.',
        marks: [
          { anchor: 'detect.pin-found', title: 'Should be found' },
          { anchor: 'detect.pin-empty', title: 'Should stay empty' },
          { anchor: 'detect.bench-test', shot: 'detect-check', title: 'Test' },
        ],
        does: {
          'detect.pin-found': 'Should be found is already on. Click each aircraft that arrived, on the After pass: 13 here.',
          'detect.pin-empty': 'Press Should stay empty, then click bare apron and look-alikes.',
          'detect.bench-test': 'Press Finish on the bar under the map, then Test beside it.',
        },
        tip: 'Put empty pins on look-alikes rather than plain ground; that is where a rule slips. The satellite button swaps in the basemap, sharper but from another day.',
        then: 'Each pin green or red, and the strip counts them.',
      },
      {
        id: 'verdict',
        at: [6, 0],
        tool: 'detect',
        label: 'Pins right?',
        ask: true,
        shot: 'detect-tested',
        text: 'Did every pin come out right?',
        choices: [
          { to: 'second', label: 'Empty pins flagged', text: 'The rules keep too much. Add one that narrows them.' },
          { to: 'ease', label: 'Pins not found', text: 'A line is too strict. Ease it and test again.' },
          { to: 'save', label: 'Every pin right', text: 'All found, all stayed empty.' },
        ],
      },
      {
        id: 'second',
        at: [6.5, -1],
        tool: 'detect',
        icon: 'plus',
        label: 'Second rule',
        optional: true,
        next: ['save'],
        shot: 'detect-builder',
        text: 'A second rule narrows what the first keeps.',
        marks: ['detect.rules', { anchor: 'detect.display', shot: 'detect-seeit' }, 'detect.test'],
        does: {
          'detect.rules': 'Add a rule for near infrared (B08) dropping by 5% against the ground around it.',
          'detect.display': 'Press Display, then colour infrared. Near infrared shows red.',
          'detect.test': 'Press Test again.',
        },
        tip: 'A pixel must pass every rule, so a new rule can only take ground away.',
        then: 'The verdict again, both rules painted on the map.',
      },
      {
        id: 'ease',
        at: [6.5, 1],
        tool: 'detect',
        icon: 'sliders',
        label: 'Ease the line',
        optional: true,
        next: ['save'],
        shot: 'detect-builder',
        text: 'An easier line lets the missed pins through.',
        marks: ['detect.rules', 'detect.test'],
        does: {
          'detect.rules': 'Drag the line toward the missed pins. The ground repaints with no new request.',
          'detect.test': 'Press Test again.',
        },
        tip: 'After a test, each pin shows as a tick on the slider. Set the line between the two kinds.',
        then: 'The verdict again, on the new line.',
      },
      {
        id: 'save',
        at: [7, 0],
        tool: 'detect',
        icon: 'save',
        label: 'Save',
        shot: 'detect-tested',
        text: 'A saved analyzer is offered in every case.',
        marks: ['detect.builder-save'],
        does: { 'detect.builder-save': 'Press Add to my analyzers.' },
        tip: 'Share, in its library row, hands it on as a file, with its checks if you choose.',
        then: 'New detection, your analyzer now offered in every case.',
      },
      {
        id: 'use',
        at: [8, 0],
        tool: 'detect',
        label: 'How often?',
        ask: true,
        shot: 'detect-mine-menu',
        text: 'Will you come back to this ground?',
        choices: [
          { to: 'routine', label: 'Yes, often', text: 'A routine keeps the areas and reads each new pass.' },
          { to: 'once', label: 'Once is enough', text: 'One pass sweeps the dates you pick.' },
        ],
      },
      {
        id: 'once',
        at: [8.5, 1],
        tool: 'detect',
        icon: 'play',
        label: 'One pass',
        // the way ends here too, on the result
        next: [],
        shot: 'detect-once-where',
        text: 'One pass sweeps the dates you pick, and you review its candidates once.',
        marks: [
          { anchor: 'detect.new', shot: 'detect-mine', title: 'New detection' },
          { anchor: 'detect.new-menu', shot: 'detect-mine-menu', title: 'One pass' },
          { anchor: 'detect.where', title: 'Where' },
          { anchor: 'detect.what', shot: 'detect-once-what', title: 'What' },
          { anchor: 'detect.when', shot: 'detect-once-when', title: 'When' },
          {
            anchor: 'detect.run-pass',
            shot: 'detect-once-start',
            title: 'Run this pass',
            tip: 'In review, K keeps, D dismisses and P pins. Compare opens a candidate on its two passes, to blink or run Difference.',
          },
        ],
        does: {
          'detect.new': 'Press New detection at the top of the panel.',
          'detect.new-menu': 'Press One pass.',
          'detect.where': 'Type Al Udeid in the area search and tick its four areas, saved in Areas. Then Next.',
          'detect.what': 'Under Mine, press AVIATION, then Next.',
          'detect.when': 'Each area takes its own dates: press its Date A, then Enter a date, and type 24/07/2026; its Date B, 25/09/2026. Then press Next.',
          'detect.run-pass': 'Name it and press Run this pass. It keeps running if you leave Detect.',
        },
      },
      {
        id: 'routine',
        at: [8.5, -1],
        tool: 'detect',
        icon: 'clock',
        label: 'Routine',
        shot: 'detect-routine-where',
        text: 'A routine reads each new pass over the same ground, here against a fixed July picture.',
        marks: [
          { anchor: 'detect.new', shot: 'detect-mine', title: 'New detection' },
          { anchor: 'detect.new-menu', shot: 'detect-mine-menu', title: 'Routine' },
          { anchor: 'detect.where', title: 'Where' },
          { anchor: 'detect.what', shot: 'detect-routine-what', title: 'What' },
          {
            anchor: 'detect.when',
            shot: 'detect-routine-when',
            title: 'When',
            tip: 'The pass before, the other choice, finds what changed since the last run rather than since a fixed day.',
          },
          { anchor: 'detect.run-pass', shot: 'detect-routine-start', title: 'Save and run the first pass' },
          { anchor: 'detect.catch-up', shot: 'detect-routine-saved', title: 'Catch up' },
          { anchor: 'detect.catch-read', shot: 'detect-routine-catchup', title: 'Read the passes' },
          {
            anchor: 'detect.glance',
            shot: 'detect-routine-read',
            title: 'Dashboard',
            tip: 'Run routine reads the newest pass whenever you press it; nothing runs on its own.',
          },
        ],
        does: {
          'detect.new': 'Press New detection at the top of the panel.',
          'detect.new-menu': 'Press Routine.',
          'detect.where': 'Type Al Udeid in the area search and tick its four areas. Then Next.',
          'detect.what': 'Under Mine, press AVIATION and set Maximum cloud cover to 35%, then Next.',
          'detect.when': 'Press A fixed picture, then each area’s Date A and Enter a date, and type 24/07/2026. Then press Next.',
          'detect.run-pass': 'Name it and press Save and run the first pass. It reads the newest pass against July.',
          'detect.catch-up': 'Press Catch up, then Look for passes to list every pass since 24 July with its cloud.',
          'detect.catch-read': 'Tick the passes it has not read yet and press Read. Each runs once, oldest first.',
          'detect.glance': 'The bars show the candidates of each pass. Press Dashboard for the full view.',
        },
      },
    ],
    result: {
      shot: 'detect-routine-dashboard',
      text: 'The routine’s dashboard: candidates over the four areas pass after pass since July, and the spots that came and went.',
      after: {
        once: { shot: 'detect-once-done', text: 'The pass read over the four areas, each candidate on the map with its two passes side by side, to keep, dismiss or pin.' },
      },
    },
  },
];

/** Settings, in the tabs of its own screen. The extension's section has a page of its own. */
export const SETTINGS_TABS = [
  { id: 'settings', label: 'General' },
  { id: 'settings-publishing', label: 'Publishing' },
  { id: 'settings-website', label: 'Website' },
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
    { where: 'X and Bluesky', text: 'When Post publishes, it fills the composer with the thread and the proof, or the reply box under the source post. Posting stays yours.' },
    { where: 'Google Lens, Bing, Yandex, TinEye', text: 'When Reverse Search opens an engine, it hands the picture to the engine’s uploader.' },
  ],
};

/** Every keystroke the app listens for, by where it is pressed. */
export const KEYMAP = [
  {
    where: 'Anywhere',
    keys: [
      { combo: 'Ctrl+K / ⌘K', does: 'opens Go to for tools, cases and documents' },
      { combo: 'Ctrl+V', does: 'files a screenshot on Media, Files, Board and Graph, and a copied address on Files, Board and Graph' },
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
      { combo: 'Delete', does: 'removes the lead clicked' },
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
      { combo: 'L', does: 'locks the photo to the terrain, or lets it go' },
      { combo: 'H / D', does: 'hides the trace, or shows its details' },
      { combo: '0', does: 'shows the whole photo again' },
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
      { combo: 'Ctrl+C / Ctrl+V', does: 'copies the picked marks, and pastes them on the picture picked or under the pointer' },
      { combo: 'Ctrl+D', does: 'duplicates the picked marks' },
      { combo: 'Right-click', does: 'opens what can be done to the mark, the picture or the page under the pointer' },
      { combo: 'F', does: 'fits the document' },
      { combo: 'Space (held)', does: 'pans, whatever tool is in hand' },
      { combo: 'Delete', does: 'removes what is selected' },
      { combo: 'Ctrl+Z', does: 'undoes the last change' },
      { combo: 'Ctrl+Shift+Z', does: 'redoes it' },
      { combo: 'Escape', does: 'drops the shape being drawn, then the selection, then the pen' },
      { combo: 'Enter / Escape', does: 'in crop mode, keeps the crop or drops it' },
    ],
  },
  {
    where: 'Map plate',
    keys: [
      { combo: 'A', does: 'opens Add' },
      { combo: 'F', does: 'gives the page the whole window, and gives it back' },
      { combo: 'Ctrl+C / Ctrl+V / Ctrl+D', does: 'copies, pastes or duplicates the elements picked' },
      { combo: 'Ctrl+G / Ctrl+Shift+G', does: 'groups the elements picked, or ungroups them' },
      { combo: 'Arrows', does: 'nudge the elements picked, Shift for five' },
      { combo: 'Delete', does: 'removes the elements picked' },
      { combo: 'Escape', does: 'drops what is being placed, then the pick' },
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
      { combo: 'Wheel on the bar', does: 'zooms the bar\'s time about the pointer, down to single frames; Shift+wheel slides it' },
      { combo: '+ / -', does: 'zooms the bar\'s time in and out about the playhead' },
      { combo: 'C', does: 'captures the frame on screen' },
      { combo: 'R', does: 'draws a zone of the picture to search on the engines, or closes it' },
      { combo: 'S', does: 'keeps a scene to geolocate at the frame on screen' },
      { combo: 'Shift+S', does: 'ends the last scene at the frame on screen' },
      { combo: 'Drag on the bar', does: 'after Mark to geolocate\'s Passage, keeps the passage dragged as a scene; Escape calls it off' },
      { combo: 'S / Shift+S', does: 'with a scene\'s time open, moves the start or the end of the passage in hand to the frame on screen' },
      { combo: '↑ / ↓', does: 'in a scene\'s time, nudges it a frame, Shift for a second' },
      { combo: 'Escape', does: 'lets go of a scene\'s time, then closes the scenes' },
      { combo: 'Ctrl+Z / Ctrl+Shift+Z', does: 'takes a scene or a mark back, or puts it back' },
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
      { combo: 'Ctrl+A', does: 'takes every piece in hand' },
      { combo: 'Arrows', does: 'nudge the pieces in hand a pixel, Shift for ten' },
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
    where: 'Notebook',
    keys: [
      { combo: 'Ctrl+K / ⌘K', does: 'on words, links them or cites the case item at the address' },
      { combo: 'Ctrl+B, Ctrl+I, Ctrl+E', does: 'sets bold, italic or code on the words, or takes it off' },
      { combo: '/', does: 'opens the insert menu, as the + of an empty line does' },
      { combo: 'Ctrl+Shift+M', does: 'switches the page between drawn and Markdown' },
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
    fix: 'Five providers need no key. The rest use yours, entered in Settings, Imagery, and the tab says which ones are missing one.',
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
  // last: walked examples, read once each tool's page is known
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
    const at = journey.steps.findIndex((step) => step.tool === tool || step.video?.tool === tool);
    return at < 0 ? [] : [{ id: journey.id, title: journey.title, step: at + 1 }];
  });
}

/** A step as it reads for a kind of file: what differs for a video replaces the rest. */
export const stepAs = (step, kind) => (kind && step[kind] ? { ...step, ...step[kind] } : step);

/**
 * What a journey made, as it reads for a kind of file (a video ends on its own proof)
 * and for the step it was reached from (`after`: a plate played as a video ends on the
 * video, a detector run as a routine on its dashboard).
 */
export function journeyResult(journey, kind, from = null) {
  const made = journey.result;
  if (!made) return made;
  const byKind = kind && made[kind] ? { ...made, ...made[kind] } : made;
  return from && made.after?.[from] ? { ...byKind, ...made.after[from] } : byKind;
}

/** A journey's steps as the nodes of its map, each with its id and its place. */
export function journeyNodes(journey) {
  return journey.steps.map((step, index) => ({ ...step, index, id: step.id ?? String(index), at: step.at ?? [index, 0] }));
}

/** Where each step leads: its choices, the steps it names, or else the one after it. */
export function journeyEdges(journey) {
  const nodes = journeyNodes(journey);
  return nodes.flatMap((node, index) => {
    const to = node.choices?.map((choice) => choice.to) ?? node.next ?? (nodes[index + 1] ? [nodes[index + 1].id] : []);
    return to.map((id) => ({ from: node.id, to: id }));
  });
}

const anchorOf = (mark) => (typeof mark === 'string' ? mark : mark.anchor);

/**
 * The marks a journey step frames, read off the page of the tool it happens in, or off
 * another page for a control every tool shares, as the Geolocating pill in the top bar.
 * What the step says to press there (`does`) replaces what the page says it is. A
 * control no page explains comes as a mark of its own.
 */
export function stepMarks(step) {
  const marks = [];
  const gather = (list) => {
    for (const mark of list ?? []) {
      marks.push(mark);
      gather(mark.opens?.marks);
    }
  };
  gather(PAGES[step.tool]?.marks);
  for (const [id, page] of Object.entries(PAGES)) if (id !== step.tool) gather(page.marks);
  return (step.marks ?? [])
    .map((mark) => {
      const own = typeof mark === 'string' ? { anchor: mark } : mark;
      const known = marks.find((one) => one.anchor === own.anchor);
      if (!known && !own.title) return null;
      const said = step.does?.[own.anchor];
      return { ...known, ...own, ...(said ? { text: said } : {}) };
    })
    .filter(Boolean);
}

/** The picture a journey step is read on: its own, or its tool's. */
export const stepShot = (step) => step.shot ?? PAGES[step.tool].shot;

/** The picture a step's control is pressed on: its own when the press opens another screen, or the step's. */
export const markShot = (step, mark) => mark.shot ?? stepShot(step);

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
    for (const step of journey.steps) {
      for (const one of [step, stepAs(step, 'video')]) {
        // a question is asked over its screen, which it shows whole
        if (one.shot) add(one.shot, []);
        for (const mark of one.marks ?? []) {
          const shot = typeof mark === 'string' ? one.shot : (mark.shot ?? one.shot);
          if (shot) add(shot, [anchorOf(mark)]);
        }
      }
    }
    if (journey.result) add(journey.result.shot, []);
    if (journey.result?.video) add(journey.result.video.shot, []);
    for (const ending of Object.values(journey.result?.after ?? {})) add(ending.shot, []);
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
