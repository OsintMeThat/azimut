# Azimut ontology (case data model)

> The contract every tool files against. Companion to [SPEC.md §5](SPEC.md); the
> spec stays a summary, this is the precise vocabulary. Keep it small, coherent,
> extensible, **versioned** — grown from real tool needs, never a whiteboard
> taxonomy. Nothing enters a case without a human click (SPEC principle 5).

**Schema version: `0`** (draft, 2026-07-10, aligns with spec v0.2). Bump on any
breaking change to entity/link shape; ship a migration when you do.

Legend: ✅ implemented in code · 🔶 machinery exists, unused · ⬜ proposed.

---

## 1. Where it lives

`case.json` is the single source of truth for the graph:

```jsonc
{ "entities": [ … ], "links": [ … ], "folders": [ … ] }
```

- **Entities** = the nodes (files, points, proofs, people…). ✅
- **Links** = typed directed edges between nodes. ✅ (every save states what its
  output was made from; see §3.)
- **Folders** = the analyst's own `/`-nested buckets (`attrs.folder`), an
  organisational overlay, **not** semantic links. ✅
- Rich per-media metadata (kind, size, uploader, duration, thumbnail…) lives in a
  **media sidecar**, not on the entity — the entity carries only what the graph
  needs to point and dedupe.

## 2. Entity

```jsonc
{ "id": "e_ab12cd34",        // _new_id("e")
  "type": "capture",          // from the registry below (free strings allowed)
  "label": "48.8584, 2.2945", // human-readable, editable
  "attrs": { … },             // per-type, see registry
  "provenance": { "by": "satellite", "at": "2026-07-10T…Z",
                  "status": "confirmed", "source": "https://…" } }
```

Rules: `type` is extensible — unknown strings are accepted and stored; the UI
just doesn't get a custom renderer for them (SPEC §5 escape hatch, keep it).
`label` is always editable and never load-bearing for identity.

### Entity type registry

| Type | State | Produced by | Key `attrs` | File-backed |
|---|---|---|---|---|
| `media` | ✅ | media-library | `path`, `sha256`, `source_url?` | yes (+ sidecar) |
| `capture` | ✅ | satellite | `coords`, `lat`, `lon`, `plus_code`, `zoom`, `bearing`, `path` | yes (image) |
| `place` | ✅ | satellite | `coords`, `lat`, `lon`, `plus_code`, `dms`, `zoom`, `bearing`, `notes?` | no (a point) |
| `proof` | ✅ | proof-composer | `spec` (json), `path` (png) | yes |
| `post` | ✅ | post-composer | `draft` (json) | yes |
| `inspect-session` | ✅ | inspect | `spec` (json) | yes |
| `note` | ✅ | (manual) | free | no |
| `person` | ⬜ | manual / future | name attrs | no |
| `organization` | ⬜ | manual / future | | no |
| `alias` / `account` | ⬜ | future orchestrator | `platform`, `handle`, `url` | no |
| `email` `phone` `domain` `ip` | ⬜ | future | the identifier | no |
| `vehicle` | ⬜ | future (OCR plate) | `plate`, `make` | no |
| `event` | ⬜ | future (EXIF, timeline) | `when`, `where` | no |

New types coming from the roadmap (declare here when built): `panorama`,
`ground-image`, `map-board`, `report`.

Per-type **attribute schemas** are the main open work: fix a controlled vocab of
attr keys per type so tools read each other's output reliably. Today attrs are
convention, not contract.

## 3. Link

```jsonc
{ "id": "l_…", "from": "e_proof", "to": "e_capture",
  "type": "derived-from",
  "provenance": { "by": "proof-composer", "at": "…", "status": "confirmed" } }
```

Directed: read as **`from` → `type` → `to`**. Removing an entity drops every
link touching it (`remove_entity`, ✅) — but *what* gets removed is decided
first, by link type (see "Delete" below).

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

### Delete: the policy is the link type, not the tool

A new tool inherits the right behaviour by picking a link type, so this never
needs re-deciding per tool. The test:

> **Delete the target — is anything usable left in my file?**
> Yes → `derived-from`. No → `depends-on`.

