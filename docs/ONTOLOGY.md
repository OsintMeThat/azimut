# Azimut ontology (case data model)

> This is the filing contract for every tool and the detailed companion to
> [SPEC.md §5](SPEC.md). Extend and version it only when implemented tools need
> new vocabulary. Tool proposals enter as `suggested` and remain distinct from
> analyst-confirmed findings.

**Storage schema: `9`.** The manifest carries `{"azimut": {"schema": 9,
"storage": "sqlite"}}`. Schema 3 moved the graph from `case.json` to per-case
`case.db`; schema 9 gives that case its final folder layout and aligns each
file-backed visible name with its filename stem in one idempotent migration.
Schemas 4–8 were unreleased development checkpoints and normalize through the
same jump. The entity/link shape is unchanged since v1. Breaking changes require
a manifest schema bump and migration. The internal SQLite schema is at version
17: 8 adds `links.confidence`, 9 rebuilds the entity search index so a case
search reaches the declared fields (§2) rather than stopping at the label and the
notes, 11 adds `links.nature` — what kind of tie an edge states, in the analyst's
own words, and only where the verb declares a qualifier (§3) — and 10 adds
`graph_pins`, where the analyst dragged a node on the graph
canvas. That is presentation, not an assertion about the case, which is why it is
a table of its own and not a key in `attrs`: an entity keeps identity, links and
provenance (§1). It is keyed by **lens** as well as by entity, because a lens is a
reading — it draws its own nodes and edges and clusters them differently, so one
shared arrangement would anchor every reading into the shape of whichever one it was
built in. It cascades with the entity, so a deleted node leaves no pin for a reissued
id to inherit, and a restore brings the node back placed by the layout.
Schema 12 adds `entity_images`: ordered presentation images for `person`,
`organization`, `vehicle`, `vessel`, `aircraft`, `structure` and
`equipment-type`, with at most one primary image per entity. A row either owns a
private, bounded presentation file imported from the computer or references an
existing image `media` or `capture`. A computer import creates no Media entity
and never enters the Media Library. A Media reference does not state
`appears-in`, and detaching it does not delete the media. The first attachment
becomes primary, and the next is promoted when the primary disappears. Trash
and bundles carry both forms.
Schema 13 adds `analysis_views`. These are named readings of the case, not entities
or findings. A live row stores a Board or Graph recipe, while a snapshot copies the
captured entities, provenance, closed relations and bounded preview thumbnails. They
stay tied to their case, travel only with its complete bundle and never create graph
edges. Live graph pins and camera are presentation owned by that view, separate from
the case-wide arrangement. Their denormalised snapshot count lets the Views menu avoid
parsing or transferring a capture merely to say how many entities it holds.
Schema 14 indexes `label` (under `NOCASE`) and `prov_at`, the two columns the
catalog orders the whole case by. Nothing about the vocabulary changes: it is the
index the ordering was already asking for.
Schema 15 adds the rebuildable temporal projection. Claims and media metadata remain
authoritative. Schema 16 lets Analysis Views own Timeline recipes and immutable
temporal snapshots. Schema 17 rebuilds temporal bounds at fixed microsecond width so
SQLite text ordering stays chronological. A Timeline view stores presentation and
track queries, never copies temporal rows into the graph and never creates a temporal
relation.

Legend: ✅ implemented in code · ⬜ proposed.

---

## 1. Where it lives

`case.db` (SQLite) is the source of truth for the graph; the storage boundary
presents it as this logical shape:

```jsonc
{ "entities": [ … ], "links": [ … ], "folders": [ … ], "entity_images": [ … ],
  "analysis_views": [ … ] }
```

- **Entities** are nodes such as files, points, proofs and people. ✅
- **Links** are typed directed edges. Every save records its inputs; see §3. ✅
- **Folders** are `/`-nested analyst buckets in `attrs.folder`, not semantic
  links. ✅
- **Entity images** are ordered presentation attachments, not graph edges. ✅
- **Analysis views** are case-owned presentation state, not graph assertions. ✅
- Media sidecars hold kind, size, uploader, duration, thumbnail data, image EXIF
  and perceptual hashes, plus ffprobe's video container and stream metadata. A
  stated position lands on one field, `gps`, whichever of the two read it. A
  SQLite browse index mirrors searchable fields, plus whether that position
  exists. Entities retain only what the graph needs for identity, links and
  deduplication.
- A media's origin is `source.url`, mirrored onto `attrs.source_url`, and
  `source.type` says how it was come by: a `download` fetched that address, while
  an `upload`, a `clipboard` paste or an adopted `manual` file carries what the
  analyst stated for it. Only those three can be given or corrected one; what a
  tool recorded is never written over, since a case that cannot tell a fetched
  address from a stated one is holding neither.

## 2. Entity

```jsonc
{ "id": "e_ab12cd34",        // _new_id("e")
  "type": "capture",          // from the registry below (free strings allowed)
  "label": "48.8584, 2.2945", // human-readable, editable
  "attrs": { … },             // per-type, see registry
  "provenance": { "by": "satellite", "at": "2026-07-10T…Z",
                  "status": "confirmed", "source": "https://…" } }
```

`type` is extensible: unknown strings are stored but receive no custom renderer.
`label` is editable. For identifiers it is the value that names the identity, so the
registry gives that field a type-specific reading such as **IP address**, **Handle**
or **Network or CIDR** instead of showing a generic **Name** box. Other fields stay in
`attrs`; the primary value is never duplicated there.

`geo` is the country a saved point falls in, resolved once and kept:
`{state, country_code, country, region?, region_en?}` with `state` one of `ok`,
`nocoords` (no position to look up), `nocountry` (open sea) or `failed` (the
lookup did not answer — the only state a later pass retries). `country` and
`region` are the local-language names; `region_en` is a second lookup in English
and is absent when it failed or matched the native name. Continent and the
English country name are *not* stored: both are derived from `country_code` at
read time, so extending those tables repairs existing cases with no migration.

### Families

`engine/entities.py` is the one registry of entity types, and each type declares a
**family**. Relations start from families and narrow endpoints where a verb is more
specific (§3). A broad verb such as `owns` can extend to a new asset, while
`sited-at` remains structure-only. `GET /api/cases/entity-types` serves the
registry — type, reading, family, icon, and the fields an analyst may fill — so a
create form is generated rather than written per type. ✅

A type, a family, a verb, a rating level and a declared field each carry a `hint`:
one clause served with the registry and shown as the tooltip wherever the word
appears, so no screen writes its own wording. `tests/test_entities.py` holds them
to one clause — no full stop, no em-dash, under a hundred characters.

| Family | Reads as | Members |
|---|---|---|
| `actor` | a person or organization that can act or hold ownership | `person`, `organization` |
| `asset` | it is owned, appears, sits somewhere | `vehicle`, `vessel`, `aircraft`, `structure` |
| `class` | a model the case counts with, never one particular object | `equipment-type` |
| `identifier` | a handle on a system | `account`, `email`, `phone`, `domain`, `ip`, `network` |
| `collected` | bytes gathered into the case rather than written, so one may depict a place | `media`, `capture` |
| `document` | it is read rather than gathered: made or consulted | `proof`, `post`, `note`, `sheet`, `inspect-session`, `bookmark` |
| `place` | a point, never a thing | `place` |
| `claim` | a statement about the graph, carrying its own reasoning | `claim` |

**`attrs.kind` is what a media is**: `image`, `video`, `audio` or `file`, stamped by
the importer from the MIME type, falling back to the extension for entities filed
before that attr existed, and `file` for anything unrecognised. Every surface draws
the icon off it rather than off the type. A PDF is a `media` of kind `file` until
text extraction ships — a native dependency on three platforms, the same gate as
OCR.

