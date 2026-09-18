# Azimut UI and UX reference

This document defines the interface structure and visual language. Feature
phasing lives in [SPEC.md](SPEC.md).

## Layout anatomy

```
┌ topbar: rose+wordmark (home) · case switcher + Board · (spacer) · guide mark · settings gear · sidebar toggle ┐
├ rail ┬ tab strip (only when the workspace has several tools) ┬ case sidebar ┤
│      │ tool canvas                                           │              │
└──────┴───────────────────────────────────────────────────────┴──────────────┘
```

## Workspace model (UX)

The rail holds a fixed set of workspaces in investigation order. Tools register
in `frontend/src/lib/workspaces.js` and appear as tabs, never as new rail entries.

| Workspace | Tools today | Future tools land here |
|---|---|---|
| **Home** (the mark) | Overview, Guide | |
| **Case** (topbar) | Board, Graph, Timeline, Sheet | v5: Orchestrator |
| **Sources** | Media Library, Files, Reverse Search | Channel Monitor, Evidence Locker |
| **Examine** | Inspect (Selection / Frame / Collage / Analyze) | Edit Provenance, Shot contact sheet, OCR, Image Compare, Hints, Sky Clock, audio |
| **Map** | Satellite, Compare, Coords & Sky | Imagery Wayback, Event layers, Ground Imagery, Measures, Viewshed, OSM Query, Map Board |
| **Compose** | Geo Proof, Geo Report, Notebook | Report Builder, GIF maker |

**Case is not on the rail.** The rail reads as a sequence of stages, and the case is
not a stage: it is what every stage files into. It hangs off the case switcher in
the topbar instead, so the header answers *which case* and the rail answers *what
am I doing*. It stays a workspace in every other respect — tabs, `#case` deep
links, and its own remembered sidebar. Timeline lives here because it is another
reading of the case, not a collection or examination stage.
That sidebar stays closed by default, because the board already lists the same case
and two lists side by side only ask which one is real.

**Home is not on the rail either**, and for the same reason. It sits on the wordmark,
which is the one affordance that needs no label and costs no seat, and it is where the
app opens (`#overview`). Its sidebar starts closed too: the page is read rather than
worked in, and its whole subject is the case the sidebar would be listing again.

## Home

Two tabs, chosen by who is looking. **Overview** is for somebody who has been here
before; **Guide** is for somebody who has not.

- **To-do** appears whenever a case is open, including an empty case. Each named
  list has its own tab and completed/total count. The block occupies one grid
  column, beside the start actions in an empty case, and stacks on narrow screens. Enter adds a task; click its
  text to edit it, check it off, or delete it. The list menu renames or deletes
  a list, with confirmation for a populated list. Changes save automatically.
  Lists are case metadata in `case.json`, included in case bundles; they are not
  graph entities and own no artifact files. Task and list deletions are permanent,
  outside Trash. Concurrent edits from another browser tab require reloading the
  lists before saving again.

- **With a case open, the page is a reading, laid out as a dashboard.** The case name
  and when it was last touched, then a two-column grid: *what is waiting* and the
  recent work on the left, the case's points and the case by family on the right. It
  runs to 1180px rather than a 760px reading column, because this page is scanned
  rather than read and four counts hanging in a ribbon on a wide screen is the emptiest
  an app can look. Below ~980px the grid stacks in that same order.
- **What is waiting is the Board's own standing questions, priced.** *To review*,
  *Nothing linked yet* and *Unfiled* are the same three terms the `+ Filter` menu
  offers, worded once in `lib/entityFilter.js`; the fourth is the Timeline's undated
  count. They are drawn as four tiles, two by two, because a number is read at a glance
  or it is not read. Pressing one hands the **question** to the surface that answers it,
  through the slot Board and Graph already share, so the table lands on exactly the rows
  the number counted and the two can never disagree.
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
  folds its own body open on the page (the check returns it) with a download link, and
  is silent when the release was muted or the check is switched off. A capture extension
  that was never installed gets one line pointing at the tab that installs it, and the
  line disappears the moment one is. Neither is dismissible state: both are conditions
  that clear themselves, so nothing here is stored and nothing here nags.
- **With no case open the page is the front door.** A fresh install lands in an empty
  workspace, where there is nothing to summarise and nothing on screen that says what
  the rail means: what Azimut is, the rail drawn as the sequence it is, a field that
  names the first case, and the cases already in the workspace when there are any.
- **The Guide is one section per workspace**, between two that set up and two that
  close. Setting up: what a case is, and the capture extension that feeds it —
  installing it is the first thing the first section says, because it is the one setup
  step that changes what the app can do. Then **three worked examples**, whole jobs
  walked tab by tab, because the sections describe tools and somebody arriving has a
  goal; each step names the tool it happens in and opens it. Closing: **every keystroke
  the app listens for**, grouped by where it is pressed, and **what to do when something
  does not work**, symptom by symptom. Static text rather than a tour, and no
  screenshots: a tour breaks on the first layout change, a screenshot is stale the
  release after it was taken, and both fail silently. `guide.test.js` fails when a tool
  joins a workspace and nobody wrote down what it is for, when a recipe sends the reader
  to a tool that does not exist, and when a key is filed under a tab the app no longer
  has.
- **The `?` in the topbar is the way in.** It sits beside the settings gear rather than
  in each toolbar, so there is one of it, and it opens the Guide on the section written
  about the tool being stood in (`guideFor`). A tool no section covers opens the guide
  at the top. It is absent on the Guide itself, which is the answer.
- **The contents list follows the reading.** It marks whichever section is under the
  eye as the column scrolls, measured against a line just below the top edge so a
  heading that has only just passed is the one being read, and the last section takes
  the foot of the page since a short final section can never reach that line. A press
  on the list owns the mark until its scroll lands, or the one control that says *go
  here* would point somewhere else three times on the way.

Rules:

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

The case as one table: a row per entity, whatever type it is. It is what makes the
hand-made vocabulary reachable — a `person`, an `account` or a `claim` had no screen
before it. One view, a table; the graph is a different question and comes as its own
view. Following a relation to a type with no tool of its own lands here, on that
row's Details.

