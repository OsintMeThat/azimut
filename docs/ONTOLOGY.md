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
a manifest schema bump and migration. The internal SQLite schema is also at
version 9: 8 adds `links.confidence`, 9 rebuilds the entity search index so a case
search reaches the declared fields (§2) rather than stopping at the label and the
notes.

Legend: ✅ implemented in code · ⬜ proposed.

---

## 1. Where it lives

`case.db` (SQLite) is the source of truth for the graph; the storage boundary
presents it as this logical shape:

```jsonc
{ "entities": [ … ], "links": [ … ], "folders": [ … ] }
```

- **Entities** are nodes such as files, points, proofs and people. ✅
- **Links** are typed directed edges. Every save records its inputs; see §3. ✅
- **Folders** are `/`-nested analyst buckets in `attrs.folder`, not semantic
  links. ✅
- Media sidecars hold kind, size, uploader, duration, thumbnail data, image EXIF
  and perceptual hashes, plus ffprobe's video container and stream metadata. A
  stated position lands on one field, `gps`, whichever of the two read it. A
  SQLite browse index mirrors searchable fields, plus whether that position
  exists. Entities retain only what the graph needs for identity, links and
  deduplication.

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
| `identifier` | a handle on a system | `account`, `email`, `phone`, `domain`, `ip`, `network` |
| `collected` | bytes gathered into the case rather than written, so one may depict a place | `media`, `capture` |
| `document` | it is read rather than gathered: made or consulted | `proof`, `post`, `note`, `inspect-session`, `bookmark` |
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

### Entity type registry

| Type | Family | State | Produced by | Key `attrs` | File-backed |
|---|---|---|---|---|---|
| `media` | collected | ✅ | media-library | `path`, `sha256`, `source_url?` | yes (+ sidecar) |
| `capture` | collected | ✅ | satellite | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `path`, `geo?` | yes (image) |
| `place` | place | ✅ | satellite, ingest, enrich | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `notes?`, `geo?`, `source_url?`, `site?`, `enrich_coord_key?`, plus the precision fields below | no (a point) |
| `proof` | document | ✅ | proof-composer | `spec` (json), `path` (png) | yes |
| `post` | document | ✅ | post-composer | `draft` (json) | yes |
| `inspect-session` | document | ✅ | inspect | `spec` (json) | yes |
| `note` | document | ✅ | notebook | `path`, `folder?` | yes (Markdown) |
| `bookmark` | document | ✅ | capture extension | `url`, `fetched_at?`, `archive_url?`, `reliability?` | no (a URL) |
| `person` | actor | ✅ | analyst | `aliases`, `role`, `nationality` | no |
| `organization` | actor | ✅ | analyst | `echelon`, `country` | no |
| `vehicle` | asset | ✅ | analyst | `plate`, `make`, `model`, `colour` | no |
| `vessel` | asset | ✅ | analyst | `imo`, `mmsi`, `flag`, `kind` | no |
| `aircraft` | asset | ✅ | analyst | `registration`, `icao24`, `model` | no |
| `structure` | asset | ✅ | analyst | `kind`, `address` | no |
| `account` | identifier | ✅ | analyst | handle in the label; `platform?`, `url`, `reliability?` | no |
| `email` | identifier | ✅ | analyst | address in the label | no |
| `phone` | identifier | ✅ | analyst | number in the label; `country?` | no |
| `domain` | identifier | ✅ | analyst | hostname in the label; `registrar?` | no |
| `ip` | identifier | ✅ | analyst | address in the label; legacy read-only `network?`; `asn?`, `provider?` | no |
| `network` | identifier | ✅ | analyst | network/CIDR in the label; `asn?`, `provider?`, `country?` | no |
| `claim` | claim | ✅ | analyst | `confidence`, `method`, `verbatim` | no |

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
`choice`, `geojson`. `longtext` stores and validates exactly what `text` does; it
says the field expects sentences, so it gets a box that grows.

**The declared `text`, `longtext` and `url` fields are what a case search matches
on**, beside the label, the type, the folder and the notes — a vehicle is looked for
by its plate. Numbers, shapes and stored grades stay out of the index. One predicate
serves both sides: `sqlite_backend._entity_search_text` for the server,
`lib/entitySearch.js` for the lists that filter a small case in memory.

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

The four fields are edited in Details → **Case**, under the heading the registry
gives them (`group` on the entity type, `"How precise"` for a place), and committed
by the panel's Save. They sit under Case rather than Info because Info reports what
the file or the save says about itself, where precision is the analyst's judgement.

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
| `depicts` | image/video media or capture → place | the place is visible | ✅ |
| `owns` | person/organization → organization/asset/identifier | strict ownership, never membership or mere control | ✅ |
| `part-of` | organization → organization | internal organizational containment | ✅ |
| `member-of` | person/organization → organization | membership, not internal containment | ✅ |
| `posted` | account → media/bookmark | the account published the content or URL | ✅ |
| `appears-in` | actor/asset/identifier → image/video media or capture | the entity or a recognizable representation is visible | ✅ |
| `sited-at` | structure → place | a permanent site, never a dated presence | ✅ |
| `in-network` | IP/network → network | an address or subnet belongs inside the network | ✅ |
| `same-image-as` | image media → image media | a machine perceptual-hash match | ✅ |
| `about` | claim → actor/asset/identifier/place/media/capture | what the statement concerns | ✅ |
| `at` | claim → place | where the statement puts its subject | ✅ |
| `cites` | claim → bookmark/note/proof/media/capture | what the statement rests on | ✅ |
| `mentions` | note/post/proof/bookmark → any other declared entity | the document refers to the entity | ✅ |
| `same-as` | entity → entity | two records, one real thing (merge) | ⬜ |