Adding a type is one registry entry plus one in `artifacts.NO_FILES` or `KINDS`.
Adding a *family* means deciding its verbs: the families are the commitment, the
types are disposable. Why the families are cut where they are — `actor` apart from
`asset`, `collected` rather than *imagery* or *material*, geometry on `place`
alone — is argued in `engine/entities.py`'s module docstring, beside the code it
governs.

### Roles ✅

Beside its family, a type declares a **role**: what it is for once the case is
*drawn*. A family says what a thing is and decides its verbs; a role says whether a
picture of the case is about it. The line that matters is between the first two —
**the file is a subject, its wrapper is an edge**.

| Role | Reads as | Members | In the drawing |
|---|---|---|---|
| `subject` | the case is about it | `person`, `organization`, `vehicle`, `vessel`, `aircraft`, `structure`, `equipment-type`, `account`, `email`, `phone`, `domain`, `ip`, `network`, `media`, `place`, `claim` | a node |
| `attestation` | a wrapper around something the case already holds | `bookmark`, `proof`, `capture` | folded into the edge that carries its provenance, drawn or not (below) |
| `annex` | consulted rather than seen, hanging off one node | `note`, `sheet`, `inspect-session` | out of the case readings, drawn by **My work** |
| `deliverable` | what the case produced | `post` | out of the case readings, drawn by **My work** |

A bookmark stays drawn because it is not a leaf: *this account posted it, this
statement cites it* is a path through it, and that path is a fact about the case. A
note and a post carry no path, so they are the filing rather than the case.

`manual` was checked first and does not answer this: `media` and `place` are not
manual and are subjects, `post` is not manual and is a deliverable, `claim` is manual
and is a subject. A type has **no default role** — a new one decides, or it would
answer by omission (`tests/test_entities.py`).

### Entity type registry

| Type | Family | Role | State | Produced by | Key `attrs` | File-backed |
|---|---|---|---|---|---|---|
| `media` | collected | subject | ✅ | media-library | `path`, `sha256`, `source_url?` | yes (+ sidecar) |
| `capture` | collected | attestation | ✅ | satellite | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `path`, `geo?` | yes (image) |
| `place` | place | subject | ✅ | satellite, ingest, enrich | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `notes?`, `geo?`, `source_url?`, `site?`, `enrich_coord_key?`, plus the precision fields below | no (a point) |
| `proof` | document | attestation | ✅ | proof-composer | `spec` (json), `path` (png) | yes |
| `post` | document | deliverable | ✅ | post-composer | `draft` (json) | yes |
| `inspect-session` | document | annex | ✅ | inspect | `spec` (json) | yes |
| `note` | document | annex | ✅ | notebook | `path`, `folder?` | yes (Markdown) |
| `sheet` | document | annex | ✅ | sheet | `path` (csv) | yes (CSV + sidecar) |
| `bookmark` | document | attestation | ✅ | capture extension | `url`, `fetched_at?`, `archive_url?`, `reliability?` | no (a URL) |
| `person` | actor | subject | ✅ | analyst | `aliases`, `role`, `nationality` | no |
| `organization` | actor | subject | ✅ | analyst | `echelon`, `country` | no |
| `vehicle` | asset | subject | ✅ | analyst | `plate`, `make`, `model`, `colour`, `condition` | no |
| `vessel` | asset | subject | ✅ | analyst | `imo`, `mmsi`, `flag`, `kind`, `condition` | no |
| `aircraft` | asset | subject | ✅ | analyst | `registration`, `icao24`, `model`, `condition` | no |
| `structure` | asset | subject | ✅ | analyst | `kind`, `address`, `condition` | no |
| `equipment-type` | class | subject | ✅ | analyst | `category`, `aliases` | no |
| `account` | identifier | subject | ✅ | analyst | handle in the label; `platform?`, `url`, `reliability?` | no |
| `email` | identifier | subject | ✅ | analyst | address in the label | no |
| `phone` | identifier | subject | ✅ | analyst | number in the label; `country?` | no |
| `domain` | identifier | subject | ✅ | analyst | hostname in the label; `registrar?` | no |
| `ip` | identifier | subject | ✅ | analyst | address in the label; legacy read-only `network?`; `asn?`, `provider?` | no |
| `network` | identifier | subject | ✅ | analyst | network/CIDR in the label; `asn?`, `provider?`, `country?` | no |
| `claim` | claim | subject | ✅ | analyst | `count`, `condition`, `when`, `time_role`, `confidence`, `method`, `verbatim` | no |

Every row is created by something: the tool-born ones by the save that produces them,
the analyst's own from the board's **New entity**, which builds its form out of the
fields declared here.

Three modelling calls the table alone does not show:

- **`alias` is folded into `account`**, whose `platform` is optional.
- **A plate, an IMO and an MMSI are fields, not entities.** An identifier is worth
  minting the day a value turns up without its object.
- **`registration` and `icao24` belong to an airframe; a callsign belongs to a
  flight**, which is a dated statement rather than an attribute.