- **New entity** offers the types an analyst creates by hand and generates the form
  from the registry. It is **one dialog shared with the graph**, so a claim is filed
  with the same words and the same duplicate warning wherever the analyst is standing.
  It opens on the type being filtered for, or the first of the chosen family. The primary field names the value being entered — **IP address**,
  **Full name**, **Handle** — never a generic **Name**. An identifier the case
  already holds is flagged with the existing row one click away: a warning, not a
  block, since merging is not shipped. What it creates opens into its own Details.
- **Add file** takes a document, scan, plan or image into the case, by the button or
  by dropping it on the list. It runs the Media Library's import, so the file is
  hashed, deduplicated, given a sidecar and a thumbnail, and filed as a `media`. One
  file opens its Details; a batch reports what landed and what was already there.
- **Search+** covers the label, type, folder, notes and declared text fields
  (ONTOLOGY §2), in memory on a case that fits one page and server-side past it.
  The first matching field is named under the row, so a vehicle found by its plate
  never looks like an unexplained result. Board and Graph send the same terms to the
  same case predicate.
- **The question is a bar that never changes shape**: a search, one **+ Filter** menu,
  and a removable chip per term. It replaces seven selects, four of which appeared and
  disappeared as the others were set — so a live term looked exactly like a dead one,
  and a control that vanished took its own way back with it. An axis that cannot be
  asked yet stays in the menu **with its reason next to it**, because a control you can
  see and cannot use teaches something and one that is not there teaches nothing.
- **The menu opens on four Questions** — *To review · Nothing linked yet · Added this
  week · Unfiled* — and picking one drops its terms in as ordinary chips. That is the
  whole of the onboarding: the answer arrives, and the sentence that produced it is
  sitting there to edit. They are code, not saved state, so nothing new has to reach
  the backup.
- **Nine axes, every value chosen from the case and counted**: a stored field and one
  of its values (*kind = video*), one or several types, one or several families, a
  folder with or without its subfolders or none at all, review state, a one-hop test
  for touching a type, having no connection at all, when it was filed, and what filed
  it. A count that would answer a *different* question is not shown: **Linked to a
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
- **Sorting** is a click on any heading, reversed by a second. Two of them name a
  column the store can order the **case** by — identity and created — so *newest first*
  is the newest in the case rather than the newest of the hundred rows loaded. The
  others sort what is loaded and say so beside the count while there are more. One
  gesture either way: which of the two it is belongs to the column, not to a second
  control the analyst has to find.
- **Columns** are the four every entity has — identity, type, folder, created — plus
  the chosen type's declared fields once a single type is picked. Read-only: a value is
  edited in that row's Details, and the Case Sheet works on the case's CSV files rather
  than on these rows. A primary entity photo replaces the type
  icon in the identity column; without one, the icon remains.
- **A row is a control**: focusable, opened with Enter, and the review clicks inside
  it never open it.
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
  which nodes: **Everything · Subjects · Ground · Statements** read the case, and **My
  work** reads the filing — what you wrote, what it was made from, and what it points
  at. They are resolved from the verb registry and the type roles, never listed here,
  so a relation or a type added to the engine joins its lens with no edit.
  Narrowing the verbs never hides a subject: an entity with no edge *in this lens* is
  an answer. What a lens takes out of the drawing is a whole **role** — a post, a note
  and an Inspect session are the filing rather than the case, and My work is the one
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
  entity in the table, and *In the graph* in any Details panel opens it here.
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

- **Header** — the case name (its id is a tooltip), a **Notes** button opening
  `notes.md` in the Notebook, a search field, and one filter chip per entity type
  present, counted from the catalog summary. The chips wrap; past the fifth they
  fold behind `+N`, and the active one always shows.
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
  `+ Folder` and `+ Note` sit above the tree.
- **Filing** — drag rows onto a folder, or drop them on Unfiled to unfile.
  Ctrl/cmd-click and shift-click select several rows first, and the drag carries
  all of them; folders are targets, never cargo. The tree scrolls itself when the
  pointer nears an edge mid-drag, since a native drag swallows the wheel.
  Unfiling does not delete data. The **Files** tab presents the same tree with
  tiles, multi-select and context actions. It also exposes Trash with the same
  restore, permanent-delete and empty actions as the sidebar. Delete sends the
  current selection through the standard confirmation.
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
proof PNGs, analysis plates and sheet CSVs. **Change…** opens the shared folder browser, which lists folders
only and can create one; the case's `exports/` stays the default. Media Details,
saved proofs and Notebook use those same destinations. Files already outside a
case are never overwritten, and concurrent exports reserve distinct numbered
names.

The Settings backup carries portable settings, API keys, templates and the
signature. It leaves absolute export paths, the workspace pointer and download
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

**A Claim's fields use three sections**: statement, time and reasoning. The Time
section uses a guided editor for a year, month, day, date and time, bounded date
range or zoned time range. Precision, certainty and timezone are chosen separately, so the analyst does
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
UTC. One searchable picker decides what the labels read: UTC, this computer's zone, any
zone in the world, or local time at a place the case has saved. A zone is named rather
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
Category tracks stack vertically. An instant is a point and an explicit interval is a bar.
A reduced date stays a point, with a thin bounded line showing the whole year, month
or day its precision covers. Approximate dates use a dashed edge and uncertain dates
use a pattern. Suggested status uses a corner mark; refuted confidence strikes the
label. The legend separates date quality from assessment confidence because the two
are independent.

The toolbar states the window in words, on the axis's own clock, between two step
arrows: pressing it opens the exact boundaries, the spans `Hour` to `Year`, and `All`
for the complete filtered extent. A span is asked for by name rather than reached by
repeated zoom steps, and the reading is what stays out because a window is checked far
more often than it is typed. Dragging the ruler pans directly. The wheel zooms around
the pointer; Shift-wheel and a horizontal trackpad gesture pan. Arrow keys, Page Up/Down, `+`, `-` and Home provide
the same navigation without a pointer. Full screen keeps the whole workspace available
for dense cases.
Only the visible window is read, 200 items at a time. A separate density request keeps
the full chronology visible underneath without loading every event. The minimap is a
histogram: one column per bin, as wide as the bin, stacked by category, with exact
counts on hover. Bins are cut as fine as they can be drawn — by the hour on a case
spanning a day, by the day on one spanning months — because a case cut by the period it
happens to span drew one mark for a scraped batch of two hundred in a week and the same
mark for a single entry that could be anywhere in a month. Column heights go by the
square root of the share, so that batch does not flatten everything beside it.

