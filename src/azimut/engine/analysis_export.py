"""On-demand snapshots of reviewed detections into a case's map layers."""

from __future__ import annotations

import colorsys
import json
from typing import Any

from .. import layout
from ..workspace import Case
from . import analyzers, maplayers
from .analysis_models import is_single


def export(case: Case, kind: str, ident: str) -> dict[str, Any]:
    with analyzers.LOCK, case._lock:
        item = analyzers.read(case, kind, ident)
        routine = ident if kind == "followups" else item["input"].get("followup_id")
        key = f"followups-{routine}" if routine else f"runs-{ident}"
        existing = next((row for row in maplayers.listing(case)
                         if row["source"].get("detection_key") == key), None)
        document: dict[str, Any] = {"type": "FeatureCollection", "azimut_detect_layer": 1,
                                    "name": item["title"], "features": []}
        if existing:
            document = json.loads(case.resolve_inside(layout.layer_snapshot_rel(existing["name"])).read_bytes())
        if kind == "followups":
            runs = [analyzers.read(case, "runs", row["id"]) for row in reversed(analyzers.listing(case, "runs"))
                    if row.get("followup_id") == ident and row.get("status") == "ready"]
        else:
            if item.get("status") != "ready":
                raise ValueError("finish the run before exporting it")
            runs = [item]
        for run in runs:
            pairs = run.get("area_runs") or [{"status": "ready", "b": run["input"]["b"]}]
            dates = {p["b"]["date"] for p in pairs if p["status"] == "ready"}
            document["features"] = [f for f in document["features"] if f["properties"]["pass_date"] not in dates]
            recipe = run["input"]["recipe"]
            for row in run["results"]:
                if row["review"] not in analyzers.KEPT:
                    continue
                passes = row.get("sources", run["input"])
                day = passes["b"]["date"]
                geometry = row.get("pinned_geometry") or (row["geometry"] if row.get("origin") == "manual" else (
                    {"type": "Point", "coordinates": row["coordinates"]}
                    if is_single(recipe) else row["geometry"]))
                properties = {
                    "name": row.get("title") or row["phenomenon"], "description": row.get("description", ""),
                    "category": day, "pass_date": day, "detector": recipe["name"],
                    "area_name": row.get("area_name", ""), "run_id": run["id"],
                }
                # A change happened somewhere between the passes, so the layer's
                # time filter reads it as that span; a radar pass names its time.
                if not is_single(recipe) and passes["a"].get("date"):
                    properties["pass_before"] = passes["a"]["date"]
                if passes["b"].get("time"):
                    properties["pass_time"] = passes["b"]["time"]
                document["features"].append({"type": "Feature", "geometry": geometry, "properties": properties})
        days = sorted({f["properties"]["pass_date"] for f in document["features"]})
        for feature in document["features"]:
            rank = days.index(feature["properties"]["pass_date"])
            lightness = .78 - .48 * rank / max(1, len(days) - 1)
            rgb = colorsys.hls_to_rgb(210 / 360, lightness, .70)
            colour = "#" + "".join(f"{round(channel * 255):02x}" for channel in rgb)
            feature["properties"].update({"marker-color": colour, "stroke": colour, "fill": colour})
        return maplayers.save_detection_snapshot(case, key, document["name"], document)