| | `derived-from` | `depends-on` |
|---|---|---|
| Holder | proof, post, frame, collage | inspect-session |
| Holds | its own pixels/text | only a reference |
| Target deleted | **survives**, + tombstone | **deleted with it**, transitively |

- **Never cascade into an output.** A post keeps its coordinates and text when
  its proof goes; a frame keeps its pixels when its video goes.
- **Tombstone** = `attrs.lost_sources[]`, `{label, type, path, sha256,
  source_url, at}` — the sha256 and URL are what keep the loss auditable six
  months later. Keyed by path, never stacked. Additive: schema stays 0.
- **One door.** Every delete (sidebar, Media Library, a tool's own list) routes
  through the chokepoint, so the rules cannot be sidestepped by where you click.
  The confirm dialog states both lists before the click.
- A **secondary** reference never cascades: losing one collage piece leaves a
  placeholder, it does not void the session. Only the subject does.

Free-typed labels stay allowed (SPEC §5) — the registry is the well-known set the
UI understands, not a closed list.

### The derivation chain

The chain, filed at save time — same click, no new ceremony (principle 3):

```
post ──derived-from──▶ proof ──derived-from──▶ capture ──(provenance: provider,zoom,bearing)
                          └────derived-from──▶ media(frame) ──derived-from──▶ media(video)
                                                    inspect-session ──depends-on──▶ media(video)
```

How it is wired (`engine/links.py`):

- Sources are recorded as **case paths** (a proof's panels, a session's
  `spec.source`, a derivative's sidecar `source.from`/`sources`); the link layer
  resolves path → entity and emits the edge.
- **Every save restates them** (`sync`): a panel dropped from a proof drops its
  edge, a proof saved three times still carries one edge per panel.
- A path that resolves to nothing (its source was deleted while the tool was
  open) cannot be linked — it leaves a tombstone instead. Never lost in silence.
- Media derivatives are all filed through one registration point, so any future
  tool producing imagery gets its chain for free. A derivative that **dedupes**
  onto an existing entity still records its derivation: the same frame really
  can come from two videos, and the entity keeps both.
- Imports, downloads and satellite captures emit nothing: their origin is a URL
  or a provider, which provenance already carries, with nothing in the case to
  point at.

## 4. Provenance, confidence, identity

- **Provenance** (on every entity *and* link): `by` (tool id — `media-library`,
  `satellite`, `proof-composer`, `post-composer`, `inspect`, or `manual`), `at`
  (UTC), `status`, optional `source` (a URL). Borrow the *shape* of W3C PROV
  (entity/activity/agent) conceptually — don't adopt the standard wholesale.
- **Confidence** = `status`: `confirmed` (analyst-made or analyst-accepted) vs
  `suggested` (a tool proposed it, awaiting a click). ✅ Binary on purpose —
  honest and simple; resist finer grading until a tool truly needs it.
  **A derivation is `confirmed`**: `derived-from`/`depends-on` record what the
  analyst's own click just made, not what a tool inferred. `suggested` is for
  inference — OCR reading a street name, EXIF proposing a `place` (see §5.2).
- **`same-as` / merge** (⬜ open, SPEC §9): when two entities are one real thing,
  link `same-as` rather than destructively merging; a resolver treats a `same-as`
  cluster as one node in views and unions their attrs/links. Keeps it reversible
  and auditable. Decide the collapse rules before the first orchestrator tool
  produces duplicate accounts.

## 5. Design rules

1. **Extensible core, not complete taxonomy.** Small well-known set + free-string
   escape hatch. Grow from real tool needs.
2. **Nothing without a click.** Tools emit `suggested`; the analyst confirms
   (principle 5). Inferred links are `suggested` too — but a derivation filed at
   save time is `confirmed`: it states what the click did, it does not guess (§4).
3. **Two-way delete.** An artifact and its entity are one thing; deleting either
   drops the other and its links (SPEC §6 delete/edit sync). What that takes
   with it is the link type's call, never the tool's (§3).
4. **Version the schema.** This file's version travels with `case.json`; a bump
   ships a migration. Do the formalisation now, while the corpus is tiny.