The visible window is a movable, resizable brush, and what it leaves out is dimmed.
Bars, date scale and brush are placed on one mapping from instant to position, which is
the only way the three can agree: what the brush covers is what the axis is showing.
Under it, one slot per calendar period, named in the middle of its own — a period is
named under its own column rather than at the instant it opens, and only as many names
as fit are printed. The columns answer the pointer and the space around them drags the
brush, so a bar under the brush is still clickable; clicking one opens the axis onto
what that bin holds. `Case activity` is off by default. `Undated`
contains missing dates; a separate `Not on UTC axis` list keeps local timestamps and
invalid legacy values visible without inventing a timezone. The date a fact entered
Azimut never masquerades as the date of the fact.

Overview stays above Plot or List, so expanding a dense track never pushes the global
navigator below the chronology. Events are packed against their rendered labels.
Overflow becomes a `+N` control that expands the track in place; **Collapse** in that
track's left label restores the bounded view and its `+N`. Plot and List are
two readings of the same loaded page.

The Timeline opens with **Events** and **Media** tracks. **Track** adds editable
presets for Events, Person, Place, Media, Sources and Case activity, using labels from
the entity registry. **Custom** opens the shared Search+ builder, then states whether
that question matches the entry itself, its subject, place, evidence, or any of those
connections. Category and time-role filters remain separate from that question.

Each track shows its name over two lines before the ellipsis, and hovering it names the
categories and the Search+ question the lane was filled from. A track can be given a
**colour**: left on **Auto** its entries keep the category colours the legend explains,
and a chosen colour wins for that track alone. Each track has one reorder grip and a
fold control. Dragging the grip changes its
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

A track that includes Statements can create Claims; Media-only and Case activity
tracks cannot. Clicking empty space creates a point; dragging creates a bounded range.
At day scale and below these are zoned timestamps and time ranges, so hours can be
created, moved and resized directly. Date-only Claims support the same confirmed move,
and intervals expose both resize edges. Every direct write shows the old and new
values before saving.

Selecting an entry opens a fixed-width inspector without changing the axis geometry.
It shows the readable and raw date, precision, timezone, authority, role, status,
confidence, reasoning and named subjects, places and evidence. Statements can be
edited there. **Right-clicking an entry** — on the axis, in the list or in either
holding queue — names the same four acts where the pointer is: pin, hide, Details and
Edit assessment. It changes no selection, so a pair being measured survives it, and the
two lane acts follow the inspector's rule of appearing only for an entry that has a
lane. A media date offers **Add correction**, prefilled from the intrinsic
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

**Open in** ends the track row, not the boundaries menu: a window is set rarely and
asked of the other surfaces often, so the three targets stay one click away while the
header keeps the window alone in its middle column. Board and Graph receive it
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
collected, the frames, collages and captures it produced itself held back — a capture
is a map the app drew out of tiles or the extension grabbed off the screen, where an
upload, a paste and a download came from outside — and the switch says how
many those are rather than leaving them unannounced; the counts and the paging are
computed with it so the facets never disagree with the list, and toggling it refetches
because the loaded page is already the collected subset. It reads how the file
**entered the case**, which is not everything true about it: one imported and later
found identical to an extracted frame stays on the side it came in by. A case holding
nothing but working files says so instead of offering to import. Thumbnail polling follows all pending case jobs, including
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

Every media row and card shows the file's human-readable stem, without its
extension and without a second title line. Editing that name in Details renames
the file; the backend returns the portable stem after replacing forbidden
characters or resolving a case-insensitive collision. Downloads keep dates and
remote ids in provenance instead of appending them to the visible name.

## Map

**Compare assembles two imagery views on one camera.** It starts with empty A/B
slots and loads tiles only after a source or a starting pair is chosen. Each
side keeps its provider, Wayback release, Sentinel-2 day and reference layers.
The source cards and mode controls use the application's shared theme, buttons
and spacing. On a card the date is a chip beside the provider, reading the same
for Wayback and for Sentinel-2, so the card's layers icon means one thing. The
cards are as wide as the maps under them, so the split between A and B is one
line down the tool. Both Layers buttons open the same A/B sheet, including each
side's FIRMS period, VIIRS night and saved case work.

The mode dock holds two kinds of choice, separated by a rule. Left of it, how the
pair is *read*: side by side, through a swipe, with B faded over A, or as
alternating whole frames. Blink has three speeds and can pause on either side.
Right of it, what gets *computed* over the pair: **Difference** and **Detect**.
Keys 1–6 switch modes; Space pauses blink. Dragging, zooming or rotating either
map moves the other in the same frame. Both stop at the lower provider zoom
ceiling. **Swap A and B** exchanges the complete source stacks and annotation
sides. One compass in the bar reads the shared turn, resets it to north and takes
an exact angle.

Each computing mode owns the same column beside the stage: the maps narrow rather
than being covered, and the dock above is the only switch between the two. Leaving
the mode closes the column.

