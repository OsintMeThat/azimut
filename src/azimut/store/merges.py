"""The database half of a merge, and of its undo (`engine/merge.py` holds the rules).

One merge is one transaction over every table that names an entity by id: links,
photos, graph positions, saved live views, the redirect that keeps the absorbed id
answering, and the record that undoes it all. A preview runs the same code and
rolls it back, so what the dialog shows is what the merge writes.

Nothing on disk is touched here. A sheet's sidecar is the one file that holds ids,
and `engine/sheets.py` rewrites it once this has committed.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from typing import Any

from ..engine import links as link_engine
from ..engine import entities as entity_engine
from ..workspace import CaseError

#: The verbs that must not close on themselves (`links._check_relation_cycle`).
CYCLE_TYPES = (link_engine.PART_OF, link_engine.IN_NETWORK, link_engine.CITES)

EntityRow = Callable[[sqlite3.Row], dict[str, Any]]
LinkRow = Callable[[sqlite3.Row], dict[str, Any]]
SyncTemporal = Callable[[sqlite3.Connection, dict[str, Any]], None]
SearchText = Callable[[str, str, dict[str, Any]], str]
FolderOf = Callable[[dict[str, Any]], str | None]


class DryRun(Exception):  # noqa: N818 - control flow, not an error
    """Raised at the end of a previewed merge, to roll it back with its report."""

    def __init__(self, report: dict[str, Any]) -> None:
        super().__init__("preview")
        self.report = report


def repoint_row_id(value: str, old: str, new: str) -> str:
    """A timeline row id (`temporal:<kind>:<owner>[:…]`) moved to another owner.

    By its parts, never by substring: an id that merely contains the old one is a
    different row.
    """
    parts = value.split(":")
    if len(parts) >= 3 and parts[0] == "temporal" and parts[2] == old:
        parts[2] = new
        return ":".join(parts)
    return value


def _moved_list(values: Any, old: str, new: str, *, rows: bool = False) -> tuple[Any, bool]:
    if not isinstance(values, list):
        return values, False
    out: list[Any] = []
    changed = False
    for value in values:
        if not isinstance(value, str):
            out.append(value)
            continue
        moved = repoint_row_id(value, old, new) if rows else (new if value == old else value)
        changed = changed or moved != value
        if moved not in out:
            out.append(moved)
    return out, changed


def rewrite_view_spec(spec: dict[str, Any], old: str, new: str, label: str = "") -> tuple[dict[str, Any], bool]:
    """A live view's recipe with the absorbed id moved onto the survivor.

    What a live view names by id: the entity a Timeline is scoped to, the rows its
    tracks pin or hide, and the nodes a Graph leaves out, folds or has placed. A
    snapshot is never passed here: a frozen reading stays what it was.
    """
    out = json.loads(json.dumps(spec))
    changed = False
    timeline = out.get("timeline") if isinstance(out.get("timeline"), dict) else None
    if timeline:
        scope = timeline.get("entity")
        if isinstance(scope, dict) and scope.get("id") == old:
            scope["id"] = new
            if label:
                scope["label"] = label
            changed = True
        for track in timeline.get("tracks") or []:
            if not isinstance(track, dict):
                continue
            for key in ("hidden", "pinned"):
                if key not in track:
                    continue
                track[key], moved = _moved_list(track.get(key), old, new, rows=True)
                changed = changed or moved
    graph = out.get("graph") if isinstance(out.get("graph"), dict) else None
    if graph:
        if graph.get("root") == old:
            graph["root"] = new
            changed = True
        for key in ("omitted", "collapsed", "kept", "expanded"):
            if key not in graph:
                continue
            graph[key], moved = _moved_list(graph.get(key), old, new)
            changed = changed or moved
        put_away = graph.get("putAway")
        if isinstance(put_away, dict):
            rewritten: dict[str, list[Any]] = {}
            for owner, ids in put_away.items():
                key = new if owner == old else owner
                values, moved = _moved_list(ids, old, new)
                changed = changed or moved or key != owner
                rewritten[key] = list(dict.fromkeys([*rewritten.get(key, []), *values]))
            graph["putAway"] = rewritten
        arrangement = graph.get("arrangement")
        if isinstance(arrangement, list):
            placed = {item.get("id") for item in arrangement if isinstance(item, dict)}
            kept: list[Any] = []
            for item in arrangement:
                if isinstance(item, dict) and item.get("id") == old:
                    changed = True
                    if new in placed:
                        continue  # the survivor's own position wins
                    item = {**item, "id": new}
                kept.append(item)
            graph["arrangement"] = kept
    return out, changed


def _reaches(conn: sqlite3.Connection, start: str, target: str, type_: str) -> bool:
    """Whether `start` leads to `target` along links of one type."""
    frontier = [start]
    seen: set[str] = set()
    while frontier:
        current = frontier.pop()
        if current == target:
            return True
        if current in seen:
            continue
        seen.add(current)
        frontier.extend(
            row["to_id"] for row in conn.execute(
                "SELECT to_id FROM links WHERE from_id = ? AND type = ?", (current, type_)
            )
        )
    return False


def merge_rows(
    conn: sqlite3.Connection,
    *,
    survivor_id: str,
    merged_id: str,
    survivor_attrs: dict[str, Any],
    survivor_status: str,
    old_key: str | None,
    merge_id: str,
    by: str,
    at: str,
    entity_row: EntityRow,
    link_row: LinkRow,
    sync_temporal: SyncTemporal,
    search_text: SearchText,
    folder_of: FolderOf,
) -> dict[str, Any]:
    """Fold `merged_id` into `survivor_id`, recording how to take it back out."""
    survivor_row = conn.execute("SELECT * FROM entities WHERE id = ?", (survivor_id,)).fetchone()
    merged_row = conn.execute("SELECT * FROM entities WHERE id = ?", (merged_id,)).fetchone()
    if survivor_row is None or merged_row is None:
        raise CaseError("both entities have to be in the case")
    survivor = entity_row(survivor_row)
    merged = entity_row(merged_row)
    entry = entity_engine.entity_type(survivor["type"])
    if survivor_id == merged_id or survivor["type"] != merged["type"] or entry is None or entry.family not in {"actor", "asset", "class", "identifier", "place"}:
        raise CaseError("only two different subjects of the same type can merge")

    moved: list[dict[str, Any]] = []
    loops: list[dict[str, Any]] = []
    twins: list[dict[str, Any]] = []
    refused: list[dict[str, Any]] = []
    for row in conn.execute(
        "SELECT * FROM links WHERE from_id = ? OR to_id = ? ORDER BY rowid", (merged_id, merged_id)
    ).fetchall():
        start = survivor_id if row["from_id"] == merged_id else row["from_id"]
        end = survivor_id if row["to_id"] == merged_id else row["to_id"]
        link = link_row(row)
        spec = link_engine.relation_type(row["type"])
        if spec is not None:
            source = entity_row(conn.execute("SELECT * FROM entities WHERE id = ?", (start,)).fetchone())
            target = entity_row(conn.execute("SELECT * FROM entities WHERE id = ?", (end,)).fetchone())
            if source["type"] not in spec.from_types or target["type"] not in spec.to_types:
                refused.append({**link, "reason": "incompatible endpoints"})
                continue
        elif row["type"] not in link_engine.CHAIN_TYPES:
            refused.append({**link, "reason": "unknown relation"})
            continue
        if start == end:
            loops.append(link)
        elif conn.execute(
            "SELECT 1 FROM links WHERE from_id = ? AND to_id = ? AND type = ? AND id != ?"
            " AND confidence IS ? AND nature IS ? AND prov_status = ? AND prov_by = ? AND prov_source IS ?",
            (start, end, row["type"], row["id"], row["confidence"], row["nature"], row["prov_status"], row["prov_by"], row["prov_source"]),
        ).fetchone() is not None:
            twins.append(link)
        elif row["type"] in CYCLE_TYPES and _reaches(conn, end, start, row["type"]):
            refused.append({**link, "reason": "would create a cycle"})
            continue
        else:
            conn.execute(
                "UPDATE links SET from_id = ?, to_id = ? WHERE id = ?", (start, end, row["id"])
            )
            moved.append({"id": row["id"], "from": row["from_id"], "to": row["to_id"], "type": row["type"]})
            continue
        conn.execute("DELETE FROM links WHERE id = ?", (row["id"],))

    if refused:
        raise DryRun({"blocked": True, "refused": refused, "links": {"moved": len(moved), "twins": len(twins), "loops": len(loops), "refused": len(refused)}, "images": {}, "pins": {}, "views": []})

    held_media = {
        row["media_id"] for row in conn.execute(
            "SELECT media_id FROM entity_images WHERE entity_id = ? AND media_id IS NOT NULL",
            (survivor_id,),
        )
    }
    has_primary = conn.execute(
        "SELECT 1 FROM entity_images WHERE entity_id = ? AND is_primary = 1", (survivor_id,)
    ).fetchone() is not None
    position = int(conn.execute(
        "SELECT COALESCE(MAX(position), -1) FROM entity_images WHERE entity_id = ?", (survivor_id,)
    ).fetchone()[0]) + 1
    images_moved: list[dict[str, Any]] = []
    images_dropped: list[dict[str, Any]] = []
    for row in conn.execute(
        "SELECT * FROM entity_images WHERE entity_id = ? ORDER BY position, image_id", (merged_id,)
    ).fetchall():
        if row["media_id"] is not None and row["media_id"] in held_media:
            images_dropped.append(dict(row))
            continue  # the same picture twice; the entity's delete takes this row
        primary = bool(row["is_primary"]) and not has_primary
        has_primary = has_primary or primary
        conn.execute(
            "UPDATE entity_images SET entity_id = ?, position = ?, is_primary = ?"
            " WHERE entity_id = ? AND image_id = ?",
            (survivor_id, position, int(primary), merged_id, row["image_id"]),
        )
        images_moved.append({
            "image_id": row["image_id"], "position": row["position"],
            "is_primary": bool(row["is_primary"]), "primary_here": primary,
        })
        position += 1

    pins: list[dict[str, Any]] = []
    for row in conn.execute("SELECT * FROM graph_pins WHERE entity_id = ?", (merged_id,)).fetchall():
        taken = conn.execute(
            "SELECT 1 FROM graph_pins WHERE entity_id = ? AND lens = ?", (survivor_id, row["lens"])
        ).fetchone() is not None
        if not taken:
            conn.execute(
                "UPDATE graph_pins SET entity_id = ? WHERE entity_id = ? AND lens = ?",
                (survivor_id, merged_id, row["lens"]),
            )
        pins.append({"lens": row["lens"], "x": row["x"], "y": row["y"], "moved": not taken})

    views: list[dict[str, Any]] = []
    for row in conn.execute(
        "SELECT id, name, spec_json FROM analysis_views WHERE mode = 'live' ORDER BY id"
    ).fetchall():
        before = json.loads(row["spec_json"])
        after, changed = rewrite_view_spec(before, merged_id, survivor_id, survivor["label"])
        if changed:
            conn.execute(
                "UPDATE analysis_views SET spec_json = ? WHERE id = ?",
                (json.dumps(after, ensure_ascii=False), row["id"]),
            )
            views.append({"id": row["id"], "name": row["name"], "before": before, "after": after})

    survivor_after = {
        **survivor,
        "attrs": survivor_attrs,
        "provenance": {**survivor["provenance"], "status": survivor_status},
    }
    conn.execute(
        "UPDATE entities SET attrs_json = ?, folder = ?, search_text = ?, prov_status = ?"
        " WHERE id = ?",
        (
            json.dumps(survivor_attrs, ensure_ascii=False),
            folder_of(survivor_attrs),
            search_text(survivor["type"], survivor["label"], survivor_attrs),
            survivor_status,
            survivor_id,
        ),
    )
    sync_temporal(conn, survivor_after)
    conn.execute("DELETE FROM links WHERE from_id = ? OR to_id = ?", (merged_id, merged_id))
    conn.execute("DELETE FROM entities WHERE id = ?", (merged_id,))

    compressed = [
        row["old_id"] for row in conn.execute(
            "SELECT old_id FROM entity_redirects WHERE new_id = ?", (merged_id,)
        )
    ]
    conn.execute("UPDATE entity_redirects SET new_id = ? WHERE new_id = ?", (survivor_id, merged_id))
    conn.execute(
        "INSERT OR REPLACE INTO entity_redirects(old_id, new_id, old_label, old_key, merge_id, at)"
        " VALUES(?, ?, ?, ?, ?, ?)",
        (merged_id, survivor_id, merged["label"], old_key, merge_id, at),
    )

    payload = {
        "merged": merged,
        "links_moved": moved,
        "links_dropped": [
            *({"reason": "loop", "link": link} for link in loops),
            *({"reason": "twin", "link": link} for link in twins),
        ],
        "images_moved": images_moved,
        "images_dropped": images_dropped,
        "pins": pins,
        "views": views,
        "survivor_before": {"attrs": survivor["attrs"], "status": survivor["provenance"]["status"]},
        "survivor_after": {"attrs": survivor_attrs, "status": survivor_status},
        "compressed": compressed,
        "sheets": [],
    }
    conn.execute(
        "INSERT INTO entity_merges(id, survivor_id, merged_id, merged_label, at, by, payload_json)"
        " VALUES(?, ?, ?, ?, ?, ?, ?)",
        (merge_id, survivor_id, merged_id, merged["label"], at, by, json.dumps(payload, ensure_ascii=False)),
    )
    return {
        "merge": merge_id,
        "survivor": survivor_after,
        "merged": merged,
        "links": {"moved": len(moved), "twins": len(twins), "loops": len(loops), "refused": len(refused)},
        "refused": [link for link in refused],
        "images": {"moved": len(images_moved), "twins": len(images_dropped)},
        "pins": {"moved": sum(1 for pin in pins if pin["moved"]), "kept": sum(1 for pin in pins if not pin["moved"])},
        "views": [view["name"] for view in views],
    }


def unmerge_rows(
    conn: sqlite3.Connection,
    merge_id: str,
    *,
    entity_row: EntityRow,
    sync_temporal: SyncTemporal,
    search_text: SearchText,
    folder_of: FolderOf,
    ensure_primary: Callable[[sqlite3.Connection, str], bool],
) -> dict[str, Any]:
    """Take one merge back out, as far as the case still allows, saying what could not."""
    record = conn.execute("SELECT * FROM entity_merges WHERE id = ?", (merge_id,)).fetchone()
    if record is None:
        raise CaseError(f"merge '{merge_id}' not found")
    payload = json.loads(record["payload_json"])
    if payload.get("undo_result"):
        return payload["undo_result"]
    if conn.execute("SELECT 1 FROM entity_merges WHERE rowid > ? AND (survivor_id IN (?, ?) OR merged_id IN (?, ?))", (conn.execute("SELECT rowid FROM entity_merges WHERE id = ?", (merge_id,)).fetchone()[0], record["survivor_id"], record["merged_id"], record["survivor_id"], record["merged_id"])).fetchone():
        raise CaseError("undo the later merge involving this subject first")
    survivor_id = record["survivor_id"]
    merged = payload["merged"]
    merged_id = merged["id"]
    survivor_row = conn.execute("SELECT * FROM entities WHERE id = ?", (survivor_id,)).fetchone()
    if survivor_row is None:
        raise CaseError("the surviving entity is unavailable; restore it or undo its later merge first")
    if conn.execute("SELECT 1 FROM entities WHERE id = ?", (merged_id,)).fetchone() is not None:
        raise CaseError(f"an entity already holds the id '{merged_id}'")
    survivor = entity_row(survivor_row)
    lost: list[str] = []

    attrs = merged.get("attrs") or {}
    prov = merged.get("provenance") or {}
    conn.execute(
        "INSERT INTO entities(id, type, label, attrs_json, folder, search_text,"
        " prov_by, prov_at, prov_status, prov_source) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            merged_id, merged["type"], merged["label"], json.dumps(attrs, ensure_ascii=False),
            folder_of(attrs), search_text(merged["type"], merged["label"], attrs),
            prov.get("by", "user"), prov.get("at", record["at"]), prov.get("status", "confirmed"),
            prov.get("source"),
        ),
    )
    sync_temporal(conn, merged)

    for move in payload.get("links_moved") or []:
        start = survivor_id if move["from"] == merged_id else move["from"]
        end = survivor_id if move["to"] == merged_id else move["to"]
        row = conn.execute("SELECT * FROM links WHERE id = ?", (move["id"],)).fetchone()
        if row is None or (row["from_id"], row["to_id"]) != (start, end):
            lost.append(f"a '{move['type']}' relation moved in the merge was changed or removed since")
            continue
        if row["type"] != move["type"] or not valid_restored_link(conn, move["from"], move["to"], row["type"]):
            lost.append(f"a '{move['type']}' relation no longer fits its original endpoints")
            continue
        conn.execute(
            "UPDATE links SET from_id = ?, to_id = ? WHERE id = ?", (move["from"], move["to"], move["id"])
        )
    present = {row["id"] for row in conn.execute("SELECT id FROM entities")}
    for dropped in payload.get("links_dropped") or []:
        link = dropped["link"]
        if link["from"] not in present or link["to"] not in present:
            lost.append(f"a '{link['type']}' relation whose other end is gone")
            continue
        if conn.execute("SELECT 1 FROM links WHERE id = ?", (link["id"],)).fetchone() is not None:
            continue
        if not valid_restored_link(conn, link["from"], link["to"], link["type"]):
            lost.append(f"a '{link['type']}' relation no longer fits the case")
            continue
        link_prov = link.get("provenance") or {}
        conn.execute(
            "INSERT INTO links(id, from_id, to_id, type, prov_by, prov_at, prov_status,"
            " prov_source, confidence, nature) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                link["id"], link["from"], link["to"], link["type"], link_prov.get("by", "user"),
                link_prov.get("at", record["at"]), link_prov.get("status", "confirmed"),
                link_prov.get("source"), link.get("confidence"), link.get("nature"),
            ),
        )

    for image in payload.get("images_moved") or []:
        row = conn.execute(
            "SELECT 1 FROM entity_images WHERE entity_id = ? AND image_id = ?",
            (survivor_id, image["image_id"]),
        ).fetchone()
        if row is None:
            lost.append("a photo moved in the merge was removed since")
            continue
        if image["is_primary"]:
            conn.execute(
                "UPDATE entity_images SET is_primary = 0 WHERE entity_id = ?", (merged_id,)
            )
        conn.execute(
            "UPDATE entity_images SET entity_id = ?, position = ?, is_primary = ?"
            " WHERE entity_id = ? AND image_id = ?",
            (merged_id, image["position"], int(image["is_primary"]), survivor_id, image["image_id"]),
        )
    for image in payload.get("images_dropped") or []:
        if image.get("media_id") not in present:
            lost.append("a photo whose file is no longer in the case")
            continue
        conn.execute(
            "INSERT OR IGNORE INTO entity_images(entity_id, image_id, media_id, path, thumbnail,"
            " title, position, is_primary) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                merged_id, image["image_id"], image["media_id"], image.get("path"),
                image.get("thumbnail"), image.get("title"), image["position"], image["is_primary"],
            ),
        )
    ensure_primary(conn, survivor_id)
    ensure_primary(conn, merged_id)

    for pin in payload.get("pins") or []:
        if pin["moved"]:
            row = conn.execute(
                "SELECT x, y FROM graph_pins WHERE entity_id = ? AND lens = ?", (survivor_id, pin["lens"])
            ).fetchone()
            if row is not None and (row["x"], row["y"]) == (pin["x"], pin["y"]):
                conn.execute(
                    "DELETE FROM graph_pins WHERE entity_id = ? AND lens = ?", (survivor_id, pin["lens"])
                )
        conn.execute(
            "INSERT OR IGNORE INTO graph_pins(entity_id, lens, x, y) VALUES(?, ?, ?, ?)",
            (merged_id, pin["lens"], pin["x"], pin["y"]),
        )

    for view in payload.get("views") or []:
        row = conn.execute("SELECT spec_json FROM analysis_views WHERE id = ?", (view["id"],)).fetchone()
        if row is None:
            lost.append(f"the view “{view['name']}” was removed since")
            continue
        if json.loads(row["spec_json"]) != view["after"]:
            lost.append(f"the view “{view['name']}” was changed since, and keeps the merged entity")
            continue
        conn.execute(
            "UPDATE analysis_views SET spec_json = ? WHERE id = ?",
            (json.dumps(view["before"], ensure_ascii=False), view["id"]),
        )

    before = payload["survivor_before"]
    after = payload["survivor_after"]
    current = dict(survivor["attrs"])
    for key in sorted(set(before["attrs"]) | set(after["attrs"])):
        was, became = before["attrs"].get(key), after["attrs"].get(key)
        if was == became:
            continue
        if current.get(key) != became:
            lost.append(f"“{survivor['label']}” has its '{key}' changed since, and keeps it")
            continue
        if key in before["attrs"]:
            current[key] = was
        else:
            current.pop(key, None)
    status = survivor["provenance"]["status"]
    if before["status"] != after["status"] and status == after["status"]:
        status = before["status"]
    conn.execute(
        "UPDATE entities SET attrs_json = ?, folder = ?, search_text = ?, prov_status = ? WHERE id = ?",
        (
            json.dumps(current, ensure_ascii=False), folder_of(current),
            search_text(survivor["type"], survivor["label"], current), status, survivor_id,
        ),
    )
    sync_temporal(conn, {**survivor, "attrs": current, "provenance": {**survivor["provenance"], "status": status}})

    conn.execute("DELETE FROM entity_redirects WHERE old_id = ?", (merged_id,))
    for old_id in payload.get("compressed") or []:
        conn.execute(
            "UPDATE entity_redirects SET new_id = ? WHERE old_id = ? AND new_id = ?",
            (merged_id, old_id, survivor_id),
        )
    result = {
        "restored": entity_row(conn.execute("SELECT * FROM entities WHERE id = ?", (merged_id,)).fetchone()),
        "survivor": survivor_id,
        "lost": lost,
        "sheets": payload.get("sheets") or [],
    }
    payload["undo_result"] = result
    payload["pending_sheets"] = True
    conn.execute("UPDATE entity_merges SET payload_json = ? WHERE id = ?", (json.dumps(payload, ensure_ascii=False), merge_id))
    return result


def valid_restored_link(conn: sqlite3.Connection, start: str, end: str, type_: str) -> bool:
    source = conn.execute("SELECT type FROM entities WHERE id = ?", (start,)).fetchone()
    target = conn.execute("SELECT type FROM entities WHERE id = ?", (end,)).fetchone()
    if source is None or target is None or start == end:
        return False
    spec = link_engine.relation_type(type_)
    if spec and (source["type"] not in spec.from_types or target["type"] not in spec.to_types):
        return False
    return type_ not in CYCLE_TYPES or not _reaches(conn, end, start, type_)
