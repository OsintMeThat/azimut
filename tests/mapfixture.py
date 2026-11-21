"""A map as the engine derives it, drawn by hand: the one fixture the map page's tests share
(`test_notes_maps.py`, `test_notes_webmap.py`, `test_site_publish.py`), so none of them reads
another test file."""

from __future__ import annotations

import base64
import io

from PIL import Image

from azimut.engine import notes_maps

LINE_DAYS = {
    "2026-10-06": [[43.46, 12.79], [43.50, 12.78], [43.55, 12.77]],
    "2026-10-14": [[43.47, 12.75], [43.51, 12.74], [43.55, 12.72]],
}


def fixture_map() -> notes_maps.Derived:
    ground = io.BytesIO()
    Image.new("RGB", (160, 100), (52, 74, 60)).save(ground, "PNG")
    tank = "s-badge-tank-e53935-destroyed"
    card = {"title": "#1", "kicker": "Vehicles", "day": "15 November 2026", "text": "Burned on the road.",
            "source": {"label": "x.com", "url": "https://x.com/desk/status/1"}}
    data = {
        "version": 1, "title": "The line", "view": {"center": [43.5, 12.75], "zoom": 10, "bearing": 0},
        "bounds": [43.40, 12.68, 43.60, 12.82],
        "ground": {"src": "data:image/png;base64," + base64.b64encode(ground.getvalue()).decode(),
                   "bounds": [43.40, 12.68, 43.60, 12.82], "credit": "Imagery: Esri, test", "size": [160, 100]},
        "details": [],
        "days": ["2026-10-06", "2026-10-14", "2026-10-20", "2026-11-15", "2026-11-16"], "day": "2026-11-16",
        "features": [
            {"id": "l0f0", "kind": "line", "coords": [LINE_DAYS["2026-10-06"]], "from": "2026-10-06",
             "until": "2026-10-13", "label": "Forward line", "of": "l0f0", "layer": "Line", "group": "Features",
             "style": {"color": "#1e88e5", "width": 3}, "card": {"title": "Forward line", "day": "6 to 13 October 2026"}},
            {"id": "l0f0s1", "kind": "line", "coords": [LINE_DAYS["2026-10-14"]], "from": "2026-10-14",
             "until": "2026-11-14", "label": "Forward line", "of": "l0f0", "layer": "Line", "group": "Features",
             "style": {"color": "#1e88e5", "width": 3}, "card": {"title": "Forward line", "day": "14 October to 14 November 2026"}},
            {"id": "l1f0", "kind": "point", "coords": [43.495, 12.745], "from": "2026-11-15", "until": None,
             "label": "#1", "of": "l1f0", "layer": "Vehicles", "group": "Destroyed",
             "style": {"color": "#e53935", "icon": tank, "status": "destroyed", "size": 1, "label": True}, "card": card},
            {"id": "l1f1", "kind": "point", "coords": [43.4951, 12.7451], "from": "2026-11-16", "until": None,
             "label": "#2", "of": "l1f1", "layer": "Vehicles", "group": "Destroyed",
             "style": {"color": "#e53935", "icon": tank, "status": "destroyed", "size": 1, "label": True},
             "card": {**card, "title": "#2", "day": "16 November 2026"}},
            {"id": "p0", "kind": "point", "coords": [43.52, 12.72], "from": "2026-10-20", "until": None,
             "label": "Heights, crest", "of": "p0", "layer": "Proofs", "group": "Proofs",
             "style": {"color": notes_maps.PROOF_COLOUR, "icon": "", "width": 2, "size": 1.0, "proof": True},
             "card": {"title": "Heights", "kicker": "Proof", "day": "20 October 2026", "text": "Seen on the heights.",
                      "proof": {"name": "Heights", "figure": "#fig-1"},
                      "verify": [{"label": "Check on Esri Wayback", "url": "https://livingatlas.arcgis.com/wayback/"}]}},
        ],
        "steps": [
            {"id": "p0", "label": "", "text": "Seen on the heights.", "name": "Heights", "day": "2026-10-20",
             "view": {"center": [43.52, 12.72], "zoom": 12, "bearing": 0, "pitch": 0}, "focus": ["p0"]},
            {"id": "s1", "label": "The road", "day": "2026-11-16",
             "view": {"center": [43.495, 12.745], "zoom": 13, "bearing": 0, "pitch": 0}, "focus": []},
        ],
        "credits": ["Imagery: Esri, test"],
    }
    legend = [{"label": "Forward line", "layer": "Line", "kind": "line", "style": {"color": "#1e88e5"}, "count": 1},
              {"label": "Destroyed", "layer": "Vehicles", "kind": "point", "style": data["features"][2]["style"], "count": 2},
              {"label": "Proofs", "layer": "Proofs", "kind": "point", "style": data["features"][4]["style"], "count": 1}]
    return notes_maps.Derived(data=data, legend=legend,
                              icons={tank: {"symbol": "badge-tank", "colour": "#e53935", "status": "destroyed"}})
