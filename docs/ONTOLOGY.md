# Ozimut ontology (case data model)

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
- **Links** = typed directed edges between nodes. 🔶 (shape + CRUD exist in
  `workspace.py`; **no tool emits any yet** — every derivation is currently
  implicit in entity `attrs` paths. Closing this is the #1 ontology task.)
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

## 3. Link (the gap)

```jsonc
{ "id": "l_…", "from": "e_proof", "to": "e_capture",
  "type": "derived-from",
  "provenance": { "by": "proof-composer", "at": "…", "status": "confirmed" } }
```

Directed: read as **`from` → `type` → `to`**. Removing an entity cascades to
drop every link touching it (`remove_entity`, ✅).

### Link type registry (proposed core)

| Type | from → to | Meaning | Priority |
|---|---|---|---|
| `derived-from` | artifact → source | provenance chain: this was made from that | ⬜ **#1** |
| `located-at` | media/proof/event → place | happened / shot at this point | ⬜ |
| `depicts` / `appears-in` | media → place/vehicle/person | subject shown in the media | ⬜ |
| `same-as` | entity → entity | two records, one real thing (merge) | ⬜ |
| `owns` | person/org → account/asset | ownership | ⬜ |
| `posted` | account → media/post | authorship | ⬜ |
| `mentions` | media/note → any | referenced, weaker than depicts | ⬜ |

Free-typed labels stay allowed (SPEC §5) — the registry is the well-known set the
UI understands, not a closed list.

### The derivation chain (why `derived-from` is #1)

The chain you want to walk — `post ← proof ← {capture, frame} ← video ← download`
— exists today only as file paths inside `attrs`, so nothing can traverse it.
Emitting `derived-from` edges at save time turns on the derivation breadcrumbs,
the cross-tool "relations", and the Case Board graph, all at once:

```
post ──derived-from──▶ proof ──derived-from──▶ capture ──(provenance: provider,zoom,bearing)
                          └────derived-from──▶ media(frame) ──derived-from──▶ media(video)
```

Each tool that already writes a source pointer in `attrs` should *also* call
`add_link(..., "derived-from", ...)` — same click, no new ceremony (principle 3).

## 4. Provenance, confidence, identity

- **Provenance** (on every entity *and* link): `by` (tool id — `media-library`,
  `satellite`, `proof-composer`, `post-composer`, `inspect`, or `manual`), `at`
  (UTC), `status`, optional `source` (a URL). Borrow the *shape* of W3C PROV
  (entity/activity/agent) conceptually — don't adopt the standard wholesale.
- **Confidence** = `status`: `confirmed` (analyst-made or analyst-accepted) vs
  `suggested` (a tool proposed it, awaiting a click). ✅ Binary on purpose —
  honest and simple; resist finer grading until a tool truly needs it.
- **`same-as` / merge** (⬜ open, SPEC §9): when two entities are one real thing,
  link `same-as` rather than destructively merging; a resolver treats a `same-as`
  cluster as one node in views and unions their attrs/links. Keeps it reversible
  and auditable. Decide the collapse rules before the first orchestrator tool
  produces duplicate accounts.

## 5. Design rules

1. **Extensible core, not complete taxonomy.** Small well-known set + free-string
   escape hatch. Grow from real tool needs.
2. **Nothing without a click.** Tools emit `suggested`; the analyst confirms
   (principle 5). Auto-created links are `suggested` too.
3. **Two-way delete.** An artifact and its entity are one thing; deleting either
   drops the other and its links (SPEC §6 delete/edit sync).
4. **Version the schema.** This file's version travels with `case.json`; a bump
   ships a migration. Do the formalisation now, while the corpus is tiny.
