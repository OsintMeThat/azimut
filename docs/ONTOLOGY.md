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
a manifest schema bump and migration. The internal SQLite schema is version 7;
it adds indexes, durable jobs and recoverable trash without changing this
logical model.

Legend: ✅ implemented in code · 🔶 machinery exists, unused · ⬜ proposed.

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
`label` is editable and never defines identity.

`geo` is the country a saved point falls in, resolved once and kept:
`{state, country_code, country, region?, region_en?}` with `state` one of `ok`,
`nocoords` (no position to look up), `nocountry` (open sea) or `failed` (the
lookup did not answer — the only state a later pass retries). `country` and
`region` are the local-language names; `region_en` is a second lookup in English
and is absent when it failed or matched the native name. Continent and the
English country name are *not* stored: both are derived from `country_code` at
read time, so extending those tables repairs existing cases with no migration.

### Entity type registry

| Type | State | Produced by | Key `attrs` | File-backed |
|---|---|---|---|---|
| `media` | ✅ | media-library | `path`, `sha256`, `source_url?` | yes (+ sidecar) |
| `capture` | ✅ | satellite | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `path`, `geo?` | yes (image) |
| `place` | ✅ | satellite, ingest, enrich | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `notes?`, `geo?`, `source_url?`, `site?`, `enrich_coord_key?` | no (a point) |
| `proof` | ✅ | proof-composer | `spec` (json), `path` (png) | yes |
| `post` | ✅ | post-composer | `draft` (json) | yes |
| `inspect-session` | ✅ | inspect | `spec` (json) | yes |
| `note` | ✅ | notebook | `path`, `folder?` | yes (Markdown) |
| `person` | ⬜ | manual / future | name attrs | no |
| `organization` | ⬜ | manual / future | | no |
| `alias` / `account` | ⬜ | future orchestrator | `platform`, `handle`, `url` | no |
| `email` `phone` `domain` `ip` | ⬜ | future | the identifier | no |
| `vehicle` | ⬜ | future (OCR plate) | `plate`, `make` | no |
| `event` | ⬜ | future (EXIF, timeline) | `when`, `where` | no |

New types coming from the roadmap (declare here when built): `panorama`,
`ground-image`, `map-board`, `report`.

Per-type attribute schemas remain open work. Today attribute keys are conventions,
not a validated contract between tools.

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

### Link type registry (proposed core)

| Type | from → to | Meaning | State |
|---|---|---|---|
| `derived-from` | artifact → source | made from that, and outlives it | ✅ |
| `depends-on` | session → subject | only a pointer at that: dies with it | ✅ |
| `located-at` | media/capture → place | shot at this point | ✅ |
| `depicts` | media/capture → place | the place is shown in the file | ✅ |
| `same-image-as` | media → media | perceptual hashes are within 10 bits | ✅ |
| `appears-in` | media → vehicle/person | subject shown in the media | ⬜ |
| `same-as` | entity → entity | two records, one real thing (merge) | ⬜ |
| `owns` | person/org → account/asset | ownership | ⬜ |
| `posted` | account → media/post | authorship | ⬜ |
| `mentions` | media/note → any | referenced, weaker than depicts | ⬜ |

### Delete policy

A tool selects one of two deletion behaviours through its link type:

> **After deleting the target, is the holder still usable?**
> Yes → `derived-from`. No → `depends-on`.

| | `derived-from` | `depends-on` |
|---|---|---|
| Holder | proof, post, frame, collage | inspect-session |
| Holds | its own pixels/text | only a reference |
| Target deleted | **survives**, + tombstone | **deleted with it**, transitively |

- `derived-from` never cascades into an output. A post keeps its text when its
  proof is deleted; a frame keeps its pixels when its video is deleted.
- It is also read backwards, as geography. The Saved panel counts the proofs
  hanging off each saved point through this edge, and a proof with no point of
  its own is placed at the point of every capture it composes, one hop back.
  A proof does carry its own point first, though: `coordsText` (what the analyst
  typed, in any supported format) then `coords` (what the panels gave it, frozen
  at save). That is what keeps a proof on the map once its capture is deleted —
  a tombstone records the path, the sha256 and the URL, never coordinates.
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