**Difference** checks that the sources can be compared before it runs.
Colour, structure and brightness methods read captured pixels in a worker.
Sentinel-2 also offers six spectral indices — NDVI, NDWI, MNDWI, NBR, NDBI and
BSI, the ones Detect measures — from the actual bands. Band frames are fetched by
an explicit act only — **Read this view**, or switching the cloud filter on —
one metered request per side; reopening a session or moving the camera never
fetches. Each frame is kept with a margin of ground around the view, so the
reading keeps its bands while the camera stays inside that margin, and past it
the last reading stays up, marked in the footer as an earlier read, until Run. A changed view must be run again before
export. A reading recomputes by itself after every move, on the
frames it holds; what it never does on a pan is spend a request.
These viewport captures depend on display resolution and zoom. Use **Detect**
for a fixed analysis grid across camera changes.
**Highlights over** sits above the tabs and says what the reading is laid on: A
alone, B alone, or both images side by side with the same mask on each — the one
arrangement that shows what a change went *from* and *to* at the same time. The
eye beside the title hides the overlay, and **Blink** flashes it on and off,
because a thin highlight over busy imagery is easier to catch moving than still.
**Clouds & shadows** sits beside it, one click, because cloud is the first thing
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
displays. A spectral index skips the automatic threshold: it is highlighted past
a stated index change, the line Detect draws, so panning cannot move it. Tone
matching defaults to automatic, which means none on Sentinel-2 — two passes
already corrected to surface reflectance have no exposure left to match, and
matching them would erase a burn that covers most of the view — and a histogram
on Esri releases, which carry two renderings. Coverage, highlighted
area and selectable change zones describe the result, each zone carrying the same
strength word a Detect candidate does: how far past the line it got. These are candidate pixel
changes for inspection, not confirmed changes to objects.

**Detect** sweeps a drawn area of Copernicus Sentinel-2 at native resolution and
keeps what it found. Every detector measures reflectance bands, which a rendered
picture has already stretched away, so Wayback has nothing to give it. Setup reads
as three numbered steps, in the order the work happens: an area, the imagery, then
what to look for.

Step 1 draws rectangles, polygons or circles, or takes the current view as a
rectangle in one click, and prices the result before anything is fetched: ground
area, native tiles, Copernicus requests and roughly how long. Each date costs two
requests a tile, the picture reviewed and the bands measured. A named area set can be
saved for this case and reused. An area is grabbed by its edge: dragging inside
one pans the map as it would anywhere else, a click on the edge shows its corner
handles, and a press that does not travel selects without nudging the geometry.
Handles and outlines are projected from the ground, so they stay on it through a
pan, a zoom or a turn.

Step 2 and the stage share one imagery between them, so what is on screen is what
a run would sweep. On arrival the maps lead, because what is above the stage is
usually what you came to analyze. From the first change made here — or straight
away when the maps show anything but Sentinel-2 — the direction reverses and
the maps follow this step; the A/B source cards step aside while Detect is on, so
there is one place to choose imagery rather than two. An analyzer that reads one
date shows one map, because there is no pair to compare. The run is blocked, with
the reason, until each image it needs is named.

On Copernicus, dates are picked from the passes the drawn areas actually have,
not from a calendar. **Find passes** asks the catalogue once, over the whole set
of areas at once, and lists what came back newest first with the two facts that
decide between them: how much of the areas that day's swath reached, and how much
of it was cloud. Sentinel-2 flies 290 km swaths on a five-day revisit, so a wide
area can have no single day covering all of it; a partial date can still be
chosen, and the panel says what share will be left unswept before the run rather
than after it. A finished run reports the share it really read, so "nothing
found" and "never looked" stay different answers. The lookup is billed as one
Copernicus request and never runs on its own.

Step 3 picks the analyzer. Eight ship built in, for big things and small ones:
vessels, fires and gas flares, construction and earthworks, small spots (impacts,
burn marks, vehicles), any surface change, burn scars, vegetation loss, and
flooding or new water. Each reads its own band product, and each was tuned on real
scenes rather than synthetic ones: rough sea under glint, a dense anchorage under
cumulus, oil fires and wildfires, bright roofs, a construction site across seven
months, dry-season pastures. Vessels stand out from their own patch of sea in near
*and* short-wave infrared, which a breaking wave does not, and a candidate joined to
bulk land is a coast. What counts as sea comes from the water index or from the
classification, either one is enough: under sun glint the index alone read a whole
strait as dry. Fires take the published short-wave ratios on B8A, which
shares B12's grid. Construction is ground that moved the same way in every band
while its vegetation held; a small spot changed while the ring of ground around it
did not, that ring read with a hole in its middle so the spot cannot sit in its own
background and over measured ground only, so a granule edge raises nothing; a burn has to end dark, which a dried pasture does not.

**Small**, **Medium**, **Large** and **All** under the analyzer set the target
size as a whole: floor and ceiling area, cleanup and grouping together, since a
small target needs no cleanup that would erase it. What the chosen one accepts is
written under the buttons in ground terms — a mark outside that band is found and
then dropped, which reads as "nothing found" unless it is said. **All** sets no
floor and no ceiling, for the mark that falls between two bands. Tuning any of
those by hand leaves no size selected. The **Clouds & shadows** switch reads Sentinel-2's classification, grows a
real cloud into the unsure pixels touching it, ignores classified "clouds" too small
to be one (white hulls and roofs), and casts each cloud away from the sun to find the
shadows the classification missed. The fire detector offers no switch: its band
ratios reject cloud already. Thresholds and the analyzer itself open from links
rather than sitting in the way. The **+** beside the analyzer starts one of your
own, either as a copy of the one in hand or from scratch; a built-in can be read
and copied but never written over, and an analyzer of your own can be saved,
renamed or removed from there. The library is shared by every case.

A **watch** keeps an analyzer, its areas and a date rule together, and
**Run again** in Saved launches a fresh pass — a weekly harbour review is that
button, not a background schedule.

**Run** explicitly starts a bounded, cancellable job, up to 4096 native tiles.
The native analysis grid is independent of map zoom. Opening the panel or
reopening a saved run reads local state only. Offline runs read only the tile cache and the frames earlier runs
kept, and a finished run keeps only the tiles that found something — so an
offline rerun covers what the cache still holds, not the whole of a past sweep.
Resolving the latest date requires a provider request at run time. Runs preserve their own input snapshots,
candidate evidence and review state. A finished run keeps the frames of the tiles
that produced a candidate and drops the rest, so a case grows with what was found
rather than with how much was swept.