Retired: `event` (replaced by the claim node), `alias` (see above), and `panorama`
(Inspect's auto-stitch export is a derived `media`). Still coming from the roadmap,
to declare here when built:

| Type | Family | Shape | Note |
|---|---|---|---|
| `grid` | document | a spec, like `inspect-session` | Grid Search already writes `.search/<name>.json`; it is **the only saved tool state outside the graph**, so today nothing can say "this sweep is how I found it" |
| `sky-session` | document | a spec, like `inspect-session` | a sun or moon lookup: the point, the date and the time, **never the numbers**. Reopening recomputes; a proof that shows the reading is what freezes it, exactly as a `proof` pairs an editable `spec` with an exported `path` |
| `ground-image` | collected | file-backed | a provider and a position of its own, which an imported media has not |
| `report` | document | file-backed | a distinct artifact, like `proof` |

`grid` and `sky-session` are the same shape as `inspect-session` and belong in
`artifacts.KINDS` rather than `NO_FILES`, so each arrives with delete, Trash and
bundle behaviour to settle. They only become worth relating once a statement can
`cites` them (SPEC §6, v3).

Attribute schemas are declared for the analyst-entered types and served with the
registry; the tool-born types keep tool-owned `attrs`, which stay conventions rather
than a validated contract. **A declared attr means *a field an analyst may fill*,
never *everything this type holds*** — that is what keeps validation additive, since
no key a tool already writes is judged by it.

A declared field says how it is edited: `text`, `longtext`, `number`, `url`,
`choice`, `geojson`, `temporal`. `longtext` stores and validates exactly what `text`
does; it says the field expects sentences, so it gets a box that grows. A `number`
may declare its bounds, its shortcut rungs, and whether it is `whole` — a count steps
by one, where a radius in metres does not.

A field may also declare the `group` that **heads it and the fields after it**, which
is what lets one type hold several subjects: a Claim says what it states, when it
applies and why that is believed, where a place's four fields all answer how tightly
the point is pinned. The heading is emitted where the group changes, so the form
keeps the registry's order rather than regrouping itself, and a heading may be opened
once.

**The declared `text`, `longtext` and `url` fields are what a case search matches
on**, beside the label, the type, the folder and the notes — a vehicle is looked for
by its plate. Numbers, shapes and stored grades stay out of the index. One predicate
serves both sides: `store/rows.py::_entity_search_text` for the server,
`lib/entitySearch.js` for the lists that filter a small case in memory.

### When the case already holds the value ✅

The `identifier` family is the one place where **the value is the identity**: two
`email` entities holding one address are two records of one thing, where two people
may genuinely share a name. `entities.identity_key` is what says whether two labels
are the same identity, and `GET /cases/{id}/entities/twin?type=&label=&ignore=`
answers it against the case.

| Type | Compared as |
|---|---|
| `account` | trimmed, case-folded, a leading `@` dropped |
| `phone` | trimmed, case-folded, spaces, dashes, dots, brackets and slashes dropped |
| `domain` | trimmed, case-folded, a trailing root dot dropped |
| `email`, `ip`, `network` | trimmed and case-folded |
| every other family | not compared |

Three rules hold it together:

- **It warns, it never refuses.** The case has no merge action, so a create that
  failed would leave the analyst holding a value with nowhere to put it. Both the
  create dialog and Details name the row already holding it and offer to open it.
- **It catches the same value typed twice, not every spelling that resolves to the
  same thing.** `+33612345678` is not compared against `0612345678` and
  `www.example.org` is not compared against `example.org`: supplying a country code or
  stripping a subdomain is a guess, and a guard that guesses flags two entities that
  are genuinely different — worse than missing one, since a duplicate is visible and a
  wrong warning teaches the analyst to ignore the next.
- **One comparison, served rather than reimplemented.** The create form used to
  lowercase the raw label in the browser, which let `@handle` and `handle` sit side by
  side. It is read on create **and on rename**, which is where it actually happens.

### What state a thing is in ✅

`condition` sits on every member of the `asset` family — a lorry, a ship, an
airframe and a bridge can all be damaged, so the field is the family's rather than
the two types it was first wanted for.

| Stored | Reads as |
|---|---|
| `intact` | Intact |
| `damaged` | Damaged |
| `destroyed` | Destroyed |
| `abandoned` | Abandoned |
| absent | unknown |

Two rules make it worth having:

- **It is the last known state, and it overwrites.** The field answers *where is this
  bridge today*, not *tell me about this bridge*. History is a statement, so it lives
  on Claims, which is why `condition` is also declared there (below) off the same
  list — same word, two speakers, exactly as `notes`/`verbatim`/`method` already are.
  One list, because a count that groups by condition has to reach both.
- **"Captured" is not a condition.** Changing hands is a change of owner, and `owns`
  already states that. Folding it in would mix condition with possession, and a
  mixture does not aggregate.

### Counting a model rather than minting objects ✅

A case that follows a conflict records the same thing over and over: *two of these
were destroyed here, filmed by that*. Stated with the vocabulary above it costs two
anonymous `vehicle` entities per sighting — hundreds of nodes that name nobody, each
a fake identity. Two additions fix it, and neither is a new mechanism.

**`equipment-type` is the model.** "T-72B3", not the tank with turret number 214. It
is its own family because the three verbs an `asset` takes are all wrong for it:
nobody owns a model, a model sits nowhere, and letting one `appears-in` a video would
give the case two ways to say the same thing, the easier of which carries no number.
Its whole vocabulary is being pointed at — `instance-of` from an object somebody
actually named, `about` from a statement — plus `mentions`, which reaches every
family. `category` is a field rather than five types, because that is what a count
groups on. It lives **in the case**, not in the workspace: a closed case folder is
complete (SPEC §2), and statistics whose labels live elsewhere do not travel. A shared
catalogue can later seed the field by autocompletion, copying the term into the case
on use, which changes nothing here.

**The Claim carries the number and time.** `count` (whole, at least 1), `condition`,
`when` and `time_role` join `confidence`, `method` and `verbatim` on the node. They
never sit on `about`, because a Claim may point at several subjects and one number on
the node could not say which it meant. So **one statement counts one kind of thing**,
and a second kind is a second Claim with its own confidence. That is the call §3
already makes for competing candidates, and it is what keeps every value on the node
assessable as one.

Absent `count` means *seen, not counted*, which is a different and honest answer from
one — the same reasoning that makes zero an invalid radius below.

The shape of a filed observation, then:

```
claim(count: 2, condition: destroyed, when: 2026-08~, time_role: observed,
      confidence: probable)
   ├── about ──▶ equipment-type "T-72B3"
   ├── at    ──▶ place "Crossroads"
   └── cites ──▶ media (the video)
```

**A model reaches a video through the statement, and only through it.** That is the
whole design: the two-hop path carries how many and in what state, where a direct
edge could carry neither.

No verb carries that date (§3): the temporal value belongs to the statement. The
parser accepts reduced Gregorian dates, date intervals, final `~`, `?` and `%`
qualifiers, and ISO timestamps with seconds. A timestamp without a timezone is kept
as unplaced rather than undated, but is not globally sortable. Two zoned timestamps
may form an exact interval. Local-time intervals, mixed date/time intervals, open
intervals and the rest of EDTF Level 2 remain outside the announced profile.

Time reads a derived SQLite projection, never a second authority. Claim `when` and
`time_role` remain on the Claim; capture/publication/imagery dates remain in the media
sidecar; filing and collection dates remain provenance. The projection labels them
`statement`, `media` or `case_activity`, and can be deleted and rebuilt from those
records. A manually assessed media time is therefore a sourced Claim about the media,
not a rewrite of `taken_at`.

**Counting Claims counts observations, not objects**: two
videos of the same destroyed tank are two statements. Azimut does not merge
observations across entities, so a total says *observations* in those words rather
than implying a fleet.

**Where the number is read** is the entity's own Details, which adds up the statements
already listed under Claims, and the Board's *Total the statements*, which groups a
whole narrowing by `about` subject (`engine/tally.py`, one implementation for both, or
the case would hold two totals for one question). Three rules fall
straight out of the model above and are what keep the sum honest: a `refuted`
statement is counted apart and never inside a total, since a candidate eliminated is
the opposite of one observed; an absent `count` stays *seen, not counted* rather than
becoming one; and **nothing is totalled across subjects**, because a number that sits
on the node and not on `about` may belong to two of them and adding it would spend the
one statement twice. Grouping *above* the subject is what the vocabulary cannot do
yet: no verb says one `equipment-type` is a variant of another, so three T-72 variants
stay three rows. Whether that verb is worth minting is a question this reading exists
to answer rather than to presume.

### How precise a place is ✅

A saved point may be an exact address or "somewhere on the north quay", and a model
that cannot say which forces the analyst to either overstate or file nothing. Four
optional fields on `place` say it, taken from Darwin Core, which settled this for
biodiversity records two decades ago.

| Field | Darwin Core term | Meaning |
|---|---|---|
| `radius_m` | `coordinateUncertaintyInMeters` | radius of the **smallest circle containing the whole location** |
| `footprint` | `footprintWKT` | a GeoJSON `Polygon`/`MultiPolygon`, when a circle is the wrong shape |
| `verbatim` | `verbatimLocality` | what the source said, word for word |
| `method` | `georeferenceProtocol` | how this point was arrived at |

Three of Darwin Core's rules are kept as written, and each is a test:

- **The radius is the smallest enclosing circle**, not a standard deviation, so two
  analysts write the same number.
- **Zero is not a valid radius.** Empty means *unknown*, a different and honest state;
  `0` would claim infinite precision. Hence a floor of one metre.
- **`verbatim` outlives every reinterpretation.** It is the field people wish they had
  kept.

Three text fields, three speakers: `notes` is the analyst writing freely, `verbatim`
is the source quoted, `method` is how the point was found ("roofline matched against
Esri imagery 2023-06", "EXIF GPS as read"). Darwin Core's fourth field,
`georeferenceRemarks`, is **not** adopted — its content belongs in `method`.

`radius_m` is stored in metres and asked for in rungs: building 25, block 100,
neighbourhood 500, town 2 000, region 10 000, served with the registry so the picker
and the validator cannot drift. A rung is a toggle, so clicking the chosen one clears
the radius. Why the ladder is not derived from Plus Code lengths is in
`entities.PRECISION_RUNGS`. Nothing here is required and **absence is never flagged**:
a place with no radius draws as a pin, with no badge asking for one.

The four fields are edited in Details → **Info**, under the heading the registry
gives them (`group` on the field that opens the block, `"How precise"` here), and committed
by the panel's Save. Info holds the entity's editable profile; Connections is reserved
for graph edges and lineage, and Time for dated statements and intrinsic dates.

The saved index (`GET /cases/{id}/satellite/index`) carries `radius_m` and
`footprint` so the map overlay draws them without fetching each place: a footprint
renders as its own polygon, a radius as a circle in metres, and a footprint wins when
both are set. The map popup states the spread in words (`±500 m`, `traced area`) and
never edits it.

**`footprint` is stored, validated and drawn, but not yet traceable.** No map offers
the gesture, so the field is API-only and the panel hides it until a shape exists.
The tracing tool (SPEC §6, v2) completes it; nothing else about the field changes
when it lands.

### What a source is worth ✅

A claim rests on something, and how much that something is worth is a property of
**the source**, never of the edge citing it. Two types carry it, and they are the two
a case actually sources from: `bookmark` (the page) and `account` (whoever posted).

| Field | On | Written by | Meaning |
|---|---|---|---|
| `url` | `bookmark` | the save | where the page is |
| `fetched_at` | `bookmark` | the save | when it was seen, UTC |
| `archive_url` | `bookmark` | the analyst | the copy that outlives the page |
| `reliability` | `bookmark`, `account` | the analyst | how much the source is worth, A–E |

`fetched_at` is stamped server-side by the route standing on the page, so the moment
is known rather than typed; a bookmark added by hand in the app carries none, and
that absence is never flagged. It is what an archived copy is later dated against.
It and `url` are tool-written, so neither is a declared field: the panel reports them
under Info rather than offering them for edit.

**The grades are the Admiralty/NATO letters**, served with the registry as a `choice`
field so the picker and the validator cannot drift:

| Stored | Reads as |
|---|---|
| `A` | completely reliable |
| `B` | usually reliable |
| `C` | fairly reliable |
| `D` | not usually reliable |
| `E` | unreliable |
| absent | not judged |

The scheme's sixth grade, **F — "reliability cannot be judged" — is not adopted**: an
empty field already says it (`entities.RELIABILITY_GRADES`). Same call the confidence
ordinal makes, where *not assessed* is the lack of a level rather than a fifth one.

A grade is read wherever its source appears, including on a relation row, where it
sits on the line carrying the entity's name while the edge's own rating sits on the
line below (§3). Nothing needs one: most bookmarks are never graded.

The file-backed pointers of `proof`, `post` and `inspect-session` (`spec`,
`draft`, `path`) are not stable: the file's name follows the label, so renaming
one in its tool rewrites the pointer on the same entity. Look these up by id, or
re-read the pointer — never cache one across a save.

## 3. Link

```jsonc
{ "id": "l_…", "from": "e_proof", "to": "e_capture",
  "type": "derived-from",
  "provenance": { "by": "proof-composer", "at": "…", "status": "confirmed" } }
```

Read a directed link as **`from` → `type` → `to`**. Removing an entity drops its
incident links. The link type decides whether dependent entities also disappear.

### Link type registry

Relations start each end from one or more **families** (§2).
`from_types`/`to_types` resolve those families to the concrete sets the endpoint
check compares against. `from_only`/`to_only` narrow an end *inside* its family for
verbs where a whole family is too broad; they intersect rather than replace, so
a narrowing can only remove a type, never smuggle one in from elsewhere.

| Type | from → to | Meaning | State |
|---|---|---|---|
| `derived-from` | media → media/capture; proof → media/capture; post → proof/media/capture; note → post/proof/media/capture | made from that, and outlives it | ✅ |
| `depends-on` | inspect-session → media/capture | only a pointer at that: dies with it | ✅ |
| `located-at` | image/video/audio media → place | where the recording was made | ✅ |
| `depicts` | image/video media, capture or proof → place | the place is visible | ✅ |
| `owns` | person/organization → organization/asset/identifier | strict ownership, never membership or mere control | ✅ |
| `part-of` | organization → organization | internal organizational containment | ✅ |
| `member-of` | person/organization → organization | membership, not internal containment | ✅ |
| `associated-with` | actor → actor | a tie that is none of the three above; what kind it is rides on the edge | ✅ |
| `posted` | account → media/bookmark | the account published the content or URL | ✅ |
| `appears-in` | actor/asset/identifier → image/video media or capture | the entity or a recognizable representation is visible | ✅ |
| `sited-at` | structure → place | a permanent site, never a dated presence | ✅ |
| `instance-of` | asset → equipment-type | this particular object is one of that model | ✅ |
| `in-network` | IP/network → network | an address or subnet belongs inside the network | ✅ |
| `same-image-as` | image media → image media | a machine perceptual-hash match | ✅ |
| `about` | claim → actor/asset/equipment-type/identifier/place/media/capture | what the statement concerns | ✅ |
| `at` | claim → place | where the statement puts its subject | ✅ |
| `cites` | claim → bookmark/note/proof/media/capture/claim | what the statement rests on | ✅ |
| `contradicts` | claim → claim | the two statements cannot both hold | ✅ |
| `mentions` | note/post/proof/bookmark/sheet → any other declared entity | the document refers to the entity | ✅ |

Every manual connector is validated by the API and offered only by its own picker.
`same-image-as` is machine-only. `part-of`, `in-network`, `cites` and the derivation
chain refuse cycles. Self-links are refused for every type.

Every label completes the sentence *"<from> … <to>"*, which fixes the direction:
`appears-in` runs subject → file, because a person appears in a video. `owns` may
target an organization but never a person; membership is stated separately.

**Containment, membership and ownership stay three verbs.** A brigade contains its
battalions through `part-of`, a person belongs to an organization through
`member-of`, a unit's trucks are owned. Keeping them apart is what makes an order of
battle queryable; a military unit is an `organization`, and `attrs.echelon` sorts the
tree.

**And `associated-with` is the fourth, for the tie that is none of them.** Until it
existed the vocabulary had no person-to-person verb at all — `owns` refuses a person
as its object, `member-of` and `part-of` both end at an organization — so stating that
two people are connected, which is the first thing a case does, cost a whole Claim
node. It runs `actor → actor` and no wider: opened to identifiers and assets it becomes
the verb that swallows the rest, and a registry where one entry answers everything says
nothing. It is symmetric, so both readings are the same word and a picker offers it
once.

### What kind of tie ✅

`associated-with` declares a `qualifier` (`RelationType.qualifier`), and the analyst's
answer is stored on the edge as `links.nature` — "sister", "employer", "business
partner". Three rules, and they are what keep one field from becoming a note on
everything:

- **The qualifier belongs to the verb, never to the edge.** Empty means this verb takes
  none, exactly as `ratable: false` means it takes no grade, and the API refuses one
  anywhere else. A note every edge could carry would leave nothing saying what an edge
  *is*. Giving one to another verb later is a word in the registry.
- **Free text, and deliberately not a closed list.** Maintaining a taxonomy of human
  relationships is a project of its own, and the first case needing "former
  sister-in-law" breaks it. Capped at 120 characters (`links.MAX_QUALIFIER`): reasoning
  that runs to sentences is a Claim, which has a field for it.
- **It leaves with the verb.** Rewording the edge to one that takes no qualifier clears
  it, or the edge would privately hold "sister" while stating that one unit is part of
  another.

Unstated carries no key at all, the same rule the rating follows, so no reader has to
tell *unstated* from *stated as empty*. The graph writes it on the line —
`is associated with (sister)` — because the verb alone is the thin half of the
statement.

**No verb carries a date.** `sited-at` is a permanent site, not a visit. A person's
whereabouts at a time, or a unit reassigned between corps, is a statement with a
reason and sources, so its `when` and `time_role` belong on a claim node rather than
an edge.

**`mentions` is a pointer, not a derivation.** A document *refers to* something,
where `derived-from` says the file was built from it; both may sit on the same pair,
and deleting the target drops the mention with no tombstone. The author is a note,
post, proof, bookmark or sheet; the target is any other declared entity, a Claim
included. A sheet states its mentions from the cells the analyst pointed at an
entity, restated on every save, so a row naming a subject is visible from that
subject's side too.

It is the one verb served as its own **action** (`RelationType.action`, `"mention"`)
under its own heading (`RelationType.group`). A pointer must not borrow the weight of
a finding, so the split is the registry's and every surface obeys it: **Add relation**
never turns into **mentions**, **Add mention** has its own target search, an edge is
only reworded inside its action, and a mention carries no rating (`ratable: false`).

### Promotion, which is how a sheet reaches all of this ✅

A sheet says what is being **checked**; the graph says what the case **believes**.
Promotion is the one road between them and it runs one way: nothing reads the graph
back into a cell. **One declaration, one press** (`engine/sheetpass.py`): a binder's line
holds several of these at once, and only the first is one row per thing
(`engine/sheetpromote.py`, `engine/sheetclaims.py`).

| Mode | What it makes | Why it is its own answer |
|---|---|---|
| a **row** | one entity of the chosen type | the ordinary case |
| a **group of rows** | one entity, one place per point | a cross-border event is two lines, one point per country; row by row that is two events |
| a **column's words** | one entity per distinct **word** | four hundred rows hold forty pieces of equipment, and a cell may hold three |
| a column of **addresses** | a `bookmark` per URL | a cell holds an address, so it becomes the thing that claims to be one |
| a column of **row names** | `part-of` / `member-of` edges | an order of battle held as text, with a validation that has already decayed |
| a column of **times** | a `claim` per row | the binder holds a *reasoning about* a time across three columns, not a time |

**And the edges between the columns**, which is what no single-column road could draw: for
each pair the analyst joined, the vocabulary is asked what it allows between their two
types (`pair_verbs`), only the pairs with an answer are offered, and the verb is re-checked
against the registry before anything is written. They enter `confirmed` — the analyst chose
the reading and pressed the button — and carry the pass's one confidence where the edge is
`ratable`. An edge is drawn only where **both** ends resolved: a row whose unit is ambiguous
keeps its entities and loses its edges, with the reason.

Six rules hold across the modes, and they are the reason it is safe to press twice.

**Nothing that owns a file is born from a cell.** A `media`, a `capture`, a `proof`, a
`post`, an `inspect-session` hold bytes; a cell holds an address. They exist only where the
app itself fetched the file — the proof import's road (`engine/proofimport.py`), and the
build a geolocation index presses (`engine/sheetproofs.py`), which is that same road driven
a row at a time. The rule is not about where the request came from but about who fetched
the bytes: the build downloads them, so it may state `derived-from`, and the pass never
touches the network, so it may not.

**A name is not an identity.** Two people share a name, so a label the case already
holds is *offered* and never merged into on its own. The exception is the
`identifier` family, where the value **is** the identity (§2).

**The sidecar remembers what came from here.** A promoted cell points at the entity it
made (`links`), a promoted word points at what it means (`values`), so the second
press updates instead of minting a twin. What the cell **said** at that moment is kept
too (`promoted`), which is what lets a row say it has moved on since — a link alone
cannot, being the same link after the label is rewritten.

**Only the columns asked for travel.** The label, the mapped fields, the point. A
promotion that swept every column into the graph would put a worklist's private notes
into the case's own record of a subject.

**A point is a second entity unless the row *is* a place.** Writing a latitude onto a
structure would put a field on it that nothing in the app declares, shows or edits, so
the coordinates become a `place` joined by whichever verb the vocabulary allows
(`sited-at` for a structure), and a type it allows none for is refused at the door.

**An inferred time is a Claim, never a cell.** Ten videos carrying an offset against
one **sync point** get an absolute time the moment that point is dated — `probable`,
with the reasoning naming it. Writing that timestamp into a `when` cell would present a
deduction as an observation. An estimated hour is likewise recorded one rung below an
established one, because the binder kept two columns for exactly that difference.

**Deleting a sheet keeps what it established.** Its `mentions` edges go with it and
the entities stay: throwing the worklist away is throwing the worklist away, not the
subjects it settled.

### The claim, and how sure it is ✅

A `claim` is a statement node. It points `about` at subjects, `at` at places and
`cites` at evidence. The Claim holds `count`, `condition`, `when`, `time_role`,
`confidence`, `method` and `verbatim`; its three connectors carry none of those
values. This keeps one statement at one confidence even when it has several subjects,
places or sources.

**`cites` also reaches another claim ✅**, because an intermediate conclusion is what
the next one is built out of: *the vehicle is a T-72B3* carries *the column is the 4th
brigade*, and stated against the video instead, the case records two findings resting
on one file and loses that refuting the first takes the second with it. It is `cites`
rather than a verb of its own — the question is the same one, what does this rest on,
and `inverse_label` already read *supports claim*. Three rules keep it from meaning
more than it says:

- **It refuses cycles**, unlike `contradicts`. *A because B, B because A* is circular
  reasoning, where two statements standing against each other is an open question.
- **A cited claim is never counted as a source.** The independence number answers
  *three citations, how many sources*, and reasoning built on reasoning has found
  nothing new (`graph._counted`).
- **Nothing propagates.** A `probable` statement may carry a `certain` one: the verb
  makes the path visible, and how strongly each end is held stays the analyst's, which
  is the rule the three assessments already follow.

| Claim `attrs.confidence` | Reads as |
|---|---|
| `certain` | established and corroborated |
| `probable` | more likely than not |
| `possible` | cannot be excluded |
| `refuted` | checked and eliminated |
| absent | not assessed |

The Claim editor owns `about`, `at`, `cites` and `contradicts`; they never appear
under **Add relation** and cannot be reworded into another action. Competing
candidates are separate Claims, which is how each gets its own confidence — the
former `exclusive` checkbox tried to do that on connectors instead and is no longer
offered, though existing `exclusive` attributes stay readable.

### What stands against a statement ✅

`contradicts` runs claim → claim and is the fourth verb of that action. It exists
because `refuted` records that a statement is dead and names nothing that killed it:
the case kept the verdict and lost the argument. Eliminating a candidate is half the
work of a geolocation — twelve are checked and eleven ruled out — and each of those
eleven carries its own reasoning and its own sources, which is a Claim rather than a
grade.

- **Statement to statement, both ends.** Pointed at a subject it would say "this
  vehicle is contradicted", which is not something anyone can assess.
- **No cycle check**, unlike `part-of` and `in-network`. Two statements contradicting
  each other is not a loop to refuse, it is what an open question looks like, and it
  reads the same in both directions — so the Claim editor lists the rows under one
  heading without sorting them by direction.
- **Not ratable**, like the three connectors above: how strongly each side is held is
  already on each Claim, and a third grade on the edge between them is exactly the
  mixture three separate assessments exist to prevent.
- **It is not a claim connector** (`links.CLAIM_CONNECTION_TYPES`). Those say what a
  statement rests on and are what a source fold walks; folding across this one would
  collapse an argument into a citation.
- The graph draws it as its own stroke, a dash broken by a beat, so a statement
  cluster shows its arguments before any label is read.

Ordinary semantic relations may carry the nullable `links.confidence` ordinal: `3`
certain, `2` probable, `1` possible, `-1` ruled out, absent for not assessed. It
saves turning a tentative ownership into a whole Claim node. A tool's suggestion is
confirmed before it can be rated, and it is rated from either surface that draws it:
the Details row and the graph's own edge panel.

**Ruled out is the one level the graph draws.** It is a verdict rather than a nuance,
and a candidate eliminated is kept on purpose — so drawn like any other stated
relation, eleven checked and rejected read as eleven live hypotheses. It takes a
stroke of its own (`lib/graph.EDGE_KINDS`), and the other three deliberately do not:
four more patterns would put what kind of edge it is and how sure of it on one
channel, which is the mixture three separate assessments exist to prevent.

**Three assessments, never combined**: Claim confidence, an ordinary relation's
ordinal, and a source's A–E reliability (§2). Chain edges, mentions, Claim connectors
and `same-image-as` are all non-ratable, and the API refuses a rating on them — which
is why no surface draws a rating control for one.

### Delete policy

A tool selects one of two deletion behaviours through its link type:

> **After deleting the target, is the holder still usable?**
> Yes → `derived-from`. No → `depends-on`.

| Link | Holder | Allowed source |
|---|---|---|
| `derived-from` | media | media, capture |
| `derived-from` | proof | media, capture |
| `derived-from` | post | proof, media, capture |
| `derived-from` | note | post, proof, media, capture |
| `depends-on` | inspect-session | media, capture |

A `derived-from` holder owns pixels or text and survives a deleted source with a
tombstone. An `inspect-session` is only adjustments over its subject, so a deleted
subject removes it transitively.

- `derived-from` never cascades into an output. A post keeps its text when its
  proof is deleted; a frame keeps its pixels when its video is deleted.
- It is also read backwards, as geography. The Saved panel counts the proofs
  hanging off each saved point through this edge, and a proof with no point of
  its own is placed at the point of every capture it composes, one hop back.
  A proof does carry its own points first, though: `spec.points[]` (what the
  analyst typed, in any supported format, one entry per point) then `coords`
  (what the panels gave it, frozen at save). That is what keeps a proof on the
  map once its capture is deleted — a tombstone records the path, the sha256 and
  the URL, never coordinates.
- **Placement reads the same edges further, and in both directions**
  (`satellite.placements`, `GET /entities/{id}/placement`): a video reaches its
  capture three hops away, through the proof that composed a frame of it. Only
  `capture` and `proof` carry a point, and **the artifact carrying one ends the
  walk**. Points deduplicate on the exact pair, never a rounded one, and the nearest
  hop wins a repeat. A proof reports every point it states, so the footage behind a
  three-point proof answers for all three. Bounded at four hops, 200 entities read
  and 15 points reported, each with the entity it was read off; a `capture` reports
  none, its point being its own rather than one the chain placed it at.
- `attrs.lost_sources[]` stores `{label, type, path, sha256, source_url, at}`.
  Tombstones are keyed by path and never stacked.
- Every UI deletion uses the same dependency-aware service. The confirmation
  lists cascading deletions and surviving outputs before the action.
- Losing a secondary source leaves a placeholder. Only losing the subject can
  invalidate a dependent session.
- Relations are not chain types. Deleting either endpoint removes the edge but
  never cascades and never leaves a tombstone: a claim nobody has looked at must
  not decide what a delete destroys.
- Exact-byte duplicates never produce `same-image-as`: import deduplicates them
  on SHA-256 before perceptual hashing runs.
- **A note files its chain from its own body, on every save.** The Markdown names
  the case files it shows as `[[media:<id>]]`, so `PUT /notes/{id}` restates the
  `derived-from` edges from the text: an image inserted through the Notebook's Media
  button gains its edge, one deleted from the text loses it. Only the types the body
  can name are reconciled (`links.EMBEDDED_TYPES`), which is what keeps a report's
  edge to the `post` draft it was composed in — that one is declared by
  `POST /notes` at creation, and no wording could restate it. A note typed by hand
  keeps no chain.

Free-typed labels remain valid in stored data. The registry defines what the UI
understands and what the API will mint, not what a case may hold.

### Relations

Everything outside the two chain types is a semantic connector: an ordinary
relation, a mention, or one of the three Claim connectors. `engine/links.py` holds
the one registry — how each type reads, the types either end accepts and which UI
action owns it — and `GET /api/cases/relation-types` serves it to every surface.
It answers with resolved type lists, so a client never has to know what a family is.

| | Chain (`derived-from`, `depends-on`) | Relation (`located-at`, `depicts`, …) |
|---|---|---|
| Says | how the file was made | what is true of the subject |
| Written by | the save that produced the artifact | enrichment, or the analyst |
| Status | always `confirmed` | `suggested` from a tool, `confirmed` by hand |
| Delete | cascades or tombstones | drops the edge, nothing else |

- A relation stated by hand is `confirmed` and validated against the registry: the
  API refuses a chain type, an unregistered type, a self-link, and any pair of
  endpoint types the table above has no reading for.
- **Relations stay editable** from any surface that shows them. Correcting the
  reading keeps the edge — same id, same provenance — since only the verb was
  wrong; the same validation applies, plus a refusal to collapse onto a relation the
  pair already holds. Removal is one gesture whatever the status: dismissing a
  proposal and retracting an accepted statement are the same act on the graph. A
  chain edge is refused there, because dropping a derivation would lose it without
  the tombstone the delete rules depend on.
- An older out-of-matrix connector stays visible and removable, but cannot be
  created or reworded. Compatibility does not silently widen the current vocabulary.
- `same-image-as` is registered but **machine-only**: it is a claim about perceptual
  hashes — two files showing the same pixels, never one shared graph identity.
- Where they appear: the Details panel, the map popup and the case board. One
  component renders all three (`RelationList.svelte`), one collects a new one
  (`RelationPicker.svelte`).

### Where a geolocation becomes a point ✅

Saving a proof files the points it carries as `place`s and states
`proof --depicts--> place` for each (`satellite.place_for_proof`). They are what
the analyst typed into the composer, or what its panels froze and they left
standing (`spec_points`, §3 placement).

**A proof states as many points as it argues.** Three impacts, a building, the
camera that filmed it: each is a point somebody concluded on, and they are peers,
in the order they were typed. **The first is the conclusion** — the map mark, the
coordinate a post cites, the place a save files first — and nothing else takes
that rank, POV included: a list that reordered itself would take a coordinate out
of a tweet without saying so. A point may carry a name, which becomes the `place`'s
label: "impact 2" reads better in the tree than `64.148100, -21.940100`.

**A capture files nothing.** Ten are taken while hunting one roof and each frames
a slightly different centre, so filing each would pin the search rather than the
answer. A capture is already on the map — the Saved index draws places and
captures alike — and what it lacked was a *node*, which is worth minting once, at
the moment somebody commits to it. That moment is the proof.

- **Nothing is ever `suggested` here.** Typed or accepted from the panels, the
  point is the analyst's own answer, and a review step over one's own answer is a
  step over nothing.
- **A point the case already holds is neither filed twice nor asked about**
  (`place_at`, rounded to five decimals, about a metre). Re-saving a proof stays
  silent, and so does one whose coordinates were never touched — the edges are
  restated all the same, so a proof concluding on a pin already on the map says
  so instead of standing beside it unattached. The key is shared with import
  enrichment (`satellite.COORD_KEY`) so a photo's EXIF point and a proof
  concluding on the same spot are one node.
- **A save restates the point rather than adding one**
  (`satellite.restate_proof_point`), the rule the proof's panels already follow.
  Reopening a proof and correcting the coordinates is an answer withdrawn: the old
  edges go, or the case reads as two geolocations. It reconciles the **whole list**
  by difference, so a point taken off it rends its place exactly as an emptied
  field once did, and POV moved to another line changes both verbs. Only what the composer itself wrote is reconciled — an edge stated by
  hand in Details, or proposed by import enrichment, is a separate claim about the
  same file — and a point another proof still concludes on keeps its material.
  A place the proof let go of that nothing else holds is **offered for deletion,
  never swept**: it is on the map, and dropping it is the analyst's call.
- **The material the proof composes states the same point**, over the derivation
  closure — the frame, the collage, the video two hops up, the capture. Confirmed,
  because **composing is the assertion**: putting a frame beside a capture and
  writing the coordinates *is* the geolocation, and asking the analyst to accept
  their own act is the review everybody clicks through, which is what makes
  `suggested` stop meaning anything where it is real. Being wrong costs one
  removal, since a relation drops alone.
- **POV picks the verb for the material, because the composition cannot.**
  Recorded-at and shows are independent — a rooftop shot was recorded somewhere it
  never shows, a skyline is shown from kilometres away — and a match between a
  frame and an imagery says only that they meet, not whether the camera or its
  subject was located. So it rides on the **point**, not on the proof, and **at
  most one point carries it**: a camera stood in one place, and two would have one
  video recorded twice. Set, the media are `located-at` that point; unset, they
  `depicts` it. A
  `capture` shows it either way, since orbital imagery was recorded nowhere on the
  ground, and so does the proof, which was composed. POV is also the only reading
  that reaches an audio file, which has a place it was made and nothing it shows.

**A point another road filed for the proof is one of its points too.** A sheet
row states a second position about a picture it already built, under its own
provenance rather than by composing that picture twice (`sheetproofs._added_point`).
The graph then holds a point the spec never learned, so everything that asks what
a proof concludes on reads both (`satellite.proof_points`): the map draws it, and
the composer **opens on it** instead of beside it. Saving is what makes the spec
agree; until then, reopening never rewrites what the analyst typed.

`proof_place_auto` (Settings → General → Proofs, on by default) decides whether
the save files them or the composer asks first. Both write the same thing, and the
question is plural when the list is.

**Only the conclusion is looked up at save.** Geography is a paced Nominatim call
(`engine/geo._pace`, 1.1 s apart under one lock), so resolving three points would
hold the save for three seconds to answer what the Locate pass answers for free.
The rest are born unlocated, exactly as an offline save already is.

**A proof is derived from what it composes and from what it rests on.** Its panels are
the pictures laid out on the canvas; its `material` is the footage behind them, brought
into the case from an address the analyst stated in the composer's Source list. Both are
restated on every save (`links.sync`), so an address taken off the list drops its edge
the way a dropped panel does, and the point follows the derivation closure rather than a
second rule — `restate_proof_point` already poses a proof's place on everything in its
chain.

**An imported proof is filed by the same rules** (`engine/proofimport.py`). A
post that publishes a geolocation is a proof and its material written in prose,
so the import files every file the post points at as `media`, each picture it
published as a `media` that proof composes, and writes their spec through the
composer's own save route — one panel per published picture, since a post
publishing a set published one geolocation. **Both halves are plural, and for
opposite reasons**: a set of published pictures is one composition, while a thread
states one point and hangs the photos and the clips it rests on off several posts.

**The proof is the node they all hang off.** It composes the pictures and rests on the
material, and both are its own `derived-from` edges — the same shape the composer writes
by hand, and the reading somebody opening the graph is after, since the proof is the
finding and a published picture is one file among the several it was read from. Hanging
the material off the *picture* instead made a media node the centre of a geolocation and
left the proof a leaf beside it. It also asked the import to say which photo of four a
composite was laid out from, which is not something a post says.

Nothing about the vocabulary changes: the proof `depicts`, the material takes the verb
POV picks, and the point deduplicates on `COORD_KEY` like any other. The material reaches
the point because the proof records `derived-from` it — the derivation closure is what the
placement reads, so a source that is merely named in the text and never downloaded is a
proof with no material rather than an edge stated about a file the case does not hold.

### Lenses ✅

The graph draws one reading at a time, and a reading is **a set of verbs and a set of
node roles, both resolved from the registries rather than listed a second time**
(`engine/graph.py`, `GET /api/cases/graph-lenses`). A verb reaches its lens by what it
joins and a type by its role, so adding either places it with no edit there:

| Lens | Verbs | Derived by | Nodes |
|---|---|---|---|
| Everything | all 19 | the whole registry | the case |
| Subjects | `owns`, `part-of`, `member-of`, `associated-with`, `posted`, `appears-in`, `instance-of`, `in-network`, `same-image-as` | an analyst's relation that is not geography | the case |
| Ground | `located-at`, `depicts`, `sited-at` | a relation whose object is a `place` | the case |
| Statements | `about`, `at`, `cites`, `contradicts` | `action = "claim"` | the case |
| My work | `derived-from`, `depends-on`, `mentions` | the chain types, plus `action = "mention"` | everything |

"The case" is the `subject` and `attestation` roles; **My work** is the switch that
puts the analyst's own output back on screen. Three calls the table does not show:

- **`same-image-as` reads with subjects, not with the artifact chain.** Two files
  being one picture is a fact about the case rather than about the filing, and `media`
  is a subject. Filed with `derived-from` it made one lens hold a derivation and a
  finding about the world at once.
- **`mentions` starts at a `document` by construction**, so it has never held one
  subject-to-subject edge. It, `derived-from` and `depends-on` all answer *what did I
  write, and out of what* — one question, one lens, named for what it is.
- **Every verb lands in exactly one lens**, which is a test (`tests/test_graph.py`):
  a verb in none is unreachable, a verb in two is an ambiguity the analyst would have
  to resolve.

Narrowing the verbs never hides a subject: a node with no edge in the chosen lens is
an answer, it is what nobody has connected yet. What a lens does take out is a whole
**role**, and it takes it out of every read — the ranking, the closed edge set, an
expansion's arrivals, a neighbourhood's walk, a route's intermediate nodes. Degree
follows, counted over the edges that reading can show, or a node would price a click
that brings nothing in. A named node is no exception: a filter is a narrowing set
earlier and a name outranks it, where a lens *is* the reading. A neighbourhood or a
route rooted on a type the lens leaves out is refused in words rather than answered
with an empty picture.

A **free type** the vocabulary has never heard of has no role, so a reading states
what it *excludes* rather than what it keeps: an allowlist resolved from the registry
would silently drop an entity nobody agreed to drop.

### The wrapper is an edge ✅

An `attestation` on a statement→source chain is drawn as **one edge, not a node**
(`engine/graph._fold`, whole-case view only — a neighbourhood gives its axis to
distance, and a fold changes distance). A bookmark is not a leaf: *this account posted
it, this statement cites it* is a path through it, and that path is a fact about the
case rather than about the filing.

```
before   claim → bookmark → account A          after   claim ──cites (3 sources · 1 account)──▶ account A
         claim → bookmark → account A
         claim → bookmark → account A
```

The rules, each of which exists to keep the fold a reading rather than a loss:

- **Across provenance only** — `posted`, `derived-from`, `depends-on`. The content
  verbs (`depicts`, `appears-in`, `located-at`) say what is *in* the material, which is
  a subject-to-subject reading: folding the capture that shows a place and holds a
  vehicle would state a claim about the two that nobody made.
- **All of it or none.** A middle whose drawn edges are not every one either a
  statement's or a provenance verb's stays a node — it carries something the edge
  cannot say.
- **Both ends drawn.** The closed set is the invariant, so a middle whose far end the
  budget cut stays a node instead.
- **The middle itself need not be drawn.** Two things keep one out of the picture and
  neither loses the path through it: its **type** is one this reading leaves out — the
  safeguard for a reconstructed case whose import filed a source under a type meant for
  the analyst's own output, where shape outranks the type name — or the **budget** cut
  it. The second is the common one: the ranking cuts the least connected first, which
  is exactly the sources this folds, so without it the fold only kept its promise below
  the ceiling. A statement resting on nine sources and one account drew as a lone dot
  with both of its ends on screen and nothing joining them.
- **A named node is never folded**, drawn or not, which is the way back: the edge
  carries the ids it stands for, and asking for one draws it with its own edges again.
  It is also what makes a route through a bookmark still land. Named *and* absent means
  the budget refused something asked for outright, and folding it would offer to hand
  back an id already in the expansion.
- **Handing back is a question about the type**, not about whether the middle is on
  screen: a source the budget cut is drawn by the same `expand` that opens a node,
  where one of a type the lens leaves out could only be refused — so that edge names
  the lens that does draw it instead.
- **Its id is not a row.** `folded:<verb>:<from>:<to>` — deterministic, so a selection
  survives a reload, and prefixed because nothing may be written to it: confirming,
  rating and removing all refuse it.
- **Only as confirmed as its weakest part.** One proposed link along the path makes the
  edge proposed, so a fold cannot launder a proposal into a finding.
- **The degree follows the drawing.** Three citations that became one edge are one
  connection now, or the node would price a click at three and bring nothing.

**Independence falls out of it** ✅. Each drawn statement carries
`rests: {sources, accounts, one}` — how many sources it rests on, how many accounts
published them, and whether *every* one of them traces back to the same account. That
last is the finding ("three citations are one source"), and it stays false while any
source has no known publisher: the untraced half may well be independent, and saying
otherwise would be a judgement rather than a measurement. The view counts them as
`single_account`. Both are read over the drawing's own edges, like the match count and
unlike the case-wide total.

### The derivation reads as three more folds ✅

Derived imagery is ordinary `media` — no new type, no role change, nothing leaves the
vocabulary (`engine/graph`, whole-case view only, like the fold above). A type for it
was considered and rejected, for three reasons worth keeping: **hiding cuts paths where
folding keeps them** (a frame filed as `annex` takes `proof ──derived-from──▶ frame` out
of every read with nothing replacing it, and a bare geolocation has no claim for the
safeguard query to rescue it by); **a derivative is often the evidence**, so Ground and
Statements would lose the very images the case is built on; and **a type is exclusive
where an origin is not** — a save that dedupes onto existing bytes returns the entity
already there and adds a `derived-from`, so one file is both imported and derived. What changes is
**how the same nodes are read**, and the role is what decides: an `annex` is left out of
a reading of the case, an `attestation` is folded, a `subject` keeps its node. A fold is
**per lens**, always: what a reading draws decides what it may collapse.

| Fold | Rule | Reads |
|---|---|---|
| `_relay` | every drawn edge a chain verb, exactly one of them **outgoing**, and it relays something | `proof ──derived from 1 frame──▶ video` |
| `_roll` | one drawn edge, a chain verb, and the node is the end that was **derived** | `12 frames made from it, used by nothing`, on the video, which still prices them |
| `_star` | the nodes stating the same point, grouped by derivation; the arrow stays on the **subject** root | `video ──depicts (3 sources)──▶ place`, `rests on 1 source` |

The family is **every arrow on the point, whatever verb it is written with**. POV splits
one material across two — the footage was `located-at` the point, the capture `depicts`
it — so a star grouped by verb cuts the family in half, each half then holds a derivation
reaching outside itself, the all-or-nothing rule refuses both and nothing collapses at
all. The surviving line is the material's own statement; the ones folded into it are
named on it and come back saying exactly what they said.

The calls the table cannot show:

- **One outgoing chain edge, never two.** A node made from a frame *and* an overhead
  capture is a confluence: collapsed, the line left standing would say the capture came
  out of the footage.
- **A leaf with a single relation is not rolled up.** A person with one link is thin
  material the case has yet to exploit, not clutter — and the direction settles the lone
  pair, since only the derivative came out of the other.
- **A capture pulled at the coordinates already suspected is the reference**, not a
  witness that agrees: its `depicts` is close to a tautology, and counting it would state
  a corroboration nobody found. Shape cannot tell it from the footage; the roles can.
  A group with no subject root keeps its own, or the one statement about that point
  would leave with it.
- **`_star`'s surviving arrow is the case's own row**, annotated rather than replaced,
  so confirming or withdrawing it stays possible. The other two build synthetic edges,
  which nothing may be written to.
- **`_star` and `_roll` leave the degree alone**, and that is where the way back sits. The others hand their nodes back from a line that *touches* them; this one
  names a frame and a capture on `video → place`, which does not touch the proof they
  were derived by. Priced down, that proof would report no further connections while two
  of them exist — so it keeps counting them, and **what an opened node touches is never
  folded**, or the click answers with the picture it was pressed on. `_roll` follows for
  a plainer reason: its count is a fact about the video rather than a second way to open
  it, and priced down the node offered one number on its pill and another in its menu for
  the same missing nodes.
- **The place reports `rests: {sources}`** where more than one arrow arrived: the
  geographic counterpart of the independence number above, and a count that would only
  restate the picture is not shown.

### The derivation chain

The chain is filed with the save action:

```
post ──derived-from──▶ proof ──derived-from──▶ capture ──(provenance: provider,zoom,bearing)
                          └────derived-from──▶ media(frame) ──derived-from──▶ media(video)
                                                    inspect-session ──depends-on──▶ media(video)
```

How it is wired (`engine/links.py`):

- Sources are recorded as **case paths** (a proof's panels, a session's
  `spec.source`, a derivative's sidecar `source.from`/`sources`); the link layer
  resolves path → entity and emits the edge. A note is the exception: its body names
  entity ids, and `sync_embedded` restates only the types that body can speak for.
- Every save restates sources through `sync`. Removing a panel removes its edge;
  repeated saves keep one edge per panel.
- A proof's pasted images are read as decoration, not sources: they carry no case
  path, so they file no entity and earn no edge. Only panels put a proof in a
  chain.
- A missing source path produces a tombstone instead of a link.
- Media derivatives are all filed through one registration point, so any future
  tool producing imagery gets its chain for free. A derivative that **dedupes**
  onto an existing entity still records its derivation: the same frame really
  can come from two videos, and the entity keeps both.
- Imports, downloads and satellite captures emit nothing: their origin is a URL
  or a provider, which provenance already carries, with nothing in the case to
  point at.

## 4. Provenance and assessment

- **Provenance** (on every entity and link): `by` (tool id: `media-library`,
  `satellite`, `proof-composer`, `post-composer`, `inspect`, `paste`, `ingest`,
  or `user`), `at` (UTC), `status` and optional source URL. It borrows the entity/activity/agent
  shape of W3C PROV without implementing the full standard.
- **Review status** is `confirmed` (analyst-made or analyst-accepted) vs
  `suggested` (a tool proposed it, awaiting a click). It is not confidence. Import
  enrichment emits suggested places and `located-at` / `same-image-as` links from
  media metadata. A proof's point is not one of them: it and the `depicts` edges
  it states over the material composed are the analyst's own act (§3). ✅
  Confirming runs both ways and stops at one hop: a confirmed entity confirms its
  incident suggested relations *and the entity at each far end*, and a confirmed
  relation confirms whichever endpoint is still `suggested`. One rule drives both —
  "this file was recorded at this point" cannot be true while the point is only
  proposed. Dismissing is not the reverse: the edge goes, the entities stay, because
  a place can be real while one file's claim about it is wrong. A dismissal sticks,
  so re-reading a file never re-proposes edges already triaged. Anything still
  `suggested` is marked as such wherever it appears.
  **A derivation is `confirmed`**: `derived-from`/`depends-on` record what the
  analyst's own click just made. `suggested` is for inference — OCR reading a street
  name, EXIF proposing a `place`. A relation stated by hand is `confirmed` for the
  same reason: there is nothing left to review.
- **Assessment has three separate homes.** Claim confidence is a string attribute
  on the Claim; an ordinary semantic relation may carry the nullable integer
  ordinal; source reliability is an A–E attribute on the source. None are combined.

## 5. Design rules

1. Keep a small known vocabulary and allow free-string extensions required by
   implemented tools.
2. Tools emit `suggested`; the analyst confirms. Derivations filed during save are
   `confirmed` because they record the action rather than an inference.
3. **Two-way delete.** An artifact and its entity are one thing; deleting either
   drops the other and its links (SPEC §6 delete/edit sync). What that takes
   with it is the link type's call, never the tool's (§3).
4. Version graph-shape and storage-format changes in the case manifest and ship a
   migration with each bump.