Free-typed labels remain valid in stored data. The registry defines what the UI
understands and what the API will mint, not what a case may hold.

### Relations

Everything outside the two chain types is a **relation**: a statement about the
world rather than about how a file was produced. `engine/links.py` holds the one
registry — how each type reads in words, the entity types either end accepts, and
whether an analyst may state it — and `GET /api/cases/relation-types` serves it to
every surface, so the vocabulary is never copied per screen.

| | Chain (`derived-from`, `depends-on`) | Relation (`located-at`, `depicts`, …) |
|---|---|---|
| Says | how the file was made | what is true of the subject |
| Written by | the save that produced the artifact | enrichment, or the analyst |
| Status | always `confirmed` | `suggested` from a tool, `confirmed` by hand |
| Delete | cascades or tombstones | drops the edge, nothing else |

- A relation stated by hand is `confirmed` and validated against the registry: the
  API refuses a chain type, an unregistered type, a self-link, and any pair of
  endpoint types the table above has no reading for.
- **Relations stay editable.** Add one, correct its reading, or take it back at any
  time, from any surface that shows them. Correcting the reading keeps the edge —
  same id, same provenance — because the two entities were always related and only
  the verb was wrong; the same validation applies, plus a refusal to collapse onto
  a relation the pair already holds. Removal is one gesture whatever the status:
  dismissing a proposal and retracting an accepted statement are the same act on
  the graph, and a statement that cannot be taken back is a trap. A chain edge is
  refused there too — dropping a derivation behind the relation path would lose it
  without the tombstone the delete rules depend on.
- `same-image-as` is registered but **machine-only**. It is a claim about
  perceptual hashes, which is enrichment's to make; a person comparing two
  pictures is not measuring a hash. It is also narrower than `same-as`: two files
  showing the same pixels, never one merged graph identity.
- Where they appear: the Details panel, the map popup, and the case board next.
  One component renders all three (`RelationList.svelte`), one collects a new one
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
  resolves path → entity and emits the edge.
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

## 4. Provenance, confidence, identity

- **Provenance** (on every entity and link): `by` (tool id: `media-library`,
  `satellite`, `proof-composer`, `post-composer`, `inspect`, or `user`), `at`
  (UTC), `status` and optional source URL. It borrows the entity/activity/agent
  shape of W3C PROV without implementing the full standard.
- **Confidence** = `status`: `confirmed` (analyst-made or analyst-accepted) vs
  `suggested` (a tool proposed it, awaiting a click). Import enrichment emits
  suggested places and `located-at` / `same-image-as` links from image or video
  metadata.
  Keep the status binary until a real workflow needs finer grading. ✅
  Confirming a suggested entity confirms its incident suggested relations *and the
  entity at each far end*; a relation is also confirmed or dismissed on its own,
  from Details, from the point's own card on the map, or from the dialog that edits
  it. Confirming a relation likewise confirms whichever endpoint is still
  `suggested`. Both directions carry one rule — "this file was shot at this point"
  cannot be true while the point is only proposed — and without both, the
  Suggestions list and the relation rows would disagree about the same click. The
  spread stops at one hop: accepting a photo's own point is a reading of that
  photo, not a licence to accept whatever else that point was separately proposed
  to be. Dismissing is not the reverse — the edge goes, the entities stay, because
  a place can be real while one file's claim about it is wrong. A dismissal also
  sticks: re-reading a file refreshes its facts without re-proposing edges it has
  already been through, so the Enrich button never undoes a triage. Anything still `suggested` is marked as such
  wherever it appears — a proposed place reads as a proposal in the Saved tree and
  in its card, never as work the analyst did.
  **A derivation is `confirmed`**: `derived-from`/`depends-on` record what the
  analyst's own click just made, not what a tool inferred. `suggested` is for
  inference, such as OCR reading a street name or EXIF proposing a `place`. A
  relation stated by hand is `confirmed` for the same reason: there is nothing
  left to review.
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