What a sweep produces is a list of candidates, strongest first, and nothing else
reaches the case on its own. Each says how strong it is in a word (weak, clear or
strong: how far past its threshold it got) and what was measured in units a reader
can check, such as "6.2× brighter than the water around it" or "NBR 0.61 → −0.28".
A candidate that crosses a tile edge is one candidate with one picture, stitched
from the tiles it touches. Review them one at a time: **Keep as a pin** files that one candidate,
with its own copy of the evidence and its provenance, and is the single act that
writes to the case; **Dismiss** takes it off the map. Either verdict moves to the
next candidate still waiting, and a running tally says how many are left. Keeping
can be undone, which sends the pin and its evidence to Trash. Evidence is enlarged
by a whole-number factor with no interpolation, so a candidate a dozen pixels
across can be read without pretending to detail the sensor never recorded. Each
result layer has its own eye control, and the one under review wears a ring on the
map. Areas and candidates belong to Detect and are drawn only there; a kept
candidate is a pin, and pins show wherever case work shows.

Annotations store longitude/latitude points and stay on their ground through pan,
zoom and rotation. Notes, arrows, boxes, ellipses, lines, freehand strokes, distance
measures and polygons can belong to A, B or both. Polygon drawing ends with a
double-click or Enter; Escape cancels. Select a mark to move it or edit its style,
double-click a note to edit its text, and use Undo/Redo for annotation changes. A
selected mark shows its corner handles, so its geometry is corrected where it was
drawn rather than deleted and redrawn; a note is dragged whole and has none.
Every mark carries a wide invisible band along its outline, because a four-pixel
arrow is a target nobody hits twice. Clicking the ground beside a mark lets it go;
dragging the map is a pan and keeps it. The tool rail packs into two columns, like
Proof Maker's, so it stays short enough to fit a laptop window. Its colour, width
and fill panels close on Escape, on their own button, on a press anywhere else,
and with the button behind them when the selection is dropped.

**Right-click the ground** here too, on either map, for the acts Compare can
honour: copy the point in every coordinate format, ask what is there, save a
place there, or start a distance measure from it — the annotation of the same
name, anchored on the point and closed by the next click. The rows Satellite
offers for its own rails are left out rather than shown dead.

**Save comparison** writes the editable version-2 session under `.compare/` and
updates its rendered media preview in My work (PNG, or GIF for blink). A preview
used by a derived proof is preserved when a later save creates new pixels.
**Open** restores the sources, layers, camera, reading mode, blink speed, detection
settings, annotations and the optional export frame; Detect is a place to work rather
than a way to read the pair, so a session saved from it reopens side by side and its runs
stay in the case. Export writes an attributed PNG, blink GIF or divider-sweep GIF to the
shared Views destination; an optional ground-anchored frame cuts any of the three to the
chosen area, while Full view remains the default. Copy current PNG uses the clipboard.
Exports include projected annotations, a scale bar and north arrow. Tile captures wait
for loaded frames and reject incomplete tiles. Google Maps JS uses the
user-triggered Azimut Capture extension and retains its on-map credits.

The search bar in the header proposes matches as you type, in the order they can
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

Saved work — places, captures and screenshots filed by the extension — lives in
the **Saved** half, grouped by geography rather than by date. The
tree's depth follows the case: one country opens straight on its regions, a
worldwide case opens on continents. A filter and a `Media / Places / Captures`
switch stay pinned above it; a screenshot counts as a capture. The panel opens on
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
point, why it stands there, and the ways out: **Open in Media**, and one button
per proof built on it. The mark being read stays lit on the map.
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
  capture marquee, which is armed from the Capture button rather than from a
  toolbox. Exactly one is ever armed: arming any of them closes the rest, and
  Escape disarms whatever is. They sit in the **rail**, a column floating in the
  map's top-left corner with the zoom buttons stacked under it, grouped by a
  hairline. An armed seat wears the accent as an edge, not as a filled square.
  Adding a reference window is in the rail too, as a seat that runs instead of
  arming.
- **Its settings** open in the rail's one **panel slot**, beside it. One mode is
  armed, so one panel is open; a panel cannot cross another or the map's own
  controls.
- **Layers** — what is drawn over the imagery: OSM labels, borders, roads, OSM
  railways, power lines, sea marks, GPS traces, active fires, night lights, the
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
  legend that filters, and Refresh, Reveal file and Remove. See
  **Added map layers** below.
- **The picture** — the provider, the Sentinel-2 layer and date, when the pixels
  were taken, the eco and usage pills, and the compass — belongs to the
  *surface*, in its own top-right corner. Which imagery is on screen is a
  property of that map and not of the tool, which is what lets two surfaces sit
  side by side each saying its own.

A capture can carry a **scale bar and a north arrow**, ticked in the capture
menu: the bar bottom-left in the analyst's own units, the needle top-right,
turned so it points at true north on a map that was rotated. Off until asked
for, then remembered for every capture after it — it is a house style rather
than a decision per shot. Neither mark is ever invented: the bar states the
crop's own resolution, the needle the bearing it was filed with, and a pasted
screenshot gets neither, since its coordinates describe the map view at filing
time rather than the picture itself. What was drawn is written into the
capture's provenance.