Every manual connector is validated by the API and offered only by its own picker.
`same-image-as` is machine-only. `part-of`, `in-network` and the derivation chain
refuse cycles. Self-links are refused for every type.

Every label completes the sentence *"<from> … <to>"*, which fixes the direction:
`appears-in` runs subject → file, because a person appears in a video. `owns` may
target an organization but never a person; membership is stated separately.

**Containment, membership and ownership stay three verbs.** A brigade contains its
battalions through `part-of`, a person belongs to an organization through
`member-of`, a unit's trucks are owned. Keeping them apart is what makes an order of
battle queryable; a military unit is an `organization`, and `attrs.echelon` sorts the
tree.

**No verb carries a date.** `sited-at` is a permanent site, not a visit. A person's
whereabouts at a time, or a unit reassigned between corps, is a statement with a
reason and sources, so it belongs on a claim node rather than an edge.

**`mentions` is a pointer, not a derivation.** A document *refers to* something,
where `derived-from` says the file was built from it; both may sit on the same pair,
and deleting the target drops the mention with no tombstone. The author is a note,
post, proof or bookmark; the target is any other declared entity, a Claim included.

It is the one verb served as its own **action** (`RelationType.action`, `"mention"`)
under its own heading (`RelationType.group`). A pointer must not borrow the weight of
a finding, so the split is the registry's and every surface obeys it: **Add relation**
never turns into **mentions**, **Add mention** has its own target search, an edge is
only reworded inside its action, and a mention carries no rating (`ratable: false`).

### The claim, and how sure it is ✅

A `claim` is a statement node. It points `about` at subjects, `at` at places and
`cites` at evidence. The Claim holds `confidence`, `method` and `verbatim`; its three
connectors carry none of those values. This keeps one statement at one confidence
even when it has several subjects, places or sources.

| Claim `attrs.confidence` | Reads as |
|---|---|
| `certain` | established and corroborated |
| `probable` | more likely than not |
| `possible` | cannot be excluded |
| `refuted` | checked and eliminated |
| absent | not assessed |

The Claim editor owns `about`, `at` and `cites`; they never appear under **Add
relation** and cannot be reworded into another action. Competing candidates are
separate Claims, which is how each gets its own confidence — the former `exclusive`
checkbox tried to do that on connectors instead and is no longer offered, though
existing `exclusive` attributes stay readable.

Ordinary semantic relations may carry the nullable `links.confidence` ordinal: `3`
certain, `2` probable, `1` possible, `-1` ruled out, absent for not assessed. It
saves turning a tentative ownership into a whole Claim node. A tool's suggestion is
confirmed before it can be rated.

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
  A proof does carry its own point first, though: `coordsText` (what the analyst
  typed, in any supported format) then `coords` (what the panels gave it, frozen
  at save). That is what keeps a proof on the map once its capture is deleted —
  a tombstone records the path, the sha256 and the URL, never coordinates.
- **Placement reads the same edges further, and in both directions**
  (`satellite.placements`, `GET /entities/{id}/placement`): a video reaches its
  capture three hops away, through the proof that composed a frame of it. Only
  `capture` and `proof` carry a point, and **the artifact carrying one ends the
  walk**. Points deduplicate on the exact pair, never a rounded one, and the nearest
  hop wins a repeat. Bounded at four hops, 200 entities read and 15 points reported,
  each with the entity it was read off; a `capture` reports none, its point being its
  own rather than one the chain placed it at.
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
  hashes, and narrower than `same-as` — two files showing the same pixels, never one
  merged graph identity.
- Where they appear: the Details panel, the map popup and the case board. One
  component renders all three (`RelationList.svelte`), one collects a new one
  (`RelationPicker.svelte`).

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

## 4. Provenance, assessment, identity

- **Provenance** (on every entity and link): `by` (tool id: `media-library`,
  `satellite`, `proof-composer`, `post-composer`, `inspect`, or `user`), `at`
  (UTC), `status` and optional source URL. It borrows the entity/activity/agent
  shape of W3C PROV without implementing the full standard.
- **Review status** is `confirmed` (analyst-made or analyst-accepted) vs
  `suggested` (a tool proposed it, awaiting a click). It is not confidence. Import
  enrichment emits suggested places and `located-at` / `same-image-as` links from
  media metadata. ✅
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
- **`same-as` / merge** (⬜ open, SPEC §10): when two entities are one real thing,
  link `same-as` rather than destructively merging; a resolver treats a `same-as`
  cluster as one node in views and unions its attributes and links. Collapse rules
  must be defined before an orchestrator creates duplicate accounts.

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
