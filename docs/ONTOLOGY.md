# Azimut ontology (case data model)

> This is the filing contract for every tool and the detailed companion to
> [SPEC.md §5](SPEC.md). Extend and version it only when implemented tools need
> new vocabulary. Nothing enters a case without analyst confirmation.

**Storage schema: `3`.** The manifest carries `{"azimut": {"schema": 3,
"storage": "sqlite"}}`; schema 3 moved the graph from `case.json` to per-case
`case.db`. The entity/link shape is unchanged since v1. Breaking changes require
a manifest schema bump and migration. The internal SQLite schema is version 4;
it adds search and media browse indexes without changing this logical model.

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
- Media sidecars hold kind, size, uploader, duration and thumbnail data. A
  SQLite browse index mirrors searchable fields. Entities retain only what the
  graph needs for identity, links and deduplication.

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
| `place` | ✅ | satellite, ingest | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `notes?`, `geo?`, `source_url?`, `site?` | no (a point) |
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
| `located-at` | media/proof/event → place | happened / shot at this point | ⬜ |
| `depicts` / `appears-in` | media → place/vehicle/person | subject shown in the media | ⬜ |
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

Free-typed labels remain valid. The registry defines what the UI understands,
not a closed list.

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
  `suggested` (a tool proposed it, awaiting a click). 🔶 `suggested` has no
  producer yet. The sidebar and PATCH validator exist, but no tool emits it until
  the v3 EXIF/OCR tools land. Keep the status binary until a real workflow needs
  finer grading. ✅
  **A derivation is `confirmed`**: `derived-from`/`depends-on` record what the
  analyst's own click just made, not what a tool inferred. `suggested` is for
  inference, such as OCR reading a street name or EXIF proposing a `place`.
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