Underneath, the **status line** reads where you are (coordinates, zoom, and the
armed tool's own measurement) on the left, and carries the two acts that take
something off the map — Save place and Capture — on the right. What marks the
point, and whether that point is the map's centre or a pin dropped somewhere,
is one small menu beside them: both are set once and the two acts are pressed
all day. The engine's scale bracket reads under the coordinates, where how far
a pixel goes and where you are make one instrument. Fullscreen sits with the
tool's title, because it is what the window does with the tool rather than what
the tool does with the map.

**Active fires** are NASA FIRMS, and answer two questions with the same marks:
what is burning now (the last 24, 48 or 72 hours, or the week) and what was
burning on a given day (any range back through the archive, up to 31 days).
Which instrument and which stretch of time are chosen in the row itself. It
needs a key, and says so with the reason rather than failing on the first tile;
a key pasted into Settings is picked up on the way back to the map. Source
tiles stop at z14. Farther in, the map enlarges their pixels into visible
squares instead of hiding the detections or asking NASA for invented detail.

**The reference layers** are key-less and each is simply on or off: Esri's
borders (country, region, district, with names) and roads, Open Infrastructure
Map's power lines, OpenSeaMap's buoys and harbours, and the raw GPS traces people
uploaded to OSM, which show tracks nobody has mapped yet. Borders start on —
reading imagery starts with which side of a line the ground is on — and none of
the others fetches a tile before its switch is pressed. The roads follow the
labels' rule: over a street map they are greyed, since it already draws them. Power lines are drawn
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
or GPX file opened from the computer, or a public My Maps or map URL followed.
Both land in the same section, because the question the row answers is who put
this on my map. **A layer is drawn and never adopted** — clicking a feature opens
what the source says about it, its name, its group and its description, with
nothing to confirm and no way from there into the case. A description written as
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
  read, and says *stale* when that was long enough ago to matter — before the
  marks are read, not after.
- **Both counts.** `3 200 features · 412 shown` whenever a group is switched
  off. The number drawn never passes for the number loaded.
- **Its legend, which is the filter.** One row per group with its colour and its
  count; clicking one hides exactly those features and keeps them loaded. A KML's
  groups are its folders, which is how a My Maps is built; a GPX's are waypoints,
  tracks and routes; a GeoJSON states none, so the file is one group named after
  itself rather than a grouping guessed out of whichever property looked like one.
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

**Refresh, Reveal file and Remove** sit under the row. A followed map is re-read
when it is added, when Refresh is pressed, and when a case opens holding it
enabled — never on a timer, and never while it is switched off. A read that finds
nothing new rewrites nothing, a read that fails leaves the last copy on the map,
and the copy the layer was drawn from is kept in the case, so it draws offline and
travels in the bundle. Removing a layer takes that copy with it, to the trash.

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

The saved-work layer answers two questions under its own switch: **what kind**
(all, places, captures, proofs, media) and **which folder**, offered only where the
case has more than one to choose between. They are the Saved panel's own
filter, so a map read here and the panel beside it can never disagree about
what the case holds, and the layer's count is what is drawn rather than what is
filed. It is on from the start, on the Media
position, and session-only: the tool stays mounted across tabs, so a switch
pressed off stays off until the app reloads and nothing is written to the case.
Places draw as outlined pins, captures and screenshots as filled ones, located
files as white-ringed ones, items at the same spot collapse
into one counted mark, and clicking a mark of saved work opens a card
with its preview, provider, dates and note. A mark of files has no card: it plays
them in the panel. A mark whose capture carries proofs
wears a dot up-left; its card names the count and offers **Show proofs**, which
switches the panel and the layer to the proofs view. In that view the card opens
the proof in Geo Proof and lists the saved posts written from it. Two post titles
fit directly in the card; additional posts expand in place, and selecting one
opens its draft in Geo Report. Hovering a card, a tree row or a search result
lights the others.

A card also holds the point's relations. The Saved index carries their count only,
so a stack of five marks is never five requests: a lone mark opens its relations
straight away — clicking a place to see which photos claim it is the point of the
gesture — and a stack waits to be asked. A point enrichment proposed from a file's
metadata is marked `suggested` in both the card and the tree, so a camera's reading
never passes for analyst work. The Save-place dialog carries the matching write:
one **Relate to…** field says why the point is being saved while the analyst still
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
*Relate to…* are what an analyst fills at the moment of saving; how precise the
point is, the source's own wording and how the point was found are edited in the
panel every other surface opens. **Edit more details** on an existing place opens
that panel — the same body as the case sidebar — and asks first if the short form
holds something Save has not taken, since the panel opens on what the case holds.

**Esri Wayback is a basemap of every World Imagery release.** Picking it puts a
chip beside the provider naming the release on screen, and the chip opens a
slider through time, oldest left, with a step either way and the list under it.
The list opens on **Changes here**, and so does the slider: only the releases
that brought a new picture of the tile under the crosshair. Esri's tilemap says
which release a tile really comes from, and walking it backwards shortlists the
candidates; a picture Esri published again, re-encoded or re-coloured, is folded
into its first publication by comparing the tiles themselves, then the
acquisition date and satellite their metadata states. Each row carries its
release date and, beside it, when the picture was taken; the pill under the chip
dates the pixels on screen the same way. Narrowed to changes, the newest release
is named by the change it shows rather than by a date no row carries. **Every
release** lists all of them, where neighbours often look identical because
nothing changed there.

**Opening the picker once makes the history follow the map.** Every view that
settles over another tile reads that tile's history from then on, picker open or
shut — gating that on the picker *staying* open was the bug behind a picker that
re-opened on wherever the analyst had been before. A tile already read costs
nothing, and a tile Esri refused is left alone until **Refresh** is pressed, so
panning never hammers a service that is down. A first history takes some seconds
(Esri's metadata service is slow) and the picker offers nothing while it comes,
since every release is not what *Changes here* was asked for; the changes it
already has stay on the slider while the next tile's are read. A history that
fails falls back to every release, which is the honest answer to not knowing.
The release rides on the provider id (`esri-wayback~64776`), so tiles are cached
and captures credited under it.

**Right-click the ground** and a menu acts on that point rather than on the
centre: copy it in every coordinate format, the analyst's own first; ask what
is there, answered inside the menu; save a place there; start a distance from
it; anchor the sun and moon on it; open its Wayback history; centre the map
on it; or open it in another map site. A right-click on a shape that answers
its own (a search-grid cell) stays that shape's. The menu flips away from the
map's edges, walks with the arrow keys, and closes on Escape, a press outside,
or a zoom that moves the ground from under it.

**Open in…** is the one row that opens a list, and it opens it *beside* the
menu. A list unfolding inside would make the menu taller, and a menu already
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
worse than none. Everything else — the case, its saved points, a sweep in
progress — is shared already, below.

A detached tab carries its number in its title and its heading, because two
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
and follow wherever they are.

**The map keeps up with the other windows on the case.** A point saved, a grid
drawn or a cell swept from the extension's panel over another map lands here
without a reload, and the same the other way round. A sweep worked from both
keeps both hands' marks: what is written is the cells that were marked, never the
grid around them. A grid discarded elsewhere closes here and says so.

## Geo Proof

A proof is composed of panels: case images, each carrying its source. Two things
in the composer are not panels.

**Overlays.** Ctrl+V, a drop on the canvas, or `+ Add overlay` put an image
straight into the proof. Ctrl+V answers to two clipboards, and the rule is which
copy came last: an annotation copied here wins, until leaving the window and
coming back hands the chord back to the system clipboard. It lands in the `Overlays` section of the side column,
sits above the panels and the legend, and is moved,
resized from its corners and framed like anything else on the canvas — you can
annotate it too. It claims no source: no media is filed, no entity, no
`derived-from` edge. The file lives in `proofs/.meta/<name>.assets/` under its own
content hash, travels with a rename, and goes when the proof does. A proof needs
a panel first, since the panels are what give the document its size — moving an
overlay never resizes the export.

**Coordinates and sources.** Both sit above the panels and both fill themselves in:
the coordinates from the first panel that carries them, the sources from the address
each panel's media traces back to.

**Coordinates are a list too**, one row per point, with a `+` to add one. A proof
often shows more than one place — three impacts, a building, the camera — and each
row takes an optional name and the marker that says the camera stood there. **The
first row is the proof's point**: the map mark, the coordinate a post cites, the
one the export prints. An arrow moves a row up to make it the conclusion; the
marker never reorders anything, or ticking it would take a coordinate out of a
tweet without saying so. A single-point proof is the field it has always been.
**A panel that carries a place adds it**, under the point already on screen rather
than in place of it — two captures of one point stay one point, and the answer the
panels gave is written down before the new one joins it. **The pin beside a row
opens it on the map**: the basemaps and the reference layers of the Map tool, the
mark on what the row says, and a click to move it. A row added with `+` opens on
the point above it, which is the only thing that says which ground it belongs on.
The exported picture prints them only when asked (Advanced → Show coordinates):
unnamed points share one line, a named one takes its own, and the plate grows by
what it prints. **Show text** switches the credit line off beside it, so a plate
can carry its points and nothing else; with both off the band takes no height at
all. A saved house style carries both, and one saved before they existed leaves a
proof's own answer alone. Posting from the proof carries every point into the tweet, one
per line, while the place, the plus code and the map links stay the conclusion's.

**Source is a list**, one box per address, with a
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
printed on the plate. Everything above them carries a `!` when it is empty, so a
panel of blanks otherwise reads as a form to finish.

The **description** is one sentence about what the proof shows. It is the proof's
notes — the graph shows it and case search finds it — and it is what a post is written
from, in place of the filename a title usually is. Editing it from the Details panel
and reopening the proof shows the edit, not the copy the file was written with.

The **date** is when the material was taken, in the same profile a Claim's *When*
uses — a day, a month, a year, a timestamp or a range, with `~` for approximate and
`?` for uncertain — edited in the same editor, folded to fit the column.

**Nothing ever fills it in**, unlike the coordinates and the sources beside it. The
date a file carries is when it was uploaded, or what a camera clock said; neither is
when the thing happened, and a date offered is a date accepted without being read. So
it is typed on purpose or it stays unknown, and the bin beside it empties it back to
unknown. Nothing marks it missing either: plenty of material carries no date anyone
can defend. A dated proof is what the Timeline shows under **Taken**, beside the dates
the files themselves carry.

**A date states itself for the footage, not only for the proof.** Saving says so — *Dated
the material: clip.mp4* — and the video's own Time tab then shows it above the dates read
out of the file, which it never overwrites. The frame is not dated, the video it was cut
from is; a satellite capture never is. Changing the date restates it, clearing it takes it
back, and a statement someone has since added reasoning to is left alone.

**The toolbar is two columns.** In one it stood taller than a laptop window, and the
colour, width and layout controls sat under the fold behind a scrollbar nobody looks
for. The separators still mark the groups: history, the drawing tools, then fit and
layout together. The controls that come and go with a selection are last, so picking a
shape never reshuffles the buttons above them.

**Frames.** Any panel or overlay takes a coloured border, its own colour and
thickness, drawn inset so the layout does not shift. A frame is decoration: it
stays out of the legend, which is still built from annotation colours alone.

**Panel and overlay transforms.** Selecting either image shows a round knob on a
short stem above it — the one Collage turns its pieces by — for a free turn, with
quarter turns as gentle snap points. The turn is carried by the image rather than
burnt into its pixels, so the selection frame, the crop marks, the border and the
annotations all stay on the picture's own edges however far it comes round, and
turning one never resizes it: the page reserves the upright room the turned
picture needs.

A double-click enters crop mode on the canvas itself: eight black edge and corner
marks frame the kept pixels, as in a slide editor, over the whole source shown
shaded outside them — so an earlier crop is there to be taken back, not only
undone. The crop button in the image row opens the same mode, and closes it. The
marks pull both ways until you leave crop mode, so a corner taken too far comes
back in the same pass; clicking off the image, that button again, or saving keeps
the box, and Escape drops it. The source file stays untouched: the proof stores
the crop rectangle and the angle, and the export draws through them. Reset crop
restores the full source while preserving the turn.

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

**Symbols.** A grid of fixed marks — a pin, an impact, vehicles, a building, a
drone, a camera, an antenna, a north arrow — stamped with one click. The one tool
that stays in hand afterwards, since marking six vehicles is one act rather than six.
A symbol takes the active colour like anything else drawn, so it joins the legend
by colour and claims no vocabulary the legend cannot say. It resizes from its
corners with the ratio locked: the box is square and there is one side to change,
so a squashed symbol is not expressible. The pin hangs from its tip rather than
its middle, which is what keeps it on its pixel while it is resized. The solid
marks carry no outline and the width control stays away for them. Fill on a
symbol is a disc behind the glyph rather than paint inside it — a thin stroke
over aerial imagery needs something to sit on — and how opaque that disc goes
stays your call, because it covers the picture.

**Picking several.** Shift adds an element to the ones already picked, on the
canvas and on the rows in the side column alike. A rectangle dragged over the
page picks everything it touches, and in grid layout it can be dragged across a
panel too, since the grid decides where a panel sits and the drag cannot be
moving it. In free layout that same drag moves the panel, so the rectangle starts
on the page around it. What a family answers to: colour, stroke width, fill,
arrow keys, Delete, and a drag from any one of them, which carries the rest.
Resizing, rotating and copying still want one element, and the handles say so —
several picked at once show the border and no anchors.

**The gestures.** Escape unwinds one level per press: the draft in hand first,
then whatever is picked, and only with nothing left to drop does it put the pen
down. Only the primary button draws. A release the canvas never sees still lands:
letting go over the side column commits the stroke and applies the rectangle
rather than leaving either one following a bare pointer. Space or the middle
button pans, and so does a drag that starts where no tool has anything to draw
on. A row picked in the side column takes the hand back to Select, since a row
cannot mean "draw here" — which is also why the rows stop lighting up while a
drawing tool is in hand: a pick nothing answers to is not shown as one. A dialog
over the composer keeps the one-letter keys, so `r` never changes the tool
underneath it.

### Import

**Import** is the third way into the tool, beside composing a proof and opening a
saved one, and it lives at the foot of the **Create proof** dialog. Paste the address of a post and the picture is downloaded, its text
read for a position and for the links it points at. Both fill the form and say
where they came from; neither is applied on its own, and a post that spells
nothing out leaves the fields empty for you to type into. **Use an image** skips
the post entirely and opens the same form. A post carrying several attachments
asks which one, each shown with the poster frame its extractor reported and its
kind — nothing has been downloaded at that point, so the picture is chosen by
looking at it. The **pictures arrive ticked and several can be**: a post publishing a
geolocation as a set — the overhead, the ground shot, the match — published one proof,
and keeping the first of three keeps a third of it. They become the panels of one
composition, which is what a proof already is. The footage slot stays single: which
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

The left of the dialog shows **the set the proof will compose**, in order, as a strip
above the file being looked at. Not the render — laying panels out is the composer's
canvas — but what is going in, which is the part worth checking before pressing Create.
The footage sits in that list as its own entry rather than as a page of the proof.

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
worth saying first — a point already on the map, a picture the case already holds,
this post imported before, or a file whose own metadata sits more than 150 m from the
coordinates entered. A source that could not be downloaded is a warning, not a
blockage: the proof is created without that file and the address stays on it. An
address taken off the list leaves its download behind rather than filing it.
**Create** appears only once the preview comes back clean, and editing a field
withdraws it.

**The proof is what everything hangs off.** It composes the pictures and rests on the
material, and both are its own edges, so the graph draws one node for the geolocation
rather than a media node with the rest strung from it. Which photo of four a composite
was laid out from is not something a post says, and a guessed pairing would state one
edge right and the rest wrong.

**One picture exports itself; a set waits for the composer.** A published panel is
already a rendered proof, so a single-picture import files it as `proofs/<name>.png`
and is done. Several panels have no render — laying them out is the composer's canvas,
in the browser — and a second renderer on the server would drift from it at the first
change to a layout. So a set is filed **without an export**, borrowing the first
picture's thumbnail so the proof still draws in the graph rather than being the only
blank node of its own constellation, and the first save in the composer writes the real
one. Until then it has nothing to export and nothing to carry into a bundle, which is
the honest cost of a composition nobody composed.

Until then nothing is in the case. Both downloads wait in a staging directory
under `media/.dl/`, which bundles skip and the Doctor ignores; closing the dialog
deletes it, and one left behind goes when the next import opens. What Create
writes is a normal proof: it lists, travels in a bundle, and reopens in the
composer as a composition to annotate — one panel per picture taken.

## Sheet

A table the analyst works in, which **is** a CSV in the case folder. Three uses no
other tool covers: a comparison grid, candidates down and criteria across; a worklist
carrying its own state and a count; and the half-facts that are too soft to be
entities and too valuable to lose. The graph says what the case believes, a sheet
says what it is checking.

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
  - A **set of values** draws one chip per value, and clicking one filters on **that
    value** — `Buk-M2E, ZU23-2` is two answers, so the filter reads them apart rather than
    comparing the whole cell. Whether a cell may hold several is a question with a box for
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
  entity* takes a type and its fields, *my geolocations* takes neither. The
  outgoing one is one row per proof, carrying the media it rests on, the place it puts on
  the map and coordinates read off the graph. Those three columns are the case's and are
  read-only; Status, Notes and any column added are the analyst's. It offers no *Build
  proofs* button, because the proofs already exist and there is nothing left to fetch.
  - **Refresh is a press, never automatic.** A sheet that rewrote itself when it was opened
    would move a file under somebody who came to read it, and it would fight the stamp that
    keeps two readers of one file from overwriting each other. It files the proofs added
    since, restates the columns the case owns, and says what it did.
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
  the two files, the proof composed of the published picture, and the point they all state.
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
    the proof takes every picture, since a post publishing a set published one proof of
    several panels, and the material takes every picture, clip and recording, since a post
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

## Notebook

The Notebook places a GitHub-flavored Markdown editor beside its preview. The
resizable split is stored locally, and Preview-only hides the editor. A note
with a remote inline image warns that its host is contacted on every open;
adding the image to the Case keeps it local. A ```mermaid fence is drawn as a
diagram, always light so it prints, and keeps its source with a note when the
syntax fails. Markdown help covers supported syntax, diagrams, image layout and
aligned text. The toolbar exports the open note, or a checked selection, as one
server-rendered PDF per note without a print dialog. Local images and
browser-rendered Mermaid diagrams travel with it; remote images are omitted.
Homonymous notes keep stable suffixes even when exported separately, and the
shared destination defaults to the case's `exports/` folder.

Case Notes stays pinned while filed notes open in session tabs. Paste, drop or
pick case media to insert it; the reference menu links case entities. Deleted
references remain as broken markers. External captures and bookmarks open their
source page. Internal captures restore their Satellite view and provider. A saved
Geo Report exposes an `OPEN` action for its new note.

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
