# Azimut UI and UX reference

This document defines the interface structure and visual language. Feature
phasing lives in [SPEC.md](SPEC.md).

## Layout anatomy

```
┌ topbar: rose+wordmark (home) · case switcher · geolocating pill · (spacer) · Add event · guide mark · settings gear · sidebar toggle ┐
├ rail: Sources · Examine · Map · Compose · ── · Case · … · theme ┬ tab strip (several tools only) ┬ case sidebar ┤
│                                                                 │ tool canvas                    │              │
└─────────────────────────────────────────────────────────────────┴────────────────────────────────┴──────────────┘
```

## Workspace model (UX)

The rail holds a fixed set of workspaces in investigation order. Tools register
in `frontend/src/lib/workspaces.js` and appear as tabs, never as new rail entries.

| Workspace | Tools today | Future tools land here |
|---|---|---|
| **Home** (the mark) | Overview | |
| **Case** (rail, under the stages) | Timeline, Board, Graph, Sheet | v5: Orchestrator |
| **Sources** | Media Library, Files, Reverse Search | Channel Monitor, Evidence Locker |
| **Examine** | Inspect, Collage | Edit Provenance, OCR, Image Compare, Hints, Sky Clock, audio |
| **Map** | Satellite, Compare, Detect, Coords & Sky | Event layers, Ground Imagery, OSM Query, Map Board |
| **Compose** | Geo Proof, Post, Map plate, Notebook | Report Builder, GIF maker |

**Support sits at the foot of the rail, above the theme switch, and is not a workspace.**
It opens one small dialog: a tip on Ko-fi, a form to vote or suggest an idea, and a
problem report that leads to Settings → System. A block stays hidden until its link
exists in `lib/support.js`, and a release refuses a stand-in link. The tip also has a
quiet link in Home's footer and one line on the last page of What's new. Nothing reaches
the network before a press, and there is no setting, reminder, counter or donor feature.

**While a scene is geolocated, a pill sits beside the case**: *Geolocating*, the scene's
colour, its time and label, and its two counts (below): the captures gathered for it, which
pulses as one lands from the app or the extension, and what its video gives it. Its label opens the scene in Inspect, **Make the
proof** opens Inspect's chooser on it, and ✕ stops; the captures stay with the scene.
Every capture filed meanwhile, from any map tool or the extension, is gathered for it on
the server (`engine/geolocate.py`), and every tab and the extension's panel follow the
same scene. **Send to Geo Proof** then makes the proof of that scene, from Horizon's
export menu and from a saved row of Satellite, Compare's comparisons among them, as Make
the proof does: a new proof holding the scene, named after its label, which its first
save takes up with nothing offered, or the proof open when it holds that scene already.
Only pictures the scene gathered go that way (`lib/toGeoProof.js`); any other joins the
proof open, as before. Horizon draws its two pictures under *Making the proof…*, encodes
both at once and keeps them in turn, each written again in about a second off the
server's loop. The server's word is shown as it lands, the capture counted and the pill gone
when the scene ends, and the server is read again behind it; an answer asked before that
word is dropped, so a count never steps back. Narrower than 1240 px it drops its first word, and under 1080 px Make the
proof keeps its icon alone. A scene holding several passages reads its first and counts
the rest, `0:00–0:07 +1`, every one on hover. A picture marked to geolocate reads *Whole
picture* where a scene reads its time.

**Case sits on the rail, under the four stages and a rule apart from them.** The
stages read in the order an investigation runs, and the case is not one of them: it
is what every stage files into. Kept in the topbar beside the case switcher, it was a
door nobody took, so it is one press from any stage instead, while the header still
answers *which case*. It is a workspace like the others: tabs, `#case` deep links,
and its own remembered sidebar. Timeline lives here because it is another reading of
the case, not a collection or examination stage. **Case** opens the tab last used
there, and the Timeline the first time, since that is where events are noted and
read; `#board` and the stored tool id `board` still reach the Board.
That sidebar stays closed by default, because the board already lists the same case
and two lists side by side only ask which one is real.

**Home is not on the rail either**, and for the same reason. It sits on the wordmark,
which is the one affordance that needs no label and costs no seat, and it is where the
app opens (`#overview`). Its sidebar starts closed too: the page is read rather than
worked in, and its whole subject is the case the sidebar would be listing again.

**The browser's Back and Forward walk the work** (`lib/backButton.js`). Each change of
tool is a step, and so is each place the analyst goes to inside one: a folder in Files,
a sheet opened from the Sheet home, a proof, a draft or a note. The address carries it
(`#files?folder=Sources%2FTelegram`, `#proof?proof=convoy`). A change that only renames
a place, such as a save naming a document, a rename or a case switch, rewrites the step
it is on. A document opened from another tool is one step with the switch that brought
it, so one Back returns to where the press was made. Tools stay loaded, so Back to a
tool finds it as it was left.

**Back never drops work.** Back away from a proof or a post with unsaved changes asks
first, and **Keep editing** leaves the address on the document; opening another one
from its list asks the same. Back on an open dialog closes that dialog, as Escape
would, and goes nowhere else. Leaving Azimut with unsaved work in a proof, a post, a
comparison or a sheet whose edits could not be written is a question the browser asks.
A step made in another case changes the tool and nothing inside it, since Back does not
switch cases.

## Home

One tab, **Overview**, for somebody who has been here before. Somebody who has not
presses *Read the guide* on it, which opens the guide on its start page.

- **To-do** appears whenever a case is open, including an empty case. Each named
  list has its own tab and completed/total count. The block occupies one grid
  column, beside the start actions in an empty case, and stacks on narrow screens. Enter adds a task; click its
  text to edit it, check it off, or delete it. The list menu renames or deletes
  a list, with confirmation for a populated list. Changes save automatically.
  Under the lists, **In the notes** gathers the open `- [ ]` of the case's notes,
  note by note, read once the lists are there; ticking one writes the note, and its
  text opens the note on that line.
  Over the lists, **To geolocate** gathers the scenes kept in Inspect that no proof
  takes up yet, by file, the file worked on last first (`GET /cases/{id}/scenes/queue`).
  Each row gives its label or its time, every passage of a scene holding several
  (`0:00–0:07 · 1:05–1:12`), a mark in the colour Inspect gives the scene
  (a band for a passage, a pin for an instant), its state by the pip at its start (an
  empty ring To geolocate, a ring holding a dot In progress, the solid accent for the one
  in hand) and its two counts. **Geolocate** goes to the map
  with its video, and on the scene in hand it reads **Stop** and stops it, the captures
  kept; the name opens it in Inspect, or in Collage for a picture a collage exported; ✕ abandons it with a word, which may
  stay empty. Three rows show and the rest are counted; the abandoned fold below, each
  with its word and **Restore**. The group is absent while the case has no scene to
  prove, and read again on the server's word while it is shown, never once it is not.
  A picture marked to geolocate is a row like the others: *Whole picture*, an image on
  its file's line and no mark, having no bar. Geolocate holds the picture beside the
  map, and the first proof that lays it out proves it, so the row, the pill and the
  count go together.
  Lists are case metadata in `case.json`, included in case bundles; they are not
  graph entities and own no artifact files. Task and list deletions are permanent,
  outside Trash. Concurrent edits from another browser tab require reloading the
  lists before saving again.

- **With a case open, the page is a reading, laid out as a dashboard.** The case name
  and when it was last touched, then a two-column grid: the recent work and the to-do
  lists on the left, the case's points, *what is waiting* and the case by family on the
  right. **What was just filed comes first**, because that is what somebody coming back
  reaches for; the counts under it are upkeep, read second. It
  runs to 1180px rather than a 760px reading column, because this page is scanned
  rather than read and four counts hanging in a ribbon on a wide screen is the emptiest
  an app can look. Below ~980px the grid stacks in that same order.
- **What is waiting is the Board's own standing questions, priced.** *To review*,
  *Nothing linked yet* and *Unfiled* are the same three terms the `+ Filter` menu
  offers, worded once in `lib/entityFilter.js`; the fourth is the Timeline's undated
  count of Claims. They are drawn as four tiles, two by two, each one line — number, then what it
  counts — with the sentence saying what that means on the pointer. Pressing one hands
  the **question** to the surface that answers it,
  through the slot Board and Graph already share, so the table lands on exactly the rows
  the number counted and the two can never disagree. *No date yet* opens the Timeline
  on its `Undated` queue, unfolded and scrolled to, with its first entry focused.
- **A count of nothing stops being a control.** It is dimmed and says zero rather than
  offering a press that lands on an empty table to confirm what the page already said.
  With all four at zero the tiles give way to one line, and that line is about the four
  questions rather than about the case: a case is never finished, so nothing on this
  page may read as a case that is.
- **A case holding nothing is not a case that is up to date.** With a total of zero
  there is no reading to give, so the grid is replaced by the three ways material gets
  in: media, files, a map capture. It is the screen a first case lands on one second
  after being named.
- **The fourth standing question is not in that list.** *Added this week* says what
  happened rather than what is outstanding, so it leads the recent work instead.
- **The recent rows carry the case's own pictures.** The catalog already attaches a
  thumbnail to the rows that have one (`thumb`), so six frames of an afternoon's work
  are shown rather than six filenames.
- **The points are on a real map, and it is only a reading.** The case's located
  footage (`GET /satellite/media`, the Map panel's own first position) is drawn
  as dots on the same engine the Map tool uses (`overview/PlaceMap.svelte`), framed on
  the case, capped at 200 points, and the wheel and the drag are all it answers: no
  capture, no basemap picker, nothing that writes. Hovering a dot names it. The
  basemap is the keyless, unmetered imagery and nothing else, so opening the page
  cannot spend a quota. Coming back to the tab re-reads the case, and points that
  did not change leave the camera where it was put. The foot says how many points the
  case holds, how many are drawn when that is fewer, and opens the Map tool. A place
  nobody filmed is a pin, and pins are read in the Map tool: with no footage placed
  there is no map here, and the figures take the shoulder instead of leaving a hole.
- **The case by family is drawn in the Graph's own eight hues** (`--graph-<family>`),
  each bar measured against the biggest family rather than against the total. One
  reading of one case cannot be two palettes.
- **The dashboard reads only the open case.** Five bounded summary reads supply the
  catalog summary, one timeline page, the newest rows, a count of the last seven days,
  and the located media the Map panel opens on. A separate read
  loads the case checklists. Nothing opens a
  second case to count it, and the only thing that reaches the network is the map of
  the case, fetching the imagery under its points.
- **Two notices, both of them answers the startup checks already gave.** A newer release
  folds its own body open on the page (the check returns it) with the download for this
  system and the release page, then the steps to put the new program in place
  (`components/UpdateButtons.svelte`, `UpdateSteps.svelte`, the same in the startup
  pop-up and Settings → System), and
  is silent when the release was muted or the check is switched off. A capture extension
  that was never installed gets one line pointing at the tab that installs it, and the
  line disappears the moment one is. Neither is dismissible state: both are conditions
  that clear themselves, so nothing here is stored and nothing here nags.
- **With no case open the page is the front door.** A fresh install lands in an empty
  workspace, where there is nothing to summarise and nothing on screen that says what
  the rail means: what Azimut is, the rail drawn as the sequence it is, a field that
  names the first case, and the cases already in the workspace when there are any.
- **The guide opens over the tools** (`components/GuideDialog.svelte`, data in
  `lib/guide.js`), from the `?` in the topbar on the tool being stood in, from Home on
  its start, from Settings on its own page. The tool underneath does not move, and
  Escape closes it. A menu on the left reads in the order somebody arriving needs it:
  **Start here** and the **Capture extension** (in tabs of its own: installing it, its
  capture over a map, its tools drawn over a map, and a table of where it works, Street
  View included), then **journeys** (a goal walked across
  the tools: a photo geolocated from its import to the published thread, an analyzer
  of your own built in Detect, from the library to its checks and its save, and a search
  with Find on the 1901 photo of Half Dome, each mark set for a reason),
  then the **workspaces** with their tools as tabs, then the
  **reference**: every key by where it is pressed, Settings (a tab per section of its
  screen), and what to do when something does not work, symptom by symptom, ending on
  **Report an issue**, which opens Settings on System where the report is written.
- **The guide can move to a tab of its own**, to follow on a second screen: the
  button beside the cross opens it on the page being read (`#guide?page=…`,
  `lib/guideWindow.js`, `components/GuidePage.svelte`) and closes the dialog. The tab
  is the guide alone, keeps its place in the address through a reload, and its *Open*
  and *Report an issue* act in the tab it was detached from, by a message between the
  two tabs. Opened from its address alone, it opens the app in a new tab instead.
- **A tool's page is a picture of it.** A number stands by each control it explains,
  on a panel's corner or just off a button's so it hides none of it, and a line per
  number stands beside the picture. At rest the picture carries its numbers and nothing
  else; reading a line, or pointing at its number, dims the rest, rings that control and
  names it by its number.
  Under the picture, the subtleties the controls do not say, set apart as one note
  under a **Tips** heading in the info colour so they never pass for part of the
  screen. A column names the
  journeys the tool takes part in, at their step, and *Open* goes to the tool.
- **A number can lead to the next screen.** A control that opens something (a menu,
  the right-click menu of the map, Details beside a row, the Go to palette) carries a
  chevron on its number; pressing it shows the picture of what opens, with its own numbers
  and a trail back. A journey's step shows only that step's frames, on the picture of
  the tool it happens in, or on one of its own when the moment needs it (the photo held
  over the map in a reference window). A journey ends on a **Result**: what it made.
  Search with Find's plays the photo and the terrain in turn, the slider walked by
  itself, and its *Try this search* files the same setup in a case of its own
  (`lib/findExample.js`), ready to press Search.
  A screen opened from a number can hold its tips, a link to a longer read (Find's,
  to docs/FIND.md) and the journey that walks it.
- **The pictures are made, not taken.** `npm run guide:shots` (`frontend/guide/`)
  builds the app into a scratch folder, starts a private Azimut on a throwaway
  workspace, files a demo case into it (public-domain photos of a real port, credited in
  `guide/photos/CREDITS.md`, the same port in public-domain USGS imagery, Horizon on a
  mountain), stages each picture with the clicks an analyst would make (`stages.mjs`)
  and writes `src/assets/guide/<shot>.webp` with the rectangle of every `data-guide`
  anchor drawn on it, and a `<shot>.webm` for a stage that has a film; the search it runs
  also writes what *Try this search* files (`lib/findExample.json`). The case is true where it can be: where and when each photo was
  taken is its own, and only the accounts that posted them are made up. The
  extension's pictures come from a second browser with the extension loaded, over
  OpenStreetMap's own tiles served at its own address (`extension.mjs`). The analyzer
  journey is the Detect film's own analyzer on Al Udeid Air Base, its two Sentinel-2
  passes copied from a tile cache that already holds them (`airbase.mjs`), so no
  Copernicus request is spent; every source a picture shows is credited in
  `guide/photos/CREDITS.md`. A picture keeps the part of the window its
  frames are in, and a panel a page does not explain is folded first. A picture stays
  landscape, at most two thirds as tall as it is wide: a cut that follows a tall panel
  takes in the screen beside it, and the dialog never shows a picture taller than the
  room it has, so a picture is always seen whole. A control that
  moved is followed; one that went fails the run, and `guide.test.js` fails when a
  frame points at an anchor no component carries, when a tool has no page, or when a
  picture ships that the guide no longer shows. Rerun it before a release, look at the
  pictures it changed, and commit them with the release.
- **No tour over the live screen.** A tour that points at the running app breaks on the
  first layout change and fails silently, where a stale picture fails a test. The tour
  is pictures of the guide instead, and the `?` is the one live control it lights.
- **A newcomer is welcomed, then toured** (`components/Onboarding.svelte`,
  `lib/onboarding.js`): a workspace with no case and no tour taken opens on a card
  saying what Azimut is for, with *Show me around* and *I know Azimut already*, over
  a film of the app's own globe diving from the whole Earth into Yosemite Valley
  (`npm run guide:hero` films it frame by frame, each frame taken once its tiles are
  all drawn, and fades it through black at both ends; a reader who asked for less
  motion gets its still). The
  tour is four pages, the stages in order, each a guide picture with one control lit
  and named (`Spotlight.svelte`). Its last page lights the topbar's `?` through the
  veil with a dotted line drawn to it, and ends on *Create my first case*, which
  focuses the front door's name field. It is hard to leave by accident: the veil does
  nothing, Escape asks first, and only Skip or the last page end it; its page is kept
  as it turns, so a reload or the next start resumes there.
- **A new version opens with What's new** in the same card: up to five pages from
  `lib/whatsNew.json`, newest version first for someone who skipped one, with no
  button that leaves for a tool, since that would end the reading on its first page.
  Closed early it waits for the next start, not the next reload; Skip or Done puts it
  away for that version. Home's footer takes the tour again and reads What's new
  again, and the front door and the guide's *Start here* offer the tour.
- **Find opens on its beta notice** in the same card, once the photo is chosen: what
  a beta means for a search, *Read the guide*, which opens the `?` on Find's own
  screen, and *Got it*. Either puts it away for good (`find_beta_seen`); Escape or
  the veil until the next start. The **Beta** pill beside Find's title shows it again.
- Where the tour stands (`tour`) and the version read (`whats_new_seen`) are kept in
  the workspace's settings, so the settings backup carries them and another browser
  on the same workspace doesn't start over. A map window never shows either, and the
  update notice waits behind them. An entry of `whatsNew.json` is a `draft` until its
  release: the release workflow fails on a tag that still carries one (`tests/test_whats_new.py`).

Rules:

- **Go to** opens from the topbar or `Ctrl+K` (`⌘K` on macOS). It starts with
  recently added documents, then searches tools, Horizon's settings, workspace
  cases, documents in the current case and the words inside its notes, each found
  note opening on its line, and *Note on the side* opens the note on the side. A Horizon setting opens Horizon with
  its inspector out, its group unfolded and its row lit a moment. While scenes wait,
  *To geolocate* leads the tools with their count and opens the sidebar on its To-do;
  typed, it is there at any count. Words also find a scene by its label or its file's
  title, which opens it in Inspect. Arrow keys select a result, Enter opens it and Escape
  returns focus. Changing case through `openCase` asks before discarding unsaved
  work; document handoffs retain their existing save and confirmation paths.
  Reads start only when the palette opens; document search uses bounded catalog
  queries and case search returns at most eight matches. Results from a closed
  palette, an earlier query or a previous case are discarded.
  Results stay visible while the next search runs; Enter waits for that search,
  and new words select the best match again. The palette hangs from the top of
  the window, so the field stays put while the list grows and shrinks, and the
  part of each name a search matched is drawn bold.
  Case names use the same accent and word normalization as other searches;
  document results rank name matches before incidental matches.
- Use at most two levels: workspace → tab.
- `uiState.tool` is authoritative. The active workspace is derived from it, so
  cross-tool handoffs do not need workspace logic. Each workspace remembers its
  last-used tab.
- Deep links use `#<tool>`, `#<workspace>` or `#<workspace>/<tool>`.
- Artifact actions can open a tool, locate a place or add an item to a proof.
- Settings is app plumbing: behind the topbar gear, not on the rail.

## Pasting into a case

`Ctrl+V` files what the clipboard holds. It covers the two things that have no
file to drop: a screenshot taken with the system tool, and an address copied out
of a browser. An image wins over a link when the clipboard carries both, and the
page it was copied from prefills the image's source.

A dialog always opens first, with only the fields that surface asks for.

| Surface | An image | A link |
|---|---|---|
| **Media** | Title, source URL | refused: a link here is a download |
| **Files** | Title, folder, source URL | Title, folder, notes |
| **Graph** | Title, source URL, drawn at the viewport centre | Title, notes, drawn there too |
| **Board** | Title, source URL, opened | Title, notes, opened |

A refusal is a screen, not a toast: it says what this surface takes and where the
thing does go. Text is refused everywhere. So is an image over 25 MB, naming the
limit. A paste into a field is left alone, and a frozen snapshot refuses to be
written into.

A pasted image is recorded as a paste rather than an upload, so a screenshot with
no stated source never reads like a file chosen off a disk. The Media grid counts
both under **Imports**. Pasting the same crop twice is one file.

## Board

The case as an index: who, what and where, then the material it is built from. It is
what makes the hand-made vocabulary reachable — a `person`, an `account` or a `claim`
had no screen before it. Following a relation to a type with no tool of its own lands
here, on that row's Details, with its group open.

- **Rows are grouped by family, never hidden.** *People & organizations*, *Accounts
  & identifiers*, *Places*, *Things* and *Equipment types* open first; *Events*,
  *Files*, *Work* and *Other* fold underneath, each one click from the tool that reads
  it (Timeline, Media Library). A case is mostly files, and one table of everything
  answered "what is in the database" rather than "who is this about". The question is
  still the one Board and Graph share, so a count, a total or a drawing never depends
  on which groups are open. Under a question every group holding an answer opens and
  the empty ones go; a fold made during that question lasts as long as it does. A
  case holding no subject opens its files and says how the index fills: a name typed
  with `@` when an event is added, or **New**.
- **A subject row reads by its events**: how many Claims name it, a dozen bars of
  when they fall across the case's own span (one span for every row, so the column
  reads as who was active when), and the dates they cover. One bounded read per page
  of rows (`POST /catalog/events`), never one per row, and none on a frozen snapshot.
  A material row keeps type, folder and created; an event row says when it happened,
  as written.
- **Sort** orders each group over the whole case: *Most noted* (the subjects most
  events name first, the files newest first), *Name*, *Recently added*. Most noted
  is asked of a group's types only, each row one index search on the links.
  **Group: None** is the one flat table, headings and all, and a Board view saved
  before the groups opens that way. Grouping, sort and folds are kept per case in
  this browser, like the question.
- **Waiting** lists the standing questions that count something (*to review*,
  *linked to nothing*, *events without a source*, *not assessed*), one click from the
  rows they count, while nothing else is being asked.
- **Details opens beside the list** when the Board is wide enough for both, and over
  it otherwise. `↑`/`↓` walk the rows and Details follows, so reading five people is
  five presses; `Esc` closes it, and a row changed with edits unsaved asks first. Its
  width is dragged from its edge and kept in the browser.

- **New entity** offers the types an analyst creates by hand and generates the form
  from the registry. It is **one dialog shared with the graph**, so a claim is filed
  with the same words and the same duplicate warning wherever the analyst is standing.
  It opens on the type being filtered for, or the first of the chosen family. The primary field names the value being entered — **IP address**,
  **Full name**, **Handle** — never a generic **Name**. An identifier the case
  already holds is flagged with the existing row one click away: a warning, not a
  block. Details can merge the two records after creation. What it creates opens
  into its own Details.
- **Add file** takes a document, scan, plan or image into the case, by the button or
  by dropping it on the list. It runs the Media Library's import, so the file is
  hashed, deduplicated, given a sidecar and a thumbnail, and filed as a `media`. One
  file opens its Details; a batch reports what landed and what was already there.
- **Search+** covers the label, type, folder, notes and declared text fields
  (ONTOLOGY §2), in memory on a case that fits one page and server-side past it.
  Both sides fold the text the same way (`engine/textfold.py`, `lib/textFold.js`):
  case, the accents on Latin, Greek and Cyrillic letters, Arabic harakat and Hebrew
  points, so `cafe` finds `Café` and `محمد` finds `مُحَمَّد`. A Devanagari vowel sign or a
  dakuten changes the letter and still has to match, and punctuation always does.
  The first matching field is named under the row, so a vehicle found by its plate
  never looks like an unexplained result. Board and Graph send the same terms to the
  same case predicate.
- **The question is a bar that never changes shape**: a search, one **+ Filter** menu,
  and a removable chip per term. It replaces seven selects, four of which appeared and
  disappeared as the others were set — so a live term looked exactly like a dead one,
  and a control that vanished took its own way back with it. An axis that cannot be
  asked yet stays in the menu **with its reason next to it**, because a control you can
  see and cannot use teaches something and one that is not there teaches nothing.
- **The menu opens on six Questions** — *To review · Nothing linked yet · Added this
  week · Unfiled · No source · Not assessed* — and picking one drops its terms in as
  ordinary chips. The last two ask of Claims only: one that cites nothing, and one with
  no confidence given (`lacks=source`, `lacks=assessment` on the catalog and graph
  routes). The Overview keeps its four tiles. That is the
  whole of the onboarding: the answer arrives, and the sentence that produced it is
  sitting there to edit. They are code, not saved state, so nothing new has to reach
  the backup.
- **Eleven axes, every value chosen from the case and counted**: a stored field and
  one of its values (*kind = video*), one or several types, one or several families, a
  folder with or without its subfolders or none at all, review state, a one-hop test
  for touching a type, having no connection at all, when it was filed, what filed it,
  and a Claim with no source or no assessment. A count that would answer a *different* question is not shown: **Linked to a
  place** is priced by how many rows touch a place, never by how many places the case
  holds. A field with no value picked yet asks nothing, and a field the case holds too
  many distinct values for is not offered — a menu of five thousand paths is not a way
  to choose.
- **The field menu is read on the click that opens it**, at any case size. Gated
  behind picking a type first, `kind` — the field the importer writes, the vocabulary
  declares nowhere, and an analyst most wants — was a filter nobody could find; gated
  behind a size, the large cases lost the one filter that scales for them. The scan is
  linear and small (50 000 entities in 0.3 s, 100 000 in 0.7 s), and what keeps the
  menu readable is the bound on **values** above, never the number of rows.
- **The count is the answer, against the whole case**: *23 of 1 204*. The denominator
  never shrinks with the numerator, because a proportion is the information a count
  carries.
- **Draw these N** hands the question to the graph. The **filter** travels, never the
  rows it matched: ids would be capped, would bloat the URL and would go stale on the
  next save, where a question is something the case can be asked again — and both
  surfaces resolve it through one predicate, so what the drawing holds is what the
  table counted.
- **Rows · Totals** is a view switch, the one Files and the Media Library already use,
  sitting at the right of the count line. *Totals* renders the same question as a total
  instead of a list: one row per subject the statements point at, summed over `count`
  and split by condition, ranked. The chips do not move. It is **there from the first
  day and dimmed until it can draw a real line** — never hidden, since a control you
  can see and cannot use teaches something. A line is real when a statement carries a
  **number** and points at **something**: *seen, not counted* is an answer rather than
  a row, and a statement about nothing has no subject to sit under, so a total offered
  over either opens on an empty answer that reads as a finding. An empty table and a
  frozen snapshot dim it too. What **one** subject comes to is read where that subject is,
  in its own Details; this reads several at once. **Nothing is totalled across
  subjects**, because a statement may point at two and one number could not say which
  it meant.
- **The question is remembered per case**, in the browser rather than in the case: it
  is how somebody was looking at their material this afternoon, not something a bundle
  should carry to another machine.
- **Views** name case-owned analyses, in two families. Board and Graph ask one question
  of the catalog and share both their question and their list of views; the Timeline
  reads time and shares with neither, so each menu offers only the readings the surface
  under it can draw, and a name is claimed inside its own family. A live view saves the
  Search+ question and the surface presentation, then recomputes against the current
  case when opened. Every
  later filter, sort, fold, hiding, expansion, camera move and graph drag autosaves;
  the badge says **saving…**, **saved** or **save failed**.
- **Each surface restores only what it saved.** Opening a Graph view from the Board puts
  its question on the rows and leaves the analyst where they are; the lens, the folds and
  the arrangement wait for the Graph, which restores them off the same active view. The
  row names the surface, so a reading made elsewhere is recognised before it is opened.
- **Export writes the reading out as a plate**, from Graph and from Timeline alike.
  A plate is a page rather than a screenshot: a header naming the case, the view, the
  lens, the question, the window and the clock, the drawing itself, and a legend for
  its hues and strokes. **SVG** is the default — the drawing is rebuilt as vectors from
  the same geometry the screen uses, so it zooms without softening and its text stays
  text — with **PNG** for an image and **Copy image** for the clipboard, which takes no
  SVG. The image states the scale it will really have, since a wide reading rasterises
  under twice the page. The page is always drawn on the daylight palette whatever the app
  is set to, and a Timeline plate is laid out at its own width rather than the browser's,
  so two analysts export the same file. The header states what the drawing holds and what
  it leaves out: how many nodes and links are on it, entries with no date, nodes a fold or
  a focus is holding back, verbs dropped where the drawing is too dense to carry them.
  Nobody can hover a page, so a Timeline plate that left some names off its marks lists
  every entry of the window under the drawing, date as written beside each, and its
  header says `labels shown for N of M; the full list follows`.
- **The menu is where a list of readings is kept in order.** Every row states its mode,
  its surface where the family holds two, and when it was last written — a distance up
  to a week, then the date, with the exact UTC minute in the tooltip. Past one saved
  view, **Sort** offers recently updated, name or surface, remembered per family in the
  browser. **Rename** edits the name in the row itself and is the one edit a snapshot
  accepts, since a label is not evidence.
- **A snapshot freezes a reading, not a second case.** It keeps up to 2,000 captured
  entities, their fields and provenance, the relations among them and bounded photo
  previews. Its Search+ controls and every case write are disabled, and its own
  **Snapshot details** panel reads only the captured copy. A Board snapshot stays in
  Board and a Graph snapshot stays in Graph. Leaving it closes the captured panel.
  Snapshots have no standalone import/export: duplicate and Trash stay inside the
  case, while the complete case bundle is the one transmission boundary.
- **A proposal is settled from its row**: confirm takes its suggested relations with
  it, dismiss is the standard delete, recoverable from the trash.
- **Sorting**, in the flat table, is a click on any heading, reversed by a second. Two of them name a
  column the store can order the **case** by — identity and created — so *newest first*
  is the newest in the case rather than the newest of the hundred rows loaded. The
  others sort what is loaded and say so beside the count while there are more. One
  gesture either way: which of the two it is belongs to the column, not to a second
  control the analyst has to find.
- **Columns**, in the flat table, are the four every entity has — identity, type, folder, created — plus
  the chosen type's declared fields once a single type is picked. Read-only: a value is
  edited in that row's Details, and the Case Sheet works on the case's CSV files rather
  than on these rows. A primary entity photo replaces the type
  icon in the identity column; without one, the icon remains.
- **A row is a control**: focusable, opened with Enter, walked with the arrow keys,
  and the review clicks inside it never open it. Adding an event about it is Details'
  own **Add event**, not a press on every row.
- **A box per row deletes several at once.** A mistake is rarely one row — a folder
  imported twice, a scraper run that filed forty of the wrong thing, a paste into the
  case next door — and undoing that one Details panel at a time is what made a slip
  expensive. Shift ticks a run and unticks it the same way, and the bar above the table
  says how many are going. The heading box reads the selection: empty, it takes the
  rows loaded; part-ticked, it shows a dash and **clears** — completing a selection
  would tick the row deliberately left out of it. The dialog is the
  organizer's, word for word, and the delete lands as **one** trash group, so the Undo
  in the toast takes the whole act back rather than the last row of it. A frozen
  snapshot has no boxes, since every case write is off there.

**The vocabulary explains itself on hover.** A family, a type, a verb, a rating and a
declared field each carry one clause from the registry that declares them, shown
where the word appears. No screen writes its own wording.

## Graph

The second tab of the same workspace, and a different question from the Board rather
than a second rendering of it: what sits at the centre of the case, what connects to
what, and what nothing connects to. It opens on the **whole case**, because a case is
a subject before it is a set of statements — a conflict followed over months has no
single root to expand from. Expansion is the drill-down.

- **Lenses** are the readings, and each one chooses both which verbs are drawn and
  which nodes: **Everything · Subjects · Ground · Claims** read the case, and **My
  work** reads the filing — what you wrote, what it was made from, and what it points
  at. They are resolved from the verb registry and the type roles, never listed here,
  so a relation or a type added to the engine joins its lens with no edit.
  Narrowing the verbs never hides a subject: an entity with no edge *in this lens* is
  an answer. What a lens takes out of the drawing is a whole **role** — a post, a note
  and a file's Inspect work are the filing rather than the case, and My work is the one
  click back to them. A node's degree follows the reading, so it never prices a click
  that could bring nothing in, and a name typed into the search can be brought into
  every reading except one that does not draw its type: that one says so instead.
- **A source is an edge, and the edge says what it stands for.** A bookmark between a
  statement and the account that posted it is drawn as one thicker line reading *cites 3
  bookmarks · 1 account* rather than as three nodes: the path survives and becomes
  legible, and the budget goes on the subjects. The edge is read in the panel and hands
  its sources back with one click — nothing else can be done to it, because it is not a
  row the case holds. **The sources need not be on screen for the path to be:** a
  bookmark the budget cut is folded exactly like one it kept, or a statement resting on
  nine sources and one account would draw as a lone dot with both of its ends visible
  and nothing joining them — on precisely the cases too large to draw whole, which are
  the ones that need it. One folded from a type this reading does not draw says where
  it lives instead of offering sources it could only refuse.
- **A step is an edge too.** A frame pulled out of a video and built into a proof is
  drawn as *derived from 1 frame* on the line between the two, not as a node in the
  middle — the act is what the edge is written with, and the picture stops spending a
  slot per step. Steps in a row read as one line to the far end. A step that shows a
  place, that a statement cites, or that the case calls the same picture as its source
  stays a node: it carries something that line cannot say. So does a node made from
  **two** sources, since collapsing it would say one of them came out of the other.
  *My work* draws every step as it is, because what was made out of what is the
  question that reading exists to answer.
- **What came out of a node and was used by nothing is its count.** Twelve frames saved
  off a video and not built on yet are twelve pictures of that video, so the video says
  *12 frames made from it, used by nothing* instead of drawing them. It is a **statement,
  not an offer**: the node goes on pricing those twelve among the connections the drawing
  does not hold, and **Expand** brings them like any other. Two counters for one question
  is what the split gave — the pill reading `+4` beside a menu offering *1 more
  connection* for the same five nodes, a difference about the mechanism rather than about
  the case. Narrow on purpose — one connection, and it has to be a derivation pointing at
  its source. A node with a single *relation* stays where it is, because thin material is
  what the case has yet to exploit rather than clutter, and a node joined to nothing
  stays too.
- **One finding on the ground is one arrow.** A proof concluding a coordinate states
  the point of everything behind it, so the frame, the video, the proof and the capture
  all point at the same dot and a reading of the ground draws nothing saying three of
  them are one picture. They collapse onto the material the finding is about, and the
  place says what it rests on: *1 source*, not four. A capture pulled at those very
  coordinates is the reference the comparison was made against, so it folds in rather
  than counting; one nobody made a proof from is the only thing saying anything about
  that point, and it stays. Answering POV writes two different verbs over one material,
  and they collapse together: the surviving line is **the case's own statement**, it can
  still be confirmed or withdrawn, and the rest are named on it. A line standing for more
  than itself is drawn heavier at every zoom and writes its count once the drawing is
  close enough for the nodes to be cards, since three hundred sentences over a case hide
  the shape the drawing is for. **A node still standing goes on counting what the arrow
  took**, and opening it draws exactly those: unlike every other fold here, what this one
  put away is named on a line that need not touch the node it was taken from, so pricing
  that node down would leave it claiming connections it visibly has.
- **`Ctrl+Z` takes back the last change to the drawing**, and `Ctrl+Shift+Z` puts it
  again; both are offered as buttons too, since a canvas teaches no gesture. It reaches
  everything that is presentation — expanding, hiding, folding, the lens, the ordering,
  a node dragged — and **nothing that writes to the case**. That boundary is the point:
  a single stack mixing *I hid a node* with *I deleted a statement* would rewrite the
  case on the fourth press to get a view back, and an edge cannot be un-deleted anyway,
  since re-filing one mints a new id, a new date and a new author. A relation filed by a
  mis-drop is offered back where it is announced instead.
- **Independence is read, not computed.** A statement's panel says what it rests on —
  *3 sources · 1 account*, marked when every one of them traces back to the same
  account — and the toolbar counts those statements. The count is **pressed to reach
  them**: it lights those statements and one hop around them, which with the sources
  folded into the edges is the finding itself. A number naming a set with no way to it
  sends you opening statements one at a time. It concludes nothing: whether three
  citations from one account is a problem is the analyst's to say, and a source with no
  known publisher is left out of the claim rather than assumed.
- **The case proposes the links its files already state.** Who posted a file is written in
  its address on X, Telegram, TikTok, YouTube, Instagram, Threads, Bluesky and the
  fediverse, and two points under 300 m apart are usually one site; the case files both as
  proposals (`engine/proposals.py`) after an import, dashed on the drawing, so islands of
  one geolocation each join through their account and their site. **N proposed** in the
  toolbar opens them as one list of sentences — *@BashaReport posted clip.mp4*, *Hangar and
  Runway are one site, 110 m apart* — each with Confirm and Drop, and a line pressed shows
  its node. A dropped proposal does not come back, and dropping the last one of an account
  the case filed takes the account too. On a case filed before this existed the toolbar
  offers **Find links** once; after that every import reads the case again and the count
  is the only news, so the toolbar stays as it was.
- **A point named by its coordinates is drawn by the town it is near.** *96 km N of Al
  Ḩazm* says where `16.982714, 45.053931` is to anybody who does not read coordinates,
  from the offline gazetteer (cities of 15 000 people or more, within 100 km), and the
  exported plate writes the same. The label stays the entity's: the panel shows both and a
  search still matches the digits. A point somebody named keeps its name.
- **The legend is the control** for the budget, where the lens is the control for the
  reading. On a real case one family dwarfs the rest, so leaving `collected` out is
  what spends the budget on the actors, places and statements instead. A handful of
  switches, no knowledge of the case needed to use them. The rows are the families the
  *case* holds rather than the ones drawn, or one switched off would take its own
  switch with it, and the last one on stays on; a family whose every member this
  reading leaves out is not offered, since that row would switch nothing. Families
  resolve to types on the way out, as the Board's family filter does, against the types
  the case actually holds — a free-typed entity no family speaks for is never dropped
  by a switch that does not claim to cover it.
- **Keep** decides which nodes a case too large to draw holds on to — the most
  connected, or the latest work — and the count says what was left out rather than
  presenting a slice as the case. It appears only once a case has actually been cut,
  because that is the only time it changes anything.
- **Position means connectivity, and repeats.** A ring per family seeds the placement;
  a relaxation then pulls linked nodes together and pushes the rest apart, so the
  parts of the case that are about each other end up next to each other and the hubs
  sit in the middle. What nothing connects to is parked in a captioned column instead
  of drifting in the cloud. An expansion switches to one column per hop, since
  distance from the root is then the question. **Nothing reads a clock or a random
  number**: same case, same pixels, because a graph screenshot goes into a report
  beside a satellite capture.
- **A question worked out in the Board is drawn here.** *Draw these N* hands over the
  filter, not the rows it matched, so the drawing answers what the table answered at
  any size and goes on answering it as the case changes. It is written over the canvas
  as the sentence it is, with one press back to the whole case — a picture that
  silently answers somebody else's question looks broken. The legend still narrows on
  top of it, and **narrows**: two filters sharing no type is a real answer, and an
  empty one.
- **Search+ is the same question here.** Text and every filter axis narrow the graph
  request itself, including stored entity fields; the graph is not repainting an old
  payload. A matched field is named in the node panel. Saved live views preserve this
  question plus lens and presentation. Pins and camera belong to that named reading
  and never rewrite the case-wide arrangement. Graph snapshots keep their captured
  fields, relations, photo previews and presentation read-only on this surface.
- **The drawing can be added to, not only read.** Right-click the empty space for
  *New entity here* — filed through the same dialog the Board uses, drawn, and pinned
  where the press landed; saying what it is to something else is the *Connect to…*
  gesture that was already there. Dropping a file anywhere on the canvas runs the
  Media Library's import and lands the media where it was dropped. Before this, an
  analyst who realised the picture was missing an account had to leave for the Board,
  create it, come back and search for it. The creation is **not** on the drawing's
  undo stack — that stack never writes to the case — so `Ctrl+Z` takes the node out of
  the picture and the toast's *Undo* is what takes the entity back, through the
  standard recoverable delete.
- **A node reaches its row**, as a row reaches its node: *In the Board* opens the same
  entity in the table, its group open and its Details beside it, and *In the graph* in
  any Details panel opens it here. A Claim followed from anywhere opens on its own
  Timeline entry, in Undated or off the UTC axis when it has no place there.
- **Find a node** by name, ranked most-connected first. On a case drawn at a few
  hundred nodes, hunting one by eye does not work, and a canvas cannot be reached
  from the keyboard at all — so this is both the way in without a mouse and the only
  practical way to a particular entity. Picking a result selects it and brings it
  under the eye at the current zoom.
- **Typing lights the drawing, and removes nothing from it.** From the first letter
  every match is outlined and keeps its name at any zoom, an edge lights when both of
  its ends match, and the rest of the case falls back to context. A filter would have
  answered the same question by taking the rest away, and the shape of the case is
  what the analyst is holding their place with. The count is over the drawing —
  *no match drawn* is a different answer from *no such entity*, which is the list's
  to give. Pressing on the case puts the list away without giving the search up, so
  the nodes it just pointed at can be read; the field asks for it back. Escape gives
  the whole search up.
- **One question narrows the picture at a time.** A search, the statements on one
  account and a selected node all dim what they are not about, and composited they are
  not a third reading but an unreadable one. The most recently asked wins, so typing a
  name outranks the node already clicked — which still rings itself and opens its
  panel, since that is what a click is for. Pressing the count gives a typed name up
  rather than answering with an unchanged picture, and Escape lets a narrowing go
  before a handful that was gathered node by node.
- **It searches the case, not the picture of it.** A view is bounded, so past the budget
  most of the case is not on screen, and a search that read only the drawing answered
  *no such entity* for entities the case plainly holds — nothing told "not in the case"
  from "not in this picture". What the drawing does not hold is listed apart and offers
  to **bring it in**, through the same `expand` that opens a node: it arrives with what
  touches it, kept whatever the ranking and the narrowing would have done with it, and
  it is selected and centred so an arrival off screen is not mistaken for nothing
  happening. The search is asked of the catalog, the read the Board uses, and ignores
  the narrowing on purpose — a name typed is a question about the case.
- **Hover reads, selection commits.** Passing over a node lights it and its edges and
  names them; a click is what narrows the picture. Selecting fades the far context
  instead of hiding it, and the side panel reads the node's own connections in words,
  using the registry's inverse wording for an incoming edge. The root of an expansion
  never fades its own view: asking for three hops and getting two of them greyed
  would contradict the question. **Expanding is priced on the node**: a degree is
  shown before the click that spends it.
- **The panel reads a node, it does not list its edges.** Connections are grouped by
  what they say — the verb and its direction, since the registry words those apart —
  under a heading that counts them, biggest group first, because what a node mostly
  is, is the first thing to say about it. Past eight in one group the rest are asked
  for rather than listed. Hovering a row singles its edge out on the canvas, verb
  written on it, and the node's other edges step back: selecting already lit all of
  them, so *which line is this row* had no answer otherwise. Clicking a row reads the
  node at the other end, and the view moves only if that node is off screen — the
  layout puts linked nodes next to each other, and recentring on every step makes the
  drawing lurch under the reading.
- **A node states the connections the picture does not hold.** The rows above are
  built from the edges on screen, so a node with forty connections and three of them
  drawn read as a node with three. The count underneath is the node's own, against the
  connections the view holds rather than the ones it can draw — a loop is kept and
  never drawn, and counting it as missing left a node asking for ever. In a whole-case
  view, expanding it from there is the same act as the menu's; in a neighbourhood there
  is nothing to press, because that read is grown by **Hops**, and the line says so.
- **The focus says how far it reaches, and stays until it is let go.** A strip over
  the drawing names the node in hand and offers **1, 2 or 3 hops** — on the keys as
  well, beside the one that fits the case. One hop answers *what touches this*; two
  answers *what does this sit between*, which is the account two people both cite
  without either naming the other, invisible at one hop and drowned at the whole
  case. The rings are walked over the **edges already drawn**, so a wider reach costs
  no read and can claim no connection the picture cannot show. How far you are
  looking is kept as you move from node to node — it is a stance, not a property of
  what you clicked — and goes back to one hop when the focus is let go. Never offered
  on the root of a neighbourhood, whose own **Hops** asks the case a different
  question.
- **Only this** takes the rest of the case off the screen rather than dimming it, and
  frames what is left. Dimming is the default because the shape behind the reading is
  what keeps your place, but a subset you mean to work on has to be readable alone. It
  never touches the layout, so switching back puts every node exactly where it was and
  the view with it. A name typed while it is on outranks it and the case comes back
  with the matches lit: an edge needs both of its ends, so hiding everything outside
  the matches would have answered a search with a scatter of unconnected dots. Escape
  gives the case back one press before it gives the node up.
- **A path is walked, not remembered.** *Walk by hand* arms the walk on the node in
  hand, and from then on the drawing shows only where the path can go: every node it
  may reach next is lit before the click, so an impossible step cannot be taken
  rather than being taken and refused — the same bargain the connection gesture
  makes. Clicking a lit node extends the path; clicking one already on it walks back
  and drops what came after; the panel's rows do the same, which is how the walk is
  reached without a mouse. Escape gives it up whole, as it drops a half-drawn
  relation. Path edges are drawn as ribbons, told apart by **weight and solidity
  rather than hue** — a graph that reaches a report is printed in grey, and the
  families already own the palette.
- **Or the case is asked for the way.** *Path to…* arms the question on a node and
  waits for the other end: **click any node**, pick a name from the search, or take a
  row from the panel — an armed gesture owns every way of pointing at a node, and the
  search is not a convenience but the half a click cannot cover, since the view holds
  a fraction of a real case and *are these two connected* is asked about things far
  enough apart to be off screen. **Nothing is dimmed while it waits**, which is where
  this parts company with *Connect to…*: a relation has a vocabulary that rules a
  pair out before the press, a route has none — the case is searched, not the
  drawing, so greying a node would be the picture asserting what only the server can
  know. That means dropping the focus fade the armed node would otherwise still be
  carrying, or the drawing says *only these five can be pressed* over a strip saying
  click anything. *No route within four hops* is that answer, and it is a finding rather than a
  silence. A route through nodes the budget cut brings them in first.
- **Every equally short route is drawn, one is read.** The ties are the point: two
  accounts reaching the same place through two different sources is what independence
  looks like, and an answer that drew one of them would hide it. The drawing lights
  them all — *how these are connected* — while the sentence takes them one at a time
  with a `1 / 3` stepper, because a sentence cannot be read three times over. An
  answered route is walked onward from and stepped back through like any other, which
  makes it a place to keep working rather than a result.
- **The path reads as a sentence**, node by node with the verb of each step between
  them. An edge crossed against its own arrow takes the registry's inverse wording,
  so the sentence always reads left to right: the first attempt wrote the plain verb
  with a reversed arrow, and *A ← made from B ← made from C* has to be walked
  backwards to be understood. Nothing is stored — a path is derived from edges that
  can be deleted, so a saved one goes quietly false the day a link in its middle is
  removed. What gets kept is the sentence, in a note, written by a person.
- **Right-click a node** and it says what can be done with it, in words: expand the
  connections it has off screen, collapse what hangs off it, hide it, connect it to
  something, or read it in Details. A
  canvas teaches no gesture on its own, so the acts are named rather than hidden in
  one. The menu selects nothing — asking what a node can do is not choosing it.
- **Expanding a node grows the picture instead of replacing it.** Its off-screen
  connections join the case already drawn, marked as arrivals, and **nothing already
  on screen moves**: everything drawn is a fixed point, so only the arrivals are
  placed, seeded beside the neighbours that asked for them. That is a promise about
  the picture before it is one about the clock — twenty nodes expanded into two thousand
  cost twenty placements instead of two thousand, which is a fifth of a second where
  it was six. A new *question* — a lens, a filter, a folder — re-places the case
  outright, since that is a different reading rather than the same one grown. The view
  does not refit either: losing your place is what following a thread used to cost.
  The price, taken deliberately: the picture depends on the order things were expanded
  in, exactly as it already depended on what was dragged. The count offered is what is
  *missing*, not the degree — when every neighbour is already drawn the menu says so
  instead of offering an act that would appear to do nothing. The panel's **Around
  this** is the other act, and is worded apart because it does the opposite: it
  replaces the case with one node and its hop columns, where **Expand** adds to the
  case in place.
- **Three acts on the drawing, three words: Expand, Collapse, Hide.** Expanding brings
  in what a node has and the picture does not; collapsing puts away what hangs off it;
  hiding takes it out. They are named that way in the node's menu, in its panel and in
  the tooltip alike — the tool once said *Open*, *Fold back*, *Fold it back*, *Take it
  out* and *Bring back* for what is really three things, and a second name for one act
  leaves the analyst deciding whether it is a second act. One way back for all of them:
  **Reset view** in the toolbar, offered only once the drawing has actually been
  edited, draws the case the way it opened without touching the reading or the
  arrangement. *Drawn as one edge* stays clear of all three: an attestation collapsed
  into one line is a way of drawing an edge, not an act on the set.
- **The switch is on the node, and states which act it is before it is pressed.** A
  pill on the node under the eye reads `+3` or `−3`, double-clicking presses it, and
  the tooltip spells out what it counts. It grows before it tidies, which is what makes
  one switch learnable: a node holding collapsed nodes gives them back, a node with
  neighbours off screen goes and gets them, a node with everything already around it
  puts that away. **It is never offered where it would do nothing** — a node the case
  has already expanded cannot be expanded again, so its switch falls through to the
  fold, and the menu's greyed line says *Expanded, 3 did not fit* rather than greying
  in silence. The same switch is in the panel in words, since a canvas cannot be
  reached from the keyboard.
- **Collapsing reaches the picture the case opened on, which no other act does.**
  Expanding adds and hiding removes; neither speaks for the two hundred nodes that were
  on screen before anything was touched, and those are the ones in the way. Collapsing
  a node puts away **what only hung off it** — pull the node out of the drawing in your
  head, and whatever falls off with it is what goes. A lone neighbour always goes; among
  the pieces with a shape of their own the biggest stays, because a control that can
  take the case away with it is a trapdoor; and a piece holding a node placed by hand
  never goes. So **a fold never cuts a link between two nodes that both stay**: the
  picture left behind says what it said before, with fewer dots. Nothing is asked of
  the case and nothing is given up — the nodes are still in the payload, `N folded` in
  the toolbar gives every one of them back at once, and a name typed into Find reaches
  a collapsed node where it is instead of fetching it again. What it does not do is
  make room: the case still sent those nodes, and **Hide** is the act that frees budget.
- **The drawing is a set you own.** **Hide**, in the panel and in the node's menu,
  leaves *any* node out of the picture, not only one you expanded. Nothing is
  deleted: the case keeps the entity and every connection it has, and the wording keeps
  clear of the edge panel's *Remove*, which does delete a statement. Three ways back at
  three sizes: the neighbour it was hanging on gives that one node straight back,
  **Undo** takes the last change off, and **Reset view** draws the case the way it
  opened. The removal is applied last, so it survives an expansion that reaches the
  same node.
  **The node it was hanging on hands it straight back**: hiding is your own act on your
  own picture, and undoing one node of it should not cost the whole drawing or the name
  of a node you have just decided not to look at, so the neighbour counts it among the
  connections the picture lacks and its switch gives it back. Naming the node again
  outranks the removal too,
  whether the name comes from Find, from a route or from a source handed back off an
  edge. It is offered on the whole case only: a neighbourhood's root is the question
  being asked, and that read takes no such list.
- **A hidden node takes what only it was holding.** Hiding the node you had expanded
  used to leave its neighbourhood behind with no edge to anything. What stays now is
  what something standing on its own still reaches: a node the ranking drew, one you
  named, or a second expansion that reached the same node, which is the convergence the
  drawing exists to show. Reachability rather than a count of edges, because the
  vocabulary ranks no edge above another and a pair holding only each other is as
  adrift as a single dot. *Reset view* undoes the whole act, since the removal was one.
- **Drawing a node is not drawing its neighbourhood.** The two were one act, so
  anything named arrived with everything it touches: a four-node route came in behind
  four neighbourhoods and the answer was buried in the crowd it brought. Now a route,
  an entity picked out of Find and the sources handed back off a folded edge are drawn
  as themselves, while **Expand** is what asks for the hop around them. A gathered
  handful does both by the group — **Expand N** and **Hide N** are one read where five
  clicks were five reads landing in five places.
- **A comfort number to open on, and no ceiling after it.** A limit that refuses is
  the app overruling the analyst about their own picture: drawing the case and asking
  what touches one node shared one budget, the ranking spent it first, and the answer
  asked for outright was the one refused — in silence, since the node was recorded as
  expanded and the control that offered to expand it greyed itself. So the first draw
  opens on **300 nodes**, the most connected, with the case's own total beside it —
  *300 of 1 050* — and **everything after that is unbounded**: nothing named, expanded
  or brought in is ever refused for room. An absolute count rather than a share of the
  case, because a tenth of fifty entities is an empty picture and a tenth of ten
  thousand is a freeze.
- **The drawing says what it weighs, since nothing stops it growing.** The placement
  compares every node against every other, sixty times over, on the main thread: five
  hundred place in a quarter of a second, a thousand in one, two thousand in four with
  the tab frozen throughout. So past a thousand the toolbar says *heavy drawing*, past
  two thousand *very heavy*, each with what the next change will cost. It is a price,
  not a wall — the acts that answer it are the analyst's own: hide what the picture is
  not about, collapse what hangs off a hub, or switch a family off.
- **Connecting is two clicks and a named verb.** "Connect to…" arms the gesture, a
  dashed arrow follows the pointer, and only the endpoints the vocabulary accepts stay
  lit — so an illegal pair cannot be drawn rather than being drawn and then refused.
  The case can still be panned while it is armed, since the two nodes worth joining
  are rarely near each other. Landing offers the readings that pair allows, each in
  its own words and under the registry's own heading where it has one, so a pointer is
  not read as a statement, and files the one chosen through the same route Details
  uses. Nothing is said when it lands: the new edge appearing is the confirmation, and
  the only case worded is a lens that does not draw that verb.
- **An edge is a thing to read and to rule on.** Clicking one names it, says which way
  it goes, who filed it, and offers *Confirm* on a proposal or *Remove* on any of
  them. On a worked case the finding is more often on the edge than on either node —
  so how sure of it, and what kind of tie it is, are set here too rather than a panel
  away in Details. Each control appears because the **registry** declares it, not
  because the edge holds a value: a ratable verb gets the rating, a verb that takes a
  qualifier gets the word. A proposal gets neither, since reviewing a machine's claim
  and grading it are two gestures and the API refuses the second first. **Removing a
  stated edge is asked for**, in red and in the same words Details uses: the panel is
  opened to read an edge, *Remove* sat beside two controls that write nothing, and
  nothing holds a removed edge — re-filing one mints a new id, a new date and a new
  author. Dismissing a proposal stays one click, because that is the review this panel
  is for and nothing of the analyst's goes with it. Nothing may be
  written to a line that stands for several, which is why a folded edge offers only its
  sources back.
- **Folder** draws one of the analyst's own buckets instead of the whole case, read the
  way the Board reads it. It sits in the toolbar rather than behind a menu because it is
  the closest thing the case has to *what I am working on*. The Board's other two
  filters are deliberately absent: review state would draw the proposals alone, and a
  proposal's far end is nearly always confirmed, so the closed link set drops every
  edge and the picture becomes a column of dots — while the dash already says
  *proposed* in place. An exact type fails the same way, the verbs running between
  families; the two that stay inside one are reached by leaving one family on.
- **Every edge says which way it goes and in what words.** The vocabulary is directed,
  so each edge carries a head, and the verb is written along the edges of whatever is
  under the eye. Seven strokes — lineage, stated relation, ruled out, contradiction,
  mention, folded sources, proposal — and the legend names the ones on screen, since an
  unexplained dash pattern is decoration.
- **One rating is on the line, and only one.** A relation checked and eliminated is
  drawn apart: "it is not this bridge" is half the work of a geolocation, and eleven
  candidates ruled out drawn like live statements make a picture of the case count
  eleven open hypotheses. The other three levels get no stroke — a verdict is not a
  nuance, *probable* against *possible* is read one edge at a time in the panel, and
  four more patterns would put *what kind of edge is this* and *how sure of it* on one
  channel. Nothing is hidden either: the elimination is the finding, so it stays drawn.
- **Nodes declutter by zoom.** Wide, they are dots; the few busiest keep their name,
  because what sits at the centre of the case is the question. Close enough for one
  to fit, each becomes a **mini card**: family stripe, then a picture column as tall
  as the card holding the preview the case already holds (or the entity's glyph,
  centred in that same column), then title, type and degree. A preview fills the
  column from the middle of the thumbnail rather than being fitted inside it, since
  a wide capture fitted into a small box read as a hole in the card; the whole
  thumbnail is in the tooltip.
- **The card is sized off the screen, not the canvas** — in canvas units it would
  cover its neighbours at every zoom. It still grows with the zoom, by the square
  root of it and up to 1.7×: pinned to one exact size, zooming in bought distance
  between the cards and nothing inside them. The gaps widen faster than the card
  does, so cards that had room keep it.
- **A node says when the case made it.** A frame, an adjustment, a collage: filed as
  ordinary media and drawn with the same glyph as a photograph somebody handed over.
  The card names the act instead of the kind — *Frame*, *Collage* — and the panel adds
  one line saying it was made out of material the case already holds. Only the tools
  that compose case material mark their output: an upload carries nothing, since
  "upload" on an upload says nothing about it. A capture is not one of them — it has
  no parents to draw, and the ontology files it as collected — though the Media
  Library still holds it back as a file the app produced.
- **Previews are the cached thumbnails** the Media Library uses, loaded only for the
  cards actually on screen and only once each. The graph never generates one: a read
  that draws does no CPU work, so an entity whose picture was never cached shows its
  glyph.
- **Unconnected** counts what nothing in this lens reaches — the case's unexploited
  material, and the one figure a table has no column for. Counted across the **case**
  like the total beside it, never over what was drawn: a node with no edge sorts last,
  so a cut discards it first, and read off the drawing the figure would report zero on
  exactly the cases large enough to need it.
- **A node can be put somewhere, and it stays.** Dragging one — as a dot or as a card,
  identically — pins it: the case records the spot, and the layout then treats it as a
  fixed point that still pushes and pulls while nothing moves it. Everything else
  settles around the pins, so a node that arrives later joins the arrangement instead
  of restarting it, and new arrivals are drawn towards where the work actually is
  rather than back to the centre. The arrows move the selected node too, since a canvas
  has no other keyboard path in. A pinned node carries a pushpin, because a node that
  ignores the layout has to say why. A node held where the drawing already had it
  carries no pushpin: nobody chose that spot, so there is nothing to let go of. Moves
  are **saved as they are made** — asking for a keystroke after every drag would put
  friction on the one gesture this is for — so the way back is a control, not an undo:
  *Let it go* in the panel for one node, which places that one against a case that
  stays where it is, and **Reset N pins** in the toolbar, which drops the whole
  arrangement and lays the case out again. That count is every pin the lens
  holds, so the way back is offered even when the pinned nodes were cut from the view.
  **Ctrl-click gathers a handful** — the nodes ringed in amber move together when any
  one of them is dragged, and Escape lets them go. Moving is not all a handful is for:
  it is also expanded and hidden by the group. That is a separate act from
  selection, which stays single because the fade is computed from it and "one hop from
  the selected node" has to have one answer. **Each lens keeps its own arrangement**,
  because a lens is a reading: it draws its own nodes and its own edges, so it clusters
  differently, and one shared arrangement would anchor every reading into the shape of
  whichever one it was built in. Offered on the whole case only: a neighbourhood gives
  its horizontal axis to distance from the root, and a node moved off its column would
  contradict what that view is drawn to show.
- Drag anywhere to pan, scroll to zoom at the pointer, `+` / `-` / `0` from the
  keyboard, and the level is on screen. Colour says only which family a node belongs
  to; the meaning of an edge is on its stroke, so the picture survives being printed.
  Selection keeps the amber.
- **Full screen** gives the drawing every row the browser chrome was holding, which is
  what a case of a few hundred nodes is read at. The toolbar comes with it, so the
  picture can still be steered, and Esc gives the window back. As in the Timeline.

## Case sidebar

The sidebar has three zones: a fixed header, one scrolling body, and a details
drawer over both. Tools keep their own saved-artifact lists; the sidebar does not
duplicate them. Its left edge resizes from 240 to 640 px, capped at half the
window. Double-click resets the persisted width.

The sidebar defaults to collapsed in Map and open elsewhere. Open state is
remembered per workspace for the current session. Reloading restores the defaults.

- **Header** — the case name (its id is a tooltip), a **Notes** button listing the
  case's notes (Case notes first, then the last written; a press pins one to the
  side, ⤢ opens it in the Notebook, the last row opens the Notebook's home), and
  three views: **Folders**, **To-do** and
  **Recent**. The choice is remembered across reloads. Folders adds a search field
  and one filter chip per entity type present, counted from the catalog summary.
  The chips wrap; past the fifth they fold behind `+N`, and the active one always
  shows.
- **Views** — the sidebar sits beside whatever tool is open, so it carries what is
  worth having there rather than a second Files. **To-do** is the case's lists from
  Home, one copy shared by both, so a task ticked on the map is ticked on Home. Its
  **To geolocate** group is the same one, so a scene can be picked up from any tool.
  The tab counts the scenes waiting, the accent's dot and their number, the abandoned
  left out, and says nothing at zero. Closed, the sidebar's toggle in the top bar wears
  the Settings gear's dot while scenes wait, and its tooltip says they are in the To-do;
  pressed, it opens the sidebar as before. The queue is read once for the case while a
  case is open; a nudge naming a file then asks that file's scenes alone
  (`GET /scenes?video=`), and the queue is read again only when the open scenes there
  changed, the sidebar open or closed. In the narrowest sidebar the count takes the room of the tab icons.
  **Recent** is the last forty items filed, newest first, read only while it is
  open.
- **Body** — one rule: no filter shows the tree, a query or a chip shows a flat
  result list. A filtered tree would have to badge folders with per-type counts
  the summary cannot give, so the modes are exclusive. Result rows carry their
  folder as meta, and clearing the filter restores the tree with the same folders
  still open. Search matches labels (plus folder and type in a case small enough
  to filter in memory), not note contents — the **Files** tab searches those.
  Browse order is **Suggestions** (tool-proposed entities to confirm or dismiss,
  a node only when non-empty), the analyst's nested folders, **Unfiled**, then
  **Trash** when it holds a delete. Trash shows its item count and size; each
  group can be restored or deleted permanently, and the node can be emptied.
  `+ Folder` and `+ Note` sit above the tree, with the work folder pinned over
  them when there is one: pressing its name opens the tree down to it, the cross
  stops working there.
- **Right-click** — a folder row offers Rename, New subfolder, New note here, Work
  in this folder and Remove; an item row offers Open, Details, Rename, Move to…,
  Show in Timeline and Move to Unfiled. Renaming needs a field the row has no room
  for, so it opens in the menu itself. A suggestion keeps its two buttons and no
  menu.
- **Filing** — drag rows onto a folder, or drop them on Unfiled to unfile.
  Ctrl/cmd-click and shift-click select several rows first, and the drag carries
  all of them; folders are targets, never cargo. The tree scrolls itself when the
  pointer nears an edge mid-drag, since a native drag swallows the wheel.
  A card or a row of the Media Library drags onto a folder the same way, and
  only a file from the desktop raises the library's import overlay.
  Unfiling does not delete data. The **Files** tab (see Sources) presents the
  same tree with tiles, multi-select and context actions. It also exposes Trash
  with the same restore, permanent-delete and empty actions as the sidebar.
  Delete sends the current selection through the standard confirmation.
- **Details** — a drawer over the sidebar, closed with the back arrow or Escape, so
  selecting a row never pushes the case out of view. Every entity uses the same three
  tabs. **Info** holds identity, declared profile fields, file metadata, notes and
  folder. An entity that sits on a point shows it, read off the point itself and
  written in the coordinate format Settings chose. **Connections** holds placement, relations, mentions, Claims and the
  collapsed **Made from & used by** block. **Time** holds dated statements, intrinsic
  media dates and a collapsed Case activity section. A field declared as holding
  sentences is a box that grows, not a line. A
  suggested entity says so at the top and carries the click that confirms it.
  People, organizations, assets and equipment types add a photo gallery above the
  form. It accepts several images from the computer or the Media Library, keeps the
  main preview to a normal panel height, and lets one image become primary. A
  computer import stays private to the entity and never enters the Media Library;
  choosing from Media only stores a reference. **The two are not one act and are not
  called one thing.** *Remove* takes a Media choice off the entity and leaves the media
  in the case, on the click. *Delete this copy* is the other, because a private photo
  exists nowhere else and is not an artifact, so no Trash holds it and no toast can undo
  it: it is asked for, in red. One word for both read as the harmless one. With
  no photo, only the two add actions remain and other surfaces keep the entity icon.
  The same two actions appear while creating a supported entity. Photos are staged
  in the form, where one can be chosen as primary, then attached after creation.
  Save commits the entity fields; each connection has its own Add action. Because the
  two commit differently, closing the panel or following a connection asks first when
  Save has not taken what is on screen.
  A file the app has no viewer for — a document, a scan, a spreadsheet — offers
  **Show in folder** rather than a download link and no tool button: handing it to
  the browser makes a second copy in Downloads, and the analyst ends up working on a
  file the case does not know about. Following one from anywhere else does the same.
  The sidebar and Media Library modal share `EntityDetails.svelte`. Image Details
  include a closed EXIF section with the parsed capture date, GPS and every readable
  tag; Video Details use the same pattern for ffprobe container, stream and tag
  fields.
- **Delete** — deleting an artifact moves its registered files and cascade into
  Trash and shows an **Undo** toast. The confirmation uses the neutral tone and
  states what can be restored. Red is for what nothing holds afterwards: deleting a
  case, purging a trash group, emptying Trash, and deleting an entity's private photo.
  **Every delete says what it touches before it runs.** The dialog asks the server
  (`POST /delete-impact`, `engine/uses.py`) and leads with *Linked to N other items in
  the case* or *Nothing else in the case uses it*, then lists what goes with it, what
  stays with a record of its missing source, and what stays but loses its link to it,
  each line saying how (*shows it*, *was recorded here*, *1 marker follows it*). The
  confirm button waits for that answer, at most ten seconds, and stays off when
  something must let go first (*Take it out of these first*: a Detect routine watching
  an area); a check that fails says it *could not check*. A selection is previewed as one act, so a proof
  deleted with its source is not listed as scarred. Saved work that went to the Trash
  in one press (a plate, a comparison, a Horizon search, a Detect routine or pass)
  still does when nothing leans on it, and asks first when something does.

## Case switcher

The switcher creates, renames, opens and deletes cases. The menu leads with the
list, since switching is what it is opened for: search on top, cases and scratch
sessions in one scrolling list, and every action in a one-line footer — **New
case** labelled, then import, open folder, export and close as icons, each with
its tooltip. The Case Doctor shield sits with those case-level actions. A case
whose database cannot be opened stays in the list with **Needs attention** and
its own Doctor button, so repairing it does not require opening it first.
Five stacked verbs no longer push the list below the fold.
**Export this case**
starts a durable job, then downloads the `.azimut.zip` through the browser.
Optional password protection downloads `.azimut.enc`; the dialog states once
that a lost password cannot be recovered.

**Import case** opens the browser's file picker for `.zip` and `.enc`, uploads
the selected bundle for a pre-flight check, and shows its case name, size,
temporary disk requirement, available space and protection state. Confirmation
always creates a new case, waits for the durable
import job, then opens it. It never replaces or merges an existing case.
Confirmed entities and relations remain confirmed in the imported case.

**Folders in the workspace** that are not cases sit at the end of the same
list, dimmed, marked **Not a case yet**. Clicking one makes it a case where it
is: nothing moves, and what was already in the folder stays in the analyst's
half. A folder holding a case that lost its manifest reads **Case to recover**
and opens the Doctor once the manifest is back. A name no case folder can carry
reads **Rename to use** and does nothing until it is renamed.

**Case Doctor** checks without writing. A healthy case gets one short result;
damage is listed one item at a time with only the repairs that apply. Database
rebuild states what cannot be recovered before the button. Removing a missing
media record takes a second click, while relinking only accepts an unregistered
file already placed in that case's `media/` folder. A stale Timeline index can be
rebuilt from Claims and media metadata.

## Workspace folder

Settings → Storage holds the folder. There is no native picker, so the path is
typed and **Check** reads it before anything is offered: refusals in red,
warnings in amber, and the folder Azimut would actually use when that differs
from the one typed. Two actions follow, never merged, because their outcomes
differ. **Use this folder** switches and moves nothing, and says how many cases
would stay behind. **Move everything here** copies, and while it runs the tab
shows the step and the bytes while Azimut refuses other work. Afterwards the old
folder is named, with one button to delete it. A folder set through
`AZIMUT_HOME` is shown without any of this: the variable wins every launch.

A full-screen panel replaces the app when the workspace can't be worked in, with
the same picker inside it and a different sentence for each reason. **Gone**:
where it was expected, and that nothing has been deleted or recreated.
**Held by another Azimut**: which machine and port has it, what two instances
would cost, and Reload. **Take it anyway** is there for a lock that outlived its
process, warned once and never presented as the ordinary way out.

## Export folders and backup

Settings → Storage remembers one destination each for note PDFs, media copies,
proof PNGs, views and comparisons (map plates included) and sheet CSVs. **Change…** opens the shared folder browser, which lists folders
only and can create one; the case's `exports/` stays the default. Media Details,
saved proofs and Notebook use those same destinations. Files already outside a
case are never overwritten, and concurrent exports reserve distinct numbered
names. Geo Proof's Export the slides uses the proofs destination, one new folder per set.

Settings → Icons is the icon library: files, a folder or a zipped pack dropped or
picked (PNG, JPEG, WebP, GIF or SVG, 512 KB a file, a thousand icons), each pack
folder a group. The browser draws an SVG as a PNG before sending it; the server
decodes every picture, keys out a flat background, trims it to what it paints,
sizes it to the layers' icon weight and stores it under the hash of its pixels,
so a picture imported twice is one icon. Each tile renames its icon, switches it
between in a disc and as it is (guessed at import from how many colours it
paints) and moves or removes it; a group renames or removes as a whole.

The Settings backup carries portable settings, API keys, templates, the icon
library, the logo and the report signature with its name, role and organisation. Templates and icons are added to those already here,
one of the same id replaced. It leaves absolute export paths, the workspace pointer and download
sessions on the machine that created them, and the UI tells the analyst to keep
the downloaded backup private.

## Connections

Details keeps four concepts visually separate: **Relations**, **Mentions**,
**Claims**, and the collapsed lineage block. The lineage block is labelled **Made
from**, **Depends on** or **Used by** from the direction and link type; it is not a
generic History list.

Ordinary relations render through one component wherever they appear. Two lines carry
the neighbour's name, then what the edge states and how sure of it. A suggested row
can be confirmed; any row can be removed, and a row the analyst stated asks first — the
question is written once and read by Details, a Claim's connectors and the Graph's edge
alike. Where a pair supports several verbs or both
directions, the reading is selectable. An older out-of-matrix row stays visible and
removable but cannot be restated. Past six rows the list hides the rest behind one
click, suggestions first. The registry's headings only appear where a list runs
several actions together.

**How sure, and how reliable, are two controls that never merge.** The rating sits
beside the verb, offering the levels the API serves plus *Not assessed* to clear it.
Unrated is the normal state, so it stays colourless until it holds a level, and a
ruled-out row is dimmed and kept rather than struck out. The source's Admiralty grade
sits on the line above, with the name it belongs to, stated rather than offered: it is
edited in that source's own panel. An ungraded source shows nothing.

**Add relation** searches only relation targets, **Add mention** the mention action.
Hovering either button lists the accepted target types; media-specific rules use the
current file kind. A filed relation cannot be reworded into a mention, and a mention
has no verb menu or rating. A Claim has its own **About**, **At** and **Cites**
editor; its confidence is edited with the Claim fields, and those three connectors
carry no rating of their own.

**Sources and Supports are two headings, Contradictions is one.** A statement may cite
another statement, and resting on is not symmetric — so *Sources* lists what this one
rests on and takes the **Add source**, while *Supports* lists the statements resting on
this one and takes nothing: that reasoning is written where it is being made. *Supports*
appears only once it holds something. A contradiction keeps one heading whichever end
filed it, since it reads the same from both.

**The Claims group adds up before it lists.** An entity several statements are *about*
shows what they come to — `5 destroyed · 1 damaged` — above the statements themselves,
with the same three rules the Board's total obeys: a ruled-out statement is counted
apart and never inside the sum, an absent count reads as *without a number*, and the
confidence spread is stated rather than folded in. Read over the whole case, since it
is a fact about the row rather than about anyone's filter. A place reached by `at` or a
source reached by `cites` is listed without being counted: neither says how many of
anything.

**Correcting a subject.** Details → Info offers **Change type…** for manually created
people, groups, objects, models and identifiers. Places, Claims and file owners keep
their type. A change lists incompatible relations or photos and stops before writing.
Fields outside the new type remain under **Kept from …**, with an explicit Remove
button; changing back makes them editable again.

**Merge…** finds another subject of the same type, including places. The older record
is selected to stay; either card can change that choice. The preview shows retained
fields, additions, conflicts and affected references. Conflicting values go into
attributed notes. A cycle or incompatible relation blocks the whole merge. Claims,
files and documents cannot merge.

**Undo** appears in the toast and in the survivor's **Merged from …** history. It
preserves later edits and lists anything it could not restore. Later merges involving
the same subject must be undone first. Frozen views and Notebook text stay unchanged;
opening an absorbed subject reaches the survivor and says **Merged into …**. Bundle
imports retain these redirects but cannot undo merges performed before export.

**The entry line.** One line notes what happened: `[date · optional] │ sentence with
@mentions │ 📎 │ Add`. It sits under the Timeline's axis; **Add event** at the top of
any Details and a node's menu in the Graph open the same line with their entity
already seated. Every entry is an ordinary Claim; the line only stops asking for the
ontology up front. Every surface says one verb for it, *Add event*.

**Add event from anywhere.** The topbar's **Add event** button (`Alt+N`, never inside
a field) opens the line over the bottom of whatever tool is on screen, over its own
Details or viewer too, with what that tool shows already seated: the file whose
Details or picture is open cites itself, and its one confirmed place is where it
happened; the Board's or the Graph's open entity, the inspected file, the open proof
or note, the place selected on the map. A place only suggested, or two of them, is
not seated, since seating it would confirm it without the analyst deciding. The date
stays empty, and the dates the place knows are offered beside it, one press each and
never filled in by themselves: first what the analyst already concluded (the date a
proof gives the footage, then a correction), then the file's camera, orbit and post
dates, the camera first and the post last (a post rarely goes online when it happened,
which its tooltip says),
and in Compare each picture's day and the span between them, a release date marked as
an estimate. A press fills the field, which stays the analyst's to correct, and the
reading says where the date came from until it is changed. It closes after **Add**, on
`Esc`, and when the analyst moves to another tool. On the Timeline the button goes to
the line already under the axis, about the picked entry's file when it has one (as
does **Add event from this file** under its preview), and on a frozen snapshot it is
greyed with its reason.

**Details opens on a summary.** Above Info · Connections · Time: the name, the type and
other names, how many events name the entity with the sources and places they reach,
when they fall across the case, **Timeline** to read them there, and **Add event**.
Connections lists those events under *Events*.

- **One thing to say is enough**: a sentence, a mention or a source. Left empty, the
  sentence writes itself from what is on the line — `2 × T-72B3 destroyed at
  Crossroads`, `Seen at Crossroads`, `Seen in clip.mp4` — and a sentence the analyst
  typed is kept as typed, whatever changes under it (**Rewrite from the mentions**
  goes back). **Add** is greyed only when there is nothing to say, and says so.
- **The date is empty until given.** It is read like every other date field
  (`dd/mm/yyyy`, month names, `~`, ranges), its reading is shown under the line, and a
  date it cannot read holds the line back until it is corrected or cleared. Focused
  and empty, the line lists what it takes, one example each (a day, a time, a month,
  a year, about, unsure, a span), and says an empty date waits in Undated; the
  calendar beside it builds a day, a month or a year for someone who would rather
  point. The sentence, focused and empty, says the same about `@`, the paperclip and
  `Enter`. It is
  never taken from a file or from the previous entry; a click on the axis is the one
  thing that offers one. Filed with a date, the entry is *observed*.
- **Every date is read on a clock, and a chip beside the reading names it.** The same
  **Clock** control sits wherever a date is typed: this line, the Timeline's
  **Change the date**, the full claim editor, Details and the Proof composer. It shows
  the clock and its offset on that day (`Kharkiv UTC+03:00`), and one press opens a
  searchable list: the entry's own places (**Local at Kharkiv**), the case's clock, the
  zones picked lately in this case, **UTC**, this computer, **Clock unknown** for a time
  only, and every zone in the world. A day takes a zone as well as a time does: `10/09/2026` on
  Tokyo's clock spans Tokyo's 10th on the axis.
- **The clock opens on the place.** When the line has a place with a point (or cites a
  proof with its own), a typed date reads on that place's zone, looked up once per
  point from the bundled boundaries through `GET /api/geo/zone`. Two places in
  different zones, or none, open on **the case's clock**: the one the Timeline's axis
  reads on, where most of the case's places are unless the analyst moved it
  (`lib/caseAxis.svelte.js`). A date typed with no place then lands on the axis where it
  was meant, and each place is still offered. A clock typed with
  the time (`14:30 UTC`) is kept, and a pick holds while the date is corrected.
  `lib/clock.js` holds the one rule: the value is kept as typed with its zone beside it
  (`when_zone`), a time also carries the offset its zone keeps then, summer time
  included, and UTC is stored as no zone.
- **`@` mentions anything the case holds**, through the catalog's own search, so other
  names are found too. The list puts an exact name or other name first, then what the
  line already mentions, then the rest, and says which field matched when it was not
  the name. `↑`/`↓` move, `Enter` or `Tab` pick, `Escape` keeps the `@` as text, and an
  `@` inside a word (an address) never opens it. The name goes into the sentence in
  plain text, and the subject becomes a chip in its seat, read off the verb registry:
  a place is where, a file or a document is the source, a Claim is only ever cited, and
  anything else is what the entry is about. A click on a chip takes it off; `Alt+↓`
  moves it to its next seat when it has one.
- **A name the case has never held** is offered last as `New · name`, with a guessed
  type that says its rule: an address, an IP, a network, a domain, a phone number, a
  handle or a profile address by its shape, otherwise the subject type the case uses
  most, otherwise a person. A place is never guessed, and a line cannot make one: a
  place is a point. The chip's menu changes the type. An identifier the case already
  holds is offered in its place (**Use the one in the case**) without refusing the new
  one. Nothing is created until **Add**: the subjects and the Claim go in one
  transaction (`create` on the claim route, ten at most).
- **📎 cites a source** from what `cites` accepts: files, captures, proofs, web pages,
  notes and other claims. The finder shows the kinds the case holds as chips with
  their counts, plus Images, Videos, Audio and Other files. Format filters query the
  whole catalog. The picker opens above the line when there is too little room below
  and scrolls within the viewport. Fields and buttons share a 36 px height.
  Every row says what it is: its picture when the case already has
  one (`previews=true` on the catalog page, nothing made), its type, the kind of file,
  its folder and the day it came in, newest first. The Claim editor's About, Place and
  Evidence pickers use the same finder. A file dropped on the line is imported the way
  the Media Library imports it, then cited.
- **More** holds **How many** (a model) and **Condition** (a model or an object),
  opened at once when the seated entity asks for them, **Confidence**, and **Full
  editor**, which opens the complete Claim editor on the line as it stands.
- `Enter` in the sentence adds, `Ctrl+Enter` adds from any field. After **Add** the
  line empties and keeps the focus for the next entry, and the toast offers **Undo**,
  which puts the Claim and the subjects it created in the Trash as one group. A refusal
  keeps everything on the line and says why there. An unsaved line is kept per case for
  the session, never on disk.

**A Claim's fields use three sections**: statement, time and reasoning. Each says what
it is for in a line under it: the sentence, the chosen date format (and that an empty
date waits in Undated), the time role and the confidence, in the words the confidence
scale is served with. The Time
section uses a guided editor for a year, month, day, date and time, bounded date
range or time range, with one **Clock** row for all of them. Precision and certainty are chosen separately, so the analyst does
not need to remember suffixes or timestamp punctuation. **Advanced** preserves and
accepts the announced raw syntax. It opens a complete reference beside the field:
patterns and examples for reduced dates, local/UTC/offset timestamps, subseconds,
date and time ranges and uncertainty markers, followed by the unsupported forms. Its role
says whether the fact occurred, was observed or was valid then. The count steps by
one and starts at one; leaving it empty says *seen, not counted*, which is not the
same answer as one. An asset carries its own **Condition** off the same scale, where
it reads as the last known state rather than as one observation.

The Time tab and Timeline use one backend contract:
window intersection, category and entity filters, opaque pagination, optional
year/month/day density buckets, a complete extent, and separate Undated and unplaced
counts. Unplaced means a value exists but cannot sit on the UTC axis yet.
Creating or editing a Temporal Claim writes its fields and selected
`about`/`at`/`cites` connector sets in one transaction. Deletion uses the normal
recoverable Trash workflow.

## Timeline

Timeline is the third Case tab. Its main axis is horizontal and stores its window in
UTC. One searchable picker decides what the labels read, and it opens on **where the
case is**: the zone most of the case's places stand in, read offline from their points
(`lib/caseClock.js`) and saying how much of the case that is (`3 of 5 places`), because
an investigation argues in the local time of where things happened. A case with no
placed point reads UTC. UTC, this computer's zone, any zone in the world, or local time
at a place the case has saved is one pick away, and the pick is kept per case in this
browser. A zone is named rather
than offered as an offset, so a stated hour survives the two days a year the offset
moves, and each row shows the offset in force **at the window** rather than today's.
The list is the platform's own copy of the IANA database, so it matches the renames
either way: typing `kyiv` finds a list that says `Europe/Kiev`, and `kolkata` finds
`Asia/Calcutta`.
Above a day the ticks step by that zone's calendar, so a day tick is its own midnight;
below it they keep exact spacing, so an hour a zone skips reads 01:00 then 03:00.
A saved place is the one reading that also draws **daylight** under the ruler, because a
band of day and night needs coordinates and a zone name carries none: night is the
strip, civil twilight and day are laid over it, and instants stay UTC underneath
whatever clock labels them. It is read from `/api/geo/daylight`, which is pure local computation and
answers a window wider than a month as cut rather than drawing stripes a few pixels
wide.
Category tracks stack vertically. A mark is drawn where its date is, to the pixel, and
its shape says what kind of date it is: **a point is an instant, a bracket is a
reduced date, a window is a moment known only between two dates, a bar is a period**,
and a box is never an instant. A reduced date is a thin line with a stop at each end,
across the whole year, month or day it covers; once that period is narrower than a few
pixels it is drawn as a point in its middle. A window is the same line dashed: a range
that occurred or was observed happened once, somewhere in it, so a video filmed between
two dates never reads as lasting that long, and its date reads "between A and B". Only
a range that held (Valid during) or one with no role is a bar. A bar is as long as its
period, down to two pixels, and a span running past the window has
no stop on that side. Approximate dates have dashed ends, uncertain ones a broken or
hatched fill, a suggestion is hollow and a refuted statement is faded with its name
struck. The legend names the four shapes and keeps date quality apart from assessment
confidence, because the two are independent.

A mark never moves sideways for its neighbours or for what is selected. Marks that
would overlap stack downwards, pinned ones first; a bracket or a bar takes the first
row free across its whole span. A name is written beside its mark, right first, then
left, and inside a period that can hold it, only where it covers nothing; otherwise the
mark stands alone and its name is on hover, in the list and in the inspector. The
selected entry is named first, and the same order on every render keeps names from
jumping during a zoom. A track with at most twelve marks whose cards all fit hangs a
card from each mark on a stem: the name, the date as written, and the cached preview
of a file. Hovering or focusing a mark draws a line up to the ruler, one for an instant
and one at each end of a span, with the date as written on the ruler. On a focused
mark, `Alt` with an arrow moves to the entry before or after it on the same track.

**One bar** sits over the axis: the window, its clock and the **Plot**/**List** split,
then Views, Export and `⋯`. Under `⋯` wait what is asked for rarely: a track to add,
grouping, the period handed to another tool, the legend and full screen. It replaced
three rows of controls, a title repeating the tab and a line of mouse hints, which put
the first entry halfway down the screen. The bar has no Add of its own: the line under
the axis adds, and the topbar's **Add event** goes to it.

The bar states the window in words, on the axis's own clock, between two step
arrows: pressing it opens the exact boundaries, the spans `Hour` to `Year`, and `All`
for the complete filtered extent. A span is asked for by name rather than reached by
repeated zoom steps, and the reading is what stays out because a window is checked far
more often than it is typed. Dragging the ruler pans directly. The wheel zooms around
the pointer; Shift-wheel and a horizontal trackpad gesture pan. Arrow keys, Page Up/Down, `+`, `-` and Home provide
the same navigation without a pointer. Full screen keeps the whole workspace available
for dense cases, and is left from the bar. The corner of the ruler names its clock
(`GMT+3`, `Aden time`), and a ruler, band or strip name that would land on another is
shortened or left out (`lib/timelineFit.js`).
Only the visible window is read, 200 items at a time. A separate density request keeps
the full chronology visible underneath without loading every event. The minimap is a
histogram: one column per bin, as wide as the bin, stacked by category, with exact
counts on hover. Bins are cut as fine as they can be drawn — by the hour on a case
spanning a day, by the day on one spanning months — because a case cut by the period it
happens to span drew one mark for a scraped batch of two hundred in a week and the same
mark for a single entry that could be anywhere in a month. Column heights go by the
square root of the share, so that batch does not flatten everything beside it.

The strip appears only once the window leaves part of the case out: opened on the
whole case, the axis is its own overview, and the strip drew the same marks twice. It
sits under the axis, so the axis does not move when it arrives, and its height comes
out of the list rather than out of the lanes being read.

The visible window is a movable, resizable brush, and what it leaves out is dimmed.
Bars, date scale and brush are placed on one mapping from instant to position, which is
the only way the three can agree: what the brush covers is what the axis is showing.
Under it, one slot per calendar period, named in the middle of its own — a period is
named under its own column rather than at the instant it opens, and only as many names
as fit are printed. The columns answer the pointer and the space around them drags the
brush, so a bar under the brush is still clickable; clicking one opens the axis onto
what that bin holds. `Case activity` is off by default. `Undated`
contains missing dates; a separate `Not on UTC axis` list keeps local timestamps and
invalid legacy values visible without inventing a timezone. A value stated in a zone
names it wherever it is read (`12 Mar 2024 (Europe/Kyiv)`), and the inspector's
**Timezone** says which clock a row is on, a plain day saying *Not stated, read as
UTC days*. The chronology copy carries it in a `time_zone` column. The date a fact entered
Azimut never masquerades as the date of the fact.

A track holds six rows of marks; past that, marks
become a `+N` under their column that expands the track in place, and **Collapse** in
that track's left label restores the bounded view and its `+N`.

**The axis and the list are one reading**, stacked: the axis on top with its ruler
pinned while its tracks scroll, a bar to drag between the two, and the list of the
window's dated entries underneath, grouped by month on the axis's clock. A row gives the
date, the statement, its subjects, places and sources, and in words what it still waits
for: `suggested`, `refuted`, and for a Claim `no source` and `not assessed`. A link
column no entry of the window fills is left out. An instant reads on the axis's clock,
which the column heading names (`Date · Kyiv time`), so the list and the ruler agree
about the hour; a day reads as it was stated, with its zone.
The entry under the pointer lights both its mark and its row, picking a mark brings its
row into the list without moving the axis, and a row opens with Enter and walks with the
arrow keys. **Plot** and **List** say which of the two gets the room, and that is what a
saved view's mode now means; dragging the bar moves it for the moment without rewriting
the view. **Copy** puts the whole window on the clipboard, every page of every track up
to 5,000 entries, as a Markdown table with its provenance quoted above it or as the
tab-separated block a spreadsheet reads back as columns (`date_as_written`,
`earliest_utc`, `latest_utc`, `statement`, `subjects`, `places`, `sources`,
`confidence`, `status`). A frozen view copies what it froze.

The Timeline opens on two tracks. **Media** holds the sources' pictures and videos
where the analyst dated them, and nowhere else. A file is dated by the date typed on a
proof (stated for the footage it rests on), by a correction, or by an event about the
file or citing it. Each of those is a Claim, and the lane draws it as that file, with
its name and picture, where the analyst put it (`as_files: "sources"`, `file` on the
row). Picking it opens the event, and a click on the lane creates nothing, since there
is no file to tie a new event to. What Inspect cut from a source (a frame, a collage)
counts as the source's. **Events** holds every Claim as its sentence, a kept Detect pin
among them. A proof's own date is not drawn beside the Claim it wrote for its footage
while the two say the same date, so a proof dated once is one mark.

Two more lanes are added from `⋯` on purpose. **Imagery** is the Media lane for what
the app pictured from above: satellite captures, map screenshots, Compare renders and
the pictures Detect keeps (`as_files: "imagery"`, the `FROM_ABOVE` routes). An event
about a video that cites a render is the video on one lane and the render on the
other. **File dates** holds what each file the case collected says about itself: the
camera's clock, the day a picture was taken from orbit, the post's date. That is a clue
rather than a finding, and a post's date is rarely when anything happened, so none of
it is drawn by default. Like the Media Library, it holds back the working files the
case made itself (frames, captures, collages, Compare renders). **Include working
files** in a track's editor lets them in. A saved view keeps the tracks it was saved
with. A row handed over from a file's Time tab adds the track that holds it, and lets
a working file onto it. When the axis is empty, it says how many file dates the tracks
leave out, and **Show them** puts them on. `⋯` adds editable presets for Events, Media,
Imagery, Person, Place, File dates, Sources and Case activity, using labels from the
entity registry. **Custom** opens the shared Search+ builder, then states whether
that question matches the entry itself, its subject, place, evidence, or any of those
connections. Category and time-role filters remain separate from that question.

Each track shows its name over two lines before the ellipsis, and hovering it names the
categories and the Search+ question the lane was filled from. A track can be given a
**colour**: left on **Auto** its entries keep the category colours the legend explains,
and a chosen colour wins for that track alone. Each track has one reorder grip and a
fold control; the grip and the edit, duplicate and delete buttons come with the pointer,
and a count shows only where the lane holds something. Dragging the grip changes its
position; `Alt` with an arrow key provides the same action. The track menu can rename,
duplicate or delete it. Selecting an entry exposes **Pin in track** and **Hide from
track** in the inspector. Pinning keeps an entry out of density overflow, while hiding
affects only that track and leaves **Show hidden** beside its name. Both are acts on a
lane, so neither is offered for an entry with no place on the axis: `Undated` and
`Not on UTC axis` list what the loaded page holds whatever the tracks hide, because an
entry is in them for what it is rather than for where it is drawn. Grouping by subject,
type, place, evidence or time role creates temporary subtracks. The same temporal row
may appear in several tracks or groups without becoming a second Claim.

**Views** uses the same case-owned contract as Board and Graph, on its own list: a
Timeline reading is tracks, a window and a clock, none of which a Board can draw. A Live
Timeline view
autosaves its window, display timezone, display mode, categories, ordered tracks with
their colours, folds, hidden and pinned entries, grouping and entity scope. A Snapshot
stores up to 5,000 matching
temporal rows with their exact track assignments and opens read-only. It does not query
the current case when reopened. Timeline views can be renamed, duplicated, deleted
through Trash, restored and carried in a complete case bundle.

**The entry line sits under the axis**, outside a snapshot, and is where a new entry
is written (see *The entry line* below). A track that includes Claims can date it;
File dates and Case activity tracks cannot. Clicking empty space puts a point on the
line's date and moves to its sentence; dragging puts a bounded range. Nothing opens
over the axis. When the entry lands somewhere the reading does not show, the toast says
where: no Events track shown (**Show** adds one), outside the window (**Go there**), or
in Undated. The date proposed is as precise as the window it was pointed at: a zoned timestamp on
a window up to three days, a day up to 400 days, a month up to twelve years and a year
beyond, so hours can be created, moved and resized directly on a short window and a
click on a decade does not claim a day. Date-only Claims support the same confirmed move,
and intervals expose both resize edges. Every direct write shows the old and new
values before saving.

Selecting an entry opens the inspector beside the axis; with nothing picked there is
none, and the axis has the width. It is headed the way the entry's track is, **Event**
or **File date**. **A file is shown at its top**: the picture, the video ready to play
or the sound, for a file's own date and for an event about or citing one, the file an
event is *about* first (a proof's date shows the footage, not the proof), with the
list's thumbnail as its first frame and one press to full screen. Below it, the date on
the axis's clock with the value as stated under it, one way to change it (the date and its **Clock**), reasoning and
named subjects, places and evidence. How the date is held (the raw value, precision,
timezone, authority, role, status) is folded under **About this date**. Statements can be
edited there. **Right-clicking an entry** — on the axis, in the list or in either
holding queue — names the same four acts where the pointer is: pin, hide, Details and
Edit claim. It changes no selection, so a pair being measured survives it, and the
two lane acts follow the inspector's rule of appearing only for an entry that has a
lane. A media date offers **Correct this date**, prefilled from the intrinsic
date; saving creates a sourced Claim about the media and does not rewrite its sidecar.
The Details view keeps Claim time fields in **Time**, not **Info**. `Open in Timeline`
applies a visible entity chip that can be cleared in one click.

**Ctrl-click a second entry** and the inspector measures between the two. Two exact
timestamps give one figure; anything coarser gives the range the bounds allow, with the
difference as written underneath it — a stated day is a window a day wide, so two dated
statements are a range apart and not a number. Windows that intersect report their
overlap and refuse to order the pair. A period says how long it runs, a point says only
how coarsely it is dated, and the two are never printed as the same thing. Ctrl-clicking
the held entry again lets it go; selecting another entry outright drops the pair.

A Claim owns one `when` value, which may be a point or interval. Its Time tab says
**Set statement date** when that value is absent instead of presenting the Claim as
an existing undated assessment. A second temporal reading is a separate Claim about
the same subject, with its own confidence and evidence; Claims do not point `about`
other Claims.

### One period, four surfaces

**Open this period in**, under `⋯`, hands the window to Board, Graph or Map. Board and Graph receive it
as a **fact-time** filter and say so in a bar above the answer, with the way back to
Timeline and Map and a Clear. That filter is the question, so it narrows the page, the
totals and a saved view alike, and it never touches `since`/`until`, which ask when a
row was *filed*. A row is in the window when a temporal entry it owns is, or when a
statement `about`, `at` or `cites` it is — a person belongs to June because something
said about them happened in June.

The Map layer is session-only and named as such. It draws whatever the window holds
that the case has put on the ground, grouped per place, and says how much of the window
could be placed at all. Placed means every relation that puts something somewhere —
a statement `at` a place, a photograph `located-at` one, an image `depicts`ing one, a
structure `sited-at` one — not `at` alone, which is a Claim's connector and left a case
full of located photographs answering with an empty map. It reads the categories the
Timeline was reading. It draws the window and nothing else: the case's saved pins are
its whole index and answer no period, so they are switched off on the way in and stay
on their own control, and the view is framed on the window's marks alone. A window
holding nothing placed says so in words rather than pulling the map out over unrelated
ground.

The marks are the saved layer's own pins in a second tint, because they are the same
gesture on the same map. Every one of them is a teardrop standing on the point: the
sharp corner is the coordinate and the body hangs above it, in the app and in the
extension alike. Anchored on its middle, as it was, a mark claimed a spot 17 px
south of the one it was filed at — ten metres of ground at level 18. A mark's card leads with what each row is — a photograph shows
itself — and offers both ways on: the entry on the axis it came from, and the thing
itself in the tool that owns it, with a file the browser can show also opening in its
own tab. The card's own buttons hand the period to Board or Graph, or close the layer.

Sent back, the window and the chosen entry both land: when the reading is already the
one being handed over, the entry is taken from what is on screen rather than waiting
for a reload that will never come.

## Sources

**Files is the case's file manager.** Everything filed in the case, by folder, as
tiles or a list. Folder counts come from the catalog summary, so a case past its
first page of 200 counts every item. A right-click acts on what was pressed:

- an item, or the selection it is part of — Open; Open in Inspect, Reverse Search
  or Geo Proof for a picture or a video (the Media Library's own list); Rename
  (also F2); Move to…; New folder with the selection; Move to Unfiled; Add event;
  Show in Timeline; Show on map for a capture; Show in folder; Details; Delete;
- a folder — Open, Rename, New subfolder, New note, New bookmark, Import files
  here, Work in this folder, Remove folder;
- empty space — the same additions, into the folder on screen.

Renaming happens in place on the tile, the list row or the tree row: Enter or
leaving the field keeps it, Escape drops it. An item is renamed by the route
Details uses, so a media renames its file. A folder carries its subfolders, its
items and their files: a note's markdown moves with it, and a media's sidecar
and browse index follow. A name another folder already has, ignoring case, is
refused, because two such folders would mirror onto one directory of notes on
Windows and macOS. The toast offers Undo.

Chips under the crumbs narrow the open folder and what is under it by type, and
**Nothing linked yet** keeps what is connected to nothing at all, the Board's
term. Either one turns the view into a flat list, as a search does, asked of the
server past the first page.

**Move to…** is one dialog for Files, the sidebar and the toasts below. It starts
on where the items already are and moves nothing until another folder is picked.

**The work folder.** One folder of the case can be the one being worked in. New
files and saved work land in it when nothing else was chosen: uploads, downloads,
pastes, captures and bookmarks from the extension, Inspect frames, proofs, posts,
sessions, places and Detect pins. Subjects and Claims never do: a person is shared
across every thread of a case, so filing them under one would be a guess. Every
save dialog that picks a folder for something new starts on it and says so, and
picking Unfiled there wins. Where nothing was asked on the way in, the toast names
the folder and offers **Move**. It is set from the crumbs in Files (**Work here**),
a folder's right-click in Files or the sidebar, or the pin on a sidebar folder row.
A case opens Files on it. It is kept in `case.json`, so a bundle carries it; a
rename carries it too, and removing the folder clears it.

**A folder exists whichever door it came in by.** Naming a new folder in a save
dialog used to set it on the item only, so it showed in Files and in no folder
picker. Every write that files an item now registers its folder, and the list
also reads the folders items already sit in, for cases filed before.

The Media Library toolbar keeps its explicit maintenance actions behind a `⋮`
beside Import, because both are repairs pressed once in a while and read as a
step of importing when they sit next to Download: **Regenerate missing
thumbnails** repairs missing previews; **Read file metadata** queues local image
EXIF/perceptual-hash and video metadata backfill for files not processed by the
current version. The `⋮` stays put on a case with no media, its rows disabled,
and closes on Escape or a click outside.

A **GPS** toggle beside the type and folder filters narrows the
list to the files whose own metadata states a position, and appears only in a case
that holds some; how many is in its tooltip, not in its label. Those rows carry
one pin glyph — coordinates in the tooltip, not in the title — and clicking it
flies the map there. **Show N working files** sits on the same independent axis: a
switch rather than another chip, because the chips answer *show me only X* and are
single-select where this one is *put X back*. The library opens on what the case
collected, the frames, collages, captures and Compare or Detect renders it produced itself held back — a capture
is a map the app drew out of tiles or the extension grabbed off the screen, where an
upload, a paste and a download came from outside — and the switch says how
many those are rather than leaving them unannounced; the counts and the paging are
computed with it so the facets never disagree with the list, and toggling it refetches
because the loaded page is already the collected subset. It reads how the file
**entered the case**, which is not everything true about it: one imported and later
found identical to an extracted frame stays on the side it came in by. **Unused (N)**
is the clean-up axis: the files no proof, post, note, plate, collage, Horizon view or
search, layer marker, sheet, entity photo or confirmed relation leans on. It reads
the same rule as the delete dialog, so a file it shows is one whose delete warns
about nothing. Only direct uses count, so a video stays used while its frames exist
and comes up once they are gone; Inspect work counts, a `same-image-as` duplicate and
a suggested link do not. It works inside the working-files switch, so the unused
frames show once that switch puts them back, and it refetches like it. A case holding
nothing but working files says so instead of offering to import. **Worklist**, beside
Import, opens the pictures and videos brought in as the Sheet *Files to geolocate*, built
on the first press and the same one after (Sheet section). Thumbnail polling follows all pending case jobs, including
files beyond the loaded page after a case import. Thumbnail failures are scoped
to their case, so switching cases always reloads previews even when relative
paths match. Enrichment respects an existing confirmed GPS relation during backfill.

**Import asks where the files came from.** A file fetched by hand elsewhere and
then dropped here carries no address of its own, so a drop or a pick opens one
field for the whole batch, and stating nothing is a real answer. The last address
stated prefills the next dialog, since one thread's worth of files rarely arrives
in a single drop. A batch that landed without one keeps the offer on its toast:
**Set source** states one for every file that just entered. Later, the Source URL
field in Details corrects any of them one at a time, and a link on the row reaches
whatever the file came from, fetched or stated.

An origin is a link, refused when it is not one — on all three doors that take one: an
upload, a later correction in Details, and the file hand-attached to a proof import, which
is the one where it is typed rather than carried. It is recorded as **stated, not
fetched**: the source type stays `upload`, the file stays under **Imports**, and
only a file brought in by hand takes one — a download already carries the address
it was pulled from, and a frame's origin is the video it came out of.

The row action for an image, a video or an audio file opens it; for anything the
app cannot display it opens the folder the file sits in, so the original is opened
in whatever program owns it rather than copied into Downloads.

**A press on a card shows the file.** A picture, a video or a sound opens in the
shared viewer (`components/MediaViewer.svelte`), below the top bar so its Add event
still reaches the file. ← and → walk the list as it is filtered, and Escape, Space or
a press beside the file closes it; a pressed video keeps the arrows and Space for its
own controls. Files opens the same viewer on a double press or on Space over the
selection, because one press there selects; Details stays on the tile's button and the
right-click. The selection follows the viewer, so the file last seen is the one picked
once it closes. A file the browser cannot draw (HEIC, TIFF, a missing codec) says so
rather than showing a broken picture. Media and Files each keep their Small, Large or
List view in the browser (`lib/viewMode.js`), the same for every case.

**Open in…** is one button per picture or video, and the tools it can go on to
sit behind it: Inspect, Reverse Search, and Geo Proof for a picture. Side by side
they made the widest row seven buttons and a small card more buttons than card, so
only what acts on the file itself stays out — the map pin, Details, opening the
file, Delete. The menu is placed against the window rather than inside the row,
because a card clips what overflows it and the last row of a scrolled list would
cut the menu off.

**Mark to geolocate** sits under a rule in the same menu and in Files' right-click. It
puts a picture or a whole video in the To-do's To geolocate (`POST /scenes/mark`), says so
with **Show**, and reads *Marked to geolocate* once there, when a press shows the list. A
map capture, a picture the app drew of a place and a frame Inspect cut are not offered;
Files cannot tell a frame, so there the server refuses it and says why. Marking a file
given up on takes it up again.

**Reverse Search starts from Inspect's file list.** Every image and video in the
case, filterable and searchable, with no worked-on row since the tab keeps nothing.
The engines' own pages sit beside it, for a file that is not in the case. Once a
picture is picked, **Change file** and **Files** in the header work as in Inspect,
and a case change drops the picture with its handoff.

**Reverse Search opens on the picture it was sent.** From a Media Library row it
is the case file; from a frame in Inspect it is the frame as it reads there —
turned, adjusted and cropped — rendered by the strip's own route and filed nowhere,
and the tool says so under the preview. The crop is the point: an engine matches a
subject better than the picture it sits in. The handoff is spent once, on the tab
it was meant for, and a case change drops it with every other handoff.

Every media row and card shows the file's human-readable stem, without its
extension and without a second title line. Editing that name in Details renames
the file; the backend returns the portable stem after replacing forbidden
characters or resolving a case-insensitive collision. Downloads keep dates and
remote ids in provenance instead of appending them to the visible name.

## Examine

Two tabs: **Inspect** reads one file closely, **Collage** lays out pieces from any
number of files. Neither has a session to start, name or save.

**The work stays with the file.** Opening a video or an image opens what was done to
it: the frames cut from it, their turns, adjustments and crops, the clip's own
adjustments. It is saved as it is made, a second or so after the last change, and
the header says *Saving…*, *Saved* or *Not saved* with a retry. Opening a file only
to look at it files nothing; the first real change does. A file has one work, named
after the file, which the sidebar lists and reopens on that file. The name in the
header renames the file itself, and the work follows unless it was given a name of
its own. **Clear work** sends it to the Trash, so the reset can be undone.

**The empty state is the file list.** Every image and video, the files already worked
on first with their frame count, filterable by kind and searchable, with the folder
browser behind `…`. **Change file** in the header opens the same list over the
file, and **Files**, first in the header, closes it and goes back. Neither asks
anything, since nothing is unsaved.

**A strip instead of tabs.** Under the viewer, a video leads the strip and the frames
cut from it follow, labelled by timecode. Clicking a tile is what the viewer and the
panel show: the player, or one frame. An image is its own single frame and needs no
strip until **Duplicate** makes a second copy to crop differently. Removing a frame
offers Undo.

**The player reads the frame on screen.** The clock gives it to the millisecond with
its number in the clip, and a capture cuts that very frame by its own timestamp: the
browser shows the frame a time falls inside, ffmpeg cuts the first frame at or after
it, so sending a time from inside a frame would cut the next one. The bar under the
video carries the frames already cut, the marks, the shot changes and the sharpest
frames a scan found, and an A–B loop; a press near a marker lands on it, and
hovering shows the picture at that point, no taller than a 16:9 one so a portrait
clip's stays clear of the video. The sound runs along the bar as a
waveform. The wheel over the bar zooms its time about the pointer, down to frames
24 px wide with a line between each, and Shift+wheel slides it; + and - zoom about
the playhead. Everything on the bar follows, a thin line along its top shows where
the window sits, the controls row reads the zoom (×4) and a press on it brings the
whole clip back. The window pages after the playhead when it runs off, and every
file opens on the whole clip. The hover pictures and the waveform come on their
own when a video opens, from one keyframe-only decode and one audio decode kept in
the case's thumbnail cache. The video zooms, pans and turns like a frame, a click
plays it, and the speed goes from 0.1× to 4×. Holding **O** shows the picture
without its adjustments, on a video and on a frame.

**The one press every visit needs stays on top of the panel.** Above the tabs sit
**Capture frame** on the video, with the time it will cut, **Mark to geolocate** under it
and **Save N frames** once there are captures, and **Save to case** on a frame. C captures from the keyboard and
takes as fast as it is pressed: the frame joins the strip at once and its picture
follows, and taking the same frame twice only points at it. The panel is resized by
its left edge. Its tabs keep their place while the file stays open, and every video and
picture opens on Scenes, a video on the clip rather than a frame of it:

- **Scenes**, first, and where a video or a picture opens: the places to find in the
  file, below. A frame of a video, a capture and a frame opened on its own have no such
  tab, and keep the tab they had.
- **Adjust**: crop, orientation and tones. A live histogram reads the picture as it
  is shown and says how much of it is pure black or white. Presets (dark scene,
  haze, text and plates) set the sliders and leave them to move. Brightness goes from black to ×4,
  neutral at the middle and ×2 at three quarters; its steps stay fine near ×1 and widen
  towards the end. A saved video is brightened the way its preview is. Denoise, auto
  levels, local contrast and a single colour channel join the sliders; a filter CSS
  cannot preview is rendered by the server a moment after the sliders stop, so a
  frame always reads as it will save. On the video, the same tab turns and tunes the
  whole clip and saves it re-encoded.
- **Moments**, on a video: the marks and the shots. Marks are set with **M** or
  **Mark here**, each labelled, kept with the work and listed in playback order.
  **Find shots** reads every frame once and cuts the clip where the camera changes
  shot: each shot is shown at its sharpest frame, labelled with the stretch it
  covers, and one press keeps it as a scene and stays here for the next. The sharpest frames of the whole clip
  fold away under them. The answer is kept, so the shots are on the bar the next
  time the clip opens.
- **Analyze**, on a frame: Error Level Analysis laid over the frame with its
  strength, and asked again once the frame is edited; Reverse image search and
  Match in Horizon.
- **Info**, what the file says about itself: the stream from the probe (resolution,
  frame rate and whether it varies, codec, bit rate, sound, a turn stored in the
  file, the software it went through), the capture date and position from its
  metadata with the point opened on Satellite, and the file's size, SHA-256, source
  and when it was added. The full metadata dump folds below. On a frame, the frame
  comes first: the time and number it was cut at and its size after the crop.

**A video's scenes are where its geolocations happen**, since a long clip often holds
several: a route filmed from a car, or a day's events cut together. **Mark to geolocate**
under Capture frame, or **S**, keeps a scene at the frame on screen, and its arrow offers
This instant or Whole video. A scene is an instant until **End here** or **Shift+S** gives
it an end at the frame on screen, and then a stretch, the kind its row calls Passage. On
screen, a scene's parts are its **passages**, each an instant or a stretch; the Moments
tab keeps the word moment for its marks. A scene that states no time is about the **whole video** and prints no timecode anywhere. The bar draws each one in its
colour, a pin at an instant and a band over a passage, named on hover. A click on a pin
opens the Scenes tab on its scene from any tab; a click on a band does so on the Scenes
tab only, and elsewhere just moves the clip. The Scenes tab of a video with no live scene,
none or only abandoned ones and no proof resting on it, asks *One place or several?* once
its list is read, with **The whole video: one place**, which keeps one scene about all of
it, and **Several places: mark them as you watch S**, which only says in a toast how S and
Shift+S mark them. The question stays while the clip holds no live scene and goes at the
first; nothing of it is remembered. The strip says only that the frames captured are kept
with the video.
**An instant always keeps its frame.** One marked in Inspect (S, Mark to geolocate's
press, the instant the scene about the whole video takes, one added or moved on a scene's
open row and applied) puts the frame at that time in the strip, as Capture frame does,
unless one within half a frame of it is there already. It is a work frame: filed to the
case once a proof uses it, as Make the proof files the frames it takes. A passage gets
none, and an Undo of the scene leaves the frame in the strip. The first scene ever kept points once, in this
browser, at where it waits: a small bubble with an arrow, *Your scenes wait here*, with
**Show** to open the To-do and ✕. It hangs under the sidebar's toggle while the sidebar is
closed, or under its To-do tab while another view is shown; with the To-do on screen it
waits for a later scene. It takes no focus, goes on Show, ✕, Escape, a press elsewhere,
another tool or after ten seconds, and follows its control on a resize. The toast keeps
its own words and Undo.

**A video is one place or several, never both, and one place is one scene.** A scene
still to prove is offered Whole video, in its open row's kinds and in the Collage tool's,
only as the video's one live scene still to prove with no scene holding passages beside
it, a proof's included. Otherwise Whole video is greyed and its hover says why: *Another
scene of this video is already about the whole video*, or *Other scenes of this video
already hold passages, so the whole of it is not one place*. Mark to geolocate's arrow
greys it the same way and the capture's offer leaves it out; the whole video kept while a
scene is about it already answers that scene. While the clip's one live scene is still
to prove and about the whole video, a passage marked with S, the main press, Shift+S or a
shot kept goes to that scene instead of a second one. It keeps its label, its captures
and its geolocating; Shift+S gives it the passage from the clip's start, and the toast,
*Scene now at 0:09, no longer the whole video*, has its Undo. Beside a proof stating
passages it stays as it is and the passage is a scene of its own. A proof about the whole
video is an answer, not a question: it stays beside new scenes, lets the one about the
whole video take a time, and keeps Whole video in its own kinds. The menus of the Media
Library and Files follow the same rule: marking whole a video whose scenes hold passages
is refused, and the toast says why, and one with a live scene about the whole video
answers that scene, never a second.

**An older case opens as it is, and nothing in it is rewritten.** Two live scenes still to
prove about the whole video, the same question asked twice, get a quiet line over the
list, *2 scenes for the whole video · Join them*. One press joins them into the first as
Same place as… joins two: its label first and the other's after it, the captures gathered,
the geolocating moved. The toast's Undo parts them again, ids and captures included. Until
they are joined, where no scene holds a time, S, the main press, Shift+S and a shot kept
take none, since either could, and their toast offers Join them. A scene about the whole
video beside scenes at a time says so in its open row, *This video also has scenes at a
time*, with **Give it a time**, which makes it the instant on screen as S would and keeps
that frame in the strip, and **Abandon…**, which asks for the usual word; closed, its row
carries a small ⚠. It takes no time S marks meanwhile, each passage a scene of its own.
Give it a time has no Undo, which would make the video both again, and Ctrl+Z starts from
it. A video in neither state shows none of this.

**The server keeps to it wherever a scene is made or given a time.** Marking a time from
outside Inspect (`POST /cases/{id}/scenes/mark`) goes to the clip's one scene about the
whole video, and is refused while two stand alone; marking whole answers the live one
first, never one given up on beside it. `PUT /cases/{id}/scenes/{draft}/time` refuses the
whole video where Inspect greys it, and the join makes two scenes about the whole video
one but never joins one to a scene with a time. A save stays lenient for whatever a case
already holds. Only a scene it would turn from a time into the whole video, beside another
about it or beside passages, keeps the time it had; the answer names it under `kept`, and
Inspect takes that time back with a toast. A picture is marked whole as before.

**The Scenes tab lists them in clip order**, a scene about the whole video first, its
label counting them, tinted while some are still to prove. A closed row writes its name,
its kind and time (`Passage · 0:30–0:45`, `Instant · 3:49`, `Whole video`) and where it
stands, and a press anywhere on it opens it and goes there. One row is open at a time:
the one under the playhead on landing in the tab, else the last touched, else the first
still to prove. It shows Whole video, Instant or Passage, each end typed (`1:05`, `65`,
`1:05.5`), taken from the frame on screen with **Here**, nudged a frame with ↑ and ↓, or
dragged by its handle on the bar. Apply comes once something changed. Enter keeps it, and
so does leaving the row or the tab when it reads as one; Escape drops it, and a second
Escape folds the row. S keeps a new scene whichever row is open, and Shift+S ends the
open one at once. A draft's change goes back with Ctrl+Z like the rest.

**One place often shows again further on, so a scene holds several passages.** The open
row's **Another passage** adds one of the kind its first passage in clip order is, from
the frame on screen, on a line of its own with its ✕, and takes it in hand: its ends drag
on the bar and Here moves it. An instant goes at that frame. A stretch is as long as the
first, starting there, or where the stretch that frame falls in ends, and is shortened to
the room before the scene's next stretch and to the clip's end; with no frame free, a
short line says so and nothing is added. The last one goes only by choosing Whole video.
Two stretches may touch and an instant may sit inside one, but two stretches that
overlap, or one instant twice, are said and not kept. Closed, such a scene reads
`2 passages · 0:00–0:07 · 1:05–1:12`, or `0:30–0:45 +2` past two, and the bar draws each
passage in the one colour its first gives it. Shift+S ends the passage in hand, else the
latest started before the frame, and says so when that end would run into another
passage. The work keeps the first passage as the scene's own time and the others under
`more`, so a scene of one is written as it always was.

**Same place as…**, beside Another passage, joins two scenes kept apart before anyone saw
they show one place. It lists the clip's other scenes still to prove that hold a time,
each in its colour with its time, and a press joins this one into the scene picked
(`POST /cases/{id}/scenes/{draft}/join`): the passages come together, stretches that
overlap made one; the label picked stays, with the other's after it unless it says the
same; the captures gathered for either stay with the scene; and if either was the one
being geolocated, the joined scene is. The server writes it in one go, and the toast's
**Undo** puts both back as they were, ids and captures included
(`POST /cases/{id}/scenes/{draft}/unjoin`), while nothing has moved the joined scene
since. A scene about the whole video, an abandoned one and a proof are never offered.

**A narrow player keeps its buttons.** The frame on screen is never cut: the frame count
goes first, then the clip's length and the keys hint, and past that the last buttons wrap
whole, on the right.

**The proofs resting on the clip are its proved scenes**, in the same list and on the
same bar, with **Open the proof** in their row. A proof built on frames cut here and stating
no time of its own is about the whole video, pinned at those frames on the bar and
placed in the list by the first, so the ones made before scenes existed are found
without being rewritten. **A proof holds several passages the same way**: its row and
its bar read as a scene's, and **Another passage** adds one as a scene's does. Its
time is written to the proof alone
(`PUT /cases/{id}/proofs/{name}/scene`), with Undo in the toast, and Whole video
takes every passage back. Saving the composition in Geo Proof never carries it, so a tab
opened earlier cannot put an older time back. A scene still to prove belongs to the
work. Once a proof takes it up it shows as the proof's and is hidden, never dropped:
the proof sent to the Trash gives it back to geolocate at its own time, and restored
from there it is proved again (`GET /cases/{id}/scenes`, whose `taken` names the drafts
a proof in the case cites). A proof that took up no scene gives its passages back as one
new scene, named after it, leaving out any passage a scene of the clip already holds.
**A scene still to prove says where it stands**, by a small mark: an empty ring *To
geolocate*, a ring holding a dot *In progress* once captures were filed for it on the map,
the solid accent *Geolocating* while it is the one being looked for, its row ringed.
**Beside the mark, two counts say at a glance whether it is ready to prove**, each by its
icon and greyed at 0: the map's, the captures gathered for it (Satellite, Compare, Horizon,
the extension's screenshots), and the video's, the frames of the strip inside its passages,
filed or not, and the collages of the clip holding one of them, every one for the whole
video. A picture marked to geolocate gives one, itself. The hover says them in words,
*In progress: 2 map captures, 5 pictures from the video*. The server's rows carry the
video's count (`footage`, `engine/scenes.draft_row`), read by Inspect's rule at a
thirtieth of a second, so the To-do, the pill, Geo Proof's home, its strip and a scene's
page say the same numbers; Inspect counts its own strip as it stands, so a frame captured
counts at once. The queue reads every file's work and the collage documents once for it. **Geolocate** is its main act, in the accent, after End
here and Make the proof: the work is written, the scene is held on the server as the one
being geolocated (`PUT /cases/{id}/geolocating`), and Satellite opens with its video as a
reference window. Pressed again on the scene in hand it reads **Stop** and stops it, its
captures kept, as in the To-do and the extension's panel. **Abandon** asks for a word in
the row, which may stay empty; Enter gives the scene up, Escape keeps it, and the toast
offers Undo. An abandoned scene leaves the list for **Abandoned (n)**, folded at the foot
of the tab, greyed with its word and **Restore**. It keeps its colour and its frames: the
bar draws it as an outlined band or a hollow pin, its frames carry a grey ring, no scene
is offered inside it, and the tab's count leaves it out.

**A proof is Proved once it states a place someone checked.** Saved with no point yet,
or only with one the imagery proposed and nobody looked at, its row reads *In progress ·
no place* rather than Proved, with **Open the proof** and **Abandon**. It stays
in the To-do beside its file's scenes (`proofs` on a file of `GET /scenes/queue`), where a
press opens it in Geo Proof, and on Geo Proof's strip its tile carries an amber dot and
its ⋯ offers Abandon. Abandoned, it joins the scenes given up on, greyed with its word,
and **Restore** brings it back (`PUT` and `DELETE /cases/{id}/proofs/{name}/abandon`). The
word lives on the proof's entity, never in its spec, and a save with a point lets it go. A
proof that states a place is refused. An older proof traced to a video by its frames reads
In progress in Inspect too but never joins the To-do, which only holds what was asked for
as a scene. The extension's list stays scenes only.

**A picture is marked whole.** Its Scenes tab offers **Mark to geolocate**, one press that
keeps one scene about the whole picture in its work, never an instant or a passage. Its
row has a name, where it stands, Abandon, Geolocate and Make the proof. **Make the proof**
opens a new proof of the picture and the captures gathered for it, on its Proof tab,
stating no time. Any proof laying the picture out takes the row's place, and once it
states a place the row reads *Proved · Proof 12* and opens it. A frame cut from a video belongs to that video's scenes
and a capture is an answer, so neither has the tab.

**Collages hang under their scenes.** The Scenes tab lists each collage cut from the clip
under every scene holding one of its pieces, on a rule in the scene's colour, and under
the whole video's scene when none does; a press opens it in the Collage tool. Make the
proof offers the scene's collages between its frames and its captures, ticked, by the
picture each was last saved as (*Changed since* on one edited after), and a proof can rest
on a collage alone.

**A capture never makes a scene; a frame belongs to one by its time.** A frame captured
in no scene offers one instead, *Frame captured at 0:00.48 · Add a scene*, with
**Whole video** and **This instant** (at that frame), each with its Undo, and This instant
alone once scenes hold passages of the clip. A
burst of captures shares one offer, which goes by on its own and then keeps quiet a
while, as it does once a scene is kept any other way; past three offers left unused on
a file it stops until another file opens, and a clip with a whole-video scene to
geolocate is never asked again, since that scene already holds every frame. In the strip, a
frame inside a passage, on an instant, or on a frame a whole-video proof rests on
carries a small dot in that scene's colour, one per scene and three at most, the
scenes named on hover. A draft about the whole video dots nothing. A frame a proof lays
out says so on hover, *Used in Proof 29*, with no badge of its own (`used`, by saved
path). **Make the proof**, on a scene to geolocate, opens the scene's frames, inside its
passages, on its instants, or every one for the whole video, all ticked, and the proof
starts with every passage the scene holds. A scene holding
none says which frame it captures instead: the sharpest one a scan found in it, else
the one it starts on, else the one on screen. The ticked frames not in the case yet are
saved on the way, under their default names in the last folder, and Geo Proof opens a
new proof of the scene on them, named after its label, on its Proof tab, the facts
being what is left to do; unsaved work in the open proof is asked about first.
A scene that gathered captures on the map offers them under its frames, ticked too, and
Geo Proof lays them out after the frames. A proof still rests on a frame of the video,
so unticking every frame leaves nothing to make. A frame not in the case yet says so on
its picture, and a scene with no label is named by its time.

**Save to case is the one step that files media.** Each output carries its own block
under the controls that shape it: a name that holds real text from the start, a
folder, an optional note. A frame, the adjusted video or an exported collage then
reads *In the case*, linked to the Media Library, until an edit makes it a
different picture. In the strip, a frame not in the case yet carries a save press in
its corner that files it under its default name and the last folder without opening
it, and the corner turns to the *In the case* check once it is filed. **Save N
frames** files every frame not in the case yet the same way.

**A collage is a document.** New starts an empty canvas, filed once the first piece
lands; the name in the header renames it and refuses a name another collage holds.
Pieces come from **Frames**, the works of any file with the files last worked on
first, or **Images**, any case image with the last added first. Each file shows its own
thumbnail, one unfolds at a time, a search box beside the tabs narrows either list, and
the list scrolls on its own so the controls below it stay in reach. A piece is a recipe
frozen when it is placed, so editing the frame later does not change the collage. A
piece still rendering holds its place with a spinner. A renamed file is followed; a
piece whose file was deleted keeps its place as a hatched gap, and the export waits
until it is removed. The selected piece is named by its file and, for a video, the time
it was cut at.

**The Collage tool is laid out for a laptop.** A bar over the canvas holds what acts on
the whole collage: **Auto-stitch**, whose arrow picks Planar, Cylindrical or Spherical
(the last pick named on the button and kept in this browser), **Ignore areas**,
**Straighten** with Draw the line, **Cut**, and **Fit**, which frames every piece, with the
zoom beside it. Narrower than its tools, beside the case sidebar on a laptop, the bar keeps
one line: the secondary tools show their icon alone, named on hover. A collage opens framed
on its pieces, as Fit frames them, and a framed view stays framed as the pane changes size.
Auto-stitch moves every piece at once, draws again three at a time the ones a panorama warp
reshapes, frames the pieces, and is one Ctrl+Z. A piece it leaves where it was is outlined,
selected for the arrows, and says why on itself: *No overlap*, *Nothing to match: blank or
painted out*, or *Fell off the canvas*, with *try Cylindrical* after a Planar stitch. Its
message says the same and carries Undo, which its arrow keeps after the message goes. A
stitch lays the pieces out anew, so it takes the cut away, and its Undo brings it back. The panel keeps
**Save to case** on top: one press files the picture under the collage's name and the
last folder, its arrow unfolds the name, folder and note, and the export size is written
under it. **Add pieces** takes the room left and scrolls on its own; the
piece in hand sits at the foot (Scale, Rotate, Crop, Unwarp, Front, Back, Remove, or the
block selected) and keeps its place and height whatever is selected. An empty collage
says *Add frames from a video, or pictures* on its canvas, with Frames and Images opening
those lists, or Cut frames in Inspect while no frame is cut.

**The canvas answers the hand.** The mouse wheel zooms toward the pointer a notch at a
time; on a touchpad two fingers pan and a pinch zooms; a drag on the background pans. The
arrows nudge the selected piece or block a canvas pixel, ten with Shift, a burst of them
one undo; Delete removes it.

**Ignore areas paints what a stitch must not match on**, such as a person, a car or a
watermark. With it on, a drag on a piece paints it red, Alt or **Erase** takes paint off,
`[` and `]` change the brush and Esc puts it down; **Clear piece**, or *N areas kept out of
auto-stitch · Clear* under the piece, takes it all off. The paint shows only while the
brush is out; otherwise a small brush mark on the piece takes it up again. The areas stay
with the collage (`exclude` on each piece, in the picture the stitch receives) and go with
the next stitch, never into the saved picture.

**Cut frames the saved picture, like a mat.** One frame over the whole collage, drawn from
the cut kept or the pieces' bounds: drag an edge or a corner, or the inside to move it. An
edge snaps to the pieces' sides, and Alt drags freely. What lies outside is dimmed while the
frame is drawn; Enter or **Apply** keeps it, Esc or **Cancel** leaves the cut as it was.
Kept, the canvas shows the pieces cut to it with a hairline round what the picture holds.
Every piece stays whole and its own, and shows whole again while the frame is drawn.
**Clear** takes the cut off, and a frame holding every piece cuts nothing. The cut belongs
to the collage (`clip: {x, y, w, h}` in canvas pixels, one Ctrl+Z). The saved picture is
the pieces within it at the same sharpness (`/inspect/compose` with `clip`), and a new cut
makes the last saved picture out of date. Find reads a cut picture from its frame's corner.

**A collage of one video is marked as that video.** When every piece is one video at an
instant, or a frame saved from it, or a picture composed from them such as a piece straightened, the panel reads *From channel_departure · 0:01–0:03*;
a collage whose pieces kept no instant, filed before instants were recorded, reads
*From channel_departure* alone, as the server reads it (`engine/scenes._collage_video`),
and **Mark to geolocate** marks the whole video; its arrow offers the stretch the pieces
span, or the instant of a single piece. Once scenes hold passages of the video, the press
marks that stretch and the arrow's Whole video is greyed, as in Inspect, and its time
offers Whole video only as Inspect's kinds do. A collage of
several sources is a picture: the
press saves it first when it is not in the case as it stands and marks it whole, and
saved again, its mark follows the new picture (`POST /scenes/mark`). Marked, or with its
pieces already in a scene of the video, it says where the scene stands, with
**Geolocate**, which opens the collage beside the video on the map, and **Make the
proof**, which opens Inspect's chooser on that scene. A press on its scene's time unfolds its time
under it: the video looping it in a small player, the pieces' frames as dots on its bar,
and Inspect's time editor; Apply moves that scene's time alone
(`PUT /cases/{id}/scenes/{draft}/time`), with Undo, and a time holding none of the pieces
says the collage leaves the scene. A proved scene says Proved and
opens its proof. On the server a collage of one video's frames reads back to that video
like a frame (`engine/scenes.py`), so a proof resting on it alone states its scene. The
rule holds at every depth, a cut of a straightened collage included. A picture filed before
the pieces' instants were recorded takes them from the collage that exported it while it
still lays out the same files, and with none to be found it still belongs to its video, at
no instant: the proof sorts after the timed ones and its frame pins nothing on the bar.

**Auto-stitch leaves out what is painted out.** Areas brushed out of a piece (a
passer-by, a car, a caption) are never matched, read on the piece as it is cut, its crop
included. Frames of one video are matched with the frames filmed just before and after them
rather than with every frame, which is quicker and keeps a long pan straighter; a frame that
matches none of them is tried against every piece before it is left in place. Each point of
a picture answers one point of the other, so two unrelated pictures no longer stitch on
chance matches. A hazy or flat picture is looked at again for detail before the stitch gives
up on it, and the same pieces always stitch the same way (`POST /inspect/auto-stitch` with
`exclude`; each placed piece answers with the `size` it was matched at, and each piece left out with `why`: `no-overlap`, `no-detail` or `off-canvas`).

**Straighten lays a bent pan flat.** A pan stitched with its tilt a little off bends a
level line into a slope or a smile. **Draw the line**, in the bar over the canvas, then click point
by point along something level that crosses the view, such as a shore, a field's far edge or a road
along the valley. The line is a rounded curve through every point, running on to the
pointer as the next click would make it; a point added between two others bends only
the stretch around it, and past the line's ends the picture moves as the end does. The
curve is drawn across the whole collage, so that shows before anything bends. A point can
be dragged while the line shows, drawing or done.
Ctrl+Z takes the last point back while the line shows; a double-click, Enter or Esc ends
the drawing; while it is drawn, the canvas takes the line's yellow at its edge and its
corner says what to click. **Straighten** bends every piece by the same column shifts so that line comes out flat:
every column of the collage moves up or down by what the line is off there, so each frame's
own pixels follow the line and the seams a stitch matched stay matched. Each bent piece is a
new file in the work folder, named after the collage and the piece ("Pan straightened
00-00-02 Convoy clip"), and takes that piece's place in the same order, so a photo stays one
piece (`POST /inspect/straighten`, every piece or none). Ctrl+Z puts the pieces back. Each
bent picture records the file and instant it came from, so a straightened collage of one
video still reads as that video. A line coming
towards the eye curves in a pan for real, so it is no line to draw. Find reads a
straightened collage's picture as one rather than frame by frame, since the stitch's own
rotations are what bent it.

**The export keeps full resolution without a setting.** It is a transparent PNG of the
pieces trimmed to their bounds within the cut, enlarged until the sharpest piece is back at its own
pixels, however small it sits on the canvas. It holds under 8192 px a side and 40
megapixels in all, and the size it will have is written under Save to case.

**The list shows what each collage holds.** The start page lays the collages out as
cards and the Collages window as rows, each with a preview. The tool draws the preview
itself once the pieces are in and the layout has settled, and files it beside the
collage, so it follows a rename and the Trash and travels in a bundle. Entity pickers
show the same picture. A collage with no preview yet shows its pieces'
outlines. A small green check means the picture it exports is in the case as the
layout stands. Once there are two, a search box narrows the list to the names holding
every word typed, whatever their accents. **Collages**, first in the header of an open
collage, waits for the last save and goes back to the list; a save that failed keeps it
open. **Open** lists the collages over the one open.

**0.3.0 sessions come over on open.** The sessions of one file merge into its work:
frames are joined, the latest session carries on, typed names and notes are kept in
its notes, relations move to it, and each collage becomes a collage document named
after the session that built it. The sessions are copied as they were to
`.inspect/.v1/` first. The copies stay on this machine, never in a bundle, and go
once their file has left the Trash for good. A session brought back from the Trash
merges the same way.

## Map

**Compare assembles two imagery views on one camera.** It opens where the other map
tabs left the window, or on the home view, with a key-less pair: an Esri Wayback release published a year or more back on A,
today's World Imagery on B. That costs the release list and tiles, never a
Copernicus request or a point's history, and A stays empty when no release list
comes back rather than showing B twice. Panning that untouched pair leaves
nothing unsaved, and Save still takes it. **New** starts over from a menu of
starting pairs, the same ones a removed pair offers above its empty slots, and
**Revert** shows only on an edited saved comparison, taking it back to the saved
version. Each
side keeps its provider, Wayback release and Sentinel-2 day.
The source cards and mode controls use the application's shared theme, buttons
and spacing. The date is a chip beside the provider, reading the same for
Wayback and for Sentinel-2 on every map tab.
The Sentinel-2 chip's menu also writes layers of your own — **Composite** puts
three bands on red, green and blue, **Index** measures `(A − B) / (A + B)` on a
colour ramp and **Custom script** is the evalscript itself, with each form
writing the script the next tab shows. **Preview on the map** draws it over the
date already chosen without saving it; closing the panel keeps the draft and the
preview, and **Discard** is what throws them away. Saved, a layer joins the
picker in Satellite, Compare and Detect. Settings → Imagery → Copernicus keeps
the list. A
Wayback chip names the release, so the day its pixels were taken sits beside it,
as it does under the chip on Satellite. The
cards float over the maps they describe, one per pane, so no bar takes the maps'
height; the place search and the camera sit in B's corner.

**Layers** is one menu for both maps, in the row above them, and one list. A new
pair starts on the layers last switched in Compare in this case, else Borders. A switcher heads the list, **A | B | AB**,
on AB, and says which map draws it: on B, every layer that is on, the case's own
included, is drawn on B and none on A. The fires and the night lights follow each
side's picture, so A shows the fires of its day and B those of its own; their
settings pick a day for each side instead. A saved comparison reopens on the side
that held its layers. One saved with a different list on each side, before the
switcher, reopens with both lists on both sides. Difference reads the pictures
without the layers, so they may stay on A alone while it is on; night lights are
the one layer it reads, when it compares two nights. A pair it cannot read says
why in full where its legend stands.

One row sits above the maps. With a pair on screen the mode dock takes the
title's place there, beside the name, **All dates**, **Export** and **Save**, and
below 1400 px its four views show as icons. The dock holds the four views: side by side, through a swipe, with B faded
over A, or as alternating whole frames. Blink has three speeds and can pause on
either side. **Difference** sits beside them as a switch, offered only when the
two sides are a matched pair, and lays its highlights over whichever view is on.
Sweeping an area over time is the Detect tab's job, not Compare's. Keys 1–4
switch views, 5 toggles Difference, and Space pauses blink. Dragging, zooming or rotating either
map moves the other in the same frame. Side by side, the pointer over one map
shows as a small cross on the same ground in the other. Both stop at the lower provider zoom
ceiling. **Swap A and B** exchanges the complete source stacks and annotation
sides. One compass over the stage reads the shared turn, resets it to north and takes
an exact angle. **Full screen** ends the header row and gives the whole tool the
screen, its bars and annotation rail included. Esc gives the window back.

A radar side knows the other side's pass: its picker marks the passes on the same
track, the only ones that compare like with like. **Two radar passes** joins
the starting pairs once the radar layer is set. Compare works without
Copernicus, so nothing is said until a Copernicus road is asked for: the
satellite and radar pairs stay in the New menu marked *set up*, and the two
archives stay in the imagery picker marked *Needs a free key* or *Needs its
layer*. Pressing one lays the same setup card as Detect's over the stage.

**All dates** in the header opens a strip under the maps whenever A and B show the
same dated archive: Sentinel-2, Sentinel-1 or Esri Wayback. It lists every picture
that archive holds of the point under the crosshair, oldest on the left: the
Copernicus days and passes of a window around A and B, one request, or the
Wayback releases that changed the point, free. A press shows a picture on B,
Alt-press or its own A button shows it on A. A Sentinel-2 day over the cloud
ceiling and a radar pass off the pair's track are greyed. **Show pictures** draws
each one small from the tile proxy, priced before it is pressed and cached once
read, and a view that moved says so rather than refreshing on its own.

Difference opens no column: its strip joins the view's own controls in the footer
under the stage, and its full settings open from the gear in a panel docked on
the stage's right edge, under B's card. The panel lies over map B rather than
narrowing the maps, since a narrower view would fetch Sentinel-2 bands again;
it takes the glass of the map's floating panels (88% and a light blur), and the
search, camera chip and legend step left of it. Read keeps one width through a
read, so the gear never moves. **Read** says what the reading is doing on the button
itself: amber **Read** when pressing it is the next move, **Reading…**,
**Loading…** while map tiles are still coming in, and a disabled **Up to date**
when nothing moved since the last read. The map legend says the same in words
("out of date, press Read"). A reading waits for tiles to finish instead of
failing on them. The panel
lies over the highlights and stays open while the map pans or zooms, since
tuning is watching them answer; the gear, its close button or Escape put it away,
and it opens closed each time Difference comes on.

**Difference** checks that the sources can be compared before it runs.
Colour, structure and brightness methods read captured pixels in a worker.
Two Sentinel-1 passes of one track are a pair too: the rendered radar picture is
read with no tone matching, and passes from two tracks are refused, because they
see the ground from two angles.
Sentinel-2 also offers six spectral indices — NDVI, NDWI, MNDWI, NBR, NDBI and
BSI, the ones Detect measures — from the actual bands. A new pair's band frames
are fetched by an explicit act — **Read**, turning Difference on, choosing a
method or an index, or switching the cloud filter on — one metered request per
side. Reopening a session or changing a date never fetches on its own. Each frame
is kept with a margin of ground around the view, so the reading keeps its bands
while the camera stays inside that margin. Frames are asked for at the
resolution the reading draws at, never finer. The cloud map is read at
Sentinel-2's own 20 m, which lets its margin reach up to a whole view past each
edge for no more pixels. Once a pair has been read with its bands, the reading
follows the camera with them. Past the margin it fetches them again once the
camera has rested for a moment, and only then, however many drags it took. The
pan has just drawn Sentinel-2 tiles, which are metered requests too. A reading
that follows the camera waits for bands already on their way, and a Read the
camera moved under reads the view it settles on, so a request is never spent and
then thrown away. Until a new pair is read, the last reading stays up, drained
to grey so it cannot pass for this view's. A changed view must be run again
before export.
These viewport captures depend on display resolution and zoom. Use the Detect
tab for a fixed analysis grid across camera changes. An index reading carries
**Save as a Detect analyzer** in the Detection tab: the same index, line, way it
moved, cleanup and cloud switches become an analyzer of your own rules, and the
toast opens it in Detect's builder, ready to sweep areas or run as a routine.
The strip's **A / B / Both** says which images carry the highlights, in any view;
Both is the default, because it shows what a change went *from* and *to* at the
same time. **Blink** flashes the highlights on and off, because a thin highlight
over busy imagery is easier to catch moving than still. Turning Difference off
in the dock takes the highlights away.
**Clouds & shadows** opens first in the settings, one click, because cloud is the first thing
that goes wrong in a reading. It gives Detect's answer, not a guess: Sentinel-2's
scene classification, grown into the unsure pixels around a real cloud, with
classified "clouds" too small to be one ignored and each cloud cast away from the
sun to find the shadows the classification missed — including the ones it read as
water, which the other date settles. It is offered on a Sentinel-2 pair only,
because that is where a classification exists; over a picture method it reads one
small frame a side, fetched by the switch itself so that the highlights on screen
are always the ones the switch describes.
The Filters tab splits cloud from shadow and sets the mask margin in ground
metres, which grows the mask past the soft edge the classification leaves.
Detection, Display and Filters tabs separate the rest of the settings, with hover descriptions.
The settings panel offers automatic/manual thresholds, tone matching, alignment,
smoothing, cleanup, minimum area, class filters, palettes and heat/class/outline
displays. Smoothing and cleanup can take small real changes with the noise, and
the Thermal palette is only colours, not a heat reading. A spectral index skips
the automatic threshold: it is highlighted past
a stated index change, the line Detect draws, so panning cannot move it. Tone
matching defaults to automatic, which means none on Sentinel-2 — two passes
already corrected to surface reflectance have no exposure left to match, and
matching them would erase a burn that covers most of the view — and a histogram
on Esri releases, which carry two renderings. Coverage, highlighted
area and selectable change zones describe the result, each zone carrying the same
strength word a Detect candidate does: how far past the line it got. These are candidate pixel
changes for inspection, not confirmed changes to objects.

Annotations store longitude/latitude points and stay on their ground through pan,
zoom and rotation. Notes, arrows, boxes, ellipses, lines, freehand strokes, distance
measures, polygons, **numbered markers and symbols** can belong to A, B or both.
The last two are the Proof Maker's stamps, put down on the ground with one press
and keeping the tool in hand: a marker counts a series per colour and starts back
at 1 for the next one, and the symbol button opens Geo Proof's own picker, filed
under Marks, Vehicles, Events, Places and People, every symbol drawn as a proof
draws it, filled and haloed. The maps are seen from above, so a vehicle model is too
and the picker's View switch stays away. A model lands nose up on the screen it was
stamped on, and its size is its length. Both stamps are sized by their own
number rather than by a line width, and one of the eight older symbols that takes a
weight has a second control for it. Polygon drawing ends
with a double-click or Enter; Escape cancels. Select a mark to move it or edit its style,
double-click a note to edit its text, and use Undo/Redo for annotation changes. A
selected mark shows its corner handles, so its geometry is corrected where it was
drawn rather than deleted and redrawn; a note is dragged whole and has none.
A box or an ellipse drawn on a turned map runs along that screen, not along north,
and keeps the bearing it was drawn at. Any selected shape but a note or a stamp
also shows a round grip above it: drag it to turn the shape about its centre,
with Shift snapping to 15°. A vehicle model has the same grip past its nose: it
turns on its point, the grip reads its heading and wind (`135° SE`), and Shift
lands the heading itself on a multiple of 15°. The heading is stored in the
`angle` a box keeps its own up in, as a compass direction, so a turned map turns
the model with the ground and nothing new is written to disk. The models are drawn
by a module loaded when the picker opens or a comparison names one, and an export
waits for it. Every older comparison opens as it was: the eleven stamps draw the
same pixels on screen and in an export, and a name this build does not know still
draws as the pin.
Every mark carries a wide invisible band along its outline, because a four-pixel
arrow is a target nobody hits twice. That band is how a box, an ellipse or a
polygon is picked and moved: its middle belongs to the map, filled or not, so a
drag inside one pans the imagery under it. The wheel still belongs to the map wherever
the pointer is: the marks are drawn over it rather than in it, and a zoom that
stopped on whatever had been drawn read as a map that had frozen. Clicking the ground beside a mark lets it go;
dragging the map is a pan and keeps it. The tool rail packs into two columns, like
Proof Maker's, so it stays short enough to fit a laptop window. The tab on its
edge, or `[`, folds it to a strip marked *Annotations* that keeps the tool in hand,
and this browser remembers the fold. Its colour, width
and fill panels close on Escape, on their own button, on a press anywhere else,
and with the button behind them when the selection is dropped. **Pressing the tool
already in hand puts it down** and gives the cursor back, on this rail and on Proof
Maker's: the way out of a drawing tool is the button you are already on.

**Right-click the ground** here too, on either map and on any mark drawn on it,
for the acts Compare can honour: copy the point in every coordinate format, ask what is there, save a
place there, start a distance measure from it — the annotation of the same
name, anchored on the point and closed by the next click — or open it in
Satellite or Detect. The rows Satellite offers for its own rails are left out
rather than shown dead.

**Save** writes the editable version-2 session under `.compare/` and
updates its rendered media preview in the case (PNG, or GIF for blink). The preview
records the date of each picture, one Esri or Wayback only estimated marked `~` on
its Time tab, where **Date a change** offers a claim that something changed between
them. A preview used by a derived proof is preserved when a later save creates new pixels.
**Open** restores the sources, layers, camera, view, the Difference switch, blink speed,
detection settings, annotations and the optional export frame; a session saved while
Difference was a view of its own reopens side by side with Difference on. Export writes an attributed PNG, blink GIF or divider-sweep GIF to the
shared Views destination, named by the comparison and its two pictures' dates, and
never over an earlier file. **Also keep it in this case** files the same image in My
work under the comparison, stamped with the reading on screen and never replaced by a
later save; asked on a comparison never saved, it asks for a name first. **To Post**,
beside Export copy, keeps the export picked in the case the same way, one file each
(the PNG, the Blink or Slide GIF, the evolution's GIF or its sheet), and opens Post on
a Compare post carrying it, told the comparison's name, its dates as before and after
(the left picture's and the right one's, an evolution's first and last day) and the
credits under the image. A picture with no single date, like World Imagery's mosaic,
is a side the post leaves as `?` for the analyst to complete. A comparison never
saved is saved first, named after its place and days as for a note, and the same image
kept before is cited again. An optional
ground-anchored frame cuts any export to the
chosen area, while Full view remains the default. The frame keeps the bearing it was
drawn at: turning the camera turns it with the ground rather than reshaping it, and
the export comes out upright as it was drawn, once all four corners are in view. Copy current PNG uses the clipboard.
Exports include projected annotations, a scale bar and north arrow. **Sign it Azimut**,
ticked by default, closes the credits line under the imagery with the logo and the
wordmark of the app's corner. A GIF keeps the colour of every mark exactly: the
palette of each frame is built around them, and the imagery gets the rest.

**GIF · Evolution** and **PNG · Evolution sheet** play the pictures of one archive in
order, on Sentinel-2 or Wayback on both sides, or Wayback against World Imagery.
Choosing one reads the crosshair's pictures, each shown as a card with its picture of
the export's ground to tick by hand. Wayback lists the whole history at once, in the
order the pictures were taken with each release beside its date, and opens on A to B
(a release that republished an older picture counts as that picture); **One a
month**, **One a year** and **All** retick it. Sentinel-2 is read a month at a time,
one Copernicus request each: it opens on A's month and B's with both passes ticked,
and the arrows or the month field go back to any month since June 2015. A pass over
the cloud ceiling is shown and can still be ticked, **Clearest of the month** ticks
the least cloudy, and the chosen passes stay listed as chips across months. One export
holds 2 to 40 pictures, and the price in Copernicus requests is stated before it runs.
Each picture is drawn from the tile proxy on the export frame's ground, or A's view,
so A and B stay as they are and every picture covers the same ground at one scale; it
may lie off screen. A frame carries its date on the imagery and a line of dates in its
footer, the last one held three times as long, at the pace chosen; a sheet lays the
pictures out in rows under one scale bar. Only the marks set on both sides are drawn,
reference layers and the Difference stay out, and the tones are the archive's. A
picture with no imagery, or with the same pixels as the one before, is left out and
the toast counts it. **Stop** ends it between two tiles. Export copy writes an
evolution to the Views destination only; To Post keeps it in the case under the
comparison (`POST /compare/sessions/{name}/evolution` for the GIF), with the days it
plays. Tile captures wait
for loaded frames and reject incomplete tiles. Google Maps JS uses the
user-triggered Azimut Capture extension and retains its on-map credits.

The search bar floating at the top of the map proposes matches as you type, in the order they can
answer: the coordinates the text parses to, saved work in this case, cities from
a gazetteer shipped with the app (GeoNames, credited under the list), and last
the geocoder's streets and hamlets. The first three cost no network and appear on
the keystroke; the geocoder is asked once typing stops, from three characters up,
and a request it cannot pace is dropped rather than queued, so the list keeps
what it had. Arrows walk the list, Enter takes the highlighted row, and Enter on
nothing parses or geocodes the raw text the way the plain box always did. A city
lands at zoom 12 and a street at 15; a saved item reopens at its own view and
bearing. Picks are remembered locally and offered back when the bar is empty.

**The right-hand panel has two halves, and one tab strip across its top.**
**Layers** is what is drawn over the imagery; **Saved** is what the case holds.
They used to be one scroll, with a list of external maps wedged between them and
a header that named only the third of the three. It opens on **Layers**, because
that is what this panel is for on the surface it is docked to: the case's own
work is also reachable from the sidebar and the Board, while what is switched on
over the imagery is reachable from nowhere else. Each section states its own
count, so the strip carries none — folded shut, the panel shows the active half's
name and its number.

**My layers** is a section inside **Layers**. **New layer** starts blank, from a
local KMZ, KML, GeoJSON or GPX file, or from a Google My Maps link. An added source
layer also offers **Create editable copy**. These routes keep the original source
and its bundled pictograms, and nothing is refreshed afterwards. A file or a copy
fetches no external icon; a My Maps link is read once, its web pictograms with it,
and the layer keeps no tie to the map.
The name offered is one no layer of the case has yet ("My layer 2"), and **Track
over time** can be switched on there, from the start.

The section and its rows fold like **Added layers**; the pencil opens the editor,
the trash removes a layer, and the grip changes its stacking order. Keyboard users
can move a focused grip with Up and Down. Each section keeps the other's order.

While a layer is edited, everything done to its features is in a bar on the map,
and the map rail and the **Save place** and **Capture** buttons step aside. The bar
holds **Select**, **Select an area**, **Add markers**, **Draw line**, **Draw area**,
**Draw a circle** (its centre, then its reach), **Draw a box** (one corner, then the
other; Enter takes either as it follows the pointer), **Paste a position**, **Add from the case** and **Style**, then **Reshape** (one
line or area), **Merge**, **Split** and the trash once something is selected,
**Undo** and **Redo**, and **Done**. A line beside it
says what a press on the map does now; **Tips** hides it, and it steps aside while
the style palette is open. Saves queue behind each other, so the bar never greys
out while one is written. The same bar appears in Map, Detect, Compare and
Horizon; Compare puts it on one of its two maps. On the 3D globe every press,
drag, double click and right-click below works as on the flat map, and a feature
of the layer being edited never opens its card: a click picks it. While a layer is
edited the globe reads a double click as two clicks, not a zoom.

The bar moves by its grip. Let go near an edge, it docks there, upright on the
left or the right; anywhere else it stays where it was dropped. It keeps clear of
the zoom buttons, the place search, the map's own controls (imagery, date, compass,
relief) and the layer's panel, folds to two rows when its row has no room between
them, remembers its place in this browser, and a double-click on the grip puts it
back at the top.

With **Select**, a click on a feature picks it and opens its sheet in the panel,
Shift-click adds to the selection, and a click on bare ground lets it go. Only what
is picked drags, and an area only by its edge. A drag that starts anywhere else
pans the map, so a pan never carries a feature off. Dragging moves the whole selection with it, the map does
not pan under the drag, and the toast offers **Undo**. What is let go is drawn where
it landed at once and saves behind; a move the layer refuses goes back. Ctrl+Z takes back any edit
of the session, one step at a time (an added marker, a restyle, a status, a reshape, a
move, a removal, a merge, a split, a group made, its settings, an **Ungroup**), and
Ctrl+Shift+Z or Ctrl+Y makes it again. Pressed while an edit still saves, it waits for
it and takes that one back; while a shape is drawn Ctrl+Z takes its last point. **Select an area** draws a
free loop round what to pick; Shift adds. Delete removes the selection, with
**Undo**, after a press on the map only: a Delete after a click on a button of the
panel removes nothing.
Double-clicking a line or an area opens its corners. A right-click on a feature
opens its menu: style, status, the point's coordinates (a marker's own, else
the spot pressed), copied in one press, **More for this point…**, which opens the
map's own point menu there (other formats, **Open in…**, **What is here?**),
**Clear the direction**, **Reshape**, **Save as case place** and removal, for the
selection it is part of. The map's menu leaves out the acts that arm a tool of the
rail, put away while a layer is edited. **Add markers** accepts
repeated map clicks, each marker drawn where it is put down at once and picked so its
sheet opens once saved; Escape stops adding. **Draw line** and **Draw area** collect
map clicks; Enter or **Save** saves, Esc cancels, and **Undo last point** takes a
corner back. A shape ended is drawn at once and saves behind; one the layer refuses
comes back to be finished or dropped. A corner placed within ten pixels of one already in the layer lands on
it, so a line drawn to meet another meets it exactly; a white ring shows where, and
Alt lets it go free. **Freehand**, while a line or an area is drawn, lays a stroke
of the pointer instead of a corner per click. While a new line or area is drawn, a
dashed leg runs from its last corner to the pointer and a label beside the pointer
says the length or the surface it would have; a circle says its radius and a box its
two sides. Once a circle's centre is down, the bar holds a **Radius** field: a reach
typed there (`800 m`, `2.5 km`, a bare number in the unit shown) draws it, and Enter
saves it. A new line is named **Line 1**, **Line 2**, an area **Area 1**, each
counted apart; a new layer's first group is **Features**. A line being reshaped grows by a click
on the map, from its end or, with the bar's other arrow, from its start. An area
being reshaped takes no click: its corners are dragged, and **+** puts one in, on each
side long enough on the screen to take one. The shape being reshaped leaves the map
while its outline stands for it, and comes back drawn as it was let go. Handles are
drawn for the corners in view only, and a corner dragged follows the pointer once a
frame, the shape taking it when it is let go. A corner
of a line being reshaped can be pressed, then **Cut the line here** splits it there.

**Merge** makes the selected lines, or areas, one feature. Lines that meet end to
end become one line, in whichever direction each was drawn; lines apart become the
parts of one feature, and areas always do. The first feature picked keeps its
name, group and style. **Split** gives each part of such a feature its own, named
after it and numbered. Both offer **Undo**.

**Style** opens one palette, the same in the bar, the sheet, the right-click menu
and a group's settings: the styles the layer already uses first, then the
colours, then four plain symbols and seventy-one round pictograms drawn locally in
the chosen colour (a filled white silhouette on the disc, dark on a pale one),
laid out by theme (Markers, Sources, Events, Forces, Vehicles, Places) with a
search by name, theme or keyword. Among them are smoke, a firing position, a launch
point, a flare, a group, a person seen from above (it turns with its direction), an
uncrewed boat, a fortified position and anti-tank obstacles, beside the bunker and
the trench; Geo Proof's picker offers the same pictograms, apart from the source and
vehicle ones. Each pick applies at once and the palette stays
open for the next. With nothing selected it sets the next markers and the group
they go into; with a selection it restyles it and can move it to another group. A
group with one style draws every feature in it, so a pick on its features
restyles the group, and the palette says so. A group with one colour does the same
for the colour alone: each feature keeps its icon, and a colour picked recolours
the group.

The palette offers at once the colours the layer is drawn in, its lines' and areas'
too, as its key lists them, each said by its name when the case names it; the
styles the layer shows fill one row, **+** showing the rest. The colours' **+**
unfolds the colours the case names in its other layers, the five plain colours,
those picked lately anywhere (a layer's palette or a plate's), the browser's picker
and the code field, which shows the colour worn for copying and takes one typed or
pasted as `#d55e00`, `d55e00` or `rgb(213, 94, 0)`. A layer in no colour yet offers
the case's named colours at once, or the plain ones when none is named. In the Icon part a chip per group scrolls the grid to it, and
only the grid scrolls, so the colours stay in view above it.

The analyst's own icons come first in the palette's Icon part. **This layer's
icons** are the ones the layer holds that the library does not, such as a copied
map's; then the library from Settings → Icons, group by group; then the app's.
With an empty library the palette says where icons are imported. A layer keeps a
copy of each icon its markers wear, taken the moment one is picked, so a case
opened on another machine draws them and removing one from the library changes
no map. An icon is drawn **in a disc** (its shape inked on a disc of the marker's
colour, as the app's pictograms are) or **as it is**, in its own colours and at
the size imported maps draw theirs; the damage stroke, the external rim, the
direction and the selection ring go round either. A colour pick never takes an
icon off: one drawn as it is keeps its colours, and the palette says so. Only a
pick of one of the app's symbols replaces it. A point copied out of a map with
its own icon offers **Its own icon** first in the copy steps, already chosen.
An unfolded layer row that holds icons says how many, with **Add these icons to
my library**: a grid, all ticked, that files the chosen ones under the layer's
name. A copy never fills the library on its own.

**New group** creates a foldable group. Its ⋯ opens its settings: its name, how it
styles its features (**Each its own**, **One colour** where each keeps its icon, or
**One style**) and that colour or style, **Names on the map**, **Icon size**,
**Line width**, how its lines are dashed and its areas filled when a feature says
nothing of its own, **Name N after their place**, **Select all** and **Ungroup**.
A pick on a group with one style or one colour restyles every feature in it, and
the toast says how many, with **Undo**. **Name after their place** asks the app's reverse geocoder
(OpenStreetMap's Nominatim, one point a second) for the village or town each
feature stands in, for the features whose name says nothing ("Point 12",
"Marker 3"), shows its progress with **Stop**, and writes the names in one edit
that one Undo takes back. The editor's feature list
shows each point's pictogram, as the map draws it, and its day. A group with one
style shows its pictogram in the list and in the layer's legend. Menus, settings
and palettes close on a press outside or Escape. Individual styles survive a
temporary group override.

A feature's sheet opens under its row in the list, the rest of the list still in
view; a feature picked on the map unfolds its group and brings its row into view.
Several features, or one whose row the search or a folded group hides, open it above
the list. It holds its style and name, then sections that fold to one line saying
what they hold, the ones opened staying open from one feature to the next.
**Evidence** shows the case item a marker follows. **Status**: for a marker, **–**
(nothing said, the first choice, since most markers are no building), **Damaged** or
**Destroyed**, drawn on the map as a stroke or a cross across the marker (a line or
an area has no status); beside it how sure, **Sure**, **Likely** or **Claimed**, a
likely line drawn dashed and a claimed one dotted, a marker drawn fainter, unless the
feature sets its own dash; and which way it faces. **Sources**: each a chip that
opens in a tab of its own, **Geolocated by me** (off gives the marker a dashed rim),
and the **Credit** a feature copied from somebody else's layer keeps, which a plate
that draws it prints. **Note**. **Details**: its group, a **Day**, which the layer's
time strip and the Timeline read, a line's length and an area's surface. A marker
states its **Position** in the
analyst's coordinate format, with a copy button; a position typed or pasted over it
(decimal, DMS, MGRS or a plus code) moves the marker there as one edit Ctrl+Z takes
back. A marker that follows a case item, or that a date holds, stays and says why. How it is drawn folds under **Look**, which
names what the feature sets of its own while folded and stays as it was left from
one feature to the next: a marker's **Size**, a line's **Width**, **Dash** (solid,
dashed, dotted) and **Arrow** at its end or both, an area's **Fill** (filled,
hatched, or its outline only) and the fill's strength, and its **Name** on the map,
as its group says, shown at a size of its own, or hidden. Each slider says its
value, quieter while the group sets it, and **Reset** gives it back to the group.
Every row says what it does when the pointer rests on its name, as a group's
settings and the layer's menu do; the words live in one module the sheet, the
right-click menu, the **Add to a layer** steps and a plate's symbol share. Each row saves
as it is set, a name or a note when its field is left. Its ⋯ holds **Save as case
place**, **Delete case place** for a followed place, and **Remove from the layer**.

The one selected marker wears a ring on the map. Dragging its knob turns the
marker toward the pointer, by steps of five degrees (Shift lets it go free), so
pulling it out to a target aims the marker at it; the direction is drawn as a
wedge round the marker. A double-click on the knob, or the sheet's ×, clears it.
The knob also turns from the keyboard. The tag in the editor's header, in the
palette beside the colours, and under a layer's legend while something in it has no
name, names what the case's colours and icons stand for ("Side A", "Drone strike").
It lists the colours and icons worn where it opened, and a colour added there; the
names the case gives elsewhere fold under one line. Every layer of the case offers
the named colours, the card and a plate's legend name a feature by them, and the
layer's legend counts its features under each name.

Enter, or a double click on the map, saves a line or an area being drawn, even from
the layer's search field or with the style palette open. While a shape is drawn or
reshaped, Ctrl+Z takes back its last change (a corner added, moved, put in or taken
out) and Ctrl+Shift+Z makes it again, never touching the layer's saved edits. A
drawing tool pressed again is put down. When the map is too narrow or too short for
the bar, it wraps onto two lines, or two columns upright, rather than run off it.
**Done** stands in the panel's header too.

**Find in this layer** filters the list by what a feature says (its name, its note,
its day, its status, its sources) and opens the groups that hold a match. A row
writes its day as `14 Oct 2026` and the first words of its note beside a name that
says little. The sheet stays at the top of the panel while the list scrolls under
it, and a row pressed keeps its place under the pointer as the sheet opens. Group grips support dragging or Up/Down keys to reorder; the first group
draws on top. Each group's **Icon size** slider runs from 50% to 300%, including
individually styled groups. Pins and round markers use comparable painted heights.
**Line width** runs from 0.5 to 12 pixels. Click a feature row to select it;
Shift-click selects a range, and Ctrl/Cmd-click toggles a row. Rows drag to
reorder or into another group, the whole selection with them; the grip shows on
the row under the pointer, and Up/Down keys move a focused one. Several selected
features share one sheet that changes them together, a row they disagree on
reading "Several"; its ⋯ offers **Move with a handle** for the keyboard and
removal with Undo. Groups initially show 100
features, with **Show 100 more** and **Show all**. Their lists scroll within the
editor so editing controls remain reachable. Removing a group moves its features
to the first remaining group. Editable shapes hold at most 4,096 coordinates.

Switching tools keeps the editing session and feature form. The layer's name is a
field in the editor's header, saved when left; its ⋯ adds or edits an optional
description and downloads the layer. **Discard changes** is the undo-arrow button
beside **Done**. **New layer**
also accepts a description. Both fields travel with the layer.

**Done**, in the bar or the panel, saves anything still in a field and any complete
shape being drawn, then ends the session. Opening another layer for editing, or
another case, leaves this one the same way, so a later **Discard changes** goes back
no further than the session it is pressed in. With nothing changed it just
leaves editing. Otherwise it asks first, then restores the layer to its state
when editing started. Separately saved case places remain in the case. The checkpoint survives a reload, so
reopening can still discard.

A personal layer's time strip works as an added layer's does, on its features'
days. The Timeline offers a **My layers** track in **Add a track**: each dated
feature of the case's layers on its day, opening on a card with **Show on the
map**. Its day is changed on the layer, not by dragging it on the axis.

**Track over time**, in the editor's ⋯, follows a layer through its changes
instead of overwriting them. It is off until asked for, and a layer that stays
off behaves as above. On, the layer's row and its editor read it at one moment
on a cursor: a tick per day that holds a change, steps to the one before and the next, **Today**,
and a calendar, which offers no day after today: a state is what was seen. The
cursor is always on a day of the calendar, today on the layer's clock until it is
moved, never on a "now" that would slide to the next day. Dragged, it catches the
change nearest the pointer. The axis writes the days its ends stand on under it, the
first change and today, with their years when it runs over more than one. Every map reads the same cursor, which
is never stored, so a layer opens on today, and opening the editor puts it back on
today wherever an earlier press left it and holds that moment while it is open: an
edit made just before midnight stays on its day, and on a layer dated to the minute
the edits of one sitting share one moment. The editor's ticks come from the features
it holds, so they are there whether or not a map drew the layer. The editor's ⋯ sets how states are
dated, to **the day** or **day and time**, and the one clock they are read on, the
case's clock until another is picked; set once, they stay out of the panel.
Switching precision rewrites nothing: a day stays a day.

The panel says which day the map shows (**Shown on the map**) and keeps it in view
above the selected feature. The edit bar says what an edit is dated to, in two
buttons, the one on saying itself in words: **From** the day shown, where what is
drawn appears that day and a move, a reshape or a status changes from it, and
**No date**, where what is drawn shows on every day and a change counts on every
day alike. That only works on what never changed by date: a feature that moved on
a day stays put with no date (a drag says why, Reshape greys out) and moves from
a day, and so does a status that changed on one. To correct one of its dates,
press that date in its history. Edits are dated to today until another day is
picked: the calendar on the day button picks it, which moves the map there too.
**No date** holds for the day it was chosen on; at another day, edits are dated
again. A feature copied in from another layer appears on the day its layer shows,
unless it brings a day of its own.

Under its name, a feature's sheet says when it shows: the day it first shows
(**Always** for none) and the day it leaves the map (**Still there** for none),
each pressed for a calendar that offers the day shown first. A start stays before
the next change and an end after the last; an event has its day only. **Unknown**,
beside Today in the end's calendar, says nobody knows when it left: it is never
set unless pressed, the feature is drawn as still there, and its row reads
**13 Oct → ?**. The round
**+** goes to a day picked to change the feature from. Its history lists each date
with what it brought (**Appears**, **Moved**, **Destroyed**, **Gone**), pressed to
show the layer then and × to take it out. A long one shows its first and last dates
and those round the one edited, the rest counted on a row (**48 more dates**) that
unfolds them. A pencil marks the date an edit will
change, and a dashed **Next edit** row shows where a dated edit would start a new
one, so a feature with no date shows that a move now gives it a history. With no
date, a line under it says what a date holds (**Moved on 8 Oct**). Several
features selected share the two days: a day they all have is said, else **Mixed**,
and a day picked goes to all of them in one edit, its calendar offering only the
days every one can take. Each row
of the layer's list says the same in a few words (**Always**, **From 12 Oct**,
**3 Oct → 14 Oct**), with a yellow dot on what changes on the day shown. Merge and
split work on features with no history yet. A feature not on the map on the day
shown, greyed in the list, keeps its status and shape there: a status, a move or a
reshape would quietly move the day it first shows, so its sheet says so and its days
are changed first. A status is always the day shown's, so a feature picked on one
day and read on another never writes the first day's status on the second.

What the cursor reads is drawn alone, never between two states: the state before
dashed under it, and an area's gains and losses since the state before or since a
chosen day, hatched in its colour. Both are set from the button at the end of the
cursor's line, which says what is drawn (**Before · ± last**, **The past** when
nothing is). What is after the
cursor's day is not drawn, and what appeared or changed on that very day is ringed
in yellow. A group's menu can say its features are **Events**: a strike or a clash
shows on its day and fades after it, where a lasting thing stays. Events stay,
faded, for good, unless that button says **Leave after** a number of days; the
layer keeps the choice, so every map and the next visit read it. Off again, the history
is hidden and kept, and an edit corrects the latest state. On the Timeline a
tracked feature is a bar per state, the last one marked on the day it went.

The download icon on a personal layer or its editor offers **KMZ**, **KML** and
**GeoJSON**. A tracked layer goes out as it stood on the cursor's day, or with
every state dated for another viewer's time slider. **Send to My
Maps…**, in the editor's ⋯ or from the download dialog, saves the KMZ of one day
and opens the analyst's My Maps, whose address the layer keeps, beside three
steps: delete the old layer there, then import the file. Google offers no way to
write to a My Maps, so the replacing is done there. KMZ carries bundled icons for use in Google Earth or My Maps; the
single-file formats carry geometry, groups and style fields. A feature's day,
status, direction, sources and provenance travel too, and come back on reimport.
Downloads include hidden groups and omit case entity IDs. Reimporting retains
Azimut symbols, group sizes and line widths. Source bitmaps travel in KMZ.

Three ways bring outside points in. **Paste a position** reads coordinates, a map
link or the text of a whole post, read where it is pasted and nowhere else: it
lists the positions found, keeps the post's addresses as sources and its day when
written unambiguously, and marks the point as somebody else's when the text cites
an address. Ctrl+V on the map opens it with the clipboard. **Add to a layer**,
on the card of a source layer's feature (a GeoConfirmed event, a My Maps pin),
puts it in one of the analyst's layers as somebody else's point, with its day and
the addresses its note cites. It opens the same step-by-step menu as a Geo Proof
point, the layer used last first, the icon step starting on the feature's own
colour; a line or an area skips the icon. A row at the top of that menu says what
the item shows, **–** (nothing said), **Damaged** or **Destroyed**, on the marker it adds.

A personal marker belongs to its layer. **Save as case place** explicitly creates
a place, or reuses a place already at that point, and records the layer's origin.
The layer's working collection, original file and icons travel with case bundles
and Trash.

**Add from the case** lists what the case has placed: places, proofs (one row per
checked point), files, captures, comparisons and views, filtered by kind and
name. Each becomes a marker that follows it: move the place or correct the proof,
and the marker moves with it. Such a marker cannot be moved alone; **Unlink**
keeps it where it stands and lets it go. **A proof and the footage it rests on
are one marker**: a file added where a proof places it follows that proof, an
item already shown on that point, as itself or as its proof or footage, is not
added twice, and taking the marker out from either side takes it out. The marker
says what its item says: a proof is named by its description (its title when it
has none, with the point's label on a proof of several) and gives its day and the
addresses it cites, the footage's among them; a file alone is named by its notes,
else its title, and gives the address it came from but no day, since a post's
date is often not when it was filmed. Each save of the proof or the file writes
these again, except a field rewritten by hand in the marker, which stays the
analyst's. A file marker made before its proof becomes the proof's on that save,
and a second marker of the same geolocation in one layer goes, kept for Undo. Its
sheet opens on the footage, then the proof, each picture opening it; the
marker's card on the map shows the same two. A case item can be shown in several
layers without another case entity.
Geo Proof's coordinate rows offer the same from the proof. A point's ⋯ goes a
step at a time: the case's layers, the one used last first; then the layer's
groups, when it has several; then, for a group whose features each have their own
style, the marker's icon and colour, the layer's own styles first, and **Add**; for
a group in one colour, its icon alone. A group with one style takes the point at once. A tick marks where the point already
is, and **New layer…** makes one and opens it. A proof with unsaved changes is
saved first, and a point the imagery only proposed is checked on the map first. Under the point, each
layer it is in reads as one line, with **Open** for the marker on the map and ×
to take it back out, with Undo. The same ⋯ makes a later point the conclusion or
removes it.

**Remove from this layer** in the popup or editor removes a marker and offers
**Undo**. Popup actions use compact icons with accessible names and hover labels.
The last twenty removed features are kept in the layer spec. **Delete case
place** previews direct relations and the layers using it before moving the place
and its relations to Trash. Layer markers that followed it stay where it stood;
restoring the place makes them follow it again. Proofs retain their own
coordinates, so media placements derived from proofs survive the place deletion.
Media located only through the deleted place lose that map position; the preview
says so when a media item is linked directly.

Saved work — places, captures, screenshots filed by the extension and saved
comparisons — lives in the **Saved** half, grouped by geography rather than by
date. The tree's depth follows the case: one country opens straight on its regions, a
worldwide case opens on continents. A filter and a `Media / Places / Captures`
switch stay pinned above it; a screenshot counts as a capture, and so does a saved
comparison, which is imagery of a point at two dates.

**A comparison is one row, whatever was made from it.** It stands at its export
frame's centre, or its view's when no frame was drawn, and the frame is outlined in
dashes on the map, since it is the ground the images show rather than a guess about
a place. The row reads its two pictures' dates, `2024-05-03~ → 2026-09-02`, and
how many images were kept from it; its card lists them, and **Open in Compare**
reopens it, from Satellite or from Compare's own maps. Deleting it moves the
session to the Trash and leaves its images in Media. Its country is looked up on
save, again only once it has moved about a kilometre. The panel opens on
**Media**, which is what a map is read for: where the case's footage stands. That
position is a **mode** — it reads its own index (`GET /satellite/media`, the first
time it is opened, never on case open) — while Places and Captures filter the one
compact index the case opens with. One position is drawn at a time, so nothing
stacks two marks on one spot. Proofs are not a position of their own: a proof
stands on the point it argues, which is a place the switch already draws, and
that place wears a dot and a count instead.

**Media** lists the case's located images and videos, one row per point. A file
carries no coordinates of its own, so the position is read off the graph, by
every road that states it: a `located-at` or `depicts` edge to a place, the point
enrichment proposed from the file's own GPS, and the derivation chain, which puts
a video where the proof that composed a frame of it stands. That chain runs
through material only: two clips published in one post keep their own points. A file recorded on a
roof and showing the street below is a row at each, and roads that agree on a
point are one row that names them all (`Recorded here · Shows this place · Via
Roofline`). A file nothing places is not listed, and neither is anything the case
made out of its own material: a frame cut in Inspect, a capture or a rendered
comparison stands where its source already stands, and the Media Library holds
the same set back behind its own switch (`links.PRODUCED_HERE`). Locate has nothing to do here
either, and the row's own actions are gone: a file is renamed, filed and deleted
in Media.

Pressing a media row, or its mark on the map, plays the file **in the panel, in
place of the list**: the footage is read beside the imagery it is being matched
against, and a window over the map would hide the half being compared. The marks
stack like any other, so one press opens every file on that metre; `←`/`→` walk
them, the count says where you are, and `Esc` brings the list back. A focused
video keeps its own arrows for seeking. The card carries the file's name, its
point, why it stands there, and the ways out: **Open in Media**, one button
per proof built on it, and **Add to a layer**, the same step-by-step menu as a
Geo Proof point's (layer, group, then icon and colour). A point only a tool
suggested is confirmed in Media first. Each layer the file is in reads as one
line under it, with **Open** and ×. The mark being read stays lit on the map.
Items with
no country collect under **Unlocated**, where **Locate** looks them up a batch at
a time and can be stopped mid-pass. Its left edge resizes from 260 to 560 px,
capped at 40% of the window, and the width is remembered locally.

Branches read `English (native)` — `Russia (Россия)` — and search matches either
spelling. Proofs and posts keep the native name only.

Saving a place or a capture resolves its country as part of the save, so the item
appears already grouped. Offline it lands under Unlocated for a later Locate.

Saving a proof turns the coordinates it carries into places, which is where a
geolocation stops being text in a spec and joins the map (ONTOLOGY §3). A proof
stating three points draws three marks and files three rows under one title,
told apart by the name each point was given. The marker beside a row says that
point is where the camera stood, at most one per proof; the others are what the
footage shows. Nothing in a composition can answer that, which is why it is asked
rather than guessed. A capture files nothing: ten are taken while hunting one
roof, and the point is worth minting once, where somebody commits to it.
Settings → General → Proofs saves them outright or has the composer ask; a point
the case already holds is neither filed twice nor asked about. Only the first
point is looked up at save — the rest wait for Locate rather than holding the
save for a lookup each.

A row the enrichment proposed from a file's GPS carries a `suggested` chip and an
**accept** action, on the row and in the search modal, so the point is settled
where the map that decides it is already open. The sidebar's Suggestions list
keeps working, and both send the same click.

A globe/folder switch beside the filter regroups the same set by My-work folder:
the case's whole folder tree, empty folders included, with unfiled items under
**Unfiled**. The filter and the kind switch keep working, counts cover the whole
subtree, and the mode is remembered locally. Only there are rows draggable —
dropping one on a folder files it, dropping it on **Unfiled** unfiles it.

The `…` button beside the filter opens the same set at full width, with previews,
search across title, note, place and provider, and three sorts. It is a modal, so
it works over a fullscreen map. Folder browsing lives in the panel, not here.

Editing a place or a capture (**Edit** on any row) sets its title, note, relation
and My-work folder in one dialog, and is the only place a new folder is created
from the map.

Map chrome sorts into four kinds, each with one place, and a tool declares
which it is (`lib/map/tools.js`) rather than adding a button somewhere.

- **Modes** — what the pointer does: measure, grid search, sun & moon, and the
  capture marquee, which is armed from the Capture button (it starts on Capture an area, the
  centred frame one choice away in its arrow) rather than from a
  toolbox. Exactly one is ever armed: arming any of them closes the rest, and
  Escape disarms whatever is. They sit in the **rail**, a column floating in the
  map's top-left corner with the zoom buttons stacked under it, grouped by a
  hairline. An armed seat wears the accent as an edge, not as a filled square.
  Adding a reference window is in the rail too, as a seat that runs instead of
  arming. Its picker narrows like the Media Library: past six items it grows a
  search, one chip per facet that would hide something, a folder button, and
  **Show N working files**, held back by default since the reference is nearly
  always collected material. The chip and the switch stay as set for the session.
  A **reference window** is a title and a picture at rest; its controls lie over
  the bottom of the picture and come up on a hover, and a clip keeps a hairline
  of progress. **Fade** lets the map show and move under the picture (only the
  bars take the pointer) and remembers the value worked on the slider. **Details**
  appears only when the file has dates, a source or notes. A clip gets its own
  player: frame steps at the clip's probed rate (← →, Space), slow motion,
  sound, and **Keep this frame**, which opens the frame as a picture beside it.
  Dragged near an edge of the map, a window settles against it; let go in a
  corner, it stays pinned there. The **pin** in its header swaps the title for
  six places: a column on the left or right, where the map narrows instead of
  being covered and the windows stack centred at their pictures' height, or one
  of the four corners, over the map, clear of the map's own controls and kept
  there as the map changes size. The place it is in sets it free. All of it is
  session-only, like the window.
  **A scene being geolocated opens its video here**: in the window already open on
  that clip, or a new one, paused where the scene starts. The scene is marked in the
  colour Inspect's bar draws it in: a band over each passage and a pin at each instant
  on the player's bar, a strip along the window's foot at rest, and a dot in its header. A pin in the player goes
  back to its start. Nothing loops. A picture marked to geolocate opens the same way,
  in the window already on it or a new one, with the scene's dot in its header and
  nothing to mark or cue.
- **Its settings** open in the rail's one **panel slot**, beside it. One mode is
  armed, so one panel is open; a panel cannot cross another or the map's own
  controls.
- **Layers** — what is drawn over the imagery: borders with the larger place
  names, town and village names, roads, railways, power lines, sea marks,
  GPS traces, active fires, night lights, the
  case's saved work, and the points another tool handed over (a sheet's
  coordinate column, a Timeline window). None of them changes what the
  pointer does, so none takes a rail seat: they are a list in the panel beside
  the map, each with its own switch. A handoff appears in the list when it
  arrives and leaves when it is closed, and keeps a Close beside its switch,
  since hiding a layer and being done with it are two different things. A layer
  that is a question answers it under its own switch rather than in a card
  floating over the map: a fixed handful of answers as a row of chips under its
  own label, an open-ended one — the folders the analyst named — as a list.
- **Added layers** — a second section under that list, with its own `+ Add a
  layer`. The line between the two is *who chose it*: the stack above is the
  app's, this one is the analyst's. A row here carries four things a curated row
  has no use for — where it came from, how fresh what is drawn actually is, a
  legend that filters, and Refresh and Remove. Its rows are the map's stack,
  top first. See **Added map layers** below.
- **The picture** — the provider, the Sentinel-2 layer and date, when the pixels
  were taken, the eco and usage pills, and the compass — belongs to the
  *surface*, in its own top-right corner. Which imagery is on screen is a
  property of that map and not of the tool, which is what lets two surfaces sit
  side by side each saying its own.

**Sentinel-1 radar** is a basemap once Settings → Imagery has found the radar
layer of the analyst's Copernicus configuration. Its chip names a pass by its day
and its UTC time, with an arrow for the way the satellite flew: dawn passes fly
south, dusk passes north, and the two see a place from opposite sides. The picker
reads a month of passes at the crosshair when it opens, one request a month, and
keeps what it read. The picture is the dual-polarisation composite Detect reviews
radar candidates on: water dark blue, vegetation grey-green, walls and hulls white.

**3D** sits under the compass. Pressed, the imagery rises on the relief
(Mapterhorn's open heights, AWS's set when Mapterhorn cannot be reached) on a
globe the app draws itself, and the view leans to 20° once the relief under it
has arrived. The flat map stays on screen until the globe stands where it was
asked. Only the hand moves the view: a drag turns the Earth under the grabbed
ground, a right-drag, middle-drag, Shift+drag or a double click held orbits round
the ground pressed, the wheel and a double click slide the eye toward the ground
under the pointer, as far for a notch or a trackpad swipe as on the flat map,
and a drag on the sky looks round from where the eye stands. Ground grabbed
near the horizon, where a pixel is kilometres, slips under the hand rather than
throwing the view across the land. Ground that arrives sharpens in place and
never moves the camera, the ground all round is held a few levels short of
sharp so a quick turn or pan never shows it coarse, and the eye stops short of
a slope rather than going through it. Rising, the view levels so the Earth stays in sight, out to the
whole globe. **Tilt** looks straight down and back, and Page Up and Page Down
lean it ten degrees at a time. **Real heights** can be raised to ×1.5, ×2 or ×3
to read a gentle slope, and the control turns amber while they are. On a billed
basemap a **Far ground: Esri** pill says the ground past a flat view's reach is
Esri's free imagery. A tilted view has no one scale, so the scale bar steps
aside while it leans, and Grid Search stays shut until 3D is off. The address
keeps the tilt, the zoom to two decimals and the height of the ground at the
centre, so a reload or a second window opens on the same view.

The globe draws what the flat map shows. Lines and areas lie on the relief
(borders, roads, the analyst's areas, a measure, the sun's path), and names, pins
and dots stand upright at their ground, the size they are on the flat map,
hidden past a ridge once the view stops. A click, a right-click or a card works
on them as it does flat, and a dropped pin drags along the slopes. Active fires
are drawn flat only, since a view to the horizon would spend their allowance:
their switch rests while 3D is on, and comes back with it. The globe is the only
3D view: a browser without WebGL2, or one that loses it, has none, and the 3D
switch greys and says why.

**How much the 3D draws is this computer's.** Settings → General → 3D views offers
Full, as the 3D always drew, then Balanced and Light for a slow graphics card or
little memory (`lib/quality3d.js`). They split the globe's tiles later, draw fewer
pixels on a high-density screen, lay fewer pictures a frame and hold less on the
GPU, and Light drops edge smoothing. Horizon draws fewer pixels too, nothing else.
The globe takes a level the next time 3D opens, Horizon at once. A capture is
drawn as Full draws it, and plates never read the level. The settings backup
leaves it behind, since it answers this machine's graphics card.

A tilted capture is the picture the map draws, imagery on relief and nothing laid
over it, filed with its tilt, bearing, exact zoom and, for a frame centred on
the view, the height of its centre. Its credit line names the
relief, the fallback when it drew some of the ground, and raised heights. It
offers no deeper resolution and no scale bar or north arrow. Opened from Saved, it
leans back to the view it was taken from; a flat capture opens straight down.

A capture can carry a **scale bar and a north arrow**, ticked in the capture
menu: the bar bottom-left in the analyst's own units, the needle top-right,
turned so it points at true north on a map that was rotated. Off until asked
for, then remembered for every capture after it — it is a house style rather
than a decision per shot. Neither mark is ever invented: the bar states the
crop's own resolution, the needle the bearing it was filed with, and a pasted
screenshot gets neither, since its coordinates describe the map view at filing
time rather than the picture itself. What was drawn is written into the
capture's provenance.

**Figure** sits in the same menu while Sentinel-2 is on, in its first row beside
Capture and Capture an area, since it is a third thing to take off this map rather
than a setting for the other two: the same ground on the day already chosen,
through the layers you pick, each panel captioned and filed as its own capture.
It opens in Geo Proof with its credit line written — the day, the point,
Sentinel-2 L2A and the credit Copernicus asks for, with the year — ready to
annotate. Up to eight panels, one to four per row, each layer once, at the capture
size the menu is set to. The chip is
never greyed: what a figure still needs is said in the dialog, where it can be
read and acted on — an undated map has nothing to build from and says so instead
of the panels, and a configuration with fewer than two layers says where another
one comes from. Every panel is the same acquisition by design: panels of different
dates compare two things at once, which is what Compare is for, so an undated
map says to pick a date first.

**Measure** is one rail seat with no modes. A click starts a measure and each
click adds a point; a double click or Enter ends a line, and a click on its first
point closes it into an area. Each leg writes its length and bearing along it, a
line of several legs its total past its end and the angle at each corner, an area
its size in its middle. A click within a few pixels of a place, a pin or another
measure's corner lands on it, unless Alt is held. Backspace takes back the last
point while a measure is drawn, Escape ends it, Delete removes the selected one.
A finished measure stays, so a second can be drawn, and two lines that cross are
marked where they meet, the point copied with a click. A finished measure's
corners drag, taken a few pixels round the dot as well, the dot halfway along a
leg bends it there, and a right-click takes a corner out. A corner pressed
without moving, or let go, starts no measure. The tool keeps its own units (the app's, metric, imperial or
nautical), and its measures wait, hidden, while it is closed.

The panel shows the selected measure in large. A line of two points takes an
exact length or bearing typed in place, in any unit or as a wind, and can be used
as **Ring** (up to five circles round A, each as wide as the line), **Cone** (what
a camera at A facing B takes in, its opening set), **Shadow** or **Viewshed**. A
shadow is drawn from an object's foot to the tip of its shadow: its direction
names the hour the sun stood opposite on the picture's day, and its length the
object's height at that sun, for level ground seen from overhead. A picture with
no day asks for one. A viewshed fills the ground in sight from A out to B, 30 km
at most, on bare earth without buildings or trees. **Keep** puts the measure in
one of the case's layers, named by what it reads, its points in the notes, and
**Copy** puts the same text on the clipboard. The panel folds to one line, what
the measure in hand reads, and stays folded until it is unfolded.

**Ground** reads the heights under a line. The flat map asks the relief server
only once the switch is on, and remembers it; in 3D the relief is read anyway, so
the ground comes with the line. A window shows the profile and reads both ways
with the map: the pointer over the chart marks its point on the line, the pointer
over the line marks it on the chart, the arrows walk the crest, and a click or
Enter brings the point to the middle of the map. For a line of two points the eye
at A and the target at B stand at heights typed or picked from the usual ones,
the crest is coloured by what the eye sees with the hidden ground shaded, or by
slope, and the title says whether B is in sight, the angle the eye looks at it
and the rise from A. On the globe the line of sight stands in the air between
them. **Look from A** opens Horizon there, facing B. The window folds to its
title bar, by its chevron or a double click, the verdict still read there. It
opens over the rail and its panel, and **Chart** beside the switch puts it away
or brings it back.

Underneath, the **status line** reads where you are (coordinates, the ground's
height in 3D, zoom) on the left, and carries the two acts that take
something off the map — Save place and Capture — on the right. What marks the
point, and whether that point is the map's centre or a pin dropped somewhere,
is one small menu beside them: both are set once and the two acts are pressed
all day. The engine's scale bracket reads under the coordinates, where how far
a pixel goes and where you are make one instrument. Link, new tab and fullscreen
close the imagery card on its right, one frame as on Compare's source cards,
because they are what the window does with the tool rather than what the tool
does with the map. On a narrow map the card splits in two lines, the provider
and those three on top, rather than slide under the search. Sentinel-2 is dated on its
own chip there, as on Compare and Detect, and the pill under it reads the day
again with how it was chosen, as the radar pass does.

**Active fires** are NASA FIRMS, and answer two questions with the same marks:
what is burning now (the last 24, 48 or 72 hours, or the week) and what was
burning on a given day (any range back through the archive, up to 31 days).
Which instrument and which stretch of time are chosen in the row itself. A
detection is a square the size of its footprint, never under 7 px, with a dark
ring so it reads on any ground; close in, its inside shows the ground and each
square keeps its own edge, even under another. A window
longer than a day draws the last 24 hours in red over the rest in amber, and the
row says so. The windows are FIRMS's own, counted in whole UTC days. The map
draws every square itself, at every zoom: a square keeps its size through a
zoom and stays where it is while the next level loads, then the new level
refines it. From zoom 8 in, a live window comes from the points fetched for the
ground around, so zooming in costs nothing more; farther out, and for a date,
the squares are read off FIRMS's own picture of each tile. It needs a key, and says which of three things stops it rather than
failing on the first tile: no key, a key switched off, a key FIRMS refused. A key
pasted into Settings is picked up on the way back to the map. A spent allowance
is none of those: the layer stays on, says it refills within ten minutes, and
asks NASA nothing in the meantime. Tiles stop at z13. Farther in, the map
draws those squares bigger instead of asking NASA for invented detail.

**The reference layers** are key-less and each is simply on or off: borders
drawn as lines from OpenStreetMap through OpenFreeMap (country, region and
district, each in its own weight, with the names of countries, regions and
cities), Esri's roads, OpenStreetMap's town, village and hamlet names, Open Infrastructure Map's power
lines, OpenSeaMap's buoys and harbours, and the raw GPS traces people uploaded to
OSM, which show tracks nobody has mapped yet. Borders start on, since reading
imagery starts with which side of a line the ground is on, and none of the others
fetches a tile before its switch is pressed. The place names fill in
under the borders' cities. They are written in Latin script, and where
two would overlap the larger place is kept. The roads and the place names are
greyed over a street map, since it already draws them. Power lines are drawn
from vector tiles in the app's own small style, coloured by voltage on Open
Infrastructure Map's scale, dashed where the line is buried, with towers from
zoom 14, substations, plants, pipelines and telecom masts. No overlay reaches a
capture: a capture stitches one provider.

**Night lights** are one night's VIIRS pass from NASA GIBS, around 01:30 local
time, or the 2016 cloud-free composite to hold it against. The row picks the
satellite (NOAA-20 back to 2024-03-25, Suomi NPP back to 2020-11-18) and the
night, from a calendar that stops at each record's first night and at
yesterday, since today's pass is still being processed. It sits lowest in the
stack, slightly see-through so the lit street can be named, and the row says
that cloud hides lights too.

**Added map layers** are somebody else's map over this one: a KML, KMZ, GeoJSON
or GPX file opened from the computer, a public My Maps or map URL followed, or a
GeoConfirmed conflict. All of them land in the same section, because the question the row answers is who put
this on my map. **A layer is drawn and never adopted** — clicking a feature opens
what the source says about it, its name, its group and its description, with
nothing to confirm. **Create editable copy** opens the source's saved features in
**My layers**, where a chosen point can be saved as a case place. A pin's card also states
its point in the analyst's format, pressed to copy: read from the file rather
than from what the map drew, which a tile rounds by tens of metres far out. A
line's card states its length and an area's its area and perimeter, at its foot
in the analyst's units, measured on the whole shape the file holds. A
right-click on a pin opens the map's own point menu on that point, headed by the
pin's name and its layer, since the pin is pressed on its head, well above the
ground it names. On a line or inside an area it opens on the ground pressed. A
place saved from that menu is the analyst's and carries nothing of the feature.
A description written as
columns is drawn as columns, one label and its value per row, because a My Maps
keeps its fields in a table and a table flattened into a paragraph is unreadable.
Addresses in it are links, and they open in a new tab: a feature sourced from a
post is read by opening the post.

The row states five things:

- **Where it came from** — the filename, the host, or Google My Maps. A followed
  map is a page somebody publishes, so this is a link to it: the one thing on the
  row that leaves the app, and it leaves on a click.
- **How fresh what is drawn is.** A file says when it was opened and nothing
  more: it is exactly what was dropped in. A followed map says when it was last
  read, and says *out of date* when that was long enough ago to matter, so before the
  marks are read, not after.
- **Both counts.** `3 200 features · 412 shown` whenever a group is switched
  off. The number drawn never passes for the number loaded.
- **Its legend, which is the filter.** One row per group with its colour and its
  count; clicking one hides exactly those features and keeps them loaded. A KML's
  groups are its folders, which is how a My Maps is built; a GPX's are waypoints,
  tracks and routes; a GeoJSON states none, so the file is one group named after
  itself rather than a grouping guessed out of whichever property looked like one.
- **Its dates, when it has any.** A layer that is on and whose features are
  dated (GeoConfirmed's events, a KML's TimeStamp or TimeSpan, a GPX waypoint's
  time, a Detect snapshot's passes) draws its events over time as a strip of bars
  under the counts: a bar a day for up to three months, a week for up to two years,
  a month past that. A feature spanning days, a TimeSpan or a Detect change, counts
  in every bar it meets and is in any period that meets it.
  The period is set on the strip itself. Drag across the bars to draw one, drag
  either handle to move a bound, slide the band between them, or click a bar to
  keep its day, week or month. Clicking one of the two dates under the strip
  opens a calendar; the arrow keys move a focused handle by a day, Page Up and
  Page Down by a week. The map, the counter and each group's count follow while
  the strip moves, and the period is kept with the legend when it is let go. A
  bound left on the layer's own first or last day stays open, so a followed
  layer's new events are not filtered out by a period nobody narrowed. An
  undated feature is outside any period. A double click on the strip, or the
  cross beside the dates, lets every date back in, and so does picking a search
  match outside the period.
- **A search, in the legend's own slot.** Typing puts the matches where the
  groups were, and the two are never on screen at once: the legend is the filter
  the case keeps, the search is a way of looking that leaves nothing behind. The
  counts above it do not move while somebody types. Names and groups are read,
  never descriptions, which on a layer of a hundred thousand features would be
  the most expensive thing in the app for a gain nobody asked for. Picking a
  match takes the map to that feature and opens the card a click on it opens. A
  match from a group that is switched off is listed all the same, marked, and
  going there switches it back on. The box is offered while the layer is drawn;
  one that is switched off has nowhere to send anybody.

**The source's own colours are always honoured; its icons are, if asked.** The
add dialog carries one tick per half, *Use the map's own icons* — off for a file,
on for a followed address, which is the same line the rest of the app draws:
following a pasted link already reaches the network, opening a file off this
machine does not. It is asked there and not on the row because there is the
moment the request would be made.

Ticked, each distinct icon is read once — out of the KMZ, or off the web by the
backend — tinted the colour its style asked for, held to one size **measured on
what is painted rather than on the image around it**, and stored in the case.
What the map loads is a picture from this machine; **the browser never asks the
source's host for anything.** A My Maps draws in its creator's own pictograms,
and it draws offline, and it draws the same after a bundle import; a followed My
Maps carries its icons inside the file it is fetched as, so most of them cost no
request at all.

Unticked, or when an icon cannot be read, the pictogram is the app's own: a pin,
a line or an area, each with a **white edge**, since a colour picked against
somebody else's basemap has no reason to read against this case's imagery. That
is also the fallback, per icon rather than per layer — one image that will not
load costs its own marks their picture and nothing else, so there is no switch to
find when something looks wrong. Nothing in the
layer is labelled on the map; a feature's name is in the hover and in the card.
Far out, where the marks would be a solid mat, the map keeps only those that fit
and draws the rest as dots, so a dense layer never looks emptier than it is.

**A row opens folded to one line**: the switch, the name, and Refresh and
Remove as icons, Refresh only on a followed map. Unfolding it shows where it came
from, how fresh it is, the counts, the time strip and the legend. A folded row
still says when its copy is stale, with its name in the warning colour and a
mark beside it. Every row starts folded on every visit, except the one just
added. **The list is the stack**: the first row draws on top, and the grip left
of the switch drags a row to another place, or moves it one place with the arrow
keys. The order is kept on each layer, and a new layer lands on top. Added
layers stay above the app's own overlays whatever their order. The section head
carries one more Refresh, for every followed layer at once, read one after the
other with a single toast at the end.

A followed map is re-read
when it is added, when Refresh is pressed, and the first time it is switched on
by hand after the app or the page opens — never on a timer, and never while it is
switched off. **A case opens again on the added layers each map had on**, kept in
the browser rather than in the case, and put back one at a time, each once the one
before is drawn. One put back draws the copy on disk and asks its source nothing. A
layer the last session was still drawing when the page died stays off, and a toast
names it, so a layer heavy enough to take the tab down does not take it down again
on reload. One whose features cannot be read or drawn is switched off with a toast. A read that finds
nothing new rewrites nothing, a read that fails leaves the last copy on the map,
and the copy the layer was drawn from is kept in the case, so it draws offline and
travels in the bundle. Removing a layer takes that copy with it, to the trash.

**GeoConfirmed** is the third way in, behind *Choose a conflict* in the add
dialog. Its own dialog reads GeoConfirmed's conflict list when it opens, then
asks for one conflict, a window (7, 30 or 90 days, a year, the whole history, or
a range of dates), and whether to keep to the area in view. A number of days
counts back from each read, so a layer of the last 30 days stays that; a range
stays put. The whole history (60,000 events for Ukraine) is read again only on
Refresh, never just because it was switched on. The layer
wears GeoConfirmed's own icons, which come inside its export, with no tick to
ask for them. Its groups are the conflict's factions, read off each icon's
colour, and factions GeoConfirmed paints alike share one row. An event is named
by its date and its first line, and its card keeps the sources and the
geolocation as links. The reference sites GeoConfirmed sends whatever the dates
(bases, plants) are grouped as *Undated sites* and start switched off. The row
says *GeoConfirmed*, or *GeoConfirmed · limited area*, and links to the
conflict's map on geoconfirmed.org.

A date is picked from a calendar the app draws, in the panel rather than over
it. The browser's own opens at its own size, in its own locale, and half
outside a panel docked to this edge — and a field reading `12/09/2026` in an app
that writes `2026-09-12` everywhere else is a date nobody can check. The month
pushes the rows under it down, walks month by month between the bounds the
service accepts, and greys the days outside them. The extension's panel draws
the same calendar from its own copy of the arithmetic.

**Sun & moon** draws one date's path from an anchored point: the arc each body
sweeps while it is up, hour ticks along it, and the bearing at an hour you drag.
Only azimuths are drawn, since a plan view cannot state an altitude. Height reads
instead from where the body's own mark sits on its ray: the anchor stands for the
zenith and the arc for the horizon, so a high sun rides close to you. The mark
names its altitude on hover, carries the moon's phase, and is absent while the
body is under the horizon. The anchor is a point and not the map centre, so panning
leaves the path alone. Coords & Sky opens the same mode with its own point, date
and time, and hands over no computed value.

**Coords & Sky opens on the point the map is on.** The map publishes the point it
records — its moved pin, else its centre — once it has been moved off the view it
opened at, and the tab converts that point rather than opening on an empty field.
Compare and Detect publish their centre each time they come to rest, so the tab
reads whichever map was looked at last.
A view nobody has moved yet is a setting rather than a finding, so it offers
nothing. The conversion is local and that is all that happens: naming the place is
a geocoder call, so the row offers **Name this place** instead of making it.

The tab **follows the map** rather than filling once: the map moving is you looking
somewhere else, and a tab still reading the point before it answers about the wrong
ground. Between two moves the field is yours — what you typed, or the point you
picked out of the case, stands.

The saved-work layer answers two questions under its own switch: **what kind**
(Media, Places or Captures) and **which folder**, offered only where the
case has more than one to choose between. They are the Saved panel's own
filter, so a map read here and the panel beside it can never disagree about
what the case holds, and the layer's count is what is drawn rather than what is
filed. It is on in a case that never switched it off, on the Media
position, and its switch is kept per case with the other layers.
Places draw as outlined pins, captures and screenshots as filled ones, located
files as white-ringed ones, items at the same spot collapse
into one counted mark, and clicking a mark of saved work opens a card
with its preview, provider, dates and note. A mark of files has no card: it plays
them in the panel. A mark whose capture carries proofs
wears a dot up-left, and its card names the count. Hovering a card, a tree row or a search result
lights the others.

A card also holds the point's relations. The Saved index carries their count only,
so a stack of five marks is never five requests: a lone mark opens its relations
straight away — clicking a place to see which photos claim it is the point of the
gesture — and a stack waits to be asked. A point enrichment proposed from a file's
metadata is marked `suggested` in both the card and the tree, so a camera's reading
never passes for analyst work. The Save-place dialog carries the matching write:
one **Relations** field says why the point is being saved while the analyst still
knows.

**A place's card traces its footprint.** A pin dropped on a guess is what this
fixes: "somewhere on the north quay" is a quay, and the case has always been
able to hold that shape — until now the only way to fill it was to paste
GeoJSON into Details. **Trace footprint** on a saved place arms the map, clicks
drop the corners, and the panel names the place the whole time, counts what is
missing and takes back the last corner. Nothing is written before Save, so
Cancel leaves the place exactly as it was, and two shapes are refused here
rather than by the store: one under three corners, and one that does not contain
the pin it belongs to. Saved, it draws under its pin like any other footprint,
and it replaces whatever said how precise the point was — its earlier shape, or
the circle a radius drew. The panel names what it is replacing before Save, and
a radius typed back over a traced shape asks in Details before dropping it: the
map draws one of the two, so a place states its precision once.

**The place dialog hands over to the full editor.** Title, folder, note and
*Relations* are what an analyst fills at the moment of saving; how precise the
point is, the source's own wording and how the point was found are edited in the
panel every other surface opens. **Edit more details** on an existing place opens
that panel — the same body as the case sidebar — and asks first if the short form
holds something Save has not taken, since the panel opens on what the case holds.

**Esri Wayback is a basemap of every World Imagery release.** Picking it puts a
chip beside the provider naming the release on screen, and the chip opens a
slider through time, oldest left, with a step either way and the list under it.
The list opens on **Every release**, dated by publication from the one release
list Esri serves; the pill under the chip dates the pixels on screen, one
metadata request for the release showing. Neighbours often look identical,
because Esri republishes a mosaic where nothing changed.

**Changes here narrows the list to the releases that brought a new picture of
the tile under the crosshair.** Esri's tilemap says which release a tile really
comes from, and walking it backwards shortlists the candidates; a picture Esri
published again, re-encoded or re-coloured, is folded into its first publication
by comparing the tiles themselves, then the acquisition date and satellite their
metadata states. Each row then carries, beside its release date, when the
picture was taken. Narrowed to changes, the newest release is named by the
change it shows rather than by a date no row carries. **Imagery history here**
on the point menu reads the same history at the point right-clicked.

**A history is read only when asked for.** The walk is dozens of requests and
takes some seconds, so a moving map never starts one: a history that no longer
describes the tile under the crosshair says so, keeps its changes on the slider,
and offers **Read here**. A tile already read costs nothing for the session.
The picker offers nothing while a first history comes, since every release is not
what *Changes here* asked for, and **the chip itself says it is waiting**,
spinner and all, because the picker can be shut meanwhile. A history that fails
falls back to every release, which is the honest answer to not knowing.
The release rides on the provider id (`esri-wayback~64776`), so tiles are cached
and captures credited under it.

**Right-click the ground** and a menu acts on that point rather than on the
centre: copy it in every coordinate format, the analyst's own first; ask what
is there, answered inside the menu; save a place there; start a distance from
it; anchor the sun and moon on it; open its Wayback history; centre the map
on it; compare it across time; or open it in Compare, in Detect or in another
map site. A right-click on a shape that answers
its own (a search-grid cell) stays that shape's; on a pin of an added layer the
menu is on the pin's point (see **Added map layers**). The menu flips away from the
map's edges, walks with the arrow keys, and closes on Escape, a press outside,
or a zoom that moves the ground from under it.

**Compare here…** asks an archive which two pictures of *this point* are the
last two, and opens Compare on the pair: Esri Wayback for the two releases that
changed it, Copernicus for the two most recent passes over it, and Copernicus
radar for the newest pass and the one before it on the same track. The last two
are offered only where Settings has what they need. The lookup happens before the tab changes, so
an archive that holds nothing to compare says so on the map instead of costing
the view. It says it is working for as long as it takes rather than for a guessed
few seconds: the walk through Esri's releases is slow, and a message that went out
halfway through left the map looking like nothing was happening. Compare receives it the way it receives a saved comparison — older on
A, newer on B — unsaved and unnamed, because nothing has been filed.

**Open in…** lists the app's other map tabs first, then the maps outside it. A
tab opens on the point at the zoom it was looked at: Satellite flies there, and
Compare and Detect move their camera and keep their own pictures and work. In
Detect a point asked for this way wins over the case's landing frame. Changing
tab, from this menu or any other way, leaves full screen. Leaving it, however it
is left, keeps the ground and zoom the map reached.

**The map tabs share one camera.** Satellite, Compare and Detect look at the same
ground: a map leaves the window's camera where it comes to rest, even when its glide
ends after you switched tab, and a map tab that shows takes it in one move, turn
included. A hidden map never moves, so it loads no tiles and asks Copernicus nothing
for ground nobody is looking at.
A map whose imagery stops short of the shared zoom lands at its own ceiling and
leaves the deeper zoom standing for the tab that has it. Detect follows while a
result is under review, keeping its candidate and imagery. A saved comparison
follows like the rest, and moving it leaves it saved; Save keeps the new view.
Horizon shares where it stands: once its eye and its look rest, the other maps
look from the eye, turned to its heading, at the zoom they had, and Coords & Sky
reads the eye. Satellite draws that eye with a dashed cone. The eye itself never
moves for another map, since a photo may be matched on it: when the other maps
look more than 1.5 km away, Horizon's map offers **Move there**, which opens the
large map on that ground for a click to stand. While no eye stands, Horizon's map
follows the others like any map tab.
Switching case leaves the camera where it is, since a view is not case state.
Settings → General → Map tabs turns it off, and each tab keeps its own camera again.

**Every map offers the same layers.** Satellite works them in its panel. Compare,
Detect and Horizon's small map list them in a **Layers** menu with the Map's own
rows, an eye each, under headings that fold: Reference, Events, Case, then the
Map's own two, My layers (drawn in the case, listed once there is one) and Added
layers (imported). A folded heading stays folded the next time the menu opens. Each map keeps
its own switches, so a layer is drawn only where it was switched on. **A case opens
again on the layers each map had on**, kept per case in the browser, never in the
case or the settings backup; a case that never switched one opens on that map's
defaults. The fires and the night lights are not kept: they show a day, so each
session starts with them off. A deleted case takes its kept switches with it. A layer that
asks a question shows its settings under its row once it is on: Saved work asks
Media, Places or Captures, on Media first as on the Map. The fires
and the night lights start on the day of the picture on screen where the map
knows it, and on the last 24 hours and the last night where it does not. Added
layers are added and worked in Satellite; the app reads each one once, and only
the tab on screen draws it. While a tool holds the pointer (a measure, a pin, an
area being drawn, Horizon's eye), a click on one of their features goes to the tool.

**Every map turns the same way.** A middle-drag, or Shift and the left button,
turns it like a wheel about the point grabbed: a dashed circle marks that point,
and the map follows the angle the pointer sweeps around it outside the circle.
Inside, the map holds, so the pointer can cross the middle without a flip. Near
north it settles on north, and Ctrl held lays the turn on 15° steps. A middle click puts north back up, as does Shift+↑;
Shift+← and Shift+→ turn a step. In Satellite a double click held down on its
second press turns the map too, for a hand with no middle button, unless a tool
is reading the clicks; a double click that stays put still zooms in. The Move the point dialog in Geo Proof turns
the same way, and Inspect's frame viewer takes the same drag, with a middle
click standing the frame upright.

Horizon has three modes on one switch at the left of its header: **View**, the
terrain from the viewpoint; **Overlay**, a photo laid over it there and matched
by hand; **Find**, an area of the map searched for where the photo was taken.
Find carries a **Beta** pill while its search is still being tuned, and its
first opening shows the beta notice. docs/FIND.md is the user guide: where Find
is strong, where it fails and how to use its tools.
The photo and its trace are the same in all three, and View only hides the
photo. The mode is in the address, so Back returns to it. A reload opens the
tab on its map. The work no save has kept yet (the viewpoint, the photo, its
trace, Find's area and alignments, the mode) is kept in the case and offered
at the foot of that map: **Resume** lays it back, **Discard** lets it go, and
anything started instead replaces it. Work a saved view or a search keeps is
not offered; Open has it. A link that names a viewpoint still stands there.

The inspector under the small map is grouped by what is asked of the view.
**Measures** holds the marked point and the ground clicked in the view.
**Viewpoint** holds where the eye stands and how high, then the camera: its
width, the frame, tilt and roll. **What the view shows** holds summit names,
ridge lines, buildings (marked Beta), the sun and moon, the haze and the
nearest ground drawn. The view's credit line and every picture of it name the
building sources drawn as each asks: 3D BAG's makers, Overture and OpenStreetMap
under ODbL with the copyright page's address in print, 3D-GloBFP's paper. In Overlay, the **Photo** group says everything about
the photo: its file (another one, or none), what the file says, the lens's
curve, the trace (undo, clear), what you know about it for Fit, and the places
Fit found when none stood out. The band over the view keeps what is done on
the picture: the photo and terrain slider, Blink, Side by side, the pens,
Detect, Reshape, the gap and Fit.

The trace is edited with the same tools in Overlay's band and on Find's photo,
one out at a time: the **Skyline** pen (T) for the edge against the sky, the
**Ridge** pen (R) for a ridge seen against farther land, drawn cyan, the **Sea
line** pen (S) for the sea's horizon, drawn in blue dashes and searched where the
sea's own horizon stands from the eye's height, **Behind**
(P) to pair a line in front with the line behind it (a letter filled on the
front one, ringed on the back one), **Cut** (X) to cut a hand-made collage
where its frames meet, **Distance** (K) to say how far a line stands (pick one
or several of < 1 km, 1–3, 3–10, 10–30 and > 30 km, then click the line; its
distance shows under it), **Sky only** (O) to say a skyline line has only sky
above it, sure of it (a click on the line, again to take it back; "Sky only"
shows over it), **Key line** (I) to say a skyline line matters most, a peak or
a notch known anywhere (three at most, "Key" shows over it), **May be bent** (G)
to brush over a part of the picture that may be bent, a wide lens's edge or a
piece stretched while laid (an orange wash; a click on a brushed part takes it
away), **Far land hidden** (F) to brush over the stretch of skyline where haze
or the night may hide land behind it (a pale blue wash: the line under the brush
is read as a ridge, laid on any of the terrain's silhouettes rather than its
outermost), and
the rubber (E).
The **magnet** (M) says whether a
line drawn snaps onto the photo's nearest edge; Alt does the other for one
stroke. A click with a pen on a line makes it that pen's kind, and a skyline
stroke lying under another one is read as a ridge, as is a trace saved before
ridges had a pen. Fit lays the skyline strokes alone on the terrain, and Find
also reads the ridges against the terrain's inner silhouettes and the pairs'
order. Both let each piece of a cut collage turn, tilt and roll by a degree or
so (on a panorama a piece rolls about its own middle), and the view then reads
each piece through its own camera. A line with
only sky above is laid on the top of the land the photo would show over it, and
a place where land still stands over it loses its score as that share of the
line grows, read as far as **Sees as far as** says, past where the line is
searched if need be. Left to Auto, land counts in full out to three times as
far as the ground the line lies on, then less and less out to six times as far,
since haze grows likelier to hide it. Only land standing behind the ridge the
line lies on counts, half as far again or more: that ridge a few pixels over the
trace is its own crest drawn a little low, not land behind. A place keeps its
score up to a fiftieth of the line under land and is ruled out past a tenth; it
says the share and how far out that land stands, on its point of the map too. A
place that explains the whole trace better than it lays the key lines loses
half the difference. Where no line is marked key, the trace's sharpest quarter, its
peaks and notches, is held the same way. The lines in a part brushed as bent count a quarter as
much, and that part never sinks a place on its own.

Find's side has two faces. **Prepare** numbers the four steps a search runs
through (Skyline, Area, Mesh, Search), each lit once done; the warnings about
the lens and the reach sit by the Search button. **Mesh** is the grid before it
is searched: how many points and how far apart, Auto's **Grid** row, and a
line for each thing the photo rules points out by, with its share and an × that
takes the hint back. When water is said to show and lies within reach of
points, Mesh offers **Check the view**: rays are walked from each such point
toward the water (the terrain raised 20 m for trees and its own error), the
time said before it starts, a count while it runs and **Stop** keeping what was
checked; the points the land hides the water from turn grey on the map, "Water
hidden by the land" on hover. Unchecked, the search checks them first, and its
step says how long that adds. A skyline standing high or low in the
frame offers **Looking down** or **Looking up** when the camera must tilt about
as far as is searched for who took it, or past it, and a picture read as one across 90° or more offers
**Cut**, since its ends drift. Where the relief is the planet's 30 m model, the
Skyline step offers **Round near lines**: the trace and the terrain are judged
rounded alike where the ground stands nearer than 3 km, the nearer the rounder,
since a near ridge's teeth are in no 30 m relief. **Help the search** folds the optional
parts, the alignments and what you know about the photo (who took it, which
way it faces, the ground the eye stands on, how the camera looks, the zoom,
the reach), each with its gist on its title line; an alignment being made
unfolds its own. **Facing** is a compass: tick one or several of the eight
directions, **Any** in its middle for none, and the map draws them as a fan
from the area, ringed at 2, 5, 10, 20, 50 and 100 km out to the reach searched.
**Eye on** ticks a summit or ridge, a slope, a valley, a plain or the sea or a
lake, each judged on the ground round the point; the map shows the grid in
those colours, grey where a point is left out, and says how many points stay.
**Eye stands** says the eye stood **Above the land round** it or **Below it**,
against the land 1 to 3 km out, and **Water** that **The sea** shows (within
the sea's horizon from each eye, as far as a mountain top sees it, no line to
trace: an island is traced as any skyline) or **Sea, lake or river** (within
the reach): the points it rules out are greyed, a hover saying why, and the
Mesh step says how many each leaves out. A line traced along the sea's horizon
says the sea too. The sea, the lakes and the rivers wide enough to be drawn as
water are the map's (OpenFreeMap's water, read once and kept), else the
terrain's flat ground when the map cannot be reached.
**Camera** opens the tilt down (**Looking down**, from a height) or up
(**Looking up**, at a summit), and **Selfie** searches the trace mirrored too.
**Sun** says where the sun stood against the camera (ahead, left, right,
behind) on a day between two local hours: the app turns it into the headings
left, with the compass's, and draws them in the fan.
For a video, **Measure from the video** reads the lens off the frames around
the moment on show, where the camera pans; Fit then keeps it and Find allows 5%
either way, since a stabilised video crops. The zoom
words are a phone's (×0.5, ×1, ×2–3, ×5+), read across the picture's own shape, and take several ticks in Overlay as in Find: the search tries from
the narrowest to the widest ticked, and none ticked is any lens. A line given a
distance is searched only on ground that far, which also sets how far the turn
is read and how fine the grid is; lines given none are kept off the ground at
the eye's feet. A collage of a pan Azimut stitched is read frame by frame, each
frame through its own camera at the stitch's lens, held level as the collage is
laid (the stitch's own level drifts on a few frames). The lens or span a stitch
says is what joining the frames worked out, so Find searches it 20% either way.
Looking from a place a
search found lays the photo as the search read it: a collage's frames, or a cut
collage's pieces, each where the search put it, and a selfie found mirrored
flipped. **As searched**, lit in the band over the view, lays it flat again, as
does taking a tool out or pulling a corner; the trace follows the photo, so
what shows is what the search scored. **Result** shows
the search on show: its name, when it was made and what it was asked with, its
progress, verdict, how far the best place can be trusted (**Solid**, **Check
it** or **Weak**, with what lowers it and the score the area reaches by chance)
and places, each with the area's chance score beside its own. What lowers it
says what does not fit there: what the place explains without the lines'
distances, Sky only, pairs and key lines when they cost it much, a piece of a
cut collage that fits badly (eased as far as a piece may go), land rising over
the Sky only lines. When one of these is about the lines, **See which lines are
off** looks from the best place, where each line off the land shows by how
much. A panorama is tried 60° wide and up and never leaned, so one whose lens
sits at that floor, or that little explains, offers **Read as a photo**: zoomed
frames, or a collage that leans, span what a photo spans. Where no place
explains anything, the map shades where the trace lies nearest the terrain.
**Check against
decoys** tries the places again with the trace mirrored and upside down: a real
place explains its own trace far better, and one a decoy fits nearly as well is
marked so. **Change and
search again** goes back to Prepare with the search's setup. The case's
earlier searches are in the **Open** menu of Find's header, as cards with the
photo, when each was made and how it ended; opening one replaces the setup on
screen. Arriving in Find without a photo, the dialog that asks for one shows the
same cards first (four, the rest behind **Show all**). **New** beside
it lets the photo, its trace and the setup go and asks for the next photo,
asking first when no search keeps what is on screen. **Save** (Ctrl+S) keeps the
photo, its trace with its marks and the setup as a search of the case without
running it, "saved, not searched" on its card; it opens on its setup, and Save
again writes over it. The map shows the grid the
setup lays before the search and once the setup is changed from the search on
show. While a search runs, the points it has scored fill the grid in as cells
of the heatmap, coloured from the middle of the scores so far up to the best,
patch by patch, since each point starts from the camera its scored neighbours
found. Result names the
**Best so far**, three places apart, read roughly as a first pass reads them
(the best are read again in full at the end). A
click on a cell, or a press on one of them, tries the trace there in full and
offers to look from it, saying the skyline and the ridges apart where both were
judged (**Fit** in the view reads the skyline alone, and says so). Looking from
it, the view settles on the trace from where the search left it, never round to
another heading, a toast taking that back unless the search laid the photo itself
(a collage, a mirror). Find keeps its map under the other modes, so coming back
lays nothing again, and the 3D view under Find rests meanwhile. A band over the
view asks **Is it the place?**: **This is the place** keeps the view in the case and the place on the
search, which stops it, a green mark on the map and the first thing Result says
(**Not it after all** takes it back). **Stop** keeps what the search scored by
then: its map and its best places, said to be what it had scored, not judged.

The Area step adds **Another area**, searched with the first on the same grid
(twelve at most, 10,000 km² together), **Finer zone**s, each searched on a grid
of its own (Auto is a third of the area's), and **Leave out** zones never
searched, drawn dashed red. **Brush** passes over the grid while the map holds
still: **Off** greys the points it passes over, so they are not searched, and
**On** turns them back on and lays white points where it paints ground in past
the grid, all as the hand moves, however large the grid (each point restyled
where it is drawn, the grid never sent to the map again); Alt paints the other
way for a stroke, each stroke over the ones before, and the app's grid then
lays the new points where the brush showed them. It reaches 50 m to 2.5 km
either side, a ring under the hand shows how far, and Ctrl+Z or **Undo** takes
the last stroke back. An area or a zone goes up to
10,000 km². **Try a point** tries the
trace from a place clicked on the map, as a search scores its best places, and
offers to look from there. No time is said before a search, which depends on
too much to hold on every computer: the search says the time left once it has
run for 20 seconds, close from about 30 and short late on, when filling in the
relief that stands near adds points. Each
choice says what it gains instead: Mesh's **Grid**, Auto's grid **Quick** (twice
as wide, a quarter of the points), **Normal** or **Thorough** (about three times
the points), each against Normal, and the Search step's **Speed**, a large grid
searched on every core of the computer (**Fastest**, its own cores counted, not
their threads), on up to four (**Fast**, the default) or on one (**Gentle**, the
computer left free), each against Gentle and for the cores this computer gives
it: two processes search about 1.5 times as fast as one, four 2.5 times and
eight 3 times.
**Grid** under More settings lays a
point every 20 m to 1 km, or Auto, about 4,000 points over the area:
20 m over a square kilometre, 50 m over a few. The points stand in a
hex lattice, as close to every spot as a square grid that fine with a quarter
fewer of them. A grid picked is laid as picked, the map showing it before the
search and the estimate saying its points, up to 100,000; past
that it is laid wider, and Find says how wide. A search run again over the same
ground reads back the skylines it swept (kept beside the terrain, a gigabyte at
most and less on a nearly full disk) and only matches the trace again.

Find's map has the small map's **Layers** button at its top right: the base
map, then the same switches, so a layer turned on in Find stays on in Horizon.
The case's layers and saved work are drawn under the area to trace it by, and
let a click through while the area or an alignment is being drawn.

Find's photo shows as the search reads it, straightened from its lens's curve
and between its corners when Overlay pulled them. **Lens curve** on its
toolbar sets the curve there, as Distortion does in the inspector. The
strokes, cuts, pairs and alignment points stay on the photo's own pixels, so
they follow it as it straightens, and a search keeps the curve and corners it
was read through. **Picture** in What you know reads any image as a Photo or a
Panorama, the same degrees per pixel all along as a phone's sweep, so a
hand-made collage of any shape can be searched either way; a wide one is
pointed to Panorama. Find never tries a panorama of unknown width wider than
its picture could span, no more than 110° from top to bottom. A panorama of unknown
width, frames laid side by side by hand or a phone's sweep, is also read two thirds
to one and a half times as tall, and each place keeps the height that explains
most: the trace's colours and the terrain's line read the photo at it, and Find's
look lays the picture taller or flatter. **Taken** says who
took it: On foot, **Roof** (from a roof or a terrace; **Floors** says how many
floors up, 3 m each, one when Roof is picked, and the eye stands from that roof to
2 m over it; Floors left empty, the eye is 3 to 10 m over the ground), Drone or
Aircraft, the last two with the heights they flew at.

An alignment is made by four clicks, the near thing and what stands behind it
on the photo, then both on the map. What the next click is for is said in the
column that waits for it, which is outlined, so the columns never move between
clicks; each point shows as soon as it is placed, in the alignment's own colour
and number. Two clicks within a hundredth of the photo's width count as lined
up even when its lens is unknown.

Over a matched photo the view keeps to two lines: the trace, green where it
lies on the terrain, amber near it and red off it, and the terrain's skyline
in white, each piece of a collage where the search read it. A skyline line
lying off the terrain says by how much on a red badge ("2.4° above the land",
"No land there"). A legend under the
view names every line it draws, the terrain's own ridge lines and the eye's
level included. **Details** (D) adds the band the terrain's skyline may be off
by (wide over a near ridge), the cuts and the pairs' letters, which also show
while a tool is out. **Side by side** draws the photo above the terrain through
the same frame, on demand, with a line down both that says the direction under
the pointer, and saves the pair as a picture. A collage cut for a search shows
its terrain **Piece by piece**, as the search read it: each piece through the
camera the search found for it, the seams dashed on both, and the piece under
the pointer says how far it was turned, tilted and rolled. **One camera** shows
the terrain whole, and the picture saved is the one shown.

Horizon offers these controls and the place search on its large map and in
Find, including its three-column view. The small map
at the top right keeps its compact controls. Searching in an enlarged map or
in Find moves the map; choosing coordinates while picking or moving a viewpoint
stands there.

**Compare here…** and **Open in…** are the two rows that open a list, and they
open it *beside* the menu. A list unfolding inside would make the menu taller, and a menu already
placed against the frame's edge answers that by moving — which slides the next
row out from under the cursor that was about to press it. So the menu is placed
once, from its measured size, and never again: the submenu flies out to the
right (to the left where that would leave the map), pushed up rather than clipped
when the row it hangs from is near the bottom, and anything else arriving late —
the answer to *What is here?* — scrolls inside a menu that stays put. `→` opens
it, `←` closes it, Escape leaves the submenu before it leaves the menu.

Those external maps are **only** here. They used to be listed in the panel as
well, at the map's centre; the same list on the point you actually clicked is
strictly better, and two of them was the same thing said twice.

**The map opens in as many tabs as there are screens.** `⧉` beside the title
opens this map again in a tab of its own, on the view it is showing — a tab
rather than a pop-up window, because a tab can be torn onto the second screen
and put back, and is what a browser does not refuse. It opens on the map alone:
the workspace rail, the case bar and the tab strip are how you get somewhere
else, and they stay in the window they belong to. It is still a whole map, and
the tab it left is not greyed out: a read-and-work surface takes as many windows
as are wanted, while a document editor (Geo Proof, Notebook, Sheet) stays one
window per document.

What is per window is the camera: where it is pointed, at what zoom and bearing,
over which imagery. That rides in the window's own address
(`#satellite?ll=48.8566,2.3522&z=17&b=215&p=esri`), which is what makes a reload
come back to the same ground and a view worth keeping as a link. An address is
something a person can type, so a coordinate or a zoom it cannot vouch for
leaves the map where it was rather than flying it nowhere. Panning rewrites the
address in place: a back button holding four hundred camera positions would be
worse than none. It is written once a move ends, a turn or a tilt included, not
at each step of it. Everything else — the case, its saved points, a sweep in
progress — is shared already, below.

A detached tab carries its number in its title and beside its search, because two
identical maps on a second screen cannot otherwise be told apart, and `solo=1`
in the same address, which is what keeps it the map alone across a reload. The
first window is unnumbered. The browser can refuse a second tab, and says so.

**⛓ points the tabs at one camera.** It is greyed until a second map tab is
open, because linking one tab to nothing is a button that does nothing — the
tabs say hello to each other on the same channel the camera travels on, and a
link already on is dropped when the last of them goes. Pressing it hands the
other linked tabs this tab's view, and from then on a pan or a zoom in any of
them carries the rest. It is per tab and off by default: two maps are worth linking while they
are being compared and in the way of each other the rest of the time. Two
linked tabs on two providers complement Compare on a second screen — and the camera
travels between tabs of the same browser, never over the network, because a
view is not case state. The extension's map tools join the same link from
Google, Bing, Earth and the other sites they draw on: an open panel counts as a
second map, follows this tab's camera and leads it (`extension/README.md`). A
panel in a background tab keeps the view until that tab is looked at, because
following one costs those sites a reload; the app's own tabs have none to pay
and follow wherever they are. While the map tabs share one camera, the link carries
that camera rather than Satellite's own: a pan in Compare or Detect reaches the
other windows and the extension, and a view arriving moves whichever map tab is on
screen.

**The map keeps up with the other windows on the case.** A point saved, a grid
drawn or a cell swept from the extension's panel over another map lands here
without a reload, and the same the other way round. A sweep worked from both
keeps both hands' marks: what is written is the cells that were marked, never the
grid around them. A grid discarded elsewhere closes here and says so.

**The extension's panel lists the scenes to geolocate** under its Capture, open while
none is being geolocated, folded to one row behind the pill while one is, and absent
when there are none (`GET /api/ingest/scenes`). Geolocate there
(`POST /api/ingest/geolocating`) holds the scene's video over the other site's map,
paused on the scene and each of its passages marked on its bar in its colour, and a pill names it, counts
what it was given and stops it. Each row, and the pill, carries the scene's two counts as
the app's do: the map's captures by the map's icon, its video's frames and collages by the
video's, a picture giving itself by the picture's, a count at 0 greyed, a row's pip marking
where it stands and the hover saying it all in words (`extension/maptools.js` mirrors
`lib/sceneCounts.js`). While it lasts, every capture filed in the case is attached
to it, the panel's included, and the capture's report says *Attached to “bridge?”*. A
picture reads *Whole picture*, with an image on its file's line, and Geolocate holds the
picture over the map with the scene's dot and no bar. The pill counts with the same pulse
as the app's, dots the scene in its colour, and offers **Make the proof**: the app's tab
comes to the front on Inspect's chooser for the scene, opening its case first through the
usual question about unsaved work, or a tab is opened at the paired address when none is.
Nothing is written from the map page. The extension's reference window carries the app's
pin back to the scene's start, beside the frame steps.

## Detect

**Detect sweeps ground and comes back to it.** It is its own tab rather than a
mode of Compare, because it is a different job: Compare reads two pictures side
by side, while Detect watches an area of Copernicus Sentinel-2 or Sentinel-1 over time. One map
is enough for that — a candidate's evidence is the before/after picture the column
shows, not a second surface — so the map is the ground you draw on and the pass you
are about to read, and the column beside it holds the work. Every detector measures
reflectance or backscatter, which a rendered picture has already stretched away, so
only Copernicus feeds it: Sentinel-2 for the optical analyzers, Sentinel-1 for the
radar ones.

Without a Copernicus key, Detect says so in the middle of its map: the account is
free, the recipe is there in two parts — the Sentinel-2 configuration whose ID is
the key, which brings its layers with it, and the Sentinel-1 layer added to it by
hand for the radar analyzers, field by field — and one press opens the Copernicus
card in Settings. The panel still opens on what the case already holds.

Detect opens on Esri World Imagery, with Borders and saved detections
visible, framed on the areas this case watches — once, after which the camera is yours. That
framing waits for the tab to show. Arriving from another map tab while they share
one view, Detect opens where that map was instead, since that is the ground in hand.
A case with no area opens where the other map tabs left the window, or on the home
view. A run under review keeps the map on it when you come back from another map
tab. The search, the compass, the ruler and SAT's
imagery/layer controls float over the map. There is no Detect header or
full-width bottom strip. Attribution stays in the map's corner and the scale stays
at bottom left; provider usage is a small chip beside the imagery selector. A pass
date appears only while reading that pass, and run status stays in the panel.
Leaving a pass restores the chosen basemap. Sentinel-2 and Sentinel-1 sit in the
imagery selector too, with their layer and day, so any Copernicus layer can be read
over the ground; neither is remembered as the basemap, and Detect opens on free
imagery.

Right-clicking the map, or a candidate, area or measure drawn on it, opens
Satellite's point menu, cut to what Detect can do:
copy the point, **What is here?**, **Measure from here**, **Centre the map here**,
**Compare here…** and **Open in…**, which lists Satellite and Compare first. While a finished run is under review, a point
inside one of its areas also offers **Add candidate here**, for a hull the
detector missed. The ruler under the compass, or `M`, measures a length: drag
from one end to the other, then drag either end to adjust it. The label reads in
the units set in Settings. `Delete` drops the selected measure and the bin beside
the ruler clears them all. Measures are a scratch aid and are not saved. Taking
the ruler up lets go of an area or a candidate being drawn, and drawing one puts
the ruler down.

The right dock has a Detect heading with collapse, **Analyzers** and **Full screen**
controls. Routines, Saved and Areas sit in a tab row below it, with New detection
at the top of the content. A second heading appears inside a routine, review,
wizard or library, where it carries Back. Full screen includes the dock. The
collapse button or `]` reduces the dock to an icon rail; pressing a tab reopens it and resizes the
map. Detect's basemap and collapsed state are viewer preferences carried by
Settings → Backup; its layers are kept per case like every map's. **Saved detections** and **Watched areas** are rows of
the map's Layers menu, under the case's saved work, and both are on at every visit.

Areas belong to the case. Each has a name, colour and polygon; its map label
appears when there is room, in the area's own colour. An area is grabbed by its
outline, like a drawn mark in Compare: inside it the map is still the map, so the
wheel zooms, a drag pans, and a middle- or shift-drag turns it about the point
grabbed, as on every other map in the app. Pressing an outline opens Areas, where
a row reads as the map draws it: colour, name, ground area and how many routines
use it. Pressing the row frames it, the eye hides it, and renaming, recolouring
or reshaping opens from the row's pencil rather than sitting in it. **Reshape on
the map** frames the area and puts its corners under the pointer; the panel says
how many routines watch it, since a routine reads its areas when it runs and its
next run sweeps the new shape, while a finished run froze its own copy and keeps
the ground it swept. **Save as a new area** leaves the old one, and the routines
on it, as they were. The tab also draws or takes the current view, shows every
area at once, and deletes. Deleting an area used by a routine lists the routines
that must release it first. A routine and a one-off run can share an area.
Older routines migrate their embedded zones to shared areas on first read.

Areas can be put in several named groups without copying their geometry. The
Areas tab lists groups in a saved order, folds each one, searches through folded
groups and keeps areas with no membership under **Ungrouped**. Dragging a group
or an area changes its displayed order; dragging an area to another group moves
that membership. The dragged row fades, a rule marks its insertion point, and
the destination group lights up. Its menu can add the same area to another
group, move it or change the order without dragging. Folding a group does not
hide map outlines.
Removing a group leaves its areas in the case.

**Share area** and **Share group** in those menus download the ground as a file
to hand to another analyst: the shapes with their names, their colours and the
folder they sit in, which no generic map format keeps. **Import**, beside
**Draw an area**, takes one into the open case. It reads Azimut's own area files
and nothing else, so nothing arrives that has to be triaged; a KML or a GeoJSON
from elsewhere is still added as a followed layer in Layers, which is a
different question. Nothing is written over: every shape is filed under a new
id, a name already in the case is numbered, group included, and the ids inside
the file only join a group to its areas. A group whose area was deleted sends
what it still has. A file a newer Azimut wrote still imports, with a line naming
the fields that went unread. What does not travel is the dates: the passes an
area is read on belong to the detection, so the analyst who receives the ground
picks their own. Older saved area sets become
groups on first read: shared outlines are reused, while temporary drawings and
outlines that have changed since the set was saved become shared areas with
their saved shapes. If a shared area's current outline differs from the saved
one, Areas asks which shape the group should use; Where holds that group until
the choice is made. Both areas remain in the case after the choice.

The list holds two kinds, and **New detection** asks which before asking anything
else, because the answer changes every question after it:

- a **one pass** sweeps each area's chosen or latest pass, once. It appears in
  **Saved**, under **One passes**, below the runs of each routine gathered under
  its name. Every finished run is drawn on the map from the start; the eye beside
  its trash hides or shows it, the one on a group's heading does the whole group,
  and showing frames the ground it covers. The layers button beside them snapshots
  what was kept or pinned into a SAT layer, a routine's heading into its one layer;
  a run with nothing kept says so and stays greyed. A change spans its two passes
  in that layer, so its date filter finds it in any period between them. A group
  folds shut from its heading; its colour square changes the routine's colour
  and its saved map overlays. A one pass has its own small colour square, which
  changes that run's saved map overlay.
- a **routine** is a place you come back to. It keeps its areas, its analyzer and
  what each pass compares against; it is run again whenever there is a new pass,
  and it remembers what it found.

A routine's card carries what it is for, its analyzer, its areas, its rule and
where its last run stands: the day of the pass it swept and how many candidates
are still to review, or how far a working one got. The play button opens dates
in the dock, **Run all** queues idle routines with their saved rules, and the title
opens the routine's own page. **Analyzers** is where the things a detection looks
for are made.

An open routine or run is drawn once, in each area's own colour, by the same
read-only overlay the list uses; the editable canvas belongs to the wizard and the
Areas tab. Hovering a routine draws its areas heavier.

A routine's page leads with **Findings**: every candidate it has kept, as a pin or
just here, newest run first, each marked **Pinned** or **Kept here** and a press
away from the evidence it came from. **Runs** beside it lists its passes, each
opening its own review. Opening any run shows only that run's saved overlay;
Back restores the saved eye states from before the review. **Run routine** opens dates in the right dock, with A and B
for every area. B is the newest eligible pass by default. **The pass before**
takes A from that area's last completed pass; the first run uses its chosen A.
Only areas with a newer eligible B are queued. If every area is current, no run
is created. The dock resizes from its left edge between 300 and 720 pixels,
while keeping room for the map.
The page also offers **Export as layer**, editing and deletion.

Either kind is built one step at a time: **Where**, **What**, **When**, then
**Start**. Only the current step shows, the next one opens once this one has what
it needs, and the reason it is not ready yet is written under the Next button.
Editing a routine opens on the last step, which reads the whole thing back with
each line a way into its step. Both kinds carry a name and a line saying what they
are for, and that line travels with every run they make.

**Where** offers the case's own areas first, as one list: each group a folded row
with a tick box that takes all its areas in or out, then the ungrouped areas, each
ticked on its own. The areas picked are listed under it. Drawing rectangles,
polygons or circles, or taking the current view as a rectangle, is for ground the
case does not watch yet. It prices the result before anything is fetched: ground
area and native tiles in Where, the Copernicus requests there too once an analyzer
is picked, and roughly how long on the last step. Each date costs two requests a tile, the picture
reviewed and the bands measured. A radar vessel sweep adds one for the Sentinel-2 water
classification it is judged against. One-off drawings stay temporary unless **Save as area** is pressed;
saving a routine promotes its drawings. A group whose areas are all in reads as
ticked even when they came through another group, and some of them as partly
ticked, so an area is never selected twice. A selection can be saved as a group; temporary drawings
become shared areas first. A routine keeps the areas selected when it was saved,
so later group edits do not change its scope. An area is grabbed by its edge: dragging inside
one pans the map as it would anywhere else, a click on the edge shows its corner
handles, and a press that does not travel selects without nudging the geometry.
Handles and outlines are projected from the ground, so they stay on it through a
pan, a zoom or a turn.

**When** asks its questions in the step itself. A change names **A**, the picture
before, and **B**, the one to look in. B is the newest pass under the cloud ceiling
set in **What**, below target size. After a pass lookup, the step names the chosen
day and any newer passes skipped for cloud, with their cloud percentage and limit.
**Date A** and **Date B** each open a calendar of available passes for that area.
Days without a pass or outside A-before-B order cannot be selected; optical pass
days show cloud cover, and radar days with multiple passes offer their times. A
chosen B is read whatever its cloud: the ceiling only picks the newest pass, and
ground under cloud is left out pixel by pixel. **Use newest pass** returns B to
automatic selection. Selecting A or B shows that image on the map at left,
framed on its area. The map chip names the area and side. Vessels and hotspots
read one image.
A routine names no B: it asks what each
run compares the newest pass with, **The pass before** (A serves the first run
only) or **A fixed picture**. For multiple areas, each area has its own visible
pass picker and dates; **Find passes** opens directly below that area's dates,
and a lookup selects and previews passes for that area. The
slot still missing is tinted, and the reason is written under the Next button.
When the two days see the sun at very
different heights, the step says how long a 10 m building's shadow is on each: past
half a pixel of difference most buildings read as changed, as a January and a
September pass over an airbase showed. The last step reads the choice back in
one line. A radar pass is a day and a UTC time,
since Sentinel-1 can see a place twice in a day from opposite directions: the list
shows each pass with its time and direction, and A and B must share
a track, so the rows on the other track are closed to the pair. A day typed by
hand is pinned to the pass on the other side's track at launch, and an automatic
pass is looked for on the reference's track.

Typing a date remains available inside each open calendar. **Find passes**
explicitly asks Copernicus about the areas
and counts one request a catalogue page against its quota, which is one for
most windows. The list shows coverage over all of them and the cloud of each
pass's 110 km tile, so a small area can be clearer or cloudier than its row
says. It looks 30 days, 90 days or a year back. The catalogue answers newest first and a
lookup reads up to five pages, so a list it still cut short offers **Older
passes**, one more lookup for the ones before the oldest listed. At launch, each area independently resolves its latest usable pass
under the cloud ceiling. Different tracks can therefore use different days.
A cloudier newest pass is reported as skipped. An unresolved area fails by name
without stopping the rest. Opening Detect reads
local state only; pass lookups happen only on request or during an explicit run.

**What** starts with nothing picked, so a detection never runs an analyzer nobody
chose. It picks the analyzer from a list grouped by what it looks for — vessels,
fires and burns, water and floods, buildings and earthworks, vegetation and small
marks, any change — with radar first where it reads the same thing better, and
your own after them. The groups start folded, the one holding the pick open, and a
folded group names the analyzer picked in it. The analyzer library folds its built-in
groups the same way. Each built-in says in brackets how far its reading can be
trusted, from what calibration showed: *reliable* (the published test, or a
contrast few false hits survive), *approximate* (right more often than not, with
known look-alikes) or *rough* (a lead to check). Radar vessels are reliable and
optical ones approximate, since a hull answers the radar through cloud and glint
alike; two radar passes read damage roughly. An analyzer that cannot run yet
carries a key and *set up*: all of them without a Copernicus key, the radar ones
until Settings has found their layer. It can still be picked and read about, and
the step says what is missing with a way to Settings. Nine ship built in, for big things and small ones:
vessels, fires and gas flares, construction and earthworks, small spots (impacts,
burn marks, vehicles), any surface change, burn scars, vegetation loss,
flooding or new water, and burned or destroyed buildings. Each reads its own band product, and each was tuned on real
scenes rather than synthetic ones: rough sea under glint, a dense anchorage under
cumulus, oil fires and wildfires, bright roofs, a construction site across seven
months, dry-season pastures. Vessels stand out from their own patch of sea in near
*and* short-wave infrared, which a breaking wave does not, and a candidate joined to
bulk land is a coast. What counts as sea comes from the water index or from the
classification, either one is enough: under sun glint the index alone read a whole
strait as dry. Fires take the published short-wave ratios on B8A, which
shares B12's grid. Construction is ground that moved the same way in every band
while its vegetation held, and burned or destroyed buildings are the same reading
darkening only, past a 9% drop: soot, char and wreckage, where burn scars need
vegetation to have burned. On pairs from Planetary Computer it took Hodeidah's
burned tank farm, an Isfahan depot and Beirut's blasted port warehouses, and gave
one to three candidates on quiet pairs of the same places; rain-wet ground is its
look-alike; a small spot changed while the ring of ground around it
did not, that ring read with a hole in its middle so the spot cannot sit in its own
background and over imaged ground only, past the area's edge too, so neither a
granule edge nor the area's own edge raises anything; a burn has to end dark, which a dried pasture does not.

Five radar analyzers read Sentinel-1 through the layer Settings → Imagery found,
and see through cloud and at night: vessels, any radar change, damaged or razed
buildings, new structures and vehicles, and flooding. They were calibrated on real
scenes: the Singapore anchorage, the Dover Strait, the North Sea in the October
2023 storms, the Belgian wind farms, the Bosphorus, Port Sudan's desert coast, the
May 2023 Emilia-Romagna floods and Gaza City before and after late 2023. A hull
has to stand out of the sea around it in both polarisations, which a strong
target's ghosts and sea spikes do not, and a weak return beside a much stronger one
is taken for its sidelobe. What counts as sea is Sentinel-2's own water class on
the clearest pass of the year before, because dry desert is as radar-dark as calm
water; the radar decides only where that pass saw cloud. In a large port a
terminal that Sentinel-2 took for water still gives candidates among the ships at
berth, which no mask tried could remove without dropping the ships too. A radar
change is the power of both polarisations averaged over ground, 45 m a step of the
size's averaging (90 m at Medium and All), and compared between two passes of one track: a
window counted in pixels held too few radar samples, and ground that did not change
came back as thousands of pieces or one region kilometres wide. *Bright* ground is ground that answered like walls on the
side that had them, and *water* is ground that went as dark as calm water. Two
passes only flag where to look: the razed-buildings analyzer says so, and the
flood one starts at Large, since a flood is fields wide. Without the radar layer
the wizard says where to find it and stops before its dates.

**Small**, **Medium**, **Large** and **All** come once an analyzer is picked, under
the list, and set the target size as a whole: floor and ceiling area, cleanup
and grouping together, since a small target needs no cleanup that would erase it.
What the chosen one accepts is written under the buttons in ground terms — a mark
outside that band is found and then dropped, which reads as "nothing found" unless
it is said. Every analyzer starts at **All**, no floor and no ceiling, because a
size taken without noticing hid an airbase's change behind Medium's 20 ha ceiling;
radar flooding alone starts at Large. **All** keeps the radar's 90 m averaging.
A size pressed holds for the next analyzer picked, and tuning any of those by hand
leaves no size selected. The **Clouds & shadows** switch reads Sentinel-2's classification, grows a
real cloud into the unsure pixels touching it, ignores classified "clouds" too small
to be one (white hulls and roofs), and casts each cloud away from the sun to find the
shadows the classification missed. The fire detector offers no switch: its band
ratios reject cloud already. Thresholds open from a link rather than sitting in
the way, and tuning them there changes this detection only.

**Analyzers** lists the built-ins and your own, shared by every case; one of your
own with checks says under its name how they last came out (**3 checks · all
pass**, **1 fails**, **not tested**). **New analyzer** asks what the analyzer
reads before anything else: **Sentinel-2 · optical** or **Sentinel-1 · radar**
(which says what it needs while Settings has no radar layer), and **One date**
or **Two dates**. That is fixed for good, so its rules and checks always fit it:
the builder shows it as a locked chip, offers only the measures and dates that
fit, and another satellite or number of dates is a new analyzer. A saved one
that never declared it gets it from its rules, once. The same screen offers
**Blank**, starting on brightness in True colour for optical data, and the ready
examples that read the same thing: a fresh burn (Lahaina, August 2023), a forest cleared (Grünheide,
2019 → 2020), water drained (the Kakhovka reservoir, June 2023) and a solar farm
built (Dubai, 2019 → 2023) on two dates, ships at anchor (Fujairah, one pass) on
one, each with its checks. A press copies an example into the library at once,
checks and all, under a free name, and opens it with its first check on the
map. A built-in opens read-only with **Copy to tune** (and **Open as rules**
where it has them, which is burn scars, vegetation loss and new water): the copy
keeps its calibrated method while its name, sizes, thresholds, candidate label
and colour become yours. Your own can be edited, shared or removed from the
list. **Share** downloads the analyzer as a file to hand on: it carries the
rules and none of your keys, which is what a settings backup cannot promise. One
with checks asks first whether they go too, since they let the other analyst
rerun the calibration and they carry the places and dates it was run on. Their
last result stays behind, so the analyzer arrives having proved nothing yet.
**Import**, beside **New analyzer**, takes one in and never writes over what is
here: an id already in use is re-minted and a name already taken is numbered. A
file a newer Azimut wrote still imports, with a line naming the fields that went
unread. A check reading a Copernicus layer this machine has no script for is
named the same way, and a radar check is retuned to the Sentinel-1 layer
Settings found here. A detection being built keeps its place while the library
is open, and an analyzer saved from there comes back picked.

The builder keeps the name, the locked chip and the sentence the analyzer reads
as at the top, and three tabs: **Rules**, **Checks** and **Settings** (sizes,
shape, cleanup, smoothing, grouping, description, candidate label and colour).
Over the rules a strip names the check on the map, says how it last came out and
carries **Test**. A rule reads as the sentence it says (*NDVI dropped by 0.25 or
more*); its dot carries its number and its map colour and hides or shows its
pixels, and ★ ranks the candidates by it. A rule names a quantity, when it is
read, and the line; its data label names the bands or classification it reads.
The quantity is one of the six indices, **My index** (a
normalised difference of any two Level-2A bands, with NDMI, NDSI, NDRE, NBR2 and
GNDVI one pick away), one band's reflectance, brightness, a colour change,
Sentinel-2's own ground class, or radar backscatter in VV, VH or VV − VH. On two
dates it is read **Before**, **After** or as the **Change** (after minus before,
so a loss is negative), and says which half of the split map it is painted on;
one date has nothing to choose. The line is a direction and an amount: a change
**Dropped**, **Rose** or moved **Either way**, a state **At least** or **At most**
a value, and either **Between** two values, with a drop entered as its size.
Reflectance shows in percent and radar in decibels; a change in reflectance or
radar takes the passes' overall shift in light out, as the built-ins do.
**Against the ground around it** reads the quantity against the ground within a
set distance, up to 300 m, the ring with a hole in the middle the vessel
detectors use, so one line holds over a dark sea and a bright desert. **Keep what
passes** all the rules or any rule. The first measured rule, marked ★, ranks
candidates: two of its units past its line is Strong (0.2 of an index, 4%
reflectance, 4 dB). Radar and optical rules do not mix, and one analyzer reads at
most six bands, each three a request per date and tile. The sentence at the top
says the whole analyzer, and becomes its description unless one is written.

The map is where checks are made and tried, and a console over it holds the
controls. Its selector picks the check on the map, **Basemap only** to see the
basemap alone, or **New check**. A check of two dates splits the map between its
passes: the before pass on the left and the after pass on the right, each on its
own map with the two cameras held together and a handle to drag the cut, and
**Before**, **Split** and **After** switch between the whole map on one and the
cut. A check of one date shows its pass on one map. A satellite button puts the
basemap in the passes' place and back; it is not an eye, because the eye further
along takes the drawings off the imagery and two eyes would read as one switch.
**Display** picks their Copernicus layer, with the one that shows the ★ rule's
data best tagged by the bands it shows (“shows B08 · B04”) and the ones you
wrote tagged *yours*. The menu opens on one line saying what it is for: what you
look at, while rules read the bands themselves.
Opening or selecting a check verifies the configuration's layers, without a
network check on builder mount. The menu shows their actual IDs, including
`VEGETATION_INDEX` where that is the configured NDVI display. Missing products
stay grey with a reason. The menu offers **Refresh layers** and setup instructions;
the same help appears in Settings → Imagery. A saved display resolves to its configured alias
or an available display, with a notice. If verification fails, the basemap
stays on. Tile errors on either pass name the layer and date and offer
**Retry imagery** or **Use basemap**.

**Reuse a formula** sits beside **Add a rule** once you have written a layer of your
own (Satellite → the date chip → Write a layer). A rule reads one number per
pixel, so a layer comes over when what it paints is a number: an index paints
`(A − B) / (A + B)` and darkens below a line, which is the `nd` measure with its
threshold; a composite that puts one band in all three channels is grey, not
colour, which is that band's reflectance, the `band` measure. The menu lists
every layer you have written — the ones that come over with their arithmetic, the
ones that do not with the reason, greyed. A colour composite is three channels
and no single number, and nobody can read a quantity out of a hand-written
script. Which dates the rule reads is the analyzer's question, not the layer's,
and a grey band brings no line: the gain it is drawn with says how bright it is,
never where the ground stops passing.

Each rule carries a coloured dot with its number, which shows or hides that
rule's pixels on the map. Until a test has run there are no pixels, so the dot is
drawn hollow and says what it is waiting for rather than answering nothing.

Moving a rule's line repaints its ground as you drag it. The first touch of the
slider fetches what that rule read over the whole frame — the same readings the
last test made, never new imagery, so it costs no Copernicus request — and from
then on the browser crosses the line itself. Only that rule's pixels move: the
pins, the candidates and the shares still answer for the last test, and the
button still reads **Test again**. A rule whose reading is in hand no longer dims
the picture when only its line moved, since the ground drawn is the ground the
next test will keep. Changing what a rule *reads* — its bands, its dates, its
context — drops the reading, and a ground class has no line to move.

**See it** beside what a rule reads draws the rule's own arithmetic on the map as
a Copernicus layer, so the quantity can be looked at continuously instead of as a
verdict. An index renders as `(A − B) / (A + B)` on a ramp, a band as that band
in grey, brightness as the visible bands averaged; a published index does the
same from its own two bands. No threshold is drawn into it, so moving the rule's
line costs no tiles — the ramp already shows where every value falls. A colour
change needs two dates, ground classes are a classification and radar is another
collection, so those say why instead of offering a press. While a rule is drawn
the Display chip reads *rule N* and the menu offers the display back; choosing
any display, or removing the rule, ends the drawing.

**Checks** are how an analyzer is proved, and one is needed to save it, with a
pin where something should be found; the others may be traps, where nothing may
be. A check is two passes (one, for one date) and the pins laid on them. It has
no frame: it reads the ground under its pins, the tile under each and the tile
across an edge when a pin is within 48 pixels of it. A check holds up to 60 pins
and reads at most 20 tiles. Exceeding the tile limit shows the count and limit
in the console, even while placing pins, and disables **Test** before fetching.
**New check** opens a drawer over the console that takes its passes: a look-up
for the ground at the middle of the map over 30 days, 90 days or a year, one
Copernicus request, or **Dates**, which picks each side from a calendar of the
month's passes, coloured by cloud and offering only days that keep the two in
order, or from a typed day, as a routine does. The pins come next: **Should be
found** and **Should stay empty** arm a pin, every click on the map drops it,
on either half, and Esc puts it down. **Finish** keeps the check, which needs a
pin; until then the column waits, dimmed, and **Cancel the check** gives it up.
The Checks tab lists every check with how it came out, **Test all** with what it
would cost at most, and for the one on the map its name, its passes and its pins
to turn or take away.

**Test** runs the rules on the ground under the pins and says, before it is
pressed, how many Copernicus requests it will fetch (none once its frames are
held), and nothing runs on its own: after a change to a rule or a pin the picture
dims and the button reads **Test again**. A test paints each rule's pixels in its
colour, what reads the before pass on the left half, the after pass on the right
and a change on both, tints the ground it measured so that ground no rule kept
still reads as tested and cloud stays clear, and outlines the candidates a run
would return there, since it runs the engine's own evaluation, cleanup, sizes,
shape and grouping. Each pin turns green or red as it comes out, and the row
under the console says **2 of 2 found** or **1 of 1 flagged**, keeps a chip for
every rule, to hide its pixels and see which ones help, and switches the map
between **Rules** and **Detections**. One control holds the overlays: an eye and
the chevron beside it, joined, because the eye is the switch and the chevron says
what it switches. The chevron lists **Markers**, **Outlines** and **Check pins**
independently; the eye takes all of them off at once, which greys the list and
says the eye has them all off, and restores the choices when pressed again. The
satellite button is the separate one: it switches the imagery to the basemap.
Display choices do not rerun a test or change the saved analyzer. Each rule's card gives the share of the
measured ground it keeps, lays the pins along its slider where they were read
(filled where they should be found, struck where none should), so the line can be
set between them, and says what the pins would have come to without it (**Without
it, 1 pin would come out wrong** means the rule keeps pins right, and one that
would make pins come out right is losing them). A click on the map reads every
rule at that point: the value, before and after for a change, and a tick or a
cross, so a thing that was not kept says which rule let it go, and the card can
drop a pin there; a pin opens the same card to turn it the other way or take it
away. Each example's empty marks are traps for one of its rules: the reef off
Lahaina and a cloud the mask missed, the mown meadows at Grünheide, the river and
the cooling pond at Kakhovka (flagged as soon as the change reads **either
way**), the panels already there in Dubai and the dunes the wind moved, the town
of Fujairah. Removing the rule that guards one turns it red, which is the lesson.
Checks are saved with the analyzer, so Settings backup carries them.

**Shape** is offered to every analyzer: **compact** keeps roofs, craters and
vehicles, **long and thin** roads, tracks and trenches, measured along each
candidate's own length.

**Start** names it, says what it is for, and runs it: **Run this pass** for a one
pass, **Save and run the first pass** for a routine, which can also be saved
without running. Every run explicitly starts a bounded,
cancellable job, up to 4096 native tiles, and joins the case's queue: runs go one
after another, and only the same detection twice at once is refused. A run keeps
going whichever tool is open. While one is queued or running, the top bar carries
**Detect** with its progress, and one press returns to it; when it settles a toast
says what it found, with **Review** to open the results. Between tiles the sweep
lets the case's other queued work through, so a thumbnail never waits out a sweep.
Nothing runs on its own: a weekly harbour review is a press on its card, not a
background schedule.

Before queueing, exact repeats of the same area, recipe, parameters and resolved
dates offer **Open** and **Run anyway**. Overlapping dates do not trigger this
notice. Dismissals are not remembered across runs and candidates are not deduplicated.

The native analysis grid is independent of map zoom. Opening the panel or
reopening its results reads local state. Offline runs use cached and retained
frames and require explicit dates. Runs preserve their input snapshots and review
state. Review pictures are retained over the whole swept area so a missed candidate
can be added later; measured band frames are retained only for tiles with results.

What a sweep produces is a list of candidates, strongest first, and nothing else
reaches the case on its own. Each says how strong it is in a word (weak, clear or
strong: how far past its threshold it got) and what was measured in units a reader
can check, such as "6.2× brighter than the water around it" or "NBR 0.61 → −0.28".
It also says how big it is: its area, then its length and width measured along its
footprint, so a ship lying on the diagonal reads as long as it is. At 10 m a pixel
that is a size class, not a survey, and a wake or a radar smear lengthens it.
**Largest first** walks the queue by length instead, from its top; pressing it
again returns to the run's order.
A candidate that crosses a tile edge is one candidate with one picture, stitched
from the tiles it touches. New candidates use the detector mask's simplified
outline; merged components retain their parts as a MultiPolygon. The bounding
box still drives crops. **Group within** measures the gap between the footprints
themselves, not their boxes, so one join never widens the next: joined by boxes,
an airbase's 667 marks once became one candidate of 31 km². Existing results keep their
stored rectangle geometry.

Opening a run puts the map on the candidate the panel is about, close enough to
read it, and every step through the queue moves it again. Review has a fixed-height
preview and a fixed footer: Keep, Dismiss and Pin remain under the pointer as
candidates change or details scroll. **K**, **D** and **P** are those three
verdicts from the keyboard and the arrows walk the queue. **Compare** under the
facts opens the candidate in Compare, framed close: a change on the two passes that
found it, and a thing present on one pass — a hull, a fire — against today's
high-resolution picture, where a platform or a flare stack is still standing and a
ship is not. Nothing is fetched to decide it; the candidate names its passes. Chips above the candidate
narrow that queue to what is still to review, what was kept, or what was pinned. **Keep** marks the
candidate in its run without creating a place or image. **Keep all** asks for confirmation
with the number of candidates still to review, then keeps them in the open run.
Kept candidates can still be dismissed individually. **Dismiss** removes a candidate
from the run. **Pin** opens the standard dialog for a name, optional description,
after-only image and Point/Area geometry. Single-image methods default to after-only
and Point; change methods default to paired images and Area. Pinning creates a
place and a PNG in Files, and links them: the picture shows the place. The picture says on its face when and where: each image
carries its letter and its date (a radar pass its UTC time), and the foot holds the
point's coordinates and the imagery's credit with the year of its passes, so the
file still reads after the run is gone. The same dates reach the case's time. The PNG carries them on its
Time tab, and a claim at the place, citing the picture, says what the sweep read: a
change `occurred` between the two passes, a thing on one pass was `observed` on it.
The place itself carries no date, and the claim no confidence. **To Post** beside a
pin opens Post on a free post carrying its picture, told the pin's name, its
description and its two passes as before and after. The run's own **To Post**, once
something was kept, carries its pins' pictures in the queue's order, four at most as
one post holds, dated from the earliest before to the latest after. A method that reads
one pass has no before, and says the day it was seen. Detect hands over no credit line.
A candidate only kept here has no picture and none is made for it, so a run of those
shows *Pin a candidate to post it* where its To Post would be. Undo sends those
copies to Trash, the claim with them unless something was added to it. Evidence is enlarged
by a whole-number factor with no interpolation, so a candidate a dozen pixels
across can be read without pretending to detail the sensor never recorded. The
candidate under review wears a ring on the map. **Add candidate**, or the map's right-click, records a point or polygon on a successfully read area,
with `origin: manual`, the same pass pair, preview and verdicts. Manual candidates
have dashed map outlines and a Manual label.

Beside **Export as layer**, the same joined control as the bench's: the eye (`H`)
takes the candidates and areas off the map, so the pass shows bare, and the
chevron beside it switches **Markers** (including numbered groups) and
**Outlines** independently without rerunning the analysis. Leaving the review
puts them back. With markers hidden, an outline still opens its candidate and the
candidate under review has a highlighted outline. The eye restores the display
choices when pressed again. When the run
read two passes, the blink (`B`) flips A against B on the map at Compare's
normal speed, and a chip over the map says which is showing, in Compare's
letters. Both passes are laid in the one map and kept loaded, so the blink
reloads nothing; it is offered only for two dates of one archive, never for a
detector that read one pass. Leaving the pass stops it.

**Export as layer** is an explicit snapshot of kept and pinned candidates only.
A routine updates one SAT layer, with a category per effective pass date; a one-off
run has its own layer. Re-exporting a date replaces its category. Older dates are
lighter and newer dates darker on a blue ramp. Features carry the name, description,
pass date, detector, area and run id. Exported layers survive deletion of their runs.


## Geo Proof

A proof is composed of panels: case images, each carrying its source. Two things
in the composer are not panels.

**With no proof open, Geo Proof shows its home** in place of the canvas, and the side
column and the toolbar wait for a proof. On top, **New proof** and a search that
finds a proof by name or by place, Enter opening the first. **Continue** holds the last proofs saved
as large thumbnails with their label and how long ago, six at most and as many as make whole
rows, a proof of a video tagged *Harbour run · 2/4* in its scene's colour (a video's only
slide says just its name), and *All N proofs* opens the Open proof list. A video is named by
the title Media gives it, else by its file name without the extension, here and wherever a
scene or a proof names its video: the Open list, the strip, the Scene tab, New proof, the
To-do and the pill. **To
prove** shows only when the case has scenes still to prove: a card per video with its
thumbnail and its scenes as chips, each with its colour, name, time, its mark and its two
counts. A chip is Make the proof: the frames of the scene chosen as from the strip, or for a picture
the proof of it and its captures. A case holding nothing shows the button and one sentence.
The home opens on the list it read last and reads it again behind (`GET /proofs`, one read),
the scenes coming from the queue the app already keeps. A scene of the strip still shows its
page in place of the canvas, as before.

**New proof** opens a window of the case's pictures. On the left, where they come from:
**All**, then **Satellite**, **Videos**, **Collages**, **Screenshots** and **Photos**, each
with its count and left out when the case holds none (`lib/newProof.js`). A frame or a
collage Inspect cut from one video is under Videos, the collage under Collages too; a map
grab, a Compare render or a Horizon view is a screenshot; the rest is a photo. The case's
folders follow, then **Scenes to prove** when the queue holds some, each with its colour
dot, its name, its time and its file, and its two counts with the mark of where it
stands, as on the home's chips. On the right, the pictures as large thumbnails: a
press adds one and its number says its place among the panels, and under Videos each video
is a block of its frames in clip order and its collages. **A scene pressed shows only its
material, all ticked**: the frames inside its passages, the collages holding one and the
captures gathered for it, read as Make the proof reads them. The proof made of it takes the
scene up and opens on the Proof tab, the frames not in the case filed on the way, and the
scene stays named at the foot with a × that lets it go. The foot holds the pictures picked
in panel order (dragged, or Alt+←/→, to reorder, Delete or × to take one out), the template
with the default preselected, **Create proof** and a quiet **Start empty**. All is where it
opens and the search is focused, so a proof is still New proof, a picture, Create proof;
Enter creates and Escape closes. A case with no scene shows no scene anywhere.

**A proof's name is the analyst's.** A new proof has none: the header's field is empty,
*Name (optional)*, and the proof files under a technical name, *Proof 3*, that is never
shown. Everywhere a proof is listed (the home, Open proof, the slides strip, the To-do,
the search) it reads as its **label**: its name when it has one, else where it stands
and its day, *Al Jawf, Yemen · 9 Nov* (the region and the country the case filed for its
first point's place, `engine/satellite.place_words`, and its date, else the day it was
made), else its point, *15.4712, 45.3221*, else *Untitled proof* (`lib/naming.js`
`itemLabel`, `lib/proofList.js` `proofLabel`). The To-do shows an unnamed proof by its
time, as a scene. A name typed wins and becomes the file's, as before; emptying the
field takes the proof back to a technical name (`POST /cases/{id}/proofs` with
`"title": ""`, or only spaces, which keeps a technical name it holds, else takes the
lowest free one). A proof saved as *Proof 3* before reads as its label with nothing
renamed. `GET /proofs` gives each its `place`, `when` and `created_at` for it.

**Open proof** shows its list on the press, its rows following when the case answers. A
pick closes it at once, and a small tag over the canvas names the proof while its pictures
load. Its search finds a proof by its label: its name, or its place. A proof of a video carries a small line in its scene's colour, *Harbour run · slide 2
of 4*: its place among that video's proofs in clip order, the abandoned last, or just its name
when it is that video's only one. A long name gives way and the place stays. A select
beside the search narrows the list to one video or to the proofs on no video. A proof on
photos reads as it always did. The list says it for every proof in one pass on the server
(`GET /cases/{id}/proofs`, `engine/scenes.proof_slides`): about 140 ms for 300 proofs on
three videos, 50 of them for the slides.

**Delete** is in the header's ⋯ once the proof open is saved, with **Show in Inspect** for
a proof of a video, in a slide's menu, and on each row of the Open list. It asks one question everywhere,
the delete preview listing what it touches, and the proof goes to the Trash, from where it
comes back. A proof of a video also asks what becomes of its scene: by default it **goes
back to To geolocate**, as a delete always gave it back, or it **is removed with it**
(`DELETE /cases/{id}/proofs/{name}?scene=drop`): the scenes to prove it took up or gave back
leave its video's Inspect work and none is given back, in one go under the case's lock, the
scenes put back if the delete fails. Restored, the proof states its passages as it did, and
deleted again it gives a scene of them back. The proof open goes to the next proof of its
video, else the one before, else the home.

**Overlays.** Ctrl+V, a drop on the canvas, or `+ Add overlay` put an image
straight into the proof. Ctrl+V answers to two clipboards, and the rule is which
copy came last (see Copy and paste): marks copied here paste as marks, an image copied
since pastes as an overlay. It lands in the `Overlays` section of the Layout tab,
sits above the panels and the legend, and is moved,
resized from its corners and framed like anything else on the canvas — you can
annotate it too. It claims no source: no media is filed, no entity, no
`derived-from` edge. The file lives in `proofs/.meta/<name>.assets/` under its own
content hash, travels with a rename, and goes when the proof does. A proof needs
a panel first, or a picture imported as published, since those are what give the
document its size — moving an overlay never resizes the export.

**The side column is four tabs**: **Proof** (coordinates, source, description and
date, the facts filled once), **Scene** (only for a proof built on a video), **Layout**
(panels, overlays, annotations and elements, where composing happens) and **Style**
(the house style, then **Text**, with the font, bold, Caption new panels, the caption
and legend sizes and Scene time on the picture, **Footer**, and **Signature**, with
**Logo**, the account handle and the **Azimut mark**). A new proof opens on Layout, since it starts with
panels; one made with Inspect's Make the proof opens on Proof, its facts still to fill;
any other opens on the tab in use, Proof at first, which lasts the session and is never
saved. A ▶ pressed on the canvas shows Scene. Each tab scrolls on its own and keeps its
place, and the arrows, Home and End walk the tabs without reaching the canvas behind.
**The Proof tab carries its fields' `!`** on its label, *Still needs coordinates and a
source* on hover, a date the save would refuse included, so a blank is not forgotten
while composing in Layout. Nothing on the canvas or in the export depends on the tab.
**A narrow header keeps Save in sight**: under 920 px Open proof, Discard, New proof and
Copy show their icons alone, on the same single line, so the canvas never moves.

**Coordinates and sources.** Both head the Proof tab and both fill themselves in:
the coordinates from the first panel that carries them, the sources from the address
each panel's media traces back to.

**Coordinates are a list too**, one row per point, with a `+` to add one. A proof
often shows more than one place — three impacts, a building, the camera — and each
row takes an optional name and the marker that says the camera stood there. **The
first row is the proof's point**: the map mark, the coordinate a post cites, the
one the export prints. A row's layers button adds it to one of the analyst's layers,
moves it up to make it the conclusion, or removes it; it has a face like the eye
beside it, so it reads as a button. The
marker never reorders anything, or ticking it would take a coordinate out of a
tweet without saying so. A single-point proof is the field it has always been.
**A panel that carries a place adds it**, under the point already on screen rather
than in place of it — two captures of one point stay one point, and the answer the
panels gave is written down before the new one joins it. **The pin at the end of a row
opens it on the map**: the basemaps and the reference layers of the Map tool, the
mark on what the row says, and a click to move it. It sits inside the row's own box,
behind a hairline and on a panel of its own, which is how every field here offers
the one act that belongs to it — the map on a coordinate, the eye that says the
camera stood there, the tab a source opens in, the calendar that builds a date. A row added with `+` opens on
the point above it, which is the only thing that says which ground it belongs on.
**A point the imagery proposed reads greyed**, its pin in amber, until somebody checks
it. A capture's point is the middle of its frame unless its pin was moved onto the
target in Satellite, and a wide frame puts that middle far from what the proof is
about. Typing the row or using the map checks it. **Save and To post walk every
unchecked point through the map first**, one at a time: *Use this point* keeps or
moves it and goes on to the next. *Later*, offered by Save only, saves the proof and
keeps those points off the case map, where they would read as conclusions; a place
already there stays. To post has no *Later*, since the post publishes the point.
**A save says what the proof just joined**, in one line under the header: *On the same
site as 2 other geolocations · @BashaReport posted 3 other files here*, with **See in the
graph**. It is read from the points and the addresses (`GET /entities/{id}/kin`), so it
answers before the link pass has filed anything, and it goes at the next edit. A proof
that shares nothing draws no line.
The exported picture prints them only when asked (Style → Show coordinates):
unnamed points share one line, a named one takes its own, and the plate grows by
what it prints. **Show text** switches the credit line off beside it, so a plate
can carry its points and nothing else; with both off the band takes no height at
all. A saved house style carries both, and one saved before they existed leaves a
proof's own answer alone. Posting from the proof carries every point into the tweet, one
per line, while the place, the plus code and the map links stay the conclusion's.

**Source is a list**, one box per address, each with a press that **opens it in a
new tab** — a source is read far more often than it is typed — and a
`+` to add one — a proof read from a thread rests on the post that published it, the
photos beside it and the clip under those. Editing a traced box turns the whole list
into the proof's own and the traced ones come along, so stating a fourth address never
means retyping the three the panels already knew. The reset arrow hands the list back
to the panels, and it is the only way back: **an emptied list is an answer**, not a
blank to fill in. A proof whose boxes have all been cleared says it has no public
source — the footage was handed over privately — and the `!` says so rather than the
panels quietly putting their addresses back and carrying them into the post.

**An address the case holds nothing from** shows a download arrow beside it. Pressing
it brings the files in as ordinary media and records them as the proof's *material*:
in its chain, and through the chain on its point, without ever becoming panels. An
address holding several files asks which, ticked by default, since an address stated
as material holds material. Only stated addresses offer it — one traced off a panel is
already in the case by construction.

Wherever a source is *read* rather than edited — the post it is handed to, the Markdown
report — it is one address per line, and a report renders one link each.

**Description and date** sit under the source, both marked *optional* and neither
printed on the plate. Everything above them carries a `!` when it is empty, repeated on the Proof tab's
label, so a
panel of blanks otherwise reads as a form to finish.

The **description** is one sentence about what the proof shows. It is the proof's
notes — the graph shows it and case search finds it — and it is what a post is written
from, in place of the filename a title usually is. Editing it from the Details panel
and reopening the proof shows the edit, not the copy the file was written with.

The **date** is when the material was taken, in the same profile a Claim's *When*
uses — a day, a month, a year, a timestamp or a range, with `~` for approximate and
`?` for uncertain — typed into **one field** rather than assembled from a format, a
precision and a certainty. It reads `24/10/2025`, `Oct 2025`, `2025`, `~2025`,
`24/10/2025 14:30 UTC` and two of those joined by *to*. Month names are read in
English and French everywhere, and in the languages the browser is set to as well,
from `Intl` and in both the forms a language writes them (`март`, `12 марта 2026`,
`12 de marzo de 2026`); the day still comes first. It keeps anything already
written in the stored syntax exactly as it is, and says underneath what it
understood. What it cannot read is handed on as typed, so the save refuses it with
a reason rather than filing a date nobody meant. The browser's own date field is
not used anywhere a date is stated: it writes its placeholder in the browser's
language, which is how an English interface came to ask for `jj/mm/aaaa`.

The calendar beside the field **builds the common answer** for anyone who would
rather point at a day than spell one. It is the app's own month grid, drawn under
the field rather than over it, and it opens on the day the field holds — else on the
month a looser answer named. A month, a range or a mark of doubt is still typed:
those are not days, and a calendar has no way to offer them.

**A date is read on a clock, and the field names it.** Under a set date, the shared
**Clock** chip opens on *the point*: the first point's zone, looked up from the bundled
boundaries, with its offset on that day. The date's reading names the zone rather than
*local time*, so the 12th is Kyiv's 12th on the Timeline, from its midnight, and a typed
`14:30` is placed on Kyiv's clock without being rewritten. **UTC** or any zone picked
from the list overrides it. **Local at the point** goes back to following the point on
every save; with no point yet the field says the day is read in UTC. The entity and the
footage's Claim carry the zone as `when_zone`, which Details edits on the same chip.

**Nothing ever fills it in**, unlike the coordinates and the sources beside it. The
date a file carries is when it was uploaded, or what a camera clock said; neither is
when the thing happened, and a date offered is a date accepted without being read. So
it is typed on purpose or it stays unknown, and the bin beside it empties it back to
unknown. Nothing marks it missing either: plenty of material carries no date anyone
can defend. A dated proof is what the Timeline shows under **Taken**, beside the dates
the files themselves carry.

**A date states itself for the footage, not only for the proof.** Saving says so, *Dated
the material: clip.mp4*, and the video's own Time tab then shows it above the dates read
out of the file, which it never overwrites. The frame is not dated, the video it was cut
from is; a satellite capture never is. **A proof about a video dates that video alone**,
its ★: the one its scene states, else the one its first frame was cut from. Another video
among the panels only confirms the place and never takes the date, nor does a photo
beside it; a proof resting on no video dates every source. When the proof states passages
the statement holds for them (`span` on the Claim), and the Time tab reads
`2:10–2:38 · 24 Oct 2025`, `0:30–0:45 +2 · …` past two, every passage on hover; about the
whole video it is the date alone. Changing the passages or the ★
(`PUT /cases/{id}/proofs/{name}/scene` with `{moments, video?, draft?}`) moves the span
and the file the statement is about at once, and leaves its date, its words and whatever
the analyst added. Changing the date restates it, clearing it takes it back, and a
statement someone has since added reasoning to is left alone. Statements written before
this are corrected on the proof's next save.

**A proof built on a video gets a Scene tab**, between Proof and Layout. It is there
only when a panel is a frame Inspect cut from a video or a picture made from its footage
(below), or when the proof states a time of its own; any other proof shows three tabs and
reads, saves and exports exactly as before.
Under *Video*, one boxed line per video, like a source: `★ clip.mp4 · 2:10–2:38` for the video the proof is about, which
its date states, and `☆ other.mp4 · confirmation` for any other video among the panels,
made the ★ in one press, its time then starting as the whole video. A proof that states
no time reads *Whole video*: the instants its frames were cut at pin it, they are not
its time. Whole video chosen in the editor, here or in Inspect, is kept on the proof
(`scene.moments` empty), so nothing is offered in its place again; only the Undo of a
proof's first time takes it back to stating nothing (`traced`).

**The time opens Inspect's own editor**: Whole video, Instant or Passage, a line per
passage, typed or nudged a frame with ↑/↓, and **Here** takes the frame on the tab's
player. **Another passage** adds one of the scene's kind from that frame as Inspect's
does, held in the scene's colour on the player's bar and moved by Here. Apply writes a saved proof's time at once, through its own route, with Undo in
the toast; a proof never saved holds it and writes it right after its first save.

**The player has the Scene tab to itself**: it opens with the tab on the ★ video,
paused where the scene starts, muted, at the clip's own shape up to under half the
window's height, with a thin bar where the passages are bands and pins in the colour the
scene has on Inspect's bar, and the proof's panels are dots. The play act at the end of
a video's line runs that video in it: through the passages, each stretch played and each
instant held a beat, or the whole video from the first panel's frame; the loop button
starts and stops that, and it never starts on its own for a system set to reduce motion.
Leaving the tab pauses it on its frame, and keeps a time being changed when it reads as
one. ←/→ step a frame, Shift a second, Space plays, and none of
them reach the canvas behind. **Add this frame** files the frame on screen as Inspect
files a capture and adds it as a panel the way the picker does, so its source traces as
usual. Each panel cut from a video carries a ▶ in its corner on the canvas, drawn with
the handles and never exported, which shows the Scene tab on that panel's frame. The
tab's **▶ on video panels** box, on by default, hides them all while composing; it is
kept in settings.json for every proof and travels with the settings backup
(`proof_scene_plays`).

**Inspect writes the same time.** Each time Geo Proof comes back to the front, when the
case moves and when the server says a scene moved, it reads the open proof's scene and
the strip again, the player and the tab left where they stand and nothing written. A
time in hand with a change stays the analyst's: the read waits until it is applied or
dropped. A proof not saved yet, made from a scene still to prove, follows a time changed
on that scene in Inspect until one is stated here. Inspect reads its list again when a
write from Geo Proof lands after it was read. The open slide's tile says the time its
Scene tab reads. A time read again that the picture prints, with **Scene time on the
picture** on, marks the proof unsaved: its saved picture still prints the old one.

**Nothing moves the time behind the analyst's back.** When a frame of the ★ video falls
outside every passage stated, the field says *1 panel is outside these passages* and
offers **Add its passage**, an instant at that frame. **Scene time on the picture**
(Style, off by default, offered only for a proof built on a video) prints
`2:10–2:38`, the timecode alone and never the video's name, in a dark tag at the bottom
left of each ★ panel, the passage that panel's frame shows in. It is drawn on the page, so the exported picture is the canvas.
A proof about the whole video has no time to print, and the house style leaves it to
each proof.

**Cut for the post** sits on one quiet line under the video's field of a proof that
states a passage, one press per passage when it states several; an instant, or the whole
video, has nothing to cut. On a proof never saved, the passage can be the time of the
scene its frames found, and the press saves the proof first through the normal save, its
point check and name question included, the line saying *Saving the proof first…*; the
cut starts once the save landed. A save that stops or is cancelled cuts nothing, and the
line says *The proof was not saved, so nothing was cut.* It cuts the passage into a
video of its own, filed in Media as Inspect's files are
(`clip 2m10s–2m38s`, after the video's title), and the proof's scene keeps it for its
post: its To Post attaches the clip in place of the whole video. The line says *Cutting 2:10–2:38… 40%* while it runs, then *Clip · 28 s · 4.2 MB*,
its passage named when the proof states several, with **Show in Media**, which lets the working file through Media's switch, and
**Remove**, which moves it to the case trash after the usual preview names the proof.
The cut is re-encoded rather than copied, so it starts on the frame asked for and plays
on X and Bluesky: H.264 and AAC, 1920 on the long side at most, 60 frames a second at
most, under 3.5 Mb/s, the source's metadata left behind. A passage runs half a second to
ten minutes, inside the video. The same passage pressed again answers the clip already
cut, never a second copy, and one cut runs at a time
(`POST /cases/{id}/proofs/{name}/clip`, read back at `GET` on the same path). The clip
stays while the ★ does, through a change of time, and is let go when the ★ moves to
another video; its file stays in Media.

**A proof made by hand finds its scene by its panels.** When it states no scene and
every frame of the ★ video among its panels (each piece of a collage of it included) falls
in one scene still to prove, and in no other scene of the video, by the rule Inspect's
dots use, the proof finds that scene. A scene about the whole video is found only as the
video's one scene. Frames in none find nothing.

**A picture made from the footage counts too.** The server walks each panel that is no
frame up its derivation, at most six steps and each file once (`POST
/cases/{id}/scenes/ties`, `engine/scenes.panel_ties`): a Horizon or Satellite capture
made over a frame carries the frame's instant, one made over a collage of the video every
piece's, a capture of such a capture the same. A capture a scene gathered while it was
geolocated points at that scene, whatever it was made from, and the line under the field
says *its captures were taken for it*. Such a panel is no frame: it pins nothing, prints
no time and has no ▶, and the video it comes from is the ★ when no frame names one. With
no time at all, the video's one scene is found. A collage of several videos stays a
picture of its own, and an older proof with no derivation opens as it did.

**Panels pointing at several scenes tie nothing.** Frames or pieces in two scenes, a
capture gathered for one and a frame in another, or panels with no time on a video with
several scenes: the line under the field asks *Which scene is it?* and lists them in clip
order, each with **Take it up**, and **None of these** keeps the proof apart for the
session. One scene offered beside a proof, or with a piece outside it, asks *Is it this
scene?* the same way. Nothing is written until one is picked; a proof never saved holds
it for its first save.

A proof never saved takes the scene it found: its field reads the scene's time, and a
line under it names the scene in its colour, *Bridge? · found by its frames*, with **Not
this scene**, or *Which town? · the video's only scene*. Its first save takes the scene up
as Make the proof's does, so Inspect shows one row; a time changed meanwhile is stated
for that scene.

A saved proof is what is on disk, as Inspect shows it: its field keeps the time it
states, *Whole video* for one that states none, and the line under it offers the scene,
*Bridge? · 0:00–0:01*, with **Take it up** and **Not this scene**. Take it up writes the
scene's time and takes the scene up at once, with Undo in the toast, which gives the
proof back its frames and the scene back to Inspect. A save never takes it up. An older
proof made by hand opens this way, and nothing changes on disk until Take it up.

**Not this scene** keeps the proof apart for the session and writes nothing. Abandoned
scenes and scenes another proof took up are never offered, nor is any to a proof that
said the whole video, and the line follows the panels as they change. The scenes are the ones the strip reads (`GET /cases/{id}/scenes?video=`); only the panels
that are no frame are asked about, read again when the panels change and when a scene
moves. Take it up writes `scene.draft` through the scene's route, which accepts the video
the panels are tied to, so the To-do drops the scene as it does for Make the proof; its
Undo gives the proof back its panels alone. A delete asks about the scene only of a proof
that states one or was cut from the video.

**A proof on a video shows its slides under the canvas**, on a strip laid out like Map
plate's bar under its page, between the toolbar and the side column. It holds every proof
resting on the ★ video and every scene of it still to prove, in clip order and in the
colour Inspect's bar gives each: a proved slide by its thumbnail, a scene still to prove
dashed round a pin with its two counts, the one geolocated now with a beat in its corner,
its page saying its time and its counts, the abandoned ones
greyed after a rule at the end. A proof taking up a scene the server still lists, made
from it or found in it by its frames, stands in that scene's place and colour, saved or
not. The video's name heads it and shows the Scene tab. **+**
starts a new scene, the list holds every slide with a search, ⋯ holds **Export the
slides**, and the fold folds it to one line for the session. Past what the strip holds
whole, the tiles shrink to their picture and number, an arrow each side says how many are
out of sight and a count says which one is shown. A tight strip fades into its ends, and
a very narrow one is a pager. A proof alone on its video has one thin line with **+ New
scene**. A proof on photos has no strip. The slides are a view: nothing is added to a
proof, and an old proof opens and saves as it did. The tiles are the rows of
`GET /cases/{id}/scenes?video=`, and a tile's picture is the proof's cached thumbnail,
the spec's or else its entity's, never the exported PNG.

**Moving to another slide saves the one left.** A press on a tile, **Alt+←** and
**Alt+→** (never the browser's Back), the arrows of the folded line and the list all go
through the save Save proof runs. Points nobody checked are saved as *Later*, kept off
the case map, and the toast says so beside *Saved Road bridge* (*Saved the slide* for one
with no name). A refused save keeps the
slide and says why. A slide never started, with no panel and nothing typed, goes without
a save; one holding only typed words asks first. Presses during the save only move where
it heads, so three fast Alt+→ go three slides on with one save. A switch rewrites the
step it is on, so Back leaves the series at once. With the strip focused, ←/→ walk the
tiles and Enter opens one. **A slide's menu** comes up on its ⋯, a right-click, or the
context-menu key and Shift+F10 on a focused tile, its first item focused: for a proof
**Rename**, **Show in Inspect** (the video on that slide's scene), **Abandon…** while it
states no place, and **Delete…**, the question the header asks; a scene still to prove keeps
Make this slide, Geolocate and Abandon…. Rename holds the name in the menu (empty for a
slide with none): the slide open takes it as if typed in its name field, saved with it, and
another slide is saved under it at once, its picture moving with it. A tile reads as the
proof's label, and a new slide with no name as *New slide*.

**A scene still to prove shows its page** in place of the canvas, and landing on it
starts nothing: its label or time, where it stands, the captures it gathered, and
**Make this slide**, **Geolocate** and **Abandon…** with a word, or **Restore**. Make
this slide chooses its frames as Inspect's Make the proof does, from
`GET /cases/{id}/scenes/{draft}/frames?video=`: the frames Inspect cut inside any of
that scene's passages by the rule its dots use (half a frame at each edge, at the clip's
own rate), all of them for a scene about the whole video, and the slide states every
passage. A frame not in the case yet is filed on the
way with the crop, turn and sliders Inspect keeps for it, so it comes out as Inspect
would have saved it. The slide made of it keeps the look of the slide before, and its
first save takes the scene up, as from Inspect. Inspect handing over a scene of the same
video, from its Scenes tab or the pill, saves the slide open rather than asking, and the
new slide keeps its look too.

**+ New scene** saves the slide on screen and starts one of the same video in its look:
the house style, the text and footer switches, the signature and the palette, never its
panels, marks, legend words or facts. It opens on the Scene tab, the player after the
last passage proved, for **Add this frame**.

**Export the slides** copies every proved slide's saved picture into one new folder of
the proofs export folder, named after the video and numbered in clip order without gaps
(`clip/01 Road bridge.png`, `02 Market.png`). Nothing is drawn again, and the slide on
screen is saved first. Scenes still to prove are not slides, and a proof never exported
is left out and named in the toast. A second export lands in `clip (2)`, never over the
first, and a copy that fails takes the whole set back
(`POST /cases/{id}/proofs/series-export`).

**Post this video's slides**, in the same ⋯ once two slides state a place on a picture,
saves the slide on screen and opens Post on the video's thread (see Post). A video with
one such slide offers none: that proof is a geolocation of its own.

**The toolbar is two columns.** In one it stood taller than a laptop window, and the
colour, width and layout controls sat under the fold behind a scrollbar nobody looks
for. The separators still mark the groups: history, the drawing tools, then fit and
layout together. The controls that come and go with a selection are last, so picking a
shape never reshuffles the buttons above them.

**Undo takes back the drawing, not the hand.** The colour in hand stays, unless the step
crosses a template's palette, and so does a zoom set to draw a detail; a page still
fitted to the window is fitted again. Mid-curve, Ctrl+Z takes the last point off.

**The rail shows what the pick can take, and nothing else.** A line, an arrow or a
stroke offers its colour, width and **line style** (solid, dashed or dotted, in
proportion to the width); a box adds its fill and its tag; a label its size, a
**frame** round its words and a **background** behind them; a cone its lens. A
picked panel or overlay offers its **border**, colour and thickness, and a picked
panel the **captions'** size and colour. **Words and lines are sized apart**: the
size control holds one slider per size the pick has, so a tag's words grow without
its box's line (**Tag text**), a callout's words without its line, a framed
label's words without its frame, and a cone's camera without its edges
(**Camera**). These used to
be small buttons in the side column's rows, out of sight while the canvas had the
eye, and the rows now keep the words alone. There is no floating bar over the
picture: it would cover what is being annotated.

**The canvas has its own right-click.** It never opens the browser's menu. On a
mark it picks it, if it was not picked, and offers Bring to front, Bring forward,
Send backward, Send to back, Duplicate, Copy and Delete, for every mark picked, with
**Lock position** on a zoom inset; on an overlay, or a panel
in free layout, the same stacking, Crop and Remove, and on any panel or overlay a
**Paste** onto it once marks are copied; on the page, Fit view and a Paste where the
marks were; on a caption or the footer, the editor. With a drawing tool in hand the right button stays
silent, as it neither draws nor drops a pick. **Ctrl+↑ and Ctrl+↓** step the picked
marks forward and back, with Shift all the way; a step passes the next mark of the
same picture, the only one it can cover.

**Handles are Collage's**: accent discs on the corners, accent squares on the
sides, ringed dark to hold up over bright imagery, with the same round turn knob.

**Captions and the footer are written in place.** A double-click on a panel's
caption or on the footer's credit line opens the editor over the words, one line
each; a footer emptied goes back to *Composed with Azimut*, and a long line wraps.
The imagery credits of the panels it shows (each panel's capture already carries its
own on its face) are kept with the proof rather than printed under it: in its Details,
in the exported PNG's metadata, in what it hands Post, and under it in a note.
**Imagery credits**, off by default, adds them after the footer's line, for a crop
that cut a capture's own credit band. A press on a caption
picks its panel, and a press on the footer picks it, framed with nothing to pull:
the rail then sets the size and colour of the captions, which share both so a row
reads as one line, or of the footer. **Auto** is the colour the background gives.
The house style carries the caption colour too.

**Frames.** Any panel or overlay takes a coloured border, its own colour and
thickness, drawn inset so the layout does not shift. A frame is decoration: it
stays out of the legend, which is still built from annotation colours alone.

**Fonts ship with the app.** The system's font is a different one on every machine,
so a proof set in it changed width from one computer to the next and a re-export no
longer matched what was published. A proof is set in Inter, Barlow Condensed,
Oxanium or IBM Plex Mono, shipped in the build, with Latin and Cyrillic where the
face has them; the Style tab picks it per proof, and the house style carries it, with a
switch for labels, callouts and tags in bold. A proof saved before fonts keeps the
system's until it is changed. An export waits for the face to be loaded.

**A mark belongs to its picture, its ink to the page.** Where a mark stands and
what it spans are kept in its picture's own pixels, so a panel that is moved,
resized, turned or cropped carries its marks along. Line widths, arrow heads,
label, symbol and marker sizes and frames are kept in page pixels instead: 4 px
is 4 px on every panel and overlay, whatever their resolution or size. A mark
dragged onto another picture joins it unchanged on screen, the arrow keys and
Ctrl+D step the same distance on every picture, and a mark drawn on a turned
panel lands under the pointer, square to the picture. A proof saved before this
rule is converted as it opens and looks as it did.

**Marks free on the page.** A box, an ellipse, a line, an arrow, a curve, a
stroke, a label, a symbol or a marker belongs to where it is let go. On a picture
it follows that picture; **dragged out into a margin it comes free**: it stays where
it is when a panel moves, and it is drawn over every picture, in one stack with the
callouts and the insets. **Put back on a picture, it is anchored to it again.** A
mark drawn in a margin is free. One drawn or let go over a zoom inset's enlargement
belongs to that inset (see Zoom insets). A free mark out in a margin can
still follow a picture: the right-click **pins it to the nearest one**, and it stays
pinned while it is moved about out there. While a mark is dragged, the picture or
the page it will belong to is outlined and named. **The
page grows** right and down to hold a free mark put past its edge, background
and all, with the footer kept under it; it never grows up or left, so a mark taken
past those edges comes back to them. Blur boxes, insets, callouts and cones stay
on their pictures, since they only mean something on its pixels, and never go on
an inset.

**Lines that hold to two pictures.** A line or an arrow drawn from one picture to
another holds by each end to the pixel it was pressed or let go on, and follows
both: the minaret in the photo stays tied to the minaret on the satellite however
the panels are moved, resized, turned or cropped. Drawn out into a margin, the end
there is free. Each end has its own handle, drawn dark ringed in the accent while
it holds; an end let go over a picture holds there and one let go in a margin comes
free, for a handle and for the whole line dragged alike, and both ends on one
picture make it that picture's mark again. The Elements row says
what it ties, `P1→P2`. A picture that is removed lets go of the ends it held,
where they were. A copy keeps holding to both pictures, stepped aside on each, while
both are in the proof, and is a free line where it stood otherwise.

**Panel and overlay transforms.** Selecting either image shows a round knob on a
short stem above it — the one Collage turns its pieces by — for a free turn, with
quarter turns as gentle snap points. The turn is carried by the image rather than
burnt into its pixels, so the selection frame, the border and the annotations all
stay on the picture's own edges however far it comes round, and turning one never
resizes it: the page reserves the upright room the turned picture needs.

A double-click enters crop mode on the canvas itself: eight black edge and corner
marks frame what is kept, as in a slide editor, over the whole source shown
shaded outside them, so an earlier crop is there to be taken back, not only
undone. The marks stand square on the page however the picture is turned, and
pull along the page's horizontal and vertical, so a picture levelled by a few
degrees can lose its tilted corners and the empty wedges around them. The crop
button in the image row opens the same mode, and closes it. The marks pull both
ways until you leave crop mode, so a corner taken too far comes back in the same
pass; clicking off the image, that button again, Enter or saving keeps the box,
and Escape drops it. Marks left where they opened change nothing. The source file
stays untouched, and the export draws through what the proof stores. Reset crop
restores the full source while preserving the turn.

What is stored depends on the angle. Unturned or turned by a quarter, the box runs
along the picture's edges and is kept as a crop rectangle in source pixels, as it
always was. At any other angle it is a `cut`: an upright window over the turned
picture, measured from the picture's middle, which replaces the room the page
reserves for it. A proof never turned, or saved before cuts existed, has no `cut`
and opens and saves exactly as before; a crop saved along a turned picture's edges
stays one until its marks are moved. A cut picture is selected by its cut, its
frame and handles square like it. Turned a few degrees more, the picture turns
inside the cut, which stays put; turned by a quarter, the cut goes round with it;
brought level, the cut becomes a plain crop again. Annotations keep their pixels
through all of it, since a cut moves no corner they are measured from. New marks
are held inside the cut, and blur boxes, zoom insets and view cones show nothing
past it, as at a crop.

**Drawing.** A tool in hand holds the canvas alone. Nothing already drawn answers
the pointer, so a stroke started inside a box draws a new element instead of
dragging the old one, and while the tool is held the colour and width you pick set
the next element rather than repainting the last. The selection stays where it was
and its handles come back with Select. A box or an ellipse also takes a fill, in its own colour at
an opacity you choose. Shapes start hollow: a fill hides what is under it, so it
is asked for rather than given. Fill and outline share one colour, since the
legend reads colour as the feature. **A shape puts the pen down when it lands**:
it is picked and Select comes back with it, so the colour, the width and the note
go onto what was just drawn. What follows a stroke is nearly always a word about
it, and every one of those used to draw a second box first. Three boxes in a row
is the shortcut pressed three times. Text does the same and opens its editor where
the label was placed, because placing it and saying what it says are one
act. A label holds more than one line — Shift+Enter opens the second, Enter ends
the edit.

**What a picked element offers.** A box, an ellipse or a freehand stroke resizes
from any handle and rotates; a line, an arrow or a curve gets a handle per vertex
instead, so any point can be re-placed. A stroke is the exception among the
points-based kinds: it has too many samples to show, so it takes the frame and
the handles rather than a canvas full of dots.

**Symbols.** The symbol button opens a grid of everything a proof can stamp, filed
under Marks, Vehicles, Events, Places and People. One click stamps it, and the tool
stays in hand afterwards, since marking six vehicles is one act rather than six. A
symbol takes the active colour like anything else drawn, so it joins the legend by
colour and claims no vocabulary the legend cannot say. It resizes from its corners
with the ratio locked, and the pin hangs from its tip, which keeps it on its pixel
while it is resized.

Over imagery a symbol is a filled silhouette with a dark halo, its details carved in a
dark shade, so it holds over a busy roof. Fill on a symbol is a disc behind it: on a
solid disc the symbol turns white, or dark on a pale colour, and the disc shows
through its details as on a map badge. How opaque that disc goes stays your call,
because it covers the picture. Eight of the first eleven symbols (vehicle, truck,
tank, person, building, drone, camera, antenna) read the width control as weight;
every other symbol carries its own weight, and the control stays away.

**Vehicle models.** The Vehicles group holds small models drawn at any angle: a car,
a pickup, a technical, a van, a truck, a tanker, a bus, a motorbike, an armoured car, an APC,
an IFV, a tank, self-propelled artillery, a towed gun, a rocket launcher, air
defence, an anti-aircraft gun and its pickup, an engineering vehicle, a helicopter,
a fighter, a transport, a quadcopter, an FPV drone, a UAV, a one-way drone, a skiff,
an uncrewed boat, a warship, a cargo ship, a locomotive and a wagon, plus Any
vehicle and a Heading chevron. Each is generic, with proportions per class and no
real type's shape or markings. The four flat vehicle stamps come first, named as
flat. They are drawn by a module loaded the first time the picker opens or a proof
names a model. On screen each painted model is kept as a picture, laid down pixel for
pixel, until its view, size, colour or ink change (64 kept at most, 4 million pixels in
all, the oldest going first), so a canvas with thirty of them redraws in an eighth of
the time; an export paints every model again, as before.

The picker's **View** (Top, Angled, Side) sets how the tiles are drawn and how the
next model is stamped, for the session. A picked model wears a ring: the amber knob
turns it on the ground, and the white knob on the arc tilts the view from above, at
the top of the arc, to the side, at the bottom. A label reads the heading and the
tilt. The turn moves in 5° steps and the tilt settles on the offered views; Shift
frees both, and a drag is one undo. The frame's own turn knob still turns the stamp
on the page, to match a picture's horizon. A model's size is its length on the
page, so turning it never resizes it, and the stamp stores its `heading` and `tilt`,
written from the View as it is stamped. A model saved without them draws from above,
its nose up, whatever View the picker holds.

An old proof opens with every stamp in its place, at its size, colour and turn, and
draws the new drawing; the names on disk did not change, and a view cone keeps its
camera.

**Numbered markers.** A filled disc carrying a number, stamped like a symbol and
keeping the tool in hand for the same reason. **Each picture counts from 1**, and
within it **each colour counts its own series**, because colour is what this composer
says "same feature" with everywhere else. A frame and a satellite capture then carry
1, 2, 3 each, and the same number on both pictures marks the same point, the way a
published geolocation pairs them. An overlay counts as a picture, and a marker on the
page, off every picture, counts in the page's own series. The number is the **first
one free** in that series, so deleting #2 and stamping again fills that hole rather
than leaving a picture that counts 1, 3, 4; recolouring a marker moves it into the
series it joins on its picture. A marker dragged onto another picture, or pasted
there, keeps its number. Markers saved before this keep theirs too: only the next
number offered follows the rule. The numeral takes a
contrasting ink off the disc's own colour, since it has to be read over whatever it
is standing on. It resizes from its corners and turns like a symbol; there is no
line in it, so the width control stays away.

**Blur boxes.** A box dragged over a face, a plate or a name, which **redraws the
picture under it through a blur** rather than covering it: what comes out of the
export is the picture's own pixels made unreadable, at full resolution, not a
rectangle laid over evidence. It lives in the panel's space like every other mark,
so it follows the panel's turn, crop and scale. The blur is as strong as the box is
big, and the filter reads a margin of ground around the box that the box then clips
away — cut exactly to its own edge, a blur mixes in the transparency past it and
comes out washed out at the border, which is the one place a redaction has to hold.
It keys no legend row and **carries no colour at all**: it hides something rather
than pointing at it, so the swatch stays away while one is drawn or picked. It
resizes from every handle and turns like a box, and a turned one still reads the
ground it stands on — the patch is taken upright and turned back level inside the
box. Over a surface whose picture has not loaded it draws solid, because a blur box
that shows nothing hides nothing.

**Box tags.** A box can carry its words on a tab of its own colour, hung from
one of its corners outside it, the way a published geolocation names a vehicle in
its frame. A double-click inside a box writes its tag, or the **Tag** control puts
it on the corner asked for, moves it, or takes it off. A new tag starts from the
legend line of its colour, since the colour already names the feature. The tag is
part of the box: it follows a drag, a resize or a turn, a press on it picks the
box, and its words start at a size read off the box's line and are sized on their
own from then on (**Tag text**). Emptied, or
let go with Escape as it is made, it is gone.

**Callouts.** A label tied to one point of a picture. Press the point, drag to
where the words should read and let go: the editor opens on the label, as it does
for Text, and a plain click puts the label up and to the right. The point belongs
to the picture like any mark. The label stands on the page, upright, over every
picture and in the margins, and stays inside the document, which only the panels
size. The **Pointer** control picks how it reaches its point: a **leader line**
ending on a dot, the default, or a **speech bubble**. On a picked label the same
control gives it a pointer, and **No pointer** turns a callout back into a framed
label, so the words are never typed twice. Dragging the label moves it alone. The
dot has its own handle, and let go over another picture it moves there while the
label stays put. A callout's line follows its font size until it is given a width
of its own.

**View cones.** Where a camera stood and what it saw. Press where it stood and drag
the way it looked: the cone opens from a badge with the camera on it, fades with
distance and stops at the edge of its picture. How wide it opens is the part an
analyst knows as a phone camera, not in degrees, so the **Lens** control shows the
phone's own as tiles, each drawn as the wedge it opens: ultra-wide 0.5×, main 1×,
2×, 3× and 5×, read off their 35 mm equivalents, held **landscape** or
**upright**. The far handle aims it and sets its reach; each edge handle opens or
closes it and settles on a lens it comes within a degree and a half of; a small
diamond on the badge's rim sizes the camera, which the size control also sets,
apart from the line. It belongs to its picture like any mark, takes a fill (a light
one by default, since it fades) and a line style.

**Zoom insets.** A frame dragged over a detail, shown bigger on the page. The
enlargement opens beside its frame where the page has room, else in the far corner
of the frame's own picture, two and a half times the frame up to two fifths of the
document's smaller side, and two lines join the sides of the pair that face each
other. The frame belongs to its picture: it moves like a box and reshapes from its
corner handles. The enlargement drags and resizes from its corners on its own,
keeps the frame's proportions and turns with a turned picture. It is drawn from the
picture's pixels and from the blur boxes over them, so a redaction holds in the
enlargement too.

**A mark drawn over an enlargement belongs to it**, as a mark belongs to its picture:
a box, an ellipse, a line, a curve, a stroke, a label, a symbol or a marker drawn or
let go there is the inset's, and the Elements row says `Z1`. Moved or resized, the
enlargement carries its marks along, and its selection frame still hugs it alone.
When its frame is moved or reshaped on its picture, the marks keep to the pixels they
were drawn on; carried onto another picture, they keep their place in the
enlargement. Dragged off it, a mark lands on the picture or the margin it is let go
over. An end of a line can hold to an enlargement as it holds to a picture. Deleting
the inset, or the picture under its frame, deletes its marks with it. A proof saved
before this kept such marks free on the page, and they stay free where they are.

**An inset can be locked in place**, from the lock on its Elements row or its
right-click, **Lock position**. Locked, neither its frame nor its enlargement moves or
resizes by pointer or arrow key: a press on the enlargement draws, picks the marks
over it or opens a marquee there, and a press on the frame reaches the picture under
it. A marquee never catches it, and a right-click on it offers **Unlock** and Delete.
It stays editable from its row, where the lock stays lit, and picked there it shows a
small lock in the enlargement's corner and nothing to pull. Picked with other marks, it
stays out of their drag. A copy of it pastes unlocked, to be placed. It is stored as
`locked: true` on the inset, absent when it is not, so an older proof reads unlocked.

**The order they stack in.** The Layout tab's **Elements** list runs front-first,
the way the Panels list above it does: the row on top is the mark on top of the
picture. A row is **dragged by its grip to reorder it**; the right-click and Ctrl+↑/↓
restack in place. The order is one order for the whole proof, while what an
element is drawn *over* is decided inside its own picture — two marks on two panels
are stacked by the panels — so once more than one picture holds elements each row
carries the picture it belongs to, and the list says so underneath.

**Picking several.** Shift adds an element to the ones already picked, on the
canvas and on the rows in the side column alike. A rectangle dragged over the
page picks everything it touches, and in grid layout it can be dragged across a
panel too, since the grid decides where a panel sits and the drag cannot be
moving it. In free layout that same drag moves the panel, so the rectangle starts
on the page around it. What a family answers to: colour, stroke width, fill,
arrow keys, Delete, Duplicate, Copy, and a drag from any one of them, which
carries the rest. Resizing and rotating still want one element, and the handles say
so: several picked at once show the border and no anchors.

**Copy and paste.** Ctrl+C (Cmd+C on a Mac) copies the marks picked, Ctrl+V pastes
them as one step, picked, and Ctrl+D duplicates them without touching the clipboard.
Every kind copies, a model keeping its view and a marker its number. Where a paste
lands (`lib/proofClipboard.js`):

- **A picture picked, or under the pointer**: the marks are set at the same places on
  it, measured from its edges, each one's lines and boxes sized with the picture and
  its ink kept on the page. This is the pairs workflow: 1, 2, 3 drawn on the frame,
  copied, pasted on the satellite capture, then each moved onto its point.
- **No picture**: back on the pictures they were copied from, stepped down and right.
- **Another proof or slide**: the copy waits in memory through a switch, and lands on
  the picture in the same place (panel 2 on panel 2), else on the first one.
- A mark free on the page stays free; a line holding to two pictures keeps holding
  while both are there; the marks over a copied zoom inset ride on its copy. A blur,
  a callout, a cone or an inset never goes on an inset.

A paste that would cover what it copies, or the paste before it, steps on by one more
step. The copy is also written to the system clipboard as a marked text, which is how
Ctrl+V tells it from an image copied since, from any tab: the marked text pastes the
marks, an image pastes an overlay. Where the page may not write there, the copy stays
in memory and a copy made without leaving the window counts as the last one. Nothing
is pasted into a field being typed in, or behind a dialog, and words selected on the
page copy as words.

**The gestures.** Escape unwinds one level per press: the draft in hand first,
then whatever is picked, and only with nothing left to drop does it put the pen
down. Only the primary button draws. A release the canvas never sees still lands:
letting go over the side column commits the stroke and applies the rectangle
rather than leaving either one following a bare pointer. Space or the middle
button pans, and the middle button never drags or picks the mark under it; so does
a drag that starts outside the page, or, with a tool that only draws on a picture,
where no picture is. A row picked in the side column takes the hand back to Select, since a row
cannot mean "draw here" — which is also why the rows stop lighting up while a
drawing tool is in hand: a pick nothing answers to is not shown as one. A dialog
over the composer keeps the one-letter keys, so `r` never changes the tool
underneath it.

### Import

**Import** is the third way into the tool, beside composing a proof and opening a
saved one, and it lives at the foot of the New proof window's left column. Paste the address of a post and the picture is downloaded, its text
read for a position and for the links it points at. Both fill the form and say
where they came from; neither is applied on its own, and a post that spells
nothing out leaves the fields empty for you to type into. **Use an image** skips
the post entirely and opens the same form. A post carrying several attachments
asks which one, each shown with the poster frame its extractor reported and its
kind — nothing has been downloaded at that point, so the picture is chosen by
looking at it. The **pictures arrive ticked and several can be**: a post publishing a
geolocation as a set — the overhead, the ground shot, the match — published one proof,
and keeping the first of three keeps a third of it. They become one proof, stacked as
published. The footage slot stays single: which
clip is the source is not something a rule knows. A login wall gives the Media
Library's cookie prompt — including the one X gives, which reads as a tombstone
(*Unavailable*) rather than as a refusal, and used to be read as a plain failure, so the
prompt never appeared on the site that needs it most. *No video could be found in this
tweet* is deliberately **not** among them: it is also what a perfectly public photo-only
post gets, and it is the ordinary road to the picture extractor. The prompt opens on **the browser this page is in**, read off the user agent:
the tab is the analyst's browser, so it is almost always the session being asked for,
and defaulting to Firefox made a Chrome user answer a question whose answer was on
screen. **And it is asked once.** Reading a browser's cookie store is reading
credentials for every site, so it is asked for and stored rather than taken — but a
session already stored is then *used*, on a wall, without the question coming back. What
a still-walled line means is therefore one of two things, and it says which: no session
named, or the named one refused.

The left of the dialog shows **the picture whole**, labelled *Proof: as published, not
added to Media*, and a set as a strip above it in the order it will be stacked, which is
the part worth checking before pressing Create. The link field says the same thing before
anything is fetched: the picture becomes the proof as it was published, and is not added
to Media. The footage sits in that list as its own entry rather than as a page of the
proof.

The proof's picture is **asked for as a picture**. The video extractor reads a post
for its footage, so a post that publishes a geolocation beside a quoted clip hands
back the clip and the published picture is invisible to it. The image extractor is
the one that can reach it, and it used to be tried only when nothing at all was
found — so the panel filled with fifty seconds of video and said so two screens
later, at the preview. Now a result of the wrong kind counts as nothing found.

Coordinates and a source are required, and **a source is one box per address**.
A geolocation thread states its point in the post that published it and hangs the
photos and the clips it rests on off the ones after it, so the addresses the post's
text pointed at all arrive as boxes and **Add a source** opens another. Each box is
fetched on its own, says underneath itself what it holds or that it was not
downloaded, and offers **Attach it** for that one address. Two addresses typed into
one box is refused: a box is the address its own file comes from, and nothing can be
downloaded from a pair.

Pressing **Preview** downloads what the boxes point at — the left of the dialog then
holds every file, the proof picture and the material, with arrows to step between
them and a video playable before anything is filed — and lists what the import would
write: each entity marked new or reused, the edges between them, and whatever is
worth saying first — a point already on the map, a picture the case already holds
(in Media, or kept with another proof), this post imported before, or a file whose own
metadata sits more than 150 m from the coordinates entered. The proof's own row says its
picture is kept as published and not added to Media. A picture over 20 MB, one that
cannot be read or is past the pixel clamp, and a set too large to stack into one page
the composer can export are refused there. A source that could not be downloaded is a warning, not a
blockage: the proof is created without that file and the address stays on it. An
address taken off the list leaves its download behind rather than filing it.
**Create** appears only once the preview comes back clean, and editing a field
withdraws it.

**The proof is what everything hangs off.** It rests on the material through its own
edges, so the graph draws one node for the geolocation rather than a media node with
the rest strung from it.

**The picture is the proof, as it was published.** It is somebody else's finished
work, so it gets no background, margins, footer or panel layout of Azimut's round it,
and it is **not filed in Media**: it lives with the proof in
`proofs/.meta/<name>.assets/`, like a pasted overlay, under the spec's `published` list,
which also keeps the post it came from. The footage the post points at is material to
analyse, so that one is filed as media. A set is one proof whose pictures are stacked
top to bottom as published, each at its own size, centred on the widest, with no margin;
the page is transparent where a narrower picture leaves it bare. The export is the
picture itself: a PNG byte for byte, any other format the same pixels in a PNG, and a set
the stacked page. A save with nothing drawn on it keeps that export whatever the browser
redrew, and a mark or an overlay makes it the picture and the marks at the picture's own
size.

Until then nothing is in the case. Both downloads wait in a staging directory
under `media/.dl/`, which bundles skip and the Doctor ignores; closing the dialog
deletes it, and one left behind goes when the next import opens. What Create
writes is a normal proof: it lists, travels in a bundle, goes to the Trash with its
picture, and reopens in Geo Proof showing the picture whole, with its coordinates,
source, description and date on the Proof tab. Marks and overlays draw over it as over
any picture. Layout lists the picture, its size and a link to its post in place of
panels, and has no legend; Style keeps only the font of the marks' words and says the
rest does not apply; the toolbar keeps the tweet crops and drops the layout modes. It
takes no panel: Add panel is not offered, and a picture sent to it from elsewhere is
refused with a toast. A proof imported before this kept its picture as a panel and as
media, and stays as it was.

## Geo Proof templates

Settings → Templates lists the house styles a proof can take, made there and nowhere
else: the composer offers no "save as template". A template holds a look and never a
case's material: the background, the margins, the layout, the type, the footer, the
signature and the drawing colours. Each row shows it by a sketch of its page, its name,
how its pictures sit and its typeface. The sketch is plain shapes measured with the
composer's layout, so a long list costs no canvas and no picture.

**New proof template opens a choice of starts**, each drawn as the sample proof set in
it: **Blank** (the look a new proof has), **Free layout** (pictures placed freely on
black, no captions or legend, one footer line), **Grid with a legend** (captioned
pictures in a row, the colour legend under them, the point and the credits below),
**Before and after** (two pictures side by side on white, each with its caption),
**Stacked for a post** (one over the other, the words large enough for a phone) and
**Pictures only** (no margin, caption or footer, for a report). A press opens the editor
on a copy under that name, with **Other starts** to go back. Nothing joins the list
until Save, and none of it is ever installed on its own. They name nobody: a logo and a
handle are slots, filled from Settings → Publishing when there is one.

**The editor puts the page first.** On the left is the sample proof in the template's
look, redrawn as each setting moves; on the right are the settings, in the groups of the
Style tab: **Page**, **Text**, **Footer**, **Signature** and **Drawing colours**, each
saying what it does on hover. The sample is Half Dome photographed from Glacier Point in
1901 and the USGS orthoimagery of the same ground, both public domain, with the marks a
geolocation carries. The template is laid on it by `applyProofStyle`, the function New
proof uses, and the page is measured by the composer's own layout, footer and signature
code, so what it shows is what a proof gets. Only the Azimut mark is drawn by the very
same code as the composer (`lib/proofMark.js`): the rest of `lib/proofPage.js` is a still
copy of `rebuild`'s drawing, which the composer's canvas cannot lend without its editing.
A logo or a handle is dragged into place on the page and resized from its corners.
**Legend** above the page shows the sample with a legend or without, since a legend's
words are each proof's own and a template holds only its size. Pictures load the first
time a template is shown.

**A template from before opens as it was.** Saved untouched, it writes back what it held,
including what the editor does not show, such as a dragged logo's offsets or a handle's
opacity (`tests/fixtures/proof-templates-0.3.3.json`). **Scene time on the picture** and
**Imagery credits** are switches a template may leave unset: unset, it says nothing, the
proof it is laid on keeps its own, and the editor says so under the switch. Pressed, on
or off, the template states it and new templates state it from the start. A style taken
from a proof always states it, so choosing No template puts the proof's own answer back.

**Default** is the bookmark button on a proof row, as on a post row. New proof opens with
that template chosen, and it can be changed or set to No template there. A picture sent
over from another tool and a proof made from Inspect start from it too, unless the proof
is the next slide of a video: **+ New scene** and a slide made from a scene still copy the
slide before them. Pressing the bookmark again clears it, and so does deleting the
template; an id whose template is gone reads as none, without a word. It is a setting
(`proof_template`), so the Settings backup carries it.

**The Azimut mark** is a switch in the template's and the proof's Signature, off by
default. Under it, **Shows** offers three buttons, each drawn as what it puts on the
page with the app's own logo and wordmark: the logo and the name (the default), the logo
alone, or the name alone, set like type of the mark's size so its capitals match a
handle's beside it. It takes the
corner it is given, the signature's at first, and steps inward past a logo or a handle
already there, so it never covers them. In a bottom corner it rides on the footer's last line, or
just above the band when the footer's words run along that side. Its ink follows what it
lies on: light on a dark page, dark on a pale one, and light with a dark halo over a
picture. It takes no press, and a proof saved without it writes no key and draws as it did.
The export draws it with the canvas's own code, so the saved picture, and the PDF a note
prints it in, carry it as the page shows it.
The footer's *Composed with Azimut* line is separate and stays as it is.

## Post

Geo Report until 0.3.4, and the same tool: its tab says *Formerly Geo Report* on hover
for that release. It writes a post or a thread and opens the site to publish it; it
never posts, and pressing Post on X or Bluesky stays the analyst's.

- **The home** stands where an empty composer would, once the case holds a draft or a
  proof: **New post** and a search that finds a post by its name or its place, or by its
  link pasted (Enter opens the first),
  then three parts. **In progress**, the last six drafts not gone out yet or changed
  since, each with its platform, its kind when it is not a geolocation, and how many
  posts it holds when they are several; **Ready to post**, under its line *Proofs with
  no post yet*, the proofs no draft names yet, a proof of a video listed under its
  video with the slides that wait, and **Video thread** beside a video while two of its
  proofs or more that state a place have no post at all, neither their own nor a thread.
  Once a thread of a video is in the case, its proofs leave Ready to post; New post →
  Video thread and the strip still offer one for any video of two proofs or more. Then
  **Posted**, the latest six to go out by the
  post's own day (read off its link, else the moment it was marked), each with that day
  and its link when it has one. Every post card wears its state as a pill (*Draft*,
  *Posted*, *Changed since posted*), and its ⋯ or a right-click offers **Open**, **Mark
  as posted…** on a draft (the same popover as the header's, on the card, without
  opening the post: `PUT /drafts/{name}/publish`), **See the post**, **Copy link** and
  **Not posted** once posted, and **Delete…**, whose question adds *Its proof goes back
  to Ready to post.* when no other post names that proof. One press on a proof writes
  its geolocation, as Attach a proof does; its ⋯ or a right-click (a slide's chip takes
  the right-click) offers **Write its post** and **Mark as posted…**, for a post that
  went out from elsewhere: the same post starts, and the header's popover opens once the
  proof has filled it in. Every card about a proof the case still lists, a waiting
  slide's chip included, also offers **Open the proof**, which opens it in Geo Proof.
  The home reads the case's drafts and proofs once each time it
  is shown: back from a post, after a delete or an Undo, after a mark. A card's picture
  sits whole on a dark ground in both themes, as Geo Proof's home and the Open list show
  theirs, since a proof is drawn on its own dark one. A proof *has a post* when a draft names its
  picture, read off the drafts list (`GET /drafts` carries each draft's `kind`,
  `posts`, `proof`, `video`, `state`, `posted` and the `picture` its card
  shows, all read off the file it opens anyway), so a draft sent to the Trash gives its
  proof back at once. A case with neither keeps the composer it always opened on.
  **‹ Posts**, first in the header, goes back to the home.
- **A post's name is the analyst's.** A new post has none: the header's field is empty,
  *Name (optional)*, and the draft files under a technical name, *Post 41*, that is never
  shown; a thread is named after neither its video nor a place. Everywhere a post is
  listed (the home's cards, Open, the search, a toast) it reads as its **label**
  (`postHome.postLabel`): its name when it has one, else its place and its day, *Al
  Jawf, Yemen · 9 Nov*: the place its `#place` says, else its proof's (a thread's, its
  video's first place), and the day of its `#date`, else of its proof, else the day it
  went out, else the day it was made; else its point; else *Untitled post*. A waiting
  proof on Ready to post reads as its own label. A name typed wins and becomes the
  file's, as before; emptying the field and leaving it takes the post back to a
  technical name. `GET /drafts` gives each its `place`, `when`, `coords` and
  `created_at` for it. A post saved as *Post 41* before reads as its label with nothing
  renamed. A post started from a plate, a comparison or a pin still takes that work's
  name, which the analyst gave it.
- **Open**, in the header, lists every post of the case as Geo Proof's Open proof does:
  each row with its picture, label, kind, platform, state pill and its day, newest first:
  the day a post went out (its link's own, else the day it was marked), a post not gone
  out its last change. A search and a filter by kind and by state (each counted, shown
  once the posts hold more than one) narrow it; the search reads the label, a name or a
  place, and a post's link pasted in it finds that post, by its own link or by the id its name holds, a posted row's buttons copy its link
  and open it (**↗**, a row with no link keeping their room so the pills line up), and
  the bin on a row deletes it with the delete preview and Undo; the list reads the case
  again after a delete or an Undo. It reads `GET /drafts` and `GET /proofs` each time it
  opens, and the home under it takes what it read.
- **A post saves itself**, as Inspect's work does: once something is typed, picked or
  attached, it is written when the typing stops, and the header says *Saving…*, then
  *Saved*, or *Not saved* with **Retry**. An untouched blank post files nothing, and
  opening a saved one writes nothing until it changes. The name field names the draft
  and is taken when it is left (Enter does too): renaming moves the file once, a name
  another post holds is refused, emptying it goes back to a technical name, and an
  unsaved post whose name was taken meanwhile files under a fresh one rather than write
  over it. `POST /cases/{id}/drafts` with `"title": ""` (or only spaces) and
  `rename_from` clears a name the same way: a technical name it holds is kept, else the
  lowest free one is taken. Going home, opening another
  post, Back, New post, a proof sent with **To Post**, another case or the tab closing
  each writes what is pending first; a post whose save failed stays open and says so.
- **A proof sent with To Post** fills a geolocation: its sentence, its date, its points
  and its source, with the media its source names on the media post. The post on screen
  is filed first. When the case holds a post of that proof still a Draft, To Post opens
  it as it was left instead, the latest saved of several (*Opened its post in
  progress*); sent again to its own draft on screen, the proof fills that one. Once every
  post of it went out, a new one starts (*Its post went out, so this is a new one*). A
  clip cut for its post (Geo Proof's **Cut for the post**) goes on the media post in
  place of the whole video it came from, which **Edit media** still offers. A clip whose
  file left the case gives the video back.
- **The time a proof states** in its video goes in its geolocation (`#timecode`): an
  instant `[0:15]`, a passage `[0:00–0:07]`, several side by side `[0:00–0:07]
  [1:05–1:12]`, read off its stated scene, the composer showing a **Timecode** field
  then. A proof of a photo or of the whole video states none, the line drops and its
  post is the one it always was. The draft keeps it (`timecode`) only when there is one.
  The built-in Classic, With date and Short layouts print it on its own line, right
  under the description (Short under the coordinates); a template of the analyst's own
  takes it once its layout says `#timecode`.
- **Add to notes**, a note icon beside Open, writes the post into a new case note (its
  place, points, assessment, source and pictures, linked to the proof, the media and
  the draft). **The header's ⋯**, beside the name once the post is saved, holds
  **Delete…**: the draft goes to the Trash with the delete preview and **Undo** in the
  toast, and the composer goes back home.
- **New post** offers five starts, Geolocation across the top. **Geolocation** is the
  composer as it always was: the same fields, the same first post, the same Publish.
  **Map plate**, **Compare** and **Free post** carry their own pictures, or a video, on
  the first post (`firstMedia`) and show only the fields their layout uses. **Compare**
  is a before and after: its layout says the description, the dates, the imagery
  credits and the mention, with no media post under it. **Video thread** asks which
  video, listing those with two proofs or more to post (one already threaded says so),
  and opens its thread.
  A draft or a template says its `kind` only when it is not a geolocation, so every
  draft and template from before reads as one. Another tool starts a post through
  `tools/post/start.js` (`startPost(kind, media, about)`): what Post holds is saved
  first, as for a proof sent with **To Post**, and the media land on the first post, or
  after a geolocation's proof. `about` says what the media show: the name of what they
  came from, its own sentence when it has one, the days they show (or `span`, a before
  and an after kept on their sides) and the credit line on their face (`startFields`
  gives the post's name, `#description`, `#date` and `#credits` from it). The date
  reads one day, or the first and the last joined by an arrow,
  `2024-05-01 → 2025-06-01`. A before and after always says both sides: a side with no
  known date is `?`, and the Date field says under it *The after picture has no known
  date.* (or before) for as long as it holds that `?`. Map plate's export starts a Map plate post
  this way, Compare's export a Compare post and Detect's pins a free post, whose Text
  and source layout carries `#date` for them. A draft saved as a free post from Compare
  before the Compare kind stays a free post.
- **Credits** is a field of the composer shown when the layout uses `#credits`, filled
  with the credit line a Compare or Map plate start hands over and edited like any
  other. The draft keeps it (`credits`, written only when there is one), and an empty
  field drops the line.
- **Alt text** is a small box beside the post's first picture, off by default. Ticked,
  every picture of every post gets a one-line **Alt text** field under it, never a
  video, with a counter against the platform's limit and **Copy** for posting by hand.
  The limits live in one table with the day each was checked and where
  (`lib/postAlt.js` `ALT_LIMITS`: X 1000 characters, Bluesky 2000). A field starts once
  with what the case says of its picture: a proof's picture its sentence, else nothing;
  a Compare or Map plate picture the post's name and dates (*Kherson bridge, 2024-05-01
  → 2025-06-01*, or *Before and after, …* for a numbered post); a video thread's contact
  sheet *Pictures of the 3 places geolocated in the video, numbered as in the post*, its
  map *Map of the 3 places…*. What the analyst writes over it, or clears, stays. The
  box is a preference (`post_alt_text`, carried by the settings backup): a new post
  starts the way the last one left it, and a saved post that keeps a text opens with it
  ticked. The draft keeps the texts by picture (`alt`, a case path to its text) only
  while the box is on and a text exists, so a post without one keeps its shape, and a
  text follows its picture when a video thread changes order. A text is no change to
  what went out, so a post marked posted stays Posted. On X, the only trace of it once
  posted is the small *ALT* badge on the picture.
- **A video thread** posts the placed proofs of one video together: an extra choice,
  never the only way, since each proof still goes out on its own. It is offered for a
  video of two such proofs or more, from New post, from the home's series card and from
  Geo Proof's strip (**Post this video's slides**); a proof abandoned, still geolocated
  or never exported is left out and named. Its column says the video, its places, the
  **Thread title** and the **Order**. The thread title is `#video`, the analyst's own
  words: empty by default (*Optional, e.g. Convoy on the coast road*), never the video's
  name, and its line drops while it is empty; a thread saved before it existed keeps
  saying the video's title in Media, as it did, the field showing it. The order has four
  choices: **Recap first** (the default: the places numbered with their times on a map
  or the proofs sheet, then the video, then a post per place), **Video first**, **Proof
  first** (the first place, then the video naming every place) and **All in one** (one
  post: up to four pictures, the contact sheet past four places). Each post is labelled
  (*Recap*, *Video*, the place's name, else where it stands with its plus code, *Al Jawf,
  Yemen (7H872G9H+FC)*, never a technical *Proof 3*) and carries its files: a place's
  proof picture, the video, the recap's picture; the column's lists call a place the
  same way. `#scenes` gives each place its time and its point, the first one to six
  decimals as the place's post writes it, `1. [0:03–0:09] - 16.018740, 45.528599`, the
  point alone for the whole video, `3. 16.018740, 45.528599`; a proof the analyst named
  says its point there too, its name staying in its own post, and a place with no point
  says its label. A place's post says its sentence, its time and its points, the
  same in every order; changing the order keeps the words written on a post, while the
  recap and the video's post take the order's own start. The mention and the Source
  field (the video's link) are the only fields; the places bring theirs. **No picture
  prints a title**: the sheet and the map show numbers (the sheet its times too), and
  `#scenes` is their legend. The contact sheet is drawn in the browser from the places'
  saved pictures, 1600 × 900, numbered as `#scenes` numbers the places, and filed in
  Media as made from the video (`POST /cases/{id}/scenes/sheet`; the same picture is
  one file). A thread holds 21 posts and says how many places it leaves out, and the
  kind's default template gives its order and words.
- **The recap picture.** Under Recap first, **Recap picture** picks **Map** or **Proofs
  sheet**. Map is the default when the places stand apart: two places or more, more than
  30 m apart; else the sheet stays, and the column says *These places are too close
  together for a map, so the recap shows the proofs sheet.* The map (`lib/recapMap.js`)
  is 1600 × 900, framed by itself on every place, each a numbered pin in the number and
  the colour `#scenes` and the strip give it, with a small scale bar (a thin line and its
  length, haloed rather than boxed, in the bottom left corner) and the imagery's credit,
  always, and no title. It has no north arrow: it is always north up. It is drawn as Map plate draws a page
  (`lib/plate/draw.js` `drawPage`, its credits from `lib/plate/credits.js`), the ground
  laid from the app's tiles (`/api/tiles`, five at a time). Its choices, each redrawn at
  once on a small preview (480 × 270, a dozen tiles or so): **Background**, Satellite
  (Esri World Imagery, the app's default basemap) or Map (OpenStreetMap); **Line in
  video order**, a dashed line from place to place, off by default; **Signature** and
  **Azimut mark**, on when the analyst's default proof style carries them: the signature
  where that style puts it, a proof's margin above the credit (the scale moves to the
  bottom right corner when it takes the bottom left), the mark small in the top right
  corner; the signature needs a logo or a handle, and says to set them in Settings →
  Publishing.
  **Local first**: the preview is drawn on a plain ground, no tile asked, until the
  analyst presses **Show the map**, picks Map or picks a ground, or a press makes the
  map. The preview is what goes
  out, and there is no button to make the map: it is drawn whole and filed in Media as
  made from the video (`POST /cases/{id}/scenes/map`, *convoy recap map.jpg*) when the
  thread needs its picture and no map made matches its choices, on **Publish** (before
  the hand-off to the extension), the recap's **Copy**, **Copy all** and the recap's
  **Download**. Until then the recap shows *Recap map* with Download, then *Making the
  map…*, and the action goes on with the map on the recap. The words of a Copy are
  copied first, while the browser still lets the page write the clipboard; Publish
  without the extension opens the platform once the map is made, or asks for one more
  press when the browser no longer lets the page open a tab. A map that cannot be drawn
  whole (a tile that did not load leaves a hole) stops the action with one sentence
  (*The recap map could not be made, so X was not opened.*) and **Copy report**:
  nothing is opened or handed over without it. A choice changed files nothing: the
  recap waits for a map made for it, and gets the one made before back when the choice
  is undone; the same choices made again are one file. A draft keeps the `map` only
  while it is the one its choices draw. A thread saved before the map opens on its
  sheet. **When the video is over the
  platform's limit** (`lib/videoLimits.js`: *This video runs 24:10, and X takes 20 minutes
  from a free account.*), the column offers the clip a place cut for its post, one per
  thread on the video's post, else its link (with **Cut for the post** named as the way
  to make one); **Post the whole video** goes back. Nothing is cut or re-encoded there.
  The draft keeps `kind: 'video'`, `video`, `title`, `order`, the texts beside `body`
  (`posts`), `first`, and the `sheet`, `clip` or `link` it uses, `recap: 'map'` with its
  `mapOptions` (`background`, `line`, `signature`, `mark`) and the `map` made for them,
  each post its `key`
  (`video`, `place:<proof>`) and `edited`. It saves itself, opens, is marked posted,
  deleted with Undo and handed to the extension, its files on each post, like any
  thread. It goes out with Publish only: Reply under the source is a geolocation's.
- **The extension window** says once, on arriving in Post without the capture
  extension, why it is worth having here: it fills the whole thread in X or Bluesky,
  pictures included, and can reply under the source post or capture it into the case.
  **How to install** opens the guide on the extension's install page; **Not now** puts
  it away in this browser. While the extension is still missing, the header keeps
  *Extension not connected · Install*. Copy and Publish work without it.
- **Post as a reply under the source** is a box under the Source field, shown when a
  geolocation's source is an X or a Bluesky post. Checked, the main action becomes
  **Reply under the source** and the first post loses its link to the source, shown so
  in the post, since the reply sits right under it; a link typed back in goes out as
  typed. Unchecked, Publish works as it always did. The draft keeps the choice
  (`reply: true`), and a template can start its posts checked. With the extension (as
  new as the app), the source post's own page opens, its reply is pressed and the reply
  box filled with the thread and its pictures. Without it, X opens its reply page
  (`intent/post` with `in_reply_to`) with the first post typed, the proof on the
  clipboard to paste (*Picture copied: paste it with Ctrl+V.*); Bluesky has no such
  page, so it says so and copies the post and opens the source to paste it under.
- **Mark as posted**, in the header beside *Saved*, is where a post says it went out:
  the analyst says so, and a link the extension caught is only offered (below). A post is a **Draft**, **Posted**
  or **Changed since posted** when it was edited after (`publish` on the draft: `site`,
  `url` when it has a link, `posted_at`, a print of the post as it went out in `mark`,
  and `changed`; written only once it is marked, so a draft from before reads as a
  draft, and a record an earlier build wrote on opening the site, `opened_at` alone,
  reads as one too). On a draft, **Mark as posted** opens a popover: *Link to the post
  (optional)*, *Keeps it with the proof and dates it.*, then **Mark as posted** (Enter)
  and **Cancel**. A link is taken as the browser shows it (no `https://`, a share's
  `?s=20`) and kept written the one way; one that is no X status or Bluesky post is said
  so and marks nothing; an empty field marks the post posted with no link, on its
  platform (*Marked as posted*). Once marked, a green pill says **Posted · 9 Nov**, the
  post's own day: an X status id and a Bluesky record key (a TID) hold the moment the
  post was made (`lib/post.js` `postLinkDate`, no network), else the moment it was
  marked. Edited after, the pill turns amber, **Changed since posted**. Its menu has
  **Open the post** and **Copy link** when it has a link, **Add the link…** or **Change
  link…** (the popover again, the day and the print kept), and **Not posted**, which
  makes it a draft again. After Publish, Reply or the extension's hand-off, **Mark as
  posted** wears a soft accent until the post is marked or closed; nothing of that is
  saved. The post's site, link and day also go on the proof it is about, as its
  `posted` record (one per post, the latest twenty, the link only when there is one): a
  record of the post, not a source, since it is no evidence. A changed link replaces
  the old one there, Not posted takes the post's entry off, and deleting the draft keeps
  it, since the post did go out. The proof's Details show *Posted on X · 9 Nov · link*,
  or *Posted on X · 9 Nov* with no link, and Add to notes writes a *Posted* section.
- **The extension's word** on a thread it handed out reaches the composer through the
  bridge (`lib/extBridge.js`): the hand-off names the draft it came from (`draft`, the
  draft's name, written first so it exists). A link the extension caught once the post
  went out (`post-link-caught`, a post's link on X or Bluesky only) is proposed, never
  kept by itself, since it can be the wrong post of a thread: on the post open, the
  header's control becomes **Link caught**, its card open under it with *Link caught:
  x.com/desk/status/…* (the link opens, to check it), **Keep** (marks it posted at that
  link) and **Not this one**, and a press elsewhere folds the card while the proposal
  waits under the chip; for another post of the case, a toast says *Link caught
  for “Kherson, Ukraine · 9 Nov”*, the post's label, with the same two, Keep writing it through that post's route; one for
  another case is ignored. A hand-off that went wrong (`post-handoff-report`) shows its
  one sentence in a warning toast with **Copy report**, which copies the extension's
  short plain-text report. When it stopped part way through the post open and says
  where the rest starts (`from`, a whole number from 1 to 100, else ignored), the toast
  also offers **Copy the rest**: the posts from that one to the last, as the composer
  builds them, a blank line between each (*Posts 2 to 3 copied*). Firefox lets the
  extension write the clipboard only right after a press, so this press does it.
- **After the extension's hand-off.** X's reply box takes one post, so a reply of
  several goes out one press per post: the extension fills post 1 (*Post 1 of 3 is
  ready. Press Reply, then Azimut opens the next under it.*), and each Reply the
  analyst presses opens that reply's page with the next post filled under it (*Post
  2 of 3 is ready under your reply.*). A reply box that offers a next post takes the
  whole thread. Once a post is sent, the extension reads its link off the site's toast
  (the account signed in, made in the last five minutes) and hands it to the app as
  `post-link-caught`, once per hand-off: a thread's first post, a reply's first reply.
  The app only offers it. A hand-off that stops (no reply in 10 minutes, the tab closed
  or gone elsewhere, a step that failed) says why in a notification and sends the app
  a `post-handoff-report`: the step and what the extension's selectors found there,
  never a word of the page, and `from`, the first post not handed over, when the posts
  before it all went in. With Alt text on, each post handed over carries its pictures'
  texts (`alt`, a file's path to its text); once the thread is in, the extension opens
  each picture's description (X's *Add description*, Bluesky's *ALT*), types the text
  and saves it, pressing nothing that sends. A post whose pictures offer no such control
  keeps no description, the rest goes on, and the app gets a `post-handoff-report`
  naming the step missed (`alt-2`, the report's *Missed:* line).
- **A narrow header** gives way a step at a time, measured rather than guessed: the
  name field narrows and the quiet line and Reply say less, then Open folds to its
  icon, then the quiet line keeps only **Install**, the kind its icon and Publish its
  verb, then *Saved* keeps its tick and the name field narrows again, so Mark as posted
  keeps its words longest, and last Mark as posted (or its pill) keeps its icon, its
  words in the hover, so a laptop with the case panel open still shows Publish whole.
  Mark as posted's icon is a flag, here and in the home's menus, so it is never read as
  Saved's tick beside it; the green pill keeps its tick once posted.
  Wide enough, it is the header it always was.

## Post templates

Settings → Templates lists the post layouts, made there and nowhere else: the
composer offers no "save as template". Each is for one kind of post, listed under it:
Geolocation (every template from before kinds), Video thread, Map plate, Compare or Free
post. A
layout is a body of tokens (`#place`, `#pluscode`, `#coordinates`, `#description`,
`#mention`, `#source`, `#date`, `#video`, `#timecode`, `#scenes`, `#credits`) and
plain text, the editor offering the tokens of its kind. A token with no value drops
its line. `#video` is the title Media gives the video the post is about, never its file
name. `#timecode` is the time a proof states in its video, `[0:15]` or `[0:00–0:07]`,
for a geolocation and each place of a video thread; `#scenes` a thread's places, one a
line and numbered, each its time and its point, `1. [0:03–0:09] - 16.018740, 45.528599`,
the point alone for the whole video, `3. 16.018740, 45.528599`. `#credits` is the composer's Credits
field.
`#date` is the date the proof
states, and the composer shows its Date field only when the layout uses it. It is
filled from the proof as the case stores it (`2024-03-12`, `2024-03~`), the same in
any language; a time says its clock as an offset on that day
(`2024-07-12 14:30 UTC+3`). A proof with no date leaves it empty and says so, and the
line drops. A token ends where its word does, so a `#dates` or `#placement` hashtag
stays text.

- **New post template** is a menu of kinds, each with its starts: Geolocation's
  Classic, Coordinates only, Short and With date, a Map plate's Plate, Compare's Before
  and after and Dates first, a Free post's Text and source, a Video thread's Recap first,
  Video first, Proof first and All in one. The editor then offers
  that kind's **Start from**, each replacing the body and nothing else (a video thread's,
  its order and texts too). A copy does not
  offer it, and keeps its kind. The same starts are in the composer's **Thread style**,
  under **Built-in** below the analyst's own templates of the open kind (alone when there
  are none, with the link to Settings → Templates kept): applying one changes the body
  only, and its **Remove** goes back to the layout the post had.
- **A video thread's template** is several posts: its **Order**, its **Recap post**
  (`body`: Recap first's first post, All in one's only one), its **Video post** and
  **Each place** (`posts`, a text per role), each taking the token the analyst presses
  into the one last written in. Its preview is the whole thread on three sample places
  (a passage, an instant, the whole video), each post counted per platform. It has no
  media post: each post carries its own files. A template that says no order or no
  texts starts on Recap first's.
- **Reply under the source by default**, on a geolocation template, starts its posts
  with *Post as a reply under the source* checked whenever their source is an X or
  Bluesky post (`reply: true`, written only when checked). A template from the first
  0.3.4 builds, which said `keep-source` or `drop-source` there, reads as unchecked.
- **Duplicate** is on every template, proof or post, and opens an unsaved copy named
  "… copy". Nothing is stored until Save; the 50-per-kind cap answers there.
- **The preview** fills the layout with a sample of its kind or with **Open post**, the
  post in the composer when it is of that kind (off otherwise). The template's own
  mention wins in both, and no mention drops the line. Under it, one count per
  platform, X and Bluesky, red past the limit.
- **A word one edit from a token** (`#coordinate`) would go out as text, so it is
  named under the layout with **Fix**, which mends every copy of it.
- **Default** is the bookmark button on a post row, one for each kind: Geolocation's is
  `post_template`, the others' `post_kind_templates`. A blank post of that kind opens on
  it without a toast, and its **Remove** goes back to the kind's own layout for that
  draft only. Pressing the bookmark again clears it; deleting the template does too.
  They are settings, so the Settings backup carries every one.

## Sheet

A table the analyst works in, which **is** a CSV in the case folder. Three uses no
other tool covers: a comparison grid, candidates down and criteria across; a worklist
carrying its own state and a count; and the half-facts that are too soft to be
entities and too valuable to lose. The graph says what the case believes, a sheet
says what it is checking.

- **The tab opens on its home**, the two halves Inspect opens on: the recent sheets,
  newest edit first with the one last open here leading, each with its rows and its
  progress (*8 of 21 done*); and a way in. That way in leads with what the case could start
  now, counted — *Files to geolocate, 21 imported files, 13 without a proof*, *My
  geolocations, 8 proofs* — and opens the one already built rather than a twin, then the
  templates, then a file, a paste or a worklist over a type. Reopening the last sheet by
  itself answered "where was I" and nothing else, and a case with no sheet opened on a
  lecture about what a sheet is for. **Sheets**, first in the header, saves what was typed
  and goes back to the home.
- **The file is the artifact.** `sheets/<name>.csv`, readable in any spreadsheet, written
  with a byte-order mark so Excel on Windows reads its accents instead of the machine's
  legacy codepage, and replaced by **rename rather than in place** so a save that dies
  half way leaves the previous table whole. A file the system will not take — a
  spreadsheet holding it open on Windows, a read-only folder — is said in a sentence
  naming it rather than a 500. A finding is a column of it — a status, a verdict, the reason — so handing the file
  to someone else hands them the work. Presentation lives in a sidecar
  (`sheets/.meta/<name>.json`): widths, hidden columns, the sort, row colours, which
  column stays in view, **what the app knows about each column**, which entity a cell
  points at, and what a cell said when the case took it. Losing the sidecar costs chips
  and colours, never a finding.
- **Two writers on one file, and the grid does not win.** Because the CSV is the
  artifact, it may be open in a spreadsheet at the same time. A read hands out a
  stamp of the file and every save presents it back; a save that would write over
  work the grid never saw is refused. The stamp is also **checked whenever the window
  comes back** — it is a stat, so it is cheap enough to ask every time — and that one is
  a warning rather than a refusal: nothing has been stopped, so the banner says the file
  moved on and waits. Both banners offer to **read the file first**: how many rows it
  holds that the grid has not, how many cells differ and the first few of them, either
  way round. Reload and overwrite are each irreversible in the direction that matters,
  and choosing between them over one sentence made three rows a colleague added and one
  stray cell the same press. **Both are confirmed**, and reload is the one that needed it
  most: it looked like the safe way out and it is the analyst's own unsaved edits that it
  drops, with the undo stack. A file rewritten byte for byte and otherwise unchanged says
  so and the banner goes.
- **The sheet's own ceiling is refused at the gesture.** 20 000 rows and 64 columns, which
  is where a worklist becomes a dataset and a grid in a browser is the wrong tool. Those
  are the file's bounds, so they used to be answered only by the save — the analyst pasted
  eight hundred rows over the line, the grid took them, and every autosave from that
  moment on was refused with the work on screen and unsaved. The paste, the append, the
  duplicate and the split are refused now, and say how much room is left.
- **Persistence is the file plus its sidecar, and nothing else.** No named views, no
  exported plate: a sheet *is* its own saved reading, and a second frozen copy of its
  state would be a duplicate that drifts. Another reading of the same rows is another
  sheet — and **duplicating a sheet** forks the work rather than the headings, sidecar
  and all, which is the button that answer had been missing. Both live in a **footer of the
  sheet list that does not scroll**, the way the case switcher's own do: they make a sheet
  out of the one that is open, and a case holding fourteen of them must not scroll them out
  of reach. The **other** fork takes the
  columns and leaves the rows, which is what a binder is actually built out of: an inbox, a
  worklist and a reference table at one schema, and a row that has been worked out **moves
  up a floor**. **Moving rows asks twice before it writes**: the first screen
  lists them and lets any be taken back out, because the grid's selection is a drag away
  from being every row on screen, and the second lines the columns up — one of this sheet's
  against one of that one's, identical names taken as the answer and a near spelling marked
  as a guess. What lands carries the rows' colour, their links and what they had already
  promoted, which is exactly what copying by hand loses; a column pointed at nothing stays
  behind, said on that screen rather than in the toast afterwards, because the destination's
  shape is its own and a silent loss reads as a clean move. Both sheets are written by one
  call and the grid's own undo reaches neither, so the toast carries **Undo**: this sheet
  goes back as it stood and the rows come out of the other one, refused if the sheet has
  been typed into since. The reading itself is part
  of what is written down: **the search and the filters live in the sidecar** with the
  sort and the hidden columns, so a sheet reopens on the question it was left on rather
  than on all four hundred rows. Everything that is the grid rather than the table —
  a filter, a colour, a width, a hidden column, the pinned row — goes out through a
  **route that writes the sidecar alone and leaves the CSV byte-identical**, because
  rewriting the file to record that a funnel was clicked moved the modification time the
  stamp is made of: the analyst's own next save then answered a conflict nobody caused,
  and a spreadsheet open on the same file was told it had been overwritten. For the same
  reason a view change never enters the undo stack — `Ctrl+Z` is for what was written,
  not for what was asked. Undo follows that logic throughout: a typed cell records the
  cells that changed, not a copy of the table, so a long afternoon on a long sheet stays
  undoable.
- **Rows are keyed by an `id` column, in the file.** Nothing hangs on a row's
  position, because a file sorted in someone else's spreadsheet would move every
  colour and link one row down. An import that already carries an `id` keeps it
  rather than being given a second one; a file edited outside and stripped of it is
  re-keyed in the grid, said so in one line, and written back only on the next save.
- **A new sheet starts from one of four worklists, or plain.** A verification worklist, a
  geolocation index, a list of accounts, a run of events: the tables an analyst rebuilds by
  hand every case, ten minutes of naming columns before any work happens — and each one
  slightly different, which is why two of their sheets never compare. A template is columns
  **and** what the app should know about them, so the status column arrives as a state with
  its four words painted and the coordinates as a point. Renamed and dropped like any others
  the moment the sheet exists. The five ways of getting rows in — blank, a file, a paste, the
  case's own entities, rows into the sheet already open — sit under **one `New` button**,
  because each is asked once per sheet and as five buttons they crowded a header that also
  carries the title, the subtitle, the sheet list, the export and the delete.
- **The browser neither reads nor writes CSV.** One parser and one writer, both in
  `engine/sheets.py`, so an imported file and a saved grid cannot disagree. Import
  posts the text of a file dropped on the grid, picked from a dialog or pasted into
  one, and the delimiter is guessed — a semicolon export is a table, not an error. A
  **workbook** cannot go that way — it is a zip holding several tables — so it goes up whole
  and comes back as **one sheet per tab under the tabs' own names**, which is how a binder
  arrives; asking the analyst to export six tabs by hand is asking them not to bother, and
  the one that gets skipped is always the "How to use" tab saying what the others mean. A
  tab holding nothing but pasted screenshots reads as empty, and it is **named rather than
  filed**: two empty sheets nobody asked for are worse than the sentence. A workbook cell
  has no words, only a number and a display format, so dates land as ISO — the one spelling
  that means the same thing in every locale, carrying the seconds when a cell has them,
  because a timecode column is what an offset is counted in — and a cleaning pass restyles
  the column for anyone who wants it otherwise. **What did not fit is named too**: the tabs
  past the twenty-fourth, and any tab read only to the twenty-thousandth row or the
  sixty-fourth column. A thirty thousand row export arriving as twenty thousand under a
  toast reading *5 tabs filed* is a sheet that looks whole. An import is also all of the
  tabs or none of them: a tab the filesystem refuses takes the ones already filed back out
  with it, so the retry does not land a second copy of half a binder.
- **A clipboard block is not a file, so it is read here.** It is TSV, and a paste is a
  patch into a selection whose geometry only the browser knows. `Ctrl+V` lands a block
  from the cursor: rows grow to fit it, columns never do — a block wider than the
  sheet is clipped and says by how much, because a heading nobody chose is worse than
  a cell lost — and the key column is never written. A wall of links with no tabs is
  read as an inbox instead: one row per link. `Ctrl+C` copies the selected rectangle
  back out, quoted so a spreadsheet reads it whole.
- **Editing is a grid's.** Press a cell and pull to select a rectangle, shift-click a far
  corner to do the same in two clicks, typing
  starts an edit on that character, Enter and Tab commit and move, Escape backs out one
  step at a time — what is open, then the edit, then the cell itself —
  arrows walk the cursor in the order the screen shows. `Ctrl+F` reaches the search,
  `Ctrl+A` ticks every row on screen, `Ctrl+Enter` adds a row, `Ctrl+D` copies the top of
  the selection down, Home, End and the page keys cross a long sheet, Delete empties the
  selection. Deep undo, and the sheet autosaves.
- **A bar above the headings holds the cell under the cursor.** A cell is thirty pixels
  tall and as wide as its column, and the sentences an analyst writes into a `Title` are
  neither: the bar is the same cell, full width, where a long value can be read and
  rewritten. Enter commits and steps down, Escape lets go of what was typed, and the corner
  pulls the bar open as far as the value needs. It is drawn whether or not a cell is picked
  — a bar that arrived with the first click pushed the grid down under the pointer, and the
  drag that click had started painted a selection nobody aimed at. The key column and the
  columns the app writes are shown and refused, for the reason their cells are.
- **The grid always ends on an empty line, and writing in it is what makes it a row.**
  What a spreadsheet does, and Tab off the last cell grows the sheet the same way. A
  `+ Row` button in the footer stood in for this: a trip to the bottom of the screen and
  then back to the column being filled, for the most ordinary thing a grid does. The
  editor opens where the click landed.
- **The list of gestures has a door.** The grid keeps its power under a right-click, which
  is right — and a right-click nobody tries is a feature nobody has. `?`, or the `i` in the
  header, opens one list naming the keys and the gestures. It is not a tour and blocks
  nothing.
- **A row can be kept under the heading while the rest scrolls.** A comparison grid is read
  *against* something — the confirmed case, the sample that sets the standard — and at row
  twelve that reference had scrolled away, which is the point of the grid gone. Pinned from
  the gutter, drawn a second time rather than moved, and not drawn at all while the filter
  leaves it out: a reference the count says is not on screen would be the grid disagreeing
  with itself.
- **Rows are thirty pixels, or four lines.** Right for a worklist and wrong for the column
  the reasoning is written in, so the sheet says which it is and remembers.
- **A line beside the sheet's name says what the table is for.** The binders carried a
  whole "How to use" tab of annotated screenshots; most of what it said belongs on the
  columns it was about, which is what a column's note is, and what is left is a subtitle —
  so it sits where a subtitle sits, next to the name, and is written in place rather than
  in a dialog. A pencil beside the name when there is none, since the `i` in that header is
  the help; no menu row for it anywhere.
- **A colour can be told what it means.** Six colours and no legend is six colours whose
  meaning lives in one analyst's head, on a case that gets handed over. Only the ones the
  sheet actually paints with are worth naming; they are named in a panel and read back in
  a strip under the rows.
- **The gutter carries the row's number and its own menu.** The number, because the key is
  a handle (`r7a3f…`) and nobody says "row r7a3f" out loud; the tick box takes its place on
  hover or once anything is ticked, since two controls in 34 pixels would be neither. A
  right-click there inserts a row above or below — where the analyst is reading, rather than
  four hundred rows below — duplicates rows, paints them, opens one field by field, or
  deletes them. A duplicate is keyed anew and carries no colour or link of its own: the
  gesture is a candidate that turns out to be two, and the second one has had no work done
  on it yet. Every gesture made on one row acts on **the batch when that row is in it**, and
  the menu's heading says which it is.
- **Many rows at once, off one selection.** Shift-click in the gutter ticks a range in
  the order the grid draws; a box in the header ticks everything shown, and only what is
  shown. Painting, deleting, filling a column and promoting all act on **what is ticked,
  or failing that on the rows dragged across** — one rule, said in the bar, because two
  selections that disagreed meant a screenful selected by dragging could not be painted
  and forty ticked rows could not be copied. The bulk fill leaves out the columns the app
  writes itself: a value put in one of those is gone by the next save. What those rows can
  become is **a bar drawn over the last of them** rather than ten more controls in the
  question bar, where ticking one row wrapped that bar onto a second line and pushed the
  table down a row height under the pointer that had just done the ticking.
- **Columns are the analyst's.** Drag a heading to move it, which moves it **in the
  file** where a collaborator will see it. Insert one on either side of the one being worked
  on — a verdict next to the claim it judges — and it lands in rename, ready to be named.
  Duplicate one and the copy carries its cells, its width, its role and its note, but none of
  its links: a link is the case's answer about one cell, and two cells claiming it would state
  one edge twice. Rename in the heading itself on a double-click. One column can be kept
  beside the key while the table scrolls sideways. A URL in a cell is a link, shown as its host: a hundred
  and twenty characters of query string in a row thirty pixels tall says nothing.
- **A row can be read down instead of across.** Fourteen columns do not read by
  scrolling sideways, so a panel shows one row field by field, every box editable, its
  links live, and how much of it is filled. It walks the rows on screen, not the file's
  own order. Each field **offers what its column knows**, as the grid's own editor does: a
  state or a set of values draws its words to click, a yes/no field is a toggle, a date
  field carries its picker, and a column the app fills is shown rather than typed into.
  A panel that put a bare box on all fourteen was a worse place to work than the row it
  was showing, on exactly the columns somebody had set up.
- **Everything that opens over the grid closes on Escape or a click beside it** —
  the heading menu, the gutter menu, the filter, the columns list, the sheet list, the export
  menu, the fill bar, the row panel. Every row of a menu **acts and then closes**, in that
  order: closing first clears the column the menu was opened about.
- **Six passes fix a column that came from somewhere else**, and each says what it would do
  before it does it — how many cells, and the first few as they would come out. Find and
  replace, on this column or every one, whole-cell or inside the words; the spacing taken out,
  because `Kherson ` and `Kherson` are two values in every menu and the difference is a
  character nothing can draw; the casing; a split into as many columns as the separator makes,
  keeping the original unless told otherwise, and up to eight — a cell that breaks into more
  is prose with punctuation in it, so the eighth column keeps the whole tail rather than the
  pass dropping what it could not place; a merge of several into one, empties left out;
  and the links lifted into a column of their own, as addresses or as bare hosts — eleven rows
  sourced to one channel is a finding, and it is invisible while the hosts sit inside
  sentences. They read the rows **on screen**, filter and all, and the count says which. There
  is no regular-expression box: a pattern with no preview is how a sheet loses a column.
- **Sort is three states on one control**: up, down, off. A blank cell sinks to the
  bottom whichever way the arrow points, because blank is "no answer yet" and it must
  not bury the rows that have one. A **second column breaks the first one's ties** —
  *by status, then by date* is how a worklist is read, and one key meant re-sorting by
  hand every time the first tied. It is offered in the heading menu rather than as a
  fourth state on the heading's own click, since "sort by this" and "sort by this too"
  one gesture apart would be a trap, and the heading it breaks ties on carries a smaller
  mark.
- **Two rows can be folded into one, and one row split into many.** The grid could already
  find the values said twice and paint them, and then left retyping one row out of three by
  hand — on an inbox where the same address arrives from three channels, that is the whole
  job. Merging keeps the fullest answer per column and the first row's key, so its colour,
  its links and its promotion record survive. The other direction is the shape every "to be
  sorted" inbox arrives in: a cell holding five links, or `Buk-M2E, ZU23-2, S-300` in a
  worklist that wants a line each, becomes a row per value with the rest of the row copied
  down. Splitting a column into *columns* is a different question and lives in the cleaning
  passes.
- **A batch of rows can be added to the sheet already open.** Import files a new sheet,
  which is right the first time and wrong every time after it: the daily batch of links
  belongs in the worklist that already carries the statuses. Which incoming column lands
  where is proposed by name and then the analyst's, and **what would be dropped is said
  before the press** — "40 rows added" over three silently discarded columns is the kind of
  import somebody finds out about a week later. It lands as one undoable step.
- **A heading has three doors, split by how often each is wanted.** The **funnel** asks
  something of the rows and stays lit whether or not the heading is hovered — hiding the
  gesture made a hundred times a day behind a hover is how an analyst concludes a grid
  cannot filter. The **short menu**, on the `...` and on a **right-click anywhere on the
  heading**, is the frequent list: sort either way, filter, insert a column left or right,
  duplicate it, rename it, the cleaning passes, point its cells at the case, keep it in
  view, hide, delete. And its last row opens the **setup panel**, which is the rare half.
  Before the menu existed the `...` opened the panel straight away, so declaring a role had
  a door and inserting a column beside the one being worked on had none.
- **The setup panel is what a column *is*, with room.** A name, a role with its own
  vocabulary, a line of instruction and the readings the role earns do not fit in a popover,
  and scrolling a menu is how you lose your place in it. So it takes the same right-hand slot
  the row panel uses — you are either reading a row across its fields or working on a column
  down the rows — and it **stays open and follows the next heading clicked**, which is what
  makes declaring six roles six clicks. Escape closes it; a click in the grid does not,
  because working on a column means clicking cells of it. Nothing the short menu offers is
  offered here twice: one screen saying a thing in two places is how the two come to
  disagree.
- **A column can be told what it holds, and the file keeps the words.** A role lives in
  the sidecar — a state, a set of values, a point, a date, a picture, and the two the app
  fills itself — and it is a **lens, never a validator**: `To be found` in a coordinates column
  and `OK en cours` outside a status vocabulary are what a real binder holds on every
  page, so they are shown as written and the filter still finds them. The role is
  suggested from the column and confirmed by hand, never applied on a guess. What the
  column is shows **in its heading**, and the cells its lens cannot read carry a mark and
  are reachable as a filter — a column that accepts anything and says nothing about what
  it skipped is a column whose total nobody can check.
  - **The sort follows the role**, which is the most visible thing one buys: without it a
    `dd/MM/yyyy` column puts 1 February before 31 January. A date sorts by the moment, a
    state by its own vocabulary's order, a counting column by the count, and a cell the
    role cannot read goes to the end rather than into the middle of January.
  - A **set of values** draws one chip per value, and clicking one **opens the column's
    words** to change it, the way a status chip does: a chip reads as the control that
    changes it, and a click on `to do` that filtered the column was the grid answering a
    question nobody asked. Filtering on a value is the heading's funnel, and reads
    `Buk-M2E, ZU23-2` as two answers rather than comparing the whole cell. A chip the app
    wrote, or one naming another row, still filters on the value pressed. Whether a cell may hold several is a question with a box for
    the separator under it, rather than one box whose placeholder was the word "no". The
    value menu counts how many rows hold each, which is what the filter hands back. Reading
    `2x S-125` as two of `S-125` was offered here once and is gone: it kept a **count inside
    a column of words**, where nothing could total it — a count belongs in a number column
    beside a column naming what is counted.
  - The **vocabulary is edited as rows**, not as text: the word, the colour it carries
    picked from the palette, how many rows use it, and two buttons to move it — because
    the order *is* the ranking the sort reads, and `to do → in progress → done` is the
    order of the work rather than the alphabet. A → Z and Z → A are offered and never
    applied on their own. The panel also says which declared values nothing uses, and
    offers to take in the words the cells hold that the list has never heard of.
  - A **state** column starts on four words already painted — to do grey, in progress blue,
    done green, ruled out red — because that is what makes the grid readable at a glance.
    A vocabulary the column brought itself is left unpainted: `done` among an imported
    binder's own words means what the binder meant.
  - **Yes / no** is two words the column chooses, and a click on the cell flips between
    them. Two answers is a toggle, not a menu.
  - A **number** gives **one** answer in the footer, over the rows on screen, and the
    column says which: nothing, how many were read, a total, an average, or the range it
    covers. The footer **names the reading it gives** — `total 52 km over 2` — because a
    total and an average are the same digits from down there. On screen and not in the
    sheet: filtering to the twelve rows left to check and then being told the total of all
    four hundred answers a question nobody asked. The column also carries a **unit** —
    `%`, `€`, `km` — written beside the heading, once, since the cells keep the digits the
    file holds. It can be repeated after every cell on request, which a column of shares
    wants and a column of distances mostly does not. `1 200` and `12,5` are read, and
    `~9` is read because an estimate is
    still a number; a digit buried in prose is not, because extracting it would also turn
    `AB-123` into 123. What it could not read is counted beside the answer and is one
    click from being the only rows on screen.
  - **A comma is a decimal mark, everywhere and without a switch.** `12,5` is twelve and a
    half, `1 200` and `1'200` are twelve hundred, and `1,234,567` is refused rather than
    read as a million: two commas cannot both be decimal marks, and guessing would put a
    value a thousand times out into a typed field with nothing said. The same reading
    settles a point, so `48,8` is one number and not a pair of coordinates — a pair needs a
    separator the comma cannot be mistaken for (`48,8566; 2,3522`, `48,8566 2,3522`) or a
    full stop already doing the job. Unlike the day-or-month order of a date, which a column
    carries its own answer to, this one is not configurable: a binder is written in one
    convention and it is the European one.
  - **The editor offers what the column knows, and never only that.** A state or a set of
    values offers its vocabulary beside the box, **narrowed to what is being typed** — on a
    multi-value column, to the value after the last separator, because that is the one
    being written. ↑ and ↓ move through it and Enter or Tab takes what is lit; clicking
    stays a toggle, which is how a list is built and unbuilt with the mouse. A word the
    column has never heard of can be **taken into its vocabulary from the cell**, which is
    where the decision is actually made. A date column offers a calendar that writes the
    form the column already uses, keeping an hour the cell had. The free text box always
    stays: `OK en cours`, `AFTER` and `To be found` are what the binders write, and an
    editor offering only a closed list would refuse exactly the cells that carry the
    reasoning.
  - A **point** is checked as it is read: two decimals is about a kilometre and says so,
    and a transposed pair is flagged rather than refused. The column can be put on the
    map as a session layer, where a coarse point is drawn as the circle it actually
    claims, and **one cell can go over on its own** from the row being read, which is
    what a worklist asks far more often; it can be swept for pairs too close to be two
    places; and it can be
    rewritten in one form on request — the one action that touches the file, because a
    role by itself never improves it.
  - A **date** column says which of three things it holds — a date, a time, or both — and
    the cell offers the picker made for it. Declared rather than guessed, so a column that
    is still empty can be told it holds times. A bare `hh:mm` stays a time of day: the
    binder writes `01:57` for an event whose date is in the sheet's title, and inventing
    that date would be inventing evidence. The column can **open the Timeline on the
    period it covers**, which is what that does — it files nothing there.
  - A **picture** column draws each cell as the picture it names, in the row, with the full
    size one click away. Two things count as one: an address, and **a file this case
    already holds**, written as the case-relative path a collaborator reads the same way in
    a spreadsheet (`media/quai-sud.jpg`). The case's own files are the common case — a
    geolocation index is worked on the images in the case folder — so **an image dropped on
    a row** goes into the case's `media/`, the cell cites it by path, and the cell points at
    the media entity so the graph knows the row rests on it. Only the address kind reaches
    the network, which the panel says before the role is chosen. A cell holding neither is
    shown as written and marked, never refused; an absolute path names a disk this case does
    not travel with, so nothing is drawn for it.
  - A **source** column declares where the pages a row rests on are written. Links are
    already live in any cell without a role, so what declaring one buys is a promotion that
    knows which column to file as bookmarks.
  - **Another row** says the cells name other rows of this sheet, and which column's words
    do the naming. Names and not keys, because the file is what a collaborator reads.
  - An **offset** says the cell is a time either side of a **sync point**, and which one.
    `-00:01:50` before it, `00:04:04` after; the column sorts by that, which is the order
    the videos actually run in and is usable long before the sync point has a time. Naming
    and dating the sync points is one press from here, because a column of offsets is where
    anybody wants them.
  - Three columns are written **by the app, into the CSV**: the date a row first appeared,
    once and never again, a column the app answers, and a column the case holds. All three
    are in the file rather than beside it because `On map: YES/NO` is exactly the column a
    collaborator opening the spreadsheet reads. `Added on` dates every empty cell on the next save, including rows
    already in the sheet, and the panel says so before it is chosen. The answered column
    holds one of three readings, and the heading says which — a heading drawing a globe over
    a column counting criteria would lie about it:
    - **on the map**, whether what the row points at has a place. Restated on every **read**
      as well as every save, so a place added an hour ago does not leave the sheet reading
      NO; the read still writes nothing.
    - **how complete**, how many of the columns it was told to watch are answered, and
      **score**, how many of them say yes — the one kind of formula this tool has, and the
      number a comparison grid is built to end each row with. A yes is spelled the way each
      watched column spells one: a declared yes/no column answers with its own first word,
      and a tick column somebody typed by hand holds `x`. The cells hold the **bare number**
      so a spreadsheet can total them; the denominator is said once, in the heading and the
      panel, rather than four hundred times in cells thirty pixels tall. A column told to
      watch nothing writes nothing, because a score over the whole sheet would change under
      the analyst every time a column was added.
    - **its point** and **what it is joined to**, which are what the case *knows* rather
      than whether it knows: the coordinates of the entity one named column points at, and
      the far end of that entity's edges. One hop, and blank where the answer is not one
      thing.
    - **still in the case**, whether the case still holds what the row was **built** from.
      The only one that reads where the row came from rather than what its cells point at,
      because it is the only one asking about something that may be gone: a link naming a
      deleted entity is dropped on the next read, so by then the cell that would have
      answered is already blank. Rows somebody typed themselves stay empty — they were
      never built from anything.
  - **Held by the case** is the third, and it is the one role the app writes that still
    carries a **link**: the cell opens the entity it was filled from. Typing in it is
    refused, because a refresh rewrites it — a view somebody can type over is a view that
    starts lying the first time they do.
  - Losing a role is **said out loud**. Renaming a column in a spreadsheet takes its role
    and its map layer with it, and a lens configured in ten minutes is not a colour.
- **A sheet can be built out of the proofs the case already holds, and kept level with
  them.** The template that fetches and this shape carry almost the same columns and run in
  opposite directions, so the modal asks which **before** anything else: *one row per
  entity* takes a type and its fields, *files to geolocate* and *my geolocations* take
  neither. The outgoing one is **one row per point** a proof concludes on, POV or not, so a
  video placed at three spots is three rows: the proof's title, its date as Geo Proof holds
  it (`~` kept), the place, whether the camera stood there, coordinates read off the graph,
  the media it rests on, the address of the post that media came from, and the
  description. Those columns are the case's and are read-only, changed in Geo Proof;
  Status, Notes and any column added are the analyst's. A proof placed nowhere still gets
  its one row. It offers no *Build proofs* button, because the proofs already exist and
  there is nothing left to fetch.
- **Files to geolocate is the same kind of sheet turned the other way**: one row per
  picture or video the analyst imported, never a frame, a capture or a render the app made,
  with its source address, the proof that answers for it however many steps down (a proof
  on a frame answers for the video), and that proof's place. A row starts *done* when a
  proof already answers and *to do* otherwise, so the count is true the day it is built.
  The case's columns are locked, Status and Notes are the analyst's. Refresh files the
  files imported since and moves a row to *done* once a proof answers it, from *to do* or
  *in progress* only: *ruled out* or a word of the analyst's stays. The Media Library's
  **Worklist** opens it, building it on the first press, and a second press opens the same
  one rather than a twin.
  - **Refresh is a press, never automatic.** A sheet that rewrote itself when it was opened
    would move a file under somebody who came to read it, and it would fight the stamp that
    keeps two readers of one file from overwriting each other. It files the proofs and the
    points added since, restates the columns the case owns, and says what it did. A row is
    found again by its proof and its place, so a sheet built when this shape was one row
    per proof keeps its rows and its columns, and gains a row per point it lacked.
  - **It adds and never removes.** A proof deleted since the build keeps its row, its notes
    and its colour, and answers NO under *In case*. Filtering on that column groups them so
    they can be deleted in one gesture — but that is the analyst's call, because the notes
    on those rows are theirs and nothing in the app wrote them.
- **A column of sources can be asked whether it still answers.** Most of a worklist is
  links, they rot, and nothing said which ones already had — so a finding could be
  published on a source gone for a month, and the only way to know was to open four hundred
  tabs. This is the one part of a sheet that reaches the network and it goes on a press,
  over the rows on screen, in batches so the count moves. Distinct addresses rather than
  rows, because eleven rows sourced to one channel hold one address eleven times. Five
  answers, and keeping them apart is the point: it answered, it answered *not here* (404,
  410), it answered something else — a login wall, a rate limit — which says nothing about
  whether the page is there, nothing answered at all, which says as much about the
  connection, or it was never asked because the sweep ran out of its own time budget. That
  last one is counted beside the others rather than folded into them: nobody asked, so
  nothing was learnt about the page. The dead ones are chips that paint their rows. An
  address on this machine or its own network is refused unasked, and so is a redirect onto
  one — the addresses come from the sheet, and a sheet arrives by import, by paste or as a
  workbook somebody sent.
- **A column of place names can be read into coordinates, and back.** Both directions
  existed elsewhere in the app and the sheet, which is where a geolocation index is
  actually worked, could reach neither — so four hundred rows of `Kherson, Ukraine` were
  typed in by hand. Reading names into points has two halves, and the case comes first:
  a row whose cell points at an entity the case has placed is answered off the graph,
  exactly and at once, and only the words left over reach the geocoder. An entity two
  different points reach is left alone rather than resolved. Two rules hold the rest:
  **nothing is applied on its own**, since a geocoder's first hit is a guess and a guess
  written unattended into a column of evidence is indistinguishable from a coordinate
  somebody read off a photograph; and **only where the target cell is empty**. Distinct
  values one way — forty places out of four hundred rows — and row by row the other,
  because five decimals is a metre and rounding two readings together would put one row's
  answer on another row's ground. The lookups are paced, so they run one at a time with a
  count and a Stop.
- **How far along the work is, off whichever column carries it.** One column per sheet,
  chosen or accepted from a suggestion, never imposed: the footer reads *312 filled · 156
  left* on any column, or the tally per bucket when that column is a state. It needs no
  role at all, which is the point — the binder this most has to replace is a geolocation
  index with no status column, and its question is the fill rate of one column. The count
  of rows left is **a link**, so those rows are one click away and the chip that appears
  was asked for. A sheet opens on the question it was left on and on nothing else: posting
  that filter automatically could not tell a cleared question from one never asked — both
  are an empty table in the sidecar — so it came back on every reopen, which reads as a
  filter appearing from nowhere.
- **A worklist can be built out of what the case already believes.** Promotion runs one way
  — rows become entities — and until this existed an analyst holding forty places in the graph
  had two answers, both bad: retype the forty, or work in a Board with nowhere to write a
  verdict. Say which type and which of its declared fields deserve a column, and the sheet
  arrives as one row per entity plus the two the work needs, a status and a note. Nothing else
  travels: a sheet holding every attribute would be a second copy of the graph, and the second
  copy is the one that goes stale. Each row **points back at what it came from**, in the same
  place a promotion writes a link, so editing the rows and promoting them again updates those
  entities rather than minting twins. The sheet gains its `mentions` edges in the same write.
- **A sheet goes into the case in one declaration and one press.** There were six roads out
  of a sheet — rows, a column's words, pointing a column at what the case already held, a
  column of hours, a column of row names — and none of them could draw an edge, because an
  edge needs *two* columns and each road only ever saw one. A line of a binder says *this
  person, in that unit, with these sources, at that point*; the case got the nodes and lost
  the sentence. So: **a mode per column**, then the joins, one plan, one press.
  - **The mode is offered only where the column's role carries it.** *Ignore* by default,
    because only what was asked for travels; *one entity per row* for the subject; *one
    entity per value* for a column of words; and, where the role says so, *Place
    (coordinates)*, *Bookmark (links)*, *Claim (hours)*, *edges to other rows*. The three
    that mint one type and only that type are named after it, in the vocabulary's own word,
    with what the column has to hold beside it.
  - **The grain of a column of words is the word**, split on the column's own separator, so
    `Buk-M2E, ZU23-2, S-125` in one cell is three. Forty pieces of kit out of four hundred
    rows, created where the case has nothing under that word and attached where it has
    exactly one. What a word *means* is kept on the column rather than on a cell, because
    one cell cannot hold three links; on a column with no separator each row also points at
    what its own word means, which is what the answering columns read.
  - **The joins are not drawn by hand.** For every pair of columns that designates
    something, the vocabulary is asked what it allows between their two types, and only the
    pairs with an answer are offered. A person and a point have no verb between them, so
    that pair never appears at all. The select shows the registry's own *readings* — "is a
    member of", "has member" — which settles the direction without asking a question about
    direction, and a pair the vocabulary leaves no choice about arrives filled in. One
    confidence for the whole pass, applied to the edges that can carry one; the edges enter
    **confirmed**, because the analyst chose the verb and pressed the button.
  - **The scope is one for every mode: the ticked rows**, or the visible ones when nothing
    is ticked, said in those words on the screen. A pass whose halves disagreed about scope
    is a pass whose count never adds up.
  - **The plan is read first, and it is the same code the press runs.** Row by row and word
    by word: a new entity, one attached to something the case already holds, one already
    sent updated, a row left alone, or a cell that cannot be read at all — then the edges,
    with the rows that have only one end and why. The button says how much it will write
    over both layers.
  - **A name is not an identity.** Two people share a name, so a row matching an entity
    already in the case is *offered* it, never merged into it behind the analyst's back;
    attaching is a choice made in the plan. The one exception is the identifier family,
    where the value is the identity — one address is one email.
  - **A field is checked before it is stored.** A column mapped onto a declared field goes
    through the same readings a typed form does, so `about 12` in a number field stops that
    row and says why instead of landing as text in a field nothing can sum. Nothing else
    travels: a pass that swept every column would put a worklist's private notes into the
    case's record of a subject.
  - **Pressing twice is safe.** The row keeps a link to what it made, so the second press
    updates it — and only while that link still points at something of the promoted type,
    since a cell pointing at a place is not a person waiting to be overwritten. An edge
    already stated is restated rather than stacked.
  - **A column of coordinates makes places**, with the uncertainty radius the cell's own
    precision claims: two decimals is about a kilometre, and a place stored without saying
    so reads on the map as a pinpoint somebody established. Points on their own are that
    column as the *subject*, typed Place — it is its own point, and nothing asks a second
    time — and a place is **named by whichever column is the subject**, so a geolocation
    index names its points by making the title column the subject and this one the point. The verb joining the row to its
    point is read out of the vocabulary — a structure is *sited at* its ground, a media *was
    recorded at* its own — and a type the vocabulary puts nowhere is refused at the door
    rather than given a latitude nothing in the app would show. A **column of addresses**
    files its pages as bookmarks that mention the row's subject, one per URL however many
    rows cite it.
  - **Nothing that owns a file is born from a cell.** A media, a capture, a proof, a post
    hold bytes and a cell holds an address, so those types are not on offer here at all.
    Going to fetch the file is the proof import's road, and it is the only one that may.
  - A **Claim is not something a bare row can become**: a statement carries what it is
    about, when it applies and what it rests on, and a row promoted on its own would be a
    statement about nothing. It is a mode of its own, on a column of hours.
  - **The press is all or nothing.** The file is checked before the first entity is written,
    the graph and the sheet's own save happen in one transaction, and a file that moved
    under the analyst takes the whole pass back — where entities without the links that make
    a second press an update would be minted twice by the retry.
  - Afterwards the row says whether it still agrees with the case: the sidecar keeps what
    the cell said when it was taken, and a cell edited since carries a mark. The sheet gains
    a `mentions` edge per promoted row.
  - **A sync point with no time is dated from where the hours are declared.** A column of
    offsets carries its rows' order straight away and their hours only once the shot itself
    is dated, so the mode that reads them says which sync point it counts from and offers to
    date it. The sync points open **over** the declaration rather than instead of it: what is
    on screen is what sent the analyst there, and closing it to ask for one date would be
    asking them to declare the whole pass twice. Escape answers the dialog on top.
  - **Ticked rows can be one thing rather than one thing each.** The only shape row-by-row
    gets wrong by construction, and it is a common one: the binder's geolocation index puts
    a cross-border event on two lines, one point per country, same title, same source.
    Promoted separately that is two events and the second is the copy nobody corrects. As a
    group it is one entity with a place per point, every row pointing at it — so either of
    them can say it is already in the case. Where two rows disagree about a field the first
    answer is kept and the preview says which field that was, because rows grouped on
    purpose differ in the detail; that is why there are two of them.
- **A geolocation index builds its proofs, which is the one road that fetches files.** Its
  own button, offered only on a sheet that can feed it — two columns of addresses and one of
  coordinates — because it is not a mode of the press above: that one is a single transaction
  precisely because nothing in it touches the network, and this one is a hundred downloads.
  Three columns and a note say what a row is, and how much of that the row holds decides what
  it becomes: coordinates alone pin a place, coordinates and the footage pose that media on
  its ground, and all three write the whole constellation a hand-made proof import writes —
  the footage, the proof that is the published picture as published (kept with the proof,
  not in Media), and the point they all state. The proof address's cell points at that
  proof, and the note becomes its description.
  `derived-from` is honest here and only here: the app fetched the bytes and composed the
  proof, so it observed the derivation. A proof with no footage is **refused**, stricter than
  importing one post by hand, because a binder holds dozens of those and nobody re-reads them
  one by one. So is a geolocation with no point, and a proof with no name — a proof's name is
  its filename.
  - **The plan downloads nothing.** The three refusals come out of the cells and the three
    "already there" answers out of the case, so the analyst reads what a hundred downloads
    would do before one of them starts. Rows ruled out on their status are dropped by default
    and handed back with one click, because a filter nobody can see is the app deciding which
    lines of a binder count.
  - **A source cell may list several addresses.** There is no `+` in a spreadsheet, so a
    cell holding them separated by spaces is how a hundred rows say what the import dialog
    says with boxes: one proof, one point, and every file it rests on. The published
    picture stays one — a row builds one proof, and a second picture would be a second.
    A row counts as already there only when every one of its addresses is already
    downloaded, since half a row is a row to run.
  - **A post with several attachments is answered, not asked about.** That is the ordinary
    shape here — a published geolocation is a picture and the post carries the material
    beside it — so a picker would fire on nearly every row, and a hundred rows cannot each
    raise one. Each slot takes **everything it can use and the extractor vouches for**:
    the proof takes every picture, since a post publishing a set published one proof,
    stacked as published, and the material takes every picture, clip and recording, since a post
    carrying two photos of the scene carries two things that were shot there. Keeping the
    first of them keeps half. What is *not* vouched for is left: the video extractor reads
    a post's media and the media of the post it quotes into one list, and past the first it
    cannot say whose a clip is. Taking it would file a stranger's video on this row's
    point, which is a wrong statement where a missing one is only incomplete — and the two
    screens with somebody in front of them list it instead.
    A row behind a login wall says the next move rather than the platform's own wording,
    which is a tombstone nobody can act on: no browser picked in Settings, one picked that
    is not signed in to that site, or Windows refusing to hand over a Chromium cookie store
    at all — three different instructions, not one sentence.
    The two still differ on what happens when nothing matches, because their contents do:
    a post carrying no picture holds no proof and is a row to do by hand, while the
    material takes a still photographed on the spot as readily as a clip.
  - **A hundred rows a press**, against five hundred for the press above, and the door says
    how many are left over: a cap that only refuses reads as a breakdown where the same cap
    naming the remainder reads as the queue it is.
  - **Atomic per row, not over the batch** — the opposite of the press above and for the
    opposite reason. Failing at row 47 is no reason to hand back the 46 that worked, so the
    files are fetched into a staging directory first and nothing enters the case until they
    are held. A row behind a login wall ends as the words **needs a login** rather than as a
    prompt nobody can answer a hundred times; naming a browser in Settings is what unblocks
    it, and the next press walks through on its own.
  - **It runs as a job with a bar and a stop**, because two minutes of downloads is
    something to watch rather than wait out. Counted in rows, not in bytes: a row is the
    unit this road is atomic in, and how far down the binder it has got is what the analyst
    is actually watching. Stopping keeps every row it finished and leaves nothing of the
    row in flight: that row's bytes are still outside the case. When it ends the screen
    **says so** — past tense, each row carrying what it turned out to be rather than what
    it was going to be, and a way out called *Done* rather than a Close that reads as
    walking away. It also names the one loose end: a proof composed of several pictures has
    no export until somebody opens it.
  - **Pressing twice is safe without the sheet remembering anything.** A proof is found by
    **where it was published**, a media by the page it was downloaded from, a place by its
    point — so a second press refreshes the point, the note and the name, and downloads
    nothing. Identity is the address and never the name, because the name is a cell
    somebody corrects: keyed on it, a corrected title built a second proof beside the first
    and left the old one standing, which is the duplicate nobody notices since both look
    right in the list. Corrected, the title now *moves* the proof, spec and export with it.
    What the sheet keeps is the chips: each cell ends up pointing at what it produced.
  - **One picture published about two places is one proof.** The binder's cross-border
    shape — a strike written on two lines, one point per country, same video, same
    published picture. Row by row that filed two exports of one image under two names and
    fetched both files twice. Now the rows sharing a published address are one proof: the
    first composes it, and the others add their point to the **material and to the proof
    itself** — the published picture is what establishes both positions, and saying so is
    the whole reason two lines were written about it. The composer's own coordinate field
    goes on stating one point, and only the edges it wrote are reconciled by a later save:
    an edge stated by another hand is a separate claim about the same file, so these stand.
    The proof always `depicts`, whatever POV says, having been composed and recorded
    nowhere. Two rows under one *name* at two different addresses are still refused: that
    is a collision over one filename, not one proof. And a row that joins one that did not
    build — a dead link, a login wall — **fails with that reason** rather than writing a
    point onto nothing: reported as done, the second position of a cross-border strike
    disappeared with no red line and no later press to take it again.
- **The reading is handed over three ways.** The rows on screen as a CSV, the rows ticked as a
  CSV, or the whole view **copied as a Markdown table** — which is what goes into a note, a
  ticket or a message, and retyping twelve rows into the Notebook is where citing a sheet
  stops. The Markdown carries a **quoted header** saying where it came from: the case, the
  sheet, the filter that was on, the sort, how many rows of how many, and the hour. That is
  the one thing a sheet plate would have carried and the only part worth keeping — twelve
  rows pasted with no filter named are a sample presented as a set, and *12 of 468* read
  without seeing why is worse than no number. A CSV is **written into the folder this case files sheets in** (Settings → Storage,
  the case's own `exports/` until another is picked), the way a note's PDF and an analysis
  plate are. Where it lands is named **in the export menu and changed from there** — sending
  the analyst to Settings to file a table somewhere else was the one export in the app that
  did that — and the sentence saying where it went carries a button that opens the folder,
  because a folder nobody finds is a file exported twice. A download instead was the one
  export nobody could find twice. Inside the case a re-export overwrites so the folder is
  refreshed in one click; outside it nothing is ever overwritten, because those files are
  the analyst's.
- **A column naming other rows of the same sheet becomes real edges.** The binders wrote an
  order of battle in a column called `Links with others` — a brigade listing its companies,
  each company naming its brigade back — held together by a spreadsheet validation that
  cannot survive a row moving, and in the real file it had already decayed to `#REF!`. Here
  the cell keeps the **words**, because a file whose links read `r7f3a` is one the
  collaborator opening it cannot follow, and the link is re-read from those words every
  time: a name points at a row when exactly one other row spells it that way. A name that
  reaches none, or two, is shown rather than guessed at — the same decay becomes a list of
  what to fix. The row panel shows the other direction, **who points at this row**, derived
  rather than kept in a second column that would drift. As a mode of the press it draws
  `part-of` or `member-of` between the entities both rows are, and an order of battle lands
  in the one press that makes its units: the modes run in the order their answers depend on
  each other, so the edges see the subjects the same press just wrote. A row whose end is
  outside the pass and not in the case yet is said so rather than invented.
- **An answering column can give the case's answer rather than a yes or no.** `On map`
  says *whether* the case knows the row's subject and nothing about what it knows, so the
  coordinates and the parent unit went on being retyped into the column alongside. Two more
  readings close that: the **point** the case holds for what one named column points at, and
  **what it is joined to** — the far end of that entity's edges, one hop, written with the
  column's own separator. The column is named rather than swept, since a sheet may point at
  the case from a subject column and a place column both. Blank where the case has nothing
  to say, and blank where two different points reach the same entity: choosing one would be
  the silent merge the app refuses everywhere.
- **A column of hours becomes dated statements, not a date field.** The binders do not hold
  dates. They hold a *reasoning about* one across three or four columns: the hour that was
  established, the hour that was estimated, and how it was worked out — "the author gave me
  this time", "a private video shows 1:57", "between 2:00 and 2:10". Copied into one field
  that is one number and three lost columns, and a Timeline fed that way is a Timeline
  nobody believes. So each ticked row becomes a **Claim**: about what its subject cell
  points at, carrying when, how sure, the reasoning, the place its own column names and the
  sources its links are. A row with no established hour falls back to its estimate **one
  rung lower in confidence** and the reasoning says which it was, because the binder kept
  two columns for exactly that difference; a note reading *between 02:00 and 02:10* becomes
  an interval. Two things are asked for rather than guessed, since guessing either moves
  evidence in time: which **day** a column of bare clocks belongs to — the binder keeps it
  in the sheet's title — and which **zone** it is written in, where local is the default and
  is honest, because a column called `Local time` stamped `Z` is off by however far away the
  event happened. Pressing again updates the statements rather than filing them twice, and
  the hours ride in the same press as the subjects they are about.
- **Rows lined up on a sync point inherit an absolute time from it.** A **sync point** is
  one moment visible in several rows — a launch, an impact, a shot heard in every video —
  and each row carries its offset against it: `-00:01:50`, `00:04:04`, which is exactly
  what the binder's `start synchro` column held. Their **relative order is usable straight
  away**, before anybody knows what time anything happened; the moment the shot itself is
  dated, every one of them has a time to the second. Sync points are named and dated on the
  sheet rather than on the columns, because one serves several of them and a time restated
  per column will disagree with itself — and a sheet holds more than one, since the binder
  already had a start and an end. They are reached from the column that uses one, which is
  the only place anybody wants them. Staying undated is the normal state and costs only the
  absolute times. What it produces is a **statement**
  whose reasoning names the moment, never a timestamp written into a cell: that is an
  inference, and presenting one as an observation is the thing the whole ontology is built
  to prevent.
- **A row can carry case files of its own.** The proof of an hour — the screenshot of the
  message, the emailed reply — sat in two whole tabs of pasted images beside the work it was
  the proof of, because a spreadsheet has nowhere to put it. Attached to the row from its
  panel and **referenced, never copied**: the file is already the case's, so nothing new is
  filed, no artifact is owned twice and the bundle does not drift. The sheet mentions it, so
  it is reachable from the file's own side too. A row holding links can also ask **what the
  library already downloaded from them** — matched on the source URL the download recorded,
  never on a title resembling a filename — which is the two halves of one page that nothing
  had ever joined.
- **The question is a search, a chip per clause and a count** — *23 of 1 204*, the
  denominator being the whole sheet. What the search found is **marked in the cells**, since
  on a fourteen-column binder the match is often in a column that is off screen. A column is
  asked four things, and they hold together: which values, whether it is empty or filled, a
  word it must or must not hold, and — on a column that says it holds numbers or dates — a
  **bound at either end**, which is the question a list of values cannot ask: *before this
  date*, *under five kilometres*. The value menu **pages** rather than giving up: it lists the
  commonest, says how many there are in all, and a box narrows against the whole column, so a
  column of a hundred and twenty cities is walkable instead of answering "too many to list".
- **A cell can point at an entity, where that means anything.** The `@` is drawn on a text
  column and on a point — a yes/no cell, a date, a number and a value out of a vocabulary are
  not things the case holds an entity for, and an `@` on them read as an offer to point a
  status at a person. A cell that already carries a link keeps its `@` whatever its column
  became. It opens the picker, which leads with what the case holds — a count per type — because the analyst usually does not
  know the label: the cell says `3rd Bde` and the case holds `3rd Separate Brigade`. A
  bare search bar only works when the answer is already known. Narrowing by type is one
  click and says how big each answer is first; the arrows and Enter pick without the
  mouse. The list is **paged, not capped**: it says how many of the matching set are on
  screen and loads the rest on a press, and the ordering — name or newest, either way —
  is applied to the whole matching set on the server, because sorting the forty rows
  already loaded answers a different question. The link is recorded beside the table and
  the cell takes the entity's name when it was empty, so the CSV still says in words
  what the graph says in an edge. Each of those becomes a `mentions` edge on save, and
  clicking the mark opens that entity's Details. **A link does not outlive what it points
  at.** No sheet shows or saves a link the case cannot answer for: the rule runs on every
  read and every save, so a sidecar carried in from another case or written against older
  ids heals itself rather than showing a cell that reads as work already done. Deleting an
  entity clears it eagerly in every sheet of the case, and an open grid drops it as soon as
  it hears the case changed, saying how many went — otherwise the next save would write the
  dead id back over the file the delete had just cleared. The words in the cell stay, since
  the file has to say in words what the graph said in an edge. Restoring from the trash
  brings the entity back, not the link.
- Rows are ticked in the gutter, painted from the annotation palette, and deleted
  together. Amber is not in that palette: it means selection, so a tick marks the
  gutter rather than washing the row and hiding the colour just painted on it.
- **The grid draws its own scrollbars**, one per axis, in a strip beside the table
  rather than over it. The app's chrome is thin everywhere, which is right for a
  panel hinting there is more below and wrong here, where the bar is how a wide
  table is crossed; and on Linux the native ones are overlays that fade out. Drag
  the thumb, or click the track to jump a panel. The tick column, the row's key and
  the column kept in view stay put while the table scrolls sideways.
- Only the rows on screen are in the DOM, so a sheet of twenty thousand scrolls. Row
  height is fixed: a cell holding sentences shows one line and opens into a box that
  grows.

## Map plate

**Map plate**, in Compose, lays a page out round the case's maps, for a report,
a print or a post. **New plate** opens one screen, each choice answered until
changed, so **Create plate** works at once: the layout on the left (the house layout,
one of the ready plates or one of the analyst's templates, each drawn as its page),
and on the right where the map looks (where the Map is looking, or round the layers
picked), which of the case's layers it draws, the paper (a report, a slide or post, a
feed post, a square, a story or a print) and the look, its own or another. **Map plate…** in the
Map's capture menu opens the house layout at once. A new plate looks where the Map is
looking, with the layers switched on there (the analyst's own layers when none is;
before the Map has looked anywhere, the ground the case's layers cover, else the
whole world). The house layout is a title naming the case by its `{case}` token, a
subtitle, the map, a legend, an inset, a cartouche, the scale, the north and the
credits, the column beside the map on a wide page and a band under it on an upright
one. The plate saves itself into the case it was opened in; its name
is its file, renaming it in the header moves it, and a name another plate holds is
refused with the reason, the plate keeping the name it had. The case's own column
folds while a plate is open, and **Plates**, first in the header, goes back to the list,
the plate's preview drawn first when one is owed. The list shows the case's plates
first, each whole whatever its paper, with its paper and the day it last changed, and
offers **Open**, **Duplicate** (its preview copied with it), a copy **laid out for**
another paper, **Rename** and the Trash. The analyst's templates, then the ready
plates, follow, each drawn as its page; a press makes a plate from it at once, where
the Map is looking, on its own paper and look, and a template's ⋯ holds **New plate from it**, **Edit**, **Rename** and **Delete**.
A plate holds eight maps and insets at most, since a browser draws only so many
maps at once (an inset drawn as a globe is drawn on the page and is not one of them); a map whose drawing the browser takes back for another is drawn again
once the plate is in sight, and says so when it keeps losing it.

**Ready plates** are the maps an open investigation publishes, laid out by a
designer's rules for each paper rather than stretched from one: **Situation map**
(the line on a quiet ground, its key and locator beside it), **Geolocation card** (the
footage beside the place it was filmed, the matches numbered, `{coords}` under it),
**Before and after** (one ground on two dates, side by side, a key figure),
**Incidents** (the events with their chronology), **Route or track**, **Line of
sight**, **Site profile**, **Locator** (a closer detail and a globe), **Briefing** and
**Post** (the map to the edges, its title on a card). Each comes in its look and its
grounds, its words in the page's text styles, and an empty picture says on the
screen what goes in it. Each is signed with the Azimut logo alone, in the source
line's muted ink: at the foot's right end on the credits' line, or beside the title
where a QR code holds that corner (Geolocation card) or the map runs to the edges
(Post, on its card). It is a Made with Azimut element with no words before it, so a
press deletes it or the inspector writes some. A plate made from one remembers it: set on another paper, or
copied for one, each element the recipe made takes its place there with its words,
its ground and its layers kept, and what was added since keeps its share of the page.

The page is laid out in millimetres and shown at its true size, scaled to the
window, so a line weighs on the screen what it weighs on the paper. The wheel
zooms the page round the pointer, a drag on its empty paper or round it (or a
middle-button drag anywhere) moves it, and **Fit** brings it back; an undo keeps
where the page is. **Add** in the header (or the A key) opens a panel whose field
finds an element by a word, Enter adding the first one found, and groups what
goes on a page by where it goes:
**Maps** (a map, a **Detail** of the main map with lines to the ground it shows,
an inset), **On the map** (a label, a **Map
text**, a **Symbol**, a number, an arrow, a **Line**, a distance, range rings, a view cone, a zone, a
spotlight, a **Country focus**, each placed by pressing the map), **Round the map**
(legend, scale bar, north arrow, credits, a date strip), **Writing** (text, banner,
stamp, the numbered list, a table, a QR code), **Blocks** (a title block of
kicker, title and standfirst, a date badge, a classification band, a source line, a
key figure, each laid out together in the page's colours), **Signing** (the analyst's signature:
the picture set in Settings → Publishing beside `{handle}` and the day, rewritten at
will; and **Made with Azimut**, the app's mark and name set tight beside the words,
without the air of the app's corner), **Pictures and shapes** (a picture, the signature picture as a logo,
a box, an ellipse, a rule) and **Playing** (a step, a video, and ready sequences:
**Reveal in four beats**, **Zoom in**, a **Title card** and an **End card**). A tool placed by pressing the map is put down by a second press
on it, or Esc.

The list of elements on the left and the inspector on the right are widened by
dragging their edge, a double click putting the width back, and put away from the
header; both stay as they were left. The inspector's sections fold by their title,
on every element at once, and a wide inspector sets them side by side. **Focus**
(F) gives the page the whole screen: the app's bars and the plate's header step
aside, and a bar over the page keeps Add, Undo, Export and the two panels, which
come back floating over the page. F or Esc gives the screen back; a browser that
refuses the screen leaves the page the whole window. **Open in its own
tab** puts the plate alone in a new tab, for another screen. A plate is edited in
one tab at a time: opening it in another tab sends this one back to the list.

A press picks an element, Shift adds to the picked ones, and elements put in one
group (Ctrl+G, Ctrl+Shift+G to undo it) are picked together. A drag moves what is
picked once the pointer has gone four pixels, so a click never nudges; it catches on
the page's edges and middle and on the other boxes (Alt lets go), and a corner with
Shift keeps the box's proportions. **A drag on a map moves its frame, as any
element's; its ground stays put** until a double click goes into it (drag to pan,
scroll to zoom, and a Shift-drag, a middle-drag or a double click held and dragged to
turn, as on the app's other maps; Esc when done). The arrow keys move, Delete
removes, Ctrl+C and Ctrl+V copy to this plate or another, Ctrl+D duplicates and
Ctrl+Z undoes, after a press on the page: a key pressed on a button of the
inspector never deletes. Escape lets the picked elements go. A right-click on an
element, on the page or in the list, picks it and opens what can be done to it:
duplicate, copy and paste, forward and back, hide, lock, the steps it shows on, and
remove; on several picked, group them too; on the paper, Add, paste, undo and redo. A
right-click on a step or on the day in the strip opens its ⋯ menu where the pointer is.
A **Detail**'s square
on the map it is drawn from is picked by a press and dragged there to move what the
detail shows; a locked detail only picks. Maps stay under the
page's writing, at the foot of the list. The list, top first, restacks by a drag
that offers only the places a row can take, and the inspector's arrows step an
element among the rows listed. A double click names an element, and its row hides
or locks it.
Several picked elements are lined up, spaced evenly, given one size, grouped,
locked or removed together from the inspector.

What stands on the ground (a label's point, an arrow's two ends, a zone's corners, a
line's points, the rings' centre and reach, the cone's eye and tip, a distance's two
ends) is dragged there by its handles, or as a whole by its own drawing. A label beside a
map keeps its place by the point it names when the map is moved or zoomed, and an
arrow, a line, a distance or a zone goes with the ground. A **Map text** is words
without a leader standing over their point: moved by the hand, it takes its point
along, and on a day or a step framed otherwise it stays over it. A **Symbol** is one of
the markers the case's layers draw (a tank, a drone, a checkpoint…), stamped by a press
on the map, the tool staying in hand for the next; it stands over its point the same
way, picked from the layers' palette with its colour, sized, turned, and shown damaged
or destroyed from its **State** row, worded as a layer's marker words it (**–**,
**Damaged**, **Destroyed**, each saying on hover what it draws), and the next one
takes the last marker set. While something is placed,
a press goes through what already stands on the map. A **Line** is clicked
point by point, ended by a double click or Enter (Backspace takes a point back), drawn
straight from point to point or curved through them, solid, dashed or dotted, with a
head at its end, both or none, and words along it. A label is plain, a bubble, a box
or a number; its leader is straight, elbowed or curved and ends in a dot, an arrow
or nothing. The numbers count in page order and the **Numbered list** writes what
each one stands for. An arrow bends, has one head, two or none, is solid, dashed or
dotted, carries words along it, and an **Advance** arrow is the broad tapered arrow
of a situation map. A zone is filled, hatched, glowing or outlined and can dim the
ground round it. A picture can point at the ground, and the picture picker offers
the proofs and footage the main map's features carry, set pointing at their place.

A map picked on the page carries its own bar: **Frame**, a half step of zoom
either way, a step to either side and a compass to turn it, and **Ground**. The
grounds are drawn small as they look, in the bar's menu and in the inspector's
**Ground** gallery. The plain ones are drawn from OpenStreetMap's vector tiles in a
style each: **Plain**, **Light grey**, **Newsroom** (warm paper, its relief shaded by
four lights, the coast drawn as lines going out into the water), **Humanitarian**,
**Shaded relief** (a survey's tinted heights under bluish shadows and a warm light),
**Topographic**, **Staff map**, **Toner** (black and white), **Plain, dark** and
**Tactical** (dark blue, its coast glowing). Then the pictures: Esri imagery, **World
Imagery Wayback, dated** (a release picked in the inspector, its date said in the
credits and in `{imagery}`), **Sentinel-2 cloudless** (EOX's cloud-free picture of the
world a year, made of many passes, so it holds no single date and says so: its year
is picked in the inspector, 2016 free for any use and the later ones for
non-commercial use only, each credited in EOX's words), **Sentinel-2, one dated
pass** once a Copernicus account is set up (one pass on the day it was taken, never a
mosaic of several: its layer, cloud ceiling and day are picked on Satellite's own
calendar over the map's middle, and it starts on the newest pass under 30% cloud, said
under it; where the pass did not reach, the map stays empty; without an account the
tile stays in the gallery, locked, with the steps to a free one),
OpenStreetMap or OpenTopoMap. Relief shading, borders and names, roads, railways, power lines, sea
marks, GPS traces or night lights go over any of them, the relief over imagery
included, the Map's key-less layers each credited on the page. **Topographic** (a
national survey's colours) and **Staff map** (a military map's khaki and olive) tint
the heights from lowland green to rock and snow, shade them, trace contour lines every
ten metres to a kilometre by the map's scale (every fifth one bolder and written with
its height), and name the summits with theirs; each of the three can be left off.

A plain ground writes the countries and their regions in spaced capitals while the map
is wide, the seas and rivers in italic (a river along its course), and a capital in
bold. It draws what an investigation reads, each left off by its box: the road
numbers on their shields, airfields with their runways, taxiways and names, military
ground, farmland, sand, ice and marsh, ferries and piers; its borders go to the
countries, their regions or the districts in them, the disputed ones dotted and the
ones at sea faint. **Detail** draws fewer or more names, small roads and buildings,
**Presence** brings every colour but the land's nearer the land's own, and the fine
colours wait behind **Change the colours**. In a framed map, a click on one of its
names offers **Hide it on this map** or **Make it a label to move**, which writes it
as the plate's own text on the map where it stood; the inspector lists the names
hidden and brings them back.

**Country focus**, on the map, lights the country pressed and draws the rest of the
world back, darkened or faded toward the paper, at the strength set; another country
is picked in its inspector. As every annotation it belongs to the day or step it is
made on, so a video can come in wide and then light a country, the focus fading in
with the transition. It is drawn on the page from the same Natural Earth countries as
the globe inset, under a soft edge, as the outline is coarse at that scale; the
disputed areas touching the country stand half lit, dotted round, and a press in one
lights nothing. A map in 3D, tilted or seen as the whole globe, is read point by point
through its camera, so the country is lit in perspective and the sky stays in the
shade. A plate saved while the focus was the map's own has it moved onto the map as
one of these, on every day and step.

There is one kind of map: its inspector's **Show the map in 3D** box stands it on its
heights, tilted (from the bar, or to the degree in the inspector), the heights drawn as they are or up to three times as tall, said under it.
It is drawn on Satellite's globe, its ground, tints, contour lines, names and the
case's layers laid on the relief; a browser without WebGL2 draws it flat and says so.
**Ridge lines** traces the crests over it. A tilted map has no scale bar and no grid;
labels, numbers, arrows and zones stay on their ground, its legend lists what its
camera shows, and its inset outlines the ground it looks at, from its foot to short of
the horizon. The inspector sets the
rest: the zoom and the turn to the decimal; a grid in latitude and longitude
(degrees and minutes or decimal), UTM or MGRS, at a chosen step, labelled on two
sides or four, or as ticks on the frame only, its ink light over imagery and dark
over a pale ground unless set; the plain ground's detail, presence, borders and
colours, what it draws, the language of its names, and the relief's strength; the
imagery's strength, colour, light, contrast and tint, with **Greyed**, **Faded**,
**Darkened** and **Muted** as starts; and the case's layers it draws, each with its groups left
out or in, its lines and its marks sized apart, its own colour, dash and area fill (full,
hatched or the outline alone) on this plate alone, drawn higher or lower. **Stands
for** gives it a role's look in one press, on the page's colours: **Held** (a full
tint of the accent), **Claimed** (hatched, dashed), **Contested** (amber, hatched,
dotted), **Front line**, **Events** (larger marks) or **Context** (grey and thin); the
legend then names its areas and lines by the role, its points keeping their words.
One feature can be left out of one map: a right-click on it, or a click on it in the
framed map, offers to hide it on this map, and the layer's row lists those hidden under
**Hidden here**, a press bringing one back. A dated layer has a **From** day and a **To**
day: what began before the first or after the last is left out of the map, whatever came
of it since, and the days it changed on leave the plate's bar with it. What began between
them keeps changing after To. Either end set past the other pulls it along, and a plate
standing outside them is put on the day just set. The legend, `{count}`, the labels tied to a feature and
the tables leave out the same; the layer itself keeps them.
A right-click on a marker that shows a file of the case (one added from a file, or from
a proof resting on footage) also offers that file, and only there: **Add video** plays
it on a step, **Add linked picture** sets a still on the page, each pointing at the
marker and the video saying its source.
A plate draws every point of a layer at every zoom, where the Map lets the ones that
overlap drop out far out: a page leaving the app must not lose one. And
**Label its named features**, and **Label its named features**, which places
a label beside each feature in the frame without two covering each other, tied to
its feature so it shows when the feature does. **New layer here** makes a layer of the
case, draws it on the map and opens it for editing in the Map where the map looks,
Back coming back to the plate. **Make a layer of the N drawn here** turns what was
drawn by hand on the map (zones, lines, arrows, distances, rings, cones, symbols and
labels) into a layer of the case, each in its group, its colour and its days, which
the map then draws in their place; Undo puts them back on the plate.

An inset's **Drawn as a globe** draws it as a small globe turned to its map's middle,
from Natural Earth's countries (public domain, shipped with the app): the sea, the
land, the country the map looks at in the accent, a ring and a dot where it looks.
Natural Earth draws a country as it is held, so the areas one country holds and
another claims (Crimea, the Donbas, Abkhazia and the others it lists) are drawn
apart, dotted round: none takes the colour of the country holding it, and a map
looking at one picks out the area itself. It covers its disc only: the corners of
its box show the map under it, and what is drawn on that map runs on under them. It
has no zoom and no frame of its own, its rim being one, and it does not count among
the plate's eight maps.

The legend lists only what the map draws in its frame on the plate's day, one row a
look, named after the group when it has one style, else after its icon and the
case's name for its colour, with the status after it. **List what the layers hold
off the map too** brings the rest back. Each row is renamed, moved up or down, and
removed by its ×, kept under **Removed** to be put back; rows are written by hand.

A text is set in one of the page's **Styles** at one press: a kicker, a title, a
standfirst, the body, a caption, a source line, a date badge or a key figure, each a
size, a weight, capitals or not, a spacing and a colour of the page (its accent, its
ink, or a muted ink between the ink and the paper), the words kept. **Words** sets what every element writes the same way, a text, a label, the words
of a zone, an arrow, a line, rings, a cone or a distance, the legend, the table, the
credits, the scale, a video's source line: their size, face, weight, italic or
capitals, colour, and what stands behind them (nothing, a halo, or a box of a colour).
Words on the ground are bold on a halo until set otherwise. Texts are also set in their
spacing and line height, aligned across and down, turned, and faded. A box its words
or rows run past (a text, a label, the legend, the table, the numbered list, the
credits) carries a **!** at its corner on the page and says so in the inspector,
whose **Fit the box** grows it to what it holds; the export names it before the file
goes out. An element gone off the page is picked from the list, and its inspector's
**Bring it back** puts it whole on the page. Every setting of the inspector says what it does when the pointer rests on it. They fill in `{date}` (the plate's day, else the day its layers
last changed), `{today}`, `{updated}`, `{case}`, `{title}`, `{scale}`, `{imagery}`,
`{handle}`, `{coords}` and `{mgrs}` (the main map's middle), `{from}` and `{to}` (the
first and last day a played plate shows), and `{count}`, `{count:destroyed}`,
`{count:damaged}` or `{count:<group>}` (what the main map shows in its frame on the
plate's day). Under a text they stand as small tags, each saying what it writes, a
press putting it where the cursor is. A word that fills in empty (no handle set, no
imagery dated) takes the separators it leaves at the ends of its line with it. The credits are what the sources are owed, a copied feature's credit
among them: they stay on the page, shrink rather than lose a source, and stand on a
band of the paper over a map. The credits box's inspector lists each credit with a
box: a layer's or a feature's can be taken off, what a ground's, a relief's or an
overlay's terms ask for stays, locked. A layer of the analyst's own files owes nobody
and is not credited. The page is drawn again at the zoom it is shown at, so
the smallest words stay sharp. A table lists the dated features as a chronology, up to the
plate's day, or each source the features cite. A QR code carries a link.

With nothing picked, the inspector sets the page: **Looks** (Press, Sand, Night,
Report, Black and white, **Survey** on the topographic ground, **Staff** on the staff
map, and the editorial ones, each on its own ground: **Newsroom**, **Situation
room**, **Tactical**, **Humanitarian**, **Atlas** and **Brief**) set the paper, ink, accent and face, every map's ground and
its imagery's whole tone (a look that is not grey gives the imagery its colour back),
and what wore the page's colours, at one press; the paper (A5, A4, A3, Letter, 16:9 or 9:16, a square, a 4:5 post, or a
size typed in), turned either way when it can be; the face (Inter, Barlow Condensed,
Roboto Condensed, Source Serif, Oxanium, IBM Plex Mono, each with Arabic behind it);
the colours; a plain paper, a gradient or a picture under everything; a rule round
the page; the margins and the feed crop drawn as guides; a see-through paper for a
PNG; the paper's **Grain**, fine specks over the whole page and its maps as printed
paper shows them, the same on the screen and in every export. A colour is picked from the page's own, the case's named colours and the last
ones used, or the browser's picker.

A plate that draws a layer followed over time has a day of its own, on a bar under
the page that steps through its changes, and plays them at three paces, once or in a
loop, without writing a day into the plate until it stops. Its day is always a day of
the calendar, today on its layers' clock for a new plate, never a "now" that would
slide to the next day, so a plate reopens on the day it was left on; one saved on
"now" before this moves to the day it was last saved, with what stood on it. The days
played are its layers' changes, every day that holds steps, and every day added to
the play: a day between two changes says so on its tile, **Add to the play**, and
its ⋯ takes it out again while it holds no steps. Any other played day is
**hidden from the video** from its ⋯: it stays on the bar to edit, dashed with its
steps and faint among the notches, and the play and every export skip it. Events stay on its
maps, faded, unless the plate's past menu says how many days. What is added on the map
(a label, an arrow, a zone, rings, a cone, a distance, a shape) **belongs to the day
it is made on**: the next day starts without it. The inspector shows it from a first
day to a last, each picked on a calendar of any day, or left open to the start or
to the end; both open is every day, and an end moved past the other pulls it along.
**Other days**, under the element list, lists another day's annotations, stretches
one to reach this day or carries it from this day on, and draws them faintly when
asked. So a video shows each day's annotations, and only those.

**The days sit on the bar as a row of notches**, one per day played, evenly apart
whatever the calendar leaves between them, with dots under a notch for its steps. The
track keeps its width whatever the day holds, and a drag lands only on a day the plate
plays. Past what it can show apart, it holds a window of days around the day shown,
moved a window at a time, and a thin line under it spans every day: a press or a drag
there goes anywhere, and **Page Up** and **Page Down** jump a window. On layers dated to the minute, the plate plays **day by day**, each day shown as
it ended, until **Hours** beside the date plays each moment on its own: a day's
moments sit together, the hour is picked beside the date, and past what the track can
show apart it keeps a notch a day. Back to days, each hour's steps follow their day's
own in order, and they return to their hours with **Hours**.

**A day can hold steps**, played after it one by one. **Step**, in Add or at the end
of the bar under the page, adds the first; from then on the bar shows the day itself
and each step, beside the plate's days, and its **+** adds a step after the one shown.
The day's tile and **+** stay put while the steps scroll between them, under the wheel
too; past what fits, the tiles shrink to their number and time, an arrow each side
says how many are out of sight, and a count says which one is shown. On a narrow
window the steps take a line of their own.
**Every tile says how long it holds in the video, and a press on that time sets
it**: the day its own seconds or, left alone, every day's (one second until set in
the export), a step its own, never shorter than its longest clip, the clip staying on
its last frame when the step holds longer. Play holds each one as the video does. A plate with no layer followed over time takes steps too,
on its one day, and has no bar under the page until it does.
While a step is shown, a pill over the page says so and **what is added belongs to
that step**, over what the day shows: the element list holds the day's elements and
that step's, the step's marked. The inspector keeps a step's element on **This
step** or **And after** (the steps after it, on the same day), or puts it back on
the whole day; an element of the day goes **Only on** the step shown by a press. A
step is dragged to another place in the strip, and its ⋯, always shown, names it, sets how long it
holds, moves it, duplicates it (what stands on it and its framing copied, the copy
played right after it), or removes it with what stands on it. A ready sequence from
Add puts its steps after the one shown and turns the video's transitions on:
**Reveal in four beats** (the region, the place, closer, the whole picture) and
**Zoom in** frame the main map from where it looks, and a **Title card** or an **End
card** covers the page with its paper and its words, sized to the page.

**A day or a step frames a map its own way.** Past the first, each one shows the map
as the one before it does, the map bar's **Keep the previous framing** ticked and the
map holding still. Unticked, the map is framed there on its own, and the steps after it
follow until one frames it too. A label keeps its place on the page; on a day framed
otherwise, its leader reaches to its point. Framing a map by the hand takes along the
labels, pictures and videos pointing at it only when no other day or step showing them
frames it differently.

**Video** puts a video on a step: on the one shown while it holds none, else on a new
step after it. **Choose a video** lists the footage placed on the map first, set
pointing at its place, then every video and GIF of the case. A GIF plays round and
round for the time set, on the page as in the MP4, its first picture standing for it
in a still. The inspector plays a video, takes
the clip's start and end from the player (**Start here**, **End here**) or typed as
minutes and seconds, and plays the clip alone; a new clip takes the first ten seconds.
**Sound** keeps the video's own sound, at a volume, and is off until asked. **Source**
writes a line over the bottom of the video, read from the file's record (who posted
it, where, when) and rewritten at will. The step holds at least as long as its longest clip.
On the page the video holds on the clip's first frame, under the writing, and runs
when the plate plays that step. Play goes through each day, then its steps, the
clips running in their boxes. A picture's or a video's leader to its point is drawn
while the map shows the point, and goes once the map is turned or framed away from it
or the point falls past a 3D map's horizon.

**Export** shows the page and its file name first, and keeps the format and sizes
picked last on this computer. It writes a PNG at screen or
print resolution or a width in pixels for a post, its paper see-through when asked,
copies the page to the clipboard, or writes a PDF of the paper size; for a played
plate, its days as an MP4, a GIF or an evolution sheet, the legend listing what any
of them draws so it stays still. A video is 1280 or 1920 pixels along its long side,
in the page's shape and both sides even (an upright story is 1080 × 1920). A plate
with steps plays each day and then its steps, and the dialog says how long the video runs: in an MP4 each step's clips run in their
boxes, with their sound when it is kept, the frame and the source line over them; a
GIF shows a clip by its first frame, and the evolution sheet keeps to the days.
With **Video transitions** on (the page's inspector, once the plate plays), the MP4
goes from one day or step to the next in the time set: the page fades into the next, a
map framed otherwise flies there, rising over a long way, drawn again at each frame so
its marks keep their size, blurred as it goes fastest or sharp, its inset following
and what is written over it placed through its camera as it leans,
and what is new fades in or is drawn along its lines, or comes at once. The frames play
at the video's own 30 a second. A step's ⋯ can cut straight into it, or give the
transition into it a time of its own (0.2 to 3 seconds). Play goes through the
transitions as the video will, for as long: the map flies, what leaves fades, what is
new fades in or is drawn, then the day or step holds its own seconds, and the dialog
counts each transition's own time in what the video runs. Everything goes into the folder saved for views.
**To Post**, beside Export for a PNG, a sheet, a GIF or an MP4 (never a PDF), makes the
same file and files it in the case instead, naming its plate, the day and step a page
shows, and the credits on its face (`POST /map-plates/export` with `into=case`); the same
file filed from the plate before is cited again. Post then opens on a Map plate post
carrying it, told the plate's title, the day shown or the first and last days played
(`2026-10-01 → 2026-10-14`), and those credits, which fill the post's Credits field. An analyst who went to another tool meanwhile is offered **Open in
Post** on the toast instead.
**Export** closes the dialog and the export goes on behind: the plate holds still under
a veil saying what is drawn and how far, the top bar says **Plate export** with its
share from any tool (a press goes back to the plate), and the other tools can be used
meanwhile. **Stop** ends it and nothing is written; another case stops it too; a map whose tiles had not
all come in is drawn as it stood and the export says so. A long video's pictures go
to disk in batches as they are drawn, so neither the tab nor the app holds them all.
The PDF holds the page as one picture at print resolution.

**Keep as template** keeps the layout, its paper and colours, the style of each
map's ground, and the pictures kept inside it (a logo from this computer, the
signature), without where the maps look, the layers or what stands on them, but
with how long a day holds. An element locked in it stays locked on the plates made
from it, so a team's house style holds. A new plate can start from one; a template
made from a ready plate is the analyst's own layout from then on. Settings → Templates lists them: **Edit** opens one here over the Map's
ground, **Done** goes back where it was opened from, and one goes out and comes back
as a file.

## Notebook

**The home.** The Notebook opens on the case's notes as cards, the way Map plate
opens on its plates. **Case notes**, the case's own page (`notes.md`), comes first
and is always there. Each filed note's card says its folder, its first words, when
it changed, its word count, the tasks left and how many records it cites; a folder
row filters the cards and *Recent* or *Name* orders them. **Find words in the
notes** looks inside every note on the server and lists each note with the line it
is first found on; a press opens the note at that line. **Reports** come first: the
notes that print in a look other than Plain or hold chapters, each card saying its
style and its chapter count. **Start from** shows every template by its first page,
drawn from the real PDF when the tile comes into view and kept for the session:
ready ones (Blank, Geolocation report, Chronolocation, Media verification, Incident
brief (5W), Source profile, Daily SITREP, Fact-check, Investigation log) and **Your
templates**. A press makes the note at once in the template's look, named after it
and numbered when the name is taken, with its title selected to retype. **New note**
opens one dialog (`NewNoteDialog.svelte`): what to start from as tiles drawn by their
first page (Blank, From the case, the ready notes, your templates; one Tab stop, the
arrows pick), an optional title whose placeholder is the name the note gets, and a
folder. A card's ⋯ opens it, pins it to the
side, opens it in its own tab, exports it, lists its editions, or deletes it.

**From the case**, beside Blank, writes a note of every geolocation of a period
(`GET /notes/from-case`, nothing fetched). Its tile opens New note on it, whose
questions show under the tiles: only the **Period** (days on
the case's clock, the zone shown, opening on every day the geolocations cover),
**Dated by** (*What they show*: the day a proof states, else the camera, post or
imagery day; or *When they were geolocated*: the day the place was stated) and the
**Layout** (*A figure each* or *A table*), and says the count live, with how many have
no day to read them by. **Create** makes a Report with its sources listed and opens
it: Summary, Findings, Ruled out and Limits, with guidance lines. A figure each gives
the picture (a proof at three quarters of the page), *Description* (the item's own,
from its Details, the line written even when empty to fill in), *Where* (the place's
chip and its coordinates), *When* (saying which day it is) and *Source*; a table gives
one row each, its description in a column. What counts: every proof, and every picture or video the Media position shows at
a confirmed point (`engine/satellite.py` `confirmed_spots`, the frontend's `placeOf`
reading edges the same way); a suggested point does not, what the case made itself
(captures, frames) does not, and a file a proof was made from is shown by its proof. A
note holds at most 200, with a line naming the cut.

**Several at once.** *Select* puts a box on every card; Shift-click picks a run,
*Select all* the folder shown, Escape leaves. A bar at the foot says how many are
picked and offers **Export as PDF** (one PDF per note, into the notes destination)
and **Make a report**, which writes a new note holding one chapter per picked note in
the order they were picked, in the Report look with a cover and a contents page, and
opens it beside its pages.

**A note, written in place.** The note is drawn as it reads while it is typed
(CodeMirror 6, `lib/notes/liveMarkdown.js`). A heading is set large, emphasis and links are styled, bullets are dots, `- [ ]` is a box to tick,
and the marks come back on the line being edited. A case reference is a chip that
opens what it names; a picture, a table, a diagram, an aligned block, an HTML block,
a chapter and the page-break and cover lines are drawn whole and stay drawn. A press
picks one (an accent outline, a picture's bar kept up); a double press, Enter or its
`</>` opens its source, which closes again once the cursor leaves it, and Escape closes
it at once. While one is picked, Backspace or Delete takes it out (Undo brings it back),
a key typed starts a paragraph of its own after it, and the arrow keys step over it
whole, picking it on the way. The toolbar's last pair switches between **Drawn** and
**Markdown**, the raw text with no drawing (Ctrl+Shift+M), one choice for the browser,
every open editor following it. A callout opens a
quote as `> [!confirmed]`, `[!unverified]`, `[!lead]`, `[!note]` or `[!warning]`, in
its colour, in the PDF too. Decimal coordinates get a ⌖ that shows them on the map.
**@** and a few letters offer the case's records and write a chip; **/** offers
headings, a dated log entry, tasks, lists, the callouts, a case item, a case picture,
an image from a file, a table, a diagram, code, a divider, a page break and today's date. The bar
above holds the same as buttons. Ctrl+B and Ctrl+I set bold and italic, Enter on an
empty item leaves the list. Pasting or dropping an image adds it to the case's media;
a library file dragged in lands as its picture. A link pasted alone is offered as a
bookmark of the case, titled from its address, nothing fetched. A note with a remote
image says its host is contacted on every open.

The file stays the Markdown it was: what the old split-pane Notebook wrote opens as it
was written and is never rewritten for being opened. The header names the note (the
name is the filename), files it in a folder, says whether it is saved, and holds
**Look**, **Write | Page**, **Pin to the side**, **Open in its own tab**, **PDF**, and
a ⋯ with *Editions*, *Keep as template* and *Delete* (*Clear the case notes* for the case's page).
PDF export writes one server-rendered PDF per note without a print dialog, in the
note's look, local images and browser-drawn diagrams with it, remote images left out,
homonyms under stable suffixes, into the shared notes destination (the case's
`exports/` by default). The export dialog first asks what the PDFs would warn about
(`POST /notes/pdf/check`, rendered in memory, nothing written) and says *Checking…*;
what it finds is listed under *Before you export*, by note when several are exported,
each with *Go to* when it names a line, and the button reads *Export anyway*. A check
that fails says nothing and never holds the export back.

**Editions.** A passage written as `> [!internal]` (*Internal* in **/** and the callout
menu) is for the team: drawn in its own colour, printed in a marked box in the internal
edition, and left out whole of the public one, its words, a contents entry, a source
cited only there, a credit, a `[n]` and a chapter written inside it, the numbering
staying continuous. Where the editor and the PDF parser could read a quote's end
differently, the public edition drops whatever either counts as the passage, and a
public PDF that would still hold one is refused. Search, excerpts and the To-do read
it as any text; other Markdown readers show a blockquote. When a picked note or one of
its chapters holds a passage, the export dialog offers **Internal | Public**,
remembered per note in this browser and Internal the first time; Public says how many
passages it leaves out, and the Page pane has the same switch. Each export is a new
file, never a replacement: a note with no internal passage has one edition, named
`<title> - <day>.pdf` and listed as Public; a note with one is named `<title> -
<internal|public> - <day>.pdf`; then `(2)` and so on that day. **⋯ › Editions**
lists every PDF a note was exported to, with its day, edition, pages and file (its
SHA-256 on hover): *Show* opens its folder, and *Check* says *Unchanged since it was
written*, *This file is not the one Azimut wrote* or *File missing*. The record (day,
edition, file, folder, pages, the PDF's SHA-256 and the printed text's) is kept on the
note, fifty at most, and travels in a bundle.

**How it prints.** **Look** sets the note's style, kept beside the note (the note
record's `look`, `notes.case_look` for the case notes) and never in its Markdown. Its
panel shows one tab at a time, *Style* (the style, then contents, numbered headings and
sources as three switches), *Text*, *Page* (paper, accent, marking), *Cover* and *Header
& footer*, a dot on each tab holding something set, and reopens on the last tab used:

- **Plain**, with nothing else set, is the document the Notebook always printed.
- **Report** has a running header, *Page X / Y*, numbered sections in the accent,
  boxed callouts, striped tables and framed figures.
- **Brief** sets a dark band with the title and puts the first verdict
  (`[!confirmed]` or `[!unverified]`) in a large box under it, to fit a page or two.
- **Journal** opens each day with its date and sets each `### YYYY-MM-DD HH:MM`
  entry's time in a left gutter on a timeline.

Every style takes A4 or Letter, an accent (the style's own, a recent colour or a
pasted hex), a TLP marking (FIRST TLP 2.0 colours, top right and in the footer of
every page), a cover page, a contents page and numbered headings and figures. PDF
bookmarks follow the headings. **Cover** is *Off*, *The style's* (a subtitle, a picture
from the case's media, a day) or **Your own page**: what the note holds above a line
`<!-- cover -->` (drawn in the editor as *End of the cover page*) prints alone on page 1,
with no running header, footer or page number, the TLP label kept, centred down the
page unless *Centred down the page* is off, its headings set larger and kept out of the
contents; the note then starts on page 2. A `::: top-left`, `::: top-right`,
`::: bottom-left` or `::: bottom-right` block there is pinned to that corner of the page,
within half its width, and the rest is centred in the room the corners leave (or starts
under the top ones); anywhere else such a block prints aligned to its side. The editor
tags one above the cover line *Top right corner* (and so on). **/** › *Alignment* offers
*Align centre*, *Align right* and the four corners, each wrapping the line in its block.
The cover skeleton puts the Azimut logo in a `::: top-right` block. Choosing it writes a skeleton at the top when
the note has no such line, as **/** › *Cover page* does. With nothing above the line the
check says so, and a cover longer than a page warns. **/** › *Signature* writes a block
of the analyst's signature picture, `{name}`, `{role}, {organisation}` and `{date}`, and
*Your logo* the analyst's logo. Five words are filled when the PDF is made, anywhere
outside code: `{title}`, `{date}` (the cover's day, else the day the PDF is made),
`{name}`, `{role}` and `{organisation}` (Settings › Publishing); an empty one goes with
the punctuation joining it, and a line left with nothing is dropped. The editor draws
them as grey words until set. Three pictures need no case file: `azimut:logo` (the
app's mark), `azimut:my-logo` and `azimut:my-signature` (set in Settings ›
Publishing); they print without frame or figure number, are no sources, and one not
set prints nothing while the check says *No logo set in Settings › Publishing.* (or
*signature*, or *No name set… for the signature.*). The picture picker offers them
above the case's pictures. A paragraph in a `::: center`, `::: right` or `::: left`
block keeps its bold, italics, code, links, chips and `[n]`, and a picture there with
no `align=` takes its block's place.

**Header and footer**, the Look's last tab, are the analyst's own, three slots
each (left, centre, right) of one line, 120 characters at most; an empty slot shows what
the style prints there, and each has a logo button (*Your logo*, *Azimut logo*). A slot is words, where `{title}`, `{date}`,
`{name}`, `{role}`, `{organisation}`, `{page}` and `{pages}` are filled on each page
(an empty one going with its separator), or a logo (`azimut:my-logo`, `azimut:logo`)
about 5 mm tall. A band with anything in it replaces the style's own on every page but
the cover and the brief's band, over or under its hairline; an empty band keeps the
style's. The TLP label keeps its place, the right slot giving way to it. A logo or a
name a slot shows that Settings does not hold is said once in the check. A band with
nothing in it is not stored, so an older Azimut prints the style's own.
Its **Text** part sets the typeface, each card drawn in its face: the style's own
(serif for Plain, Report and Journal, sans for Brief), Noto Serif, Noto Sans,
Literata (a book face for long write-ups) or IBM Plex Sans (a clean face for briefs),
and the size, Smaller, Normal or Larger, which headings, tables and captions follow.
A letter a face lacks prints in the Noto face of its script. Templates carry both.
Its **Sources** row, *List sources at the end*, is on for Report, Brief and Journal and
off for Plain until set; templates carry it too.

The PDF keeps what a reader needs to check the work. A chip naming a record with a
web address (a bookmark's page, an account's profile, a file's source; an archived
copy only when there is nothing else) is a link, links in tables stay links, and
decimal coordinates open OpenStreetMap at that point. Photo metadata (EXIF, GPS,
XMP, IPTC) is never put in the PDF: a JPEG goes in without those blocks and a photo
turned by its EXIF is drawn upright.

**Sources.** Where an item comes from is read in one place (`engine/notesources.py`)
from what the case recorded, nothing fetched: the credit under a picture, a chip's
link and the list of sources all come from it. A picture made in the case (an Inspect
frame, a collage, a proof, a Compare or Detect picture) credits what it was made from,
following its `derived-from` chain, with *+N* when it has several origins. With the
list on, the PDF ends with **Sources**, in the contents and the bookmarks and on a page
of its own in Report: every picture and video it shows (a file is evidence even with no
address: its name, the day it was filed, its SHA-256), every cited record that has an
address, an archive or an author, and every web link written in the text, each once in
order of first citation. An entry says what the item is, its kind and site, who posted
it, the day of its content and the day it was collected, its address and archived copy
in full, its SHA-256 and *from [k]* for what it was made from. A chip, a credit and a
written link carry a small `[n]` that jumps to their entry. A place, a person or an
event with no address is not a source; generated links (coordinates) are not listed;
a note citing nothing prints no list.

**Write | Page** opens the note's pages beside it: the real PDF the server would write
(`POST /notes/preview`, nothing written to disk), drawn with pdf.js loaded only
there, redrawn 900 ms after typing stops with the old pages kept until the new ones
are ready. One preview is asked at a time and only the newest typed meanwhile follows
it; a note whose pages took long waits as long after typing, up to 4 s. Its pictures
are the same pages with fewer pixels: at most 800 or 1600 across by the room they
take, JPEG unless they show through, kept in memory (400 pictures, 96 MB); the check
before an export reads them so too, the PDF written keeps every pixel. Diagrams missing from it are drawn in the browser and asked for once
more. Pressing a page scrolls the note to where it starts. The choice is kept for the
browser. What the PDF warns about is listed under the pane's bar, its count folding
the list: an empty section; a picture, video, chapter or record no longer in the case
(marked red); a picture with no source while sources are listed; tasks still open,
outside Plain; a link a reader cannot open (`file:`, localhost, a private address); a
script no face covers. One that names a line goes there when pressed. A template's pages give no such warnings, since a
template is guidance by design.

**Pictures and pages.** Hovering a picture, in the note or on its page in the Page
pane, offers **XXS**, **XS**, **S**, **M**, **L** and **Full**, left, centre or right, and **Caption**,
written on its line as `{width=… align=… caption="…"}`. The bar also offers *Open in
<Tool>* when a tool can reopen the state the picture was taken from, and *Source…* for
a picture brought in by hand with no address (a link stated, never fetched). A proof
also offers *Posted…*, in the note as on the Page pane: where it was published, on X or elsewhere,
kept on the proof (`posted_url`, a field of its Details too, an emptied field taking it
off). The PDF then links the picture to the post and adds *Posted:* and the address
under its credit, and lists it under the proof in the sources; the Page pane draws its
pages again as soon as either address is kept. None of the bar
prints, and the bar wraps onto two rows in a narrow note. Go to from a warning lands on
the picture with its bar in reach. The picture picker lists proofs beside pictures.
Each bar is one Tab stop, walked with the arrows. *Caption* opens a one-line field where the caption prints:
Enter or leaving it writes it, Escape leaves it as it was, and the note shows it under
the picture. A caption beats an image's title; with numbered figures it reads
*Figure N.* and the caption. Under it a grey credit says where the picture comes
from: *Source:* and the site, *Imagery:* with the provider and the day, or *Watch:*
for a video, each a link. Each size keeps the picture within a tenth, a fifth, a
third, a half or three quarters of the page across and down, so a phone screenshot is not a page tall.
A picture with no width written stays within half the page down, so a phone
screenshot is half a page rather than a whole one (a diagram keeps the whole page), and
shrinks by up to a quarter more rather than leave the rest of its page blank; one that still goes to the next page leaves its room marked on the
Page pane with *Fit the picture here*, which writes the width that keeps it there. A
width written by hand is never changed. **/** → *Page break* writes
`<!-- pagebreak -->`, a dashed rule in the note: the PDF starts a new page there,
unless the page is still empty, and every other reader sees an HTML comment. No HTML
comment prints. A video prints as its thumbnail with a play mark and its *Watch*
credit, or as a line with that link when it has no thumbnail. A diagram prints at its
size on screen. A caption is never parted from its picture, and a heading never stays
alone at the foot of a page.

**Chapters and guidance.** **/** → *Include a note* writes `[[include:<id>]]` on its
own line, drawn as a chapter block with its number, title and first words, *Open* and
*Remove*. In the PDF the included note becomes a chapter under its title, its own
headings one level down, a new page for each in Report (a heading right above an
included note goes with that chapter, and in Report opens its page); chapters go two levels deep,
and a loop or a note no longer in the case prints a short aside instead. A chapter
counts as a `mentions` edge. A line `<!--? … -->` is guidance: drawn as grey words,
replaced by what is typed on it, never printed nor counted, and an HTML comment to
any other Markdown reader.

**One copy, one tab.** The Notebook, the note on the side and the To-do share one
copy of each open note (`lib/notes/noteDoc.svelte.js`), written 700 ms after typing
stops and at once before an export or a tick. A note opened in a second browser tab
is taken there: the first tab writes what it has and turns read-only with *Edit here*
to take it back.

**On the side.** A note pinned to the side stays on the right as tools change,
resizable at its edge (`components/NoteDock.svelte`). Its bar has the same **Write |
Page** as the Notebook, but Page shows the PDF in place of the note, which keeps its
place underneath; pressing a page or a warning goes back to Write at that line, and
anything put or cited in the note goes back to Write first. Those pages offer no
picture size marks, the surface being too narrow for their bar. The choice is kept per
surface for the browser. In a narrow note the save state is a mark with its words on
hover, Add is its "+" alone, and under 340 px only *Not saved* shows. Notes in the sidebar pins one,
as do **Pin to the side** in the Notebook and *Note on the side* in Go to; the note
button in the top bar shows and hides it. The first time it opens it says it stays
and that Notes in the sidebar brings it back, once per browser. Its bar picks the
note from the same list as the sidebar's (`components/NotePicker.svelte`) and opens
the note in the Notebook or its own tab. Whether it is open is kept for the browser,
which note per case.

**Putting things in the note.** **Add** (+) in the bar puts what the tool on screen
shows in the note, always in this order: *Cite “…”* when the tool shows a record, the
tool's own offers (at most four), then *A source…*. While a note is on the side, the
tools' own menus add *Put in “<note>”* beside their Copy, Export or capture; with no
note on the side, no tool changes. A put is one press, never a dialog: it lands at the
cursor, or at the end if the note was not written in this visit, on lines of its own;
the note scrolls to it and lights it, a picture opens its caption, and the toast offers
Undo, which also sends what was filed only for it to the Trash. A picture is filed in
the case like any capture, and the same state put twice is filed once. Tables stop at
200 rows with a line naming the cut, and their records are chips, so their sources get
their number (`lib/notes/putInNote.svelte.js`, offers from `lib/noteHere.svelte.js`,
openers in `tools/**/*.opener.js`).

What each tool puts, and where its *Put in “<note>”* sits:

| Tool | What lands | Where |
|---|---|---|
| Map | *An area of the map*: the capture marquee is armed and the box dragged is filed as a capture (Esc or Cancel calls it off), once per identical view (provider, imagery day, centre, zoom, bearing, size). *This point*: decimal degrees at 5 places, or the open place's chip and its coordinates. *This measure*: its own text and assumption, and the day a shadow was read for | capture menu, right-click *Put this point in “…”*, Add |
| Compare | *An area of the pair*: the frame tool is armed for the note alone (Esc, a click or Cancel calls it off) and both pictures of the box drawn land side by side, both days in its credit, kept once per identical pair and frame; the export's own frame is left as it was. An unsaved comparison is saved as *<place>, <day A> to <day B>* | Export panel |
| Detect | *This pin*: a pinned candidate's evidence picture, captioned with what was measured, its area and its days; a candidate not pinned offers nothing | the pinned verdict |
| Inspect | *This frame*, labelled *Frame at 00:12.480*, saved first when it is not | under Save to case |
| Collage | *This collage*, saved first when it is not | under Save to case |
| Geo Proof | *This proof*, saved first when it is not: the picture at full width, captioned with the proof's own sentence and date, then one line per point (name, point of view or shown) | export menu |
| Timeline | *This window* as a table | Copy, Add |
| Sheet | *This view* as a table, its provenance header kept | Export, Add |
| Media | *Quote the post*: the words as posted, the account and day, then the media's chip | Open in…, Add |
| Map plate | *This page*: the page on screen drawn at 300 dpi (at most 36 Mpx, a large paper coarser rather than refused), filed once per plate, day, step and size, its credits on its face; refused while tiles are still loading. *The days side by side*: the plate's sheet, 2 to 12 days | the export dialog (PNG, Sheet), Add |
| Compare | *This evolution sheet*: 2 to 40 pictures, the comparison saved first, each day credited (Wayback days as estimates); fetched on that press | Export panel with Sheet ticked |
| Horizon | Offered whenever an eye stands: a box dragged over the view as it shows, loupe kept (Esc or Cancel calls it off), the view saved first, filed once per view, area, kind and size. *An area of the photo above the terrain* while a photo is laid, else *An area of the view* with its names, ruler and credits. Never a Find score or rank | Export menu, Add |
| Detect | *The kept table*: kept and noted candidates only, under a quoted header (run and areas, analyzer, passes, threshold, cloud mask, *N kept of M candidates, P pinned*), 200 rows at most | beside Export as layer, Add |
| Timeline, Graph | *This reading* as a picture of its plate, filed with the snapshot that freezes it (or the one open) | the *Export this reading* dialog, Add |

*Open in <Tool>* on a picture's bar reopens what it came from: the map at that view
and basemap (not a tilted capture's pitch nor a dated pick), the comparison as it is
now, the video at the frame's instant, the collage, the proof, the run at that
candidate, the plate at that day and step, the Horizon view, the Timeline or Graph
snapshot. Pictures filed before this build carry no such way back and show none.

**One press, the right surface.** The extension's toolbar button has no popup once it
is paired (`extension/background.js`, "the toolbar button"). On a map site its own copy
of the app's hosts names (`extension/mapsites.js`, held to `engine/mapsites.py` by
`tests/fixtures/map-site-hosts.json`), it puts the map panel over the map, and a second
press takes it off. On any other page it opens the note below. On Azimut's own tab it
opens nothing: the press is the browser's leave to capture that tab, the app says
*Extension ready. Press Capture again* and the button shows a tick for a moment. The
decision is made before anything is awaited, because a side panel opens only inside
the press. Until a token is stored the button opens the pairing popup instead: three
steps, the token, **Pair** (`extension/pairing.js`, the check the options page makes
too), a token the app turns down never stored; on Azimut's own tab its **Open it** asks
the app for Settings on the Capture extension tab (`open-pairing`). Paired, it offers
what the press was for. The map panel's header holds the case picker, a dot for whether
its drawing sits on the ground (green placed, amber placing itself, grey nothing to
draw on; the words in its tooltip, and under the header only while they ask for
something), the note, the link and the fold. **Capture an area** comes first, with
Lat/Lon fields only where the address gives no position; the selection's bar holds the
scale bar and north arrow tick, remembered, and the bearing the arrow needs. A panel
that cannot reach the app says why in its body: *Not paired with Azimut yet* or a
token turned down (**Pair with Azimut** opens the options), or *Azimut is not
answering* (**Try again**).

**Notes in the extension.** The toolbar button on any page that is not a map,
**Alt+Shift+N** anywhere, and the note button in the map panel's header open the
browser's side panel (Chrome) or sidebar (Firefox) on the app's own note, framed:
`#notebook?case=…&note=…&solo=1&panel=1` (`components/NotePanel.svelte`), one copy of
the note with the app's. Its bar picks the case (the workspace's cases and scratch
sessions, the open one marked), then the note with its picker (Case notes and the
case's notes), then the save state, **Look** (the Notebook's own, its panel as wide as
the space allows), **Write | Page** and **Add (+)**. Picking a case writes the note shown, then switches in place to the note pinned
to the side for that case, else Case notes; the address keeps the new case and note,
and the extension follows: its map panel, Capture and right-click items go to that
case, and a case picked in the map panel reopens the note on it. Firefox opens its
sidebar only from a press on the browser itself, so its map panel's note button says
*This browser opens the note from its own sidebar, or with Alt+Shift+N.* **Save this
page**, over the note, files the page in front into the note's case as a bookmark
(`notes-bookmark`, `POST /api/ingest/bookmark`), asking for the page first where the
browser keeps it from the extension. The editor is the compact one,
with no *Open in…* nor ⌖, and a chip opens the record's address in a new tab. With no
`case` the app's last case opens, with no `note` the note pinned to the side or Case
notes, and a pick is kept in the address. With no case it says *Open a case in Azimut,
or pick one in the extension's map panel, then open the note again.*

While the panel holds a note, a right-click on any page offers **Cite this page**
(**Cite this post** on X, Bluesky or Telegram), **Quote the selection** and **Capture
into the note**, and **Alt+Shift+S** captures the map in front. The note's **Add (+)**
offers the same three first, under *From this tab*: it asks the panel (`note-tab-ask`)
and the panel answers what the tab in front holds (`note-tab`: open, closed or none,
its address, title, selected words, whether it is a post, and whether it is a map, which
the extension asks of the app's map sites with its pairing); a pick goes back as
`note-tab-run`. The menu says *Reading the tab…* until then, *Allow Azimut on this
tab…* for a closed tab and *Nothing to add from this tab* for none, then *A source…*. A press in
a side panel opens no tab to an extension, so the first pick asks the browser for every
site (an optional permission, SPEC §9); where the browser will not ask from inside the
note (Firefox), *Allow* shows on a line above it. Refused, the panel says *Right-click
the page to cite, quote or capture it.*, and the extension's options say when it is
given and take it back. The extension sends only facts (the address, the title, the
words, a filed capture's id) to the frame (`postMessage`, `note-put`), which writes the
note through the same Put as every tool, with its light, toast and Undo:

- **Cite** puts the page's chip: the case's own item for that address, else a bookmark
  filed and named from the address or the page's title, nothing fetched.
- **Quote** puts `> [“the words”](address#:~:text=…) [[entity:…|Title]]`: the words
  verbatim (spaces collapsed, past 1,000 characters cut with `[…]`) linking to the
  passage itself, a text fragment that opens the page scrolled to them and lit
  (`lib/notes/textFragment.js`), then the page's chip. A written link to a cited
  record's page, a passage link included, is that record in the Sources list.
- **Capture** works on map sites and always draws the map panel's area selection (*Drag over
  the map to capture it. Esc cancels.*): only the rectangle dragged is filed into the
  panel's case and put in with its caption field open, and Esc, on the page or in the
  panel, puts nothing. Elsewhere it says *Captures are for map sites. Cite this page
  instead.* A browser lets an extension capture a tab only after a gesture on it, so on
  a map never right-clicked (nor its toolbar button pressed there) a press says *Right-click the
  map to capture it.*, learnt from one capture taken on the press and thrown away; no
  browser message is ever shown as it is.

The items are gone when the panel closes or holds no note. On Azimut's own page they
say *This is Azimut itself, not a source.*

**A source…** takes a pasted or typed link. It is looked up in the case first, nothing
fetched (`GET /sources/lookup`): what the case holds is cited. Otherwise *Bookmark*,
named from the address (*Post by @h on X*, *Telegram, channel #n*…,
`engine/urltitles.py`), or *Download*, the only press that reaches the network. A link
pasted alone in a note is looked up the same way: *Cite it* when the case has it, else
*Bookmark it* with a name read from the address.

**The note in the case.** A save restates the records a note cites as `mentions`
edges (`engine/notelinks.py`), so the note shows in their Details and the Graph; a
mention stated by hand in Details stays. Notes written before that get theirs once,
the first time the case is opened, without their file being touched. Details lists
**Cited in notes** with each sentence, which opens the note on it, and **Cite in
note** puts the record into the note being written. A note's open tasks show under
the To-do lists, ticked there without opening it. Go to (`Ctrl+K`) finds words inside
notes.

**Templates.** *Keep as template* saves a note's text, folder and look, without its
cover picture or day. Settings → Templates → **Notebook templates** shows each by its
first page with its style: *Edit* opens it in the Notebook with **Look** and **Page**
(drawn without a case: a case picture or record prints as a placeholder) and *Done*
back to Settings; *Duplicate*, a download as `<name>.azimut-note.json` and *Delete*
sit beside it; below sit **New template ▾** (*Blank*, *From a ready one* ›, *From one of
yours* ›, *From a note of this case* ›, each opening the new template in the Notebook)
and *Import a file*. In a template, **/** offers *Guidance* rather than *Include a
note*. `{today}` and `{now}` are written in when a note starts from one; the five print
words are filled when it prints. The ready Geolocation report opens on its own cover
page with the Azimut logo on a line of its own and ends with a signature block, both
removable.

**A report's author.** Settings › Publishing groups *Post*, **In reports** and
*On proofs* (the account handle). *In reports* holds the **Logo** (the picture the proof
composer and the Map plate already use), **Name**, **Role** and **Organisation** (one
line each, 80 characters at most) and the **Signature**, a PNG of a handwritten
signature up to 1 MB, a transparent one recommended; each field says what it takes and
where it prints. The settings backup carries them all.

**The logo editor.** A picked logo opens *Edit logo* before it is saved, and **Edit…**
opens it again. It cuts the logo to a rectangle, rounded corners or a circle, draws a
frame along that shape in a colour of its own, fills the inside with a background or
leaves it transparent, and sets a margin and a zoom; dragging a preview, or the arrow
keys, moves the logo inside its shape. Two previews show it on paper and over a
picture. Save draws the result into the logo itself (`lib/logoLook.js`), so proofs,
plates and notes print it as any picture, and keeps the picture as picked
(`logo-original.png`) with the look, so the next edit starts from it rather than
framing the frame. A logo left plain is saved byte for byte, with no original kept;
one saved before the editor existed opens as it is.

## Visual language (UI)

Tokens live in `frontend/src/app.css`. The interface follows the dense, flat
instrument style of QGIS, Google Earth Pro, Resolve and Lightroom.

- **Type**: system font for interface copy, monospace for coordinates, hashes and
  dates, and uppercase micro-labels only for panel sections.
- **Palette**: neutral gray darks (`--bg-0…3`), white-alpha borders, muted
  status colors. Azimuth amber is reserved for the primary action, selection and
  2 px active-edge indicators. It is not a decorative background or glow.
- **Theme**: dark by default, with a light daylight palette toggled from the
  foot of the rail. Both are the same tokens: `:root` holds dark, a
  `:root[data-theme='light']` block flips the colour tokens, and `lib/theme.js`
  stamps `data-theme` on `<html>` (remembered in `localStorage`, applied in
  `index.html` before first paint). The amber accent and the annotation palette
  stay fixed across themes. Surfaces over imagery remain dark through
  `.dark-surface`. New chrome must use tokens; hardcoded light colours are limited
  to text on dark image scrims.
- **Shape**: radii 3/4/6px, flat panels with 1px borders, rectangular badges.
- **Update dot**: `.update-dot` on a `.dotted` host says "something here is to
  install or update", and nothing else. It repeats down one path — the topbar
  gear, the Settings tab holding it, then the button that acts on it — so
  following it always ends somewhere it can be cleared. No counts, no other
  colours.
- **Motion**: none. Color-only transitions ≤0.15s; no entrance animations,
  no hover lifts. Transient functional feedback (locate-flash) is the one
  exception.
- **Copy**: no slogans or self-explanation in chrome. Empty states use one short
  sentence. Visible UI strings use `·`, `:` or a period instead of em dashes.
- **The analyst's words keep their direction**: the interface stays English, and a
  label, a note or a statement in Arabic, Hebrew or Persian reads right to left
  where it is shown or typed. HTML holding them carries `dir="auto"` (the Timeline's
  captions, cards, list and inspector, the Board's names and fields, Details' name
  and notes, the Claim editor). A canvas node name and an SVG plate label, which no
  attribute reaches, are wrapped in a first-strong isolate (`lib/bidi.js`
  `bidiIsolate`). Date fields stay left to right.
- **Brand**: north arrow (`Logo.svelte`) + drawn wordmark (`Wordmark.svelte`),
  both defined in the components themselves. The arrow repeats in
  `public/favicon.svg` and in the plated PNG/ICO icons that
  `packaging/icons/render_icons.py` redraws; move those together.
  No other place uses brand lettering.

## Adding a tool (checklist for future work)

1. Add the component under `frontend/src/tools/`. Register it in `App.svelte`
   and the workspace's `tools` array in `lib/workspaces.js`.
2. Consume tokens and shared primitives (`.btn`, `.input`, `.card`,
   `.tool-header`); respect the accent roles above.
3. The tool owns its artifacts: list, reopen and delete them in-tool; file
   entities with provenance so Suggestions/Details work.
4. Tests accompany the tool (repo rule); pure logic goes in `lib/` with a
   `.test.js`.

## Adding a tool to the map (checklist)

A tool that works *on* the map is not a rail seat of its own: it joins the map's
own registry.

1. Declare it in `lib/map/tools.js` — a mode (it changes what a click means), an
   action (it runs and arms nothing), or a layer (it is drawn and toggled).
2. A mode says which cursor the surface wears while it is armed, and whether it
   brings a panel. Its store answers `isOn` / `open` / `close`, plus `pointing`
   when being armed is not the same as waiting for a click. Exclusion is then
   automatic — nothing else has to be told the new tool exists.
3. A mode's reading goes in the status line, not in its panel: a number the map
   is telling you belongs beside the coordinates.
4. Keep the rail at seven seats or fewer. The eighth files itself under an
   existing group with a flyout.
