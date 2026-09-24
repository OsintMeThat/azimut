"""Ready analyzers of your own, each with the checks that show it working.

A new analyzer can start from one of these. Starting copies it into the
analyst's library, checks included, so the first thing they can do is run the
checks, see them pass, change a rule and watch one fail. Every example keeps
places where nothing may be found, and most of them are traps: ground that one
of its rules is there to turn away, so removing that rule turns the check red.

Every pass, mark and line here was read on the real scenes (2026-09-24), from
Sentinel-2 Level-2A laid out as Detect's band evalscript returns it, through
this engine's own `detect_rules.check`, then every check was run again through
Copernicus itself, which is what an analyst's run reads. Marks sit at least 64
pixels inside the grid tile they fall in, since a check reads each mark on its
own tile.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .analysis_models import SIZES, Check, Parameters, Recipe, Rule

Point = tuple[float, float]


@dataclass(frozen=True)
class Example:
    id: str
    place: str
    when: str
    recipe: Recipe


def _checks(a: str, b: str, layer: str,
            *rows: tuple[str, str, tuple[float, float, float, float], list[Point], list[Point]]) -> list[Check]:
    """One pair of passes, shown in `layer`, and the places read on it."""
    return [Check.model_validate({
        "id": ident, "name": name,
        "a": {"date": a, "layer": layer} if a else {}, "b": {"date": b, "layer": layer},
        "bounds": dict(zip(("west", "south", "east", "north"), bounds)),
        "marks": [{"point": point, "expect": "found"} for point in found]
        + [{"point": point, "expect": "empty"} for point in empty],
    }) for ident, name, bounds, found, empty in rows]


def _example(ident: str, place: str, when: str, size: str, **fields: Any) -> Example:
    parameters = Parameters.model_validate(SIZES["rules"][size])
    return Example(ident, place, when, Recipe(method="rules", parameters=parameters, **fields))


EXAMPLES: list[Example] = [
    # The Lahaina fire of 8 August 2023. A is that morning's pass, before the
    # town burned. Without the second rule a cloud the mask missed reads as a
    # burn; without the third the surf on the reef does. That rule reads near
    # infrared rather than the scene classification, which Copernicus left
    # unclassified under the surf that morning.
    _example(
        "burn", "Lahaina, Maui", "August 2023", "medium",
        name="Fresh burn", phenomenon="Fresh burn", colour="#ef4444",
        description="The burn ratio dropped and ended low, on ground brighter than water in "
        "near infrared. A field harvested between the passes can look the same.",
        rules=[Rule(measure="index", index="nbr", on="change", op="le", value=-0.2),
               Rule(measure="index", index="nbr", on="b", op="le", value=0.1),
               Rule(measure="band", band="B08", on="b", op="ge", value=0.04)],
        checks=_checks(
            "2023-08-08", "2023-08-13", "SWIR",
            ("town", "The town and hills that burned", (-156.68747, 20.86409, -156.66278, 20.90174),
             [(-156.67478, 20.87209), (-156.67547, 20.89374)], []),
            ("spared", "Homes and dry grass that did not", (-156.66095, 20.85149, -156.63523, 20.88217),
             [], [(-156.64723, 20.87417), (-156.64895, 20.85949)]),
            ("reef", "The reef off the town", (-156.6873, 20.85703, -156.6633, 20.87303),
             [], [(-156.6753, 20.86503)]),
            ("cloud", "A cloud the mask missed", (-156.64644, 20.88862, -156.62244, 20.90462),
             [], [(-156.63444, 20.89662)]),
        )),
    # The pine forest cleared for the Grünheide factory in early 2020. Mown
    # meadows lose as much green; the short-wave rule is what keeps them out.
    _example(
        "clearing", "Grünheide, Germany", "2019 → 2020", "medium",
        name="Forest cleared", phenomenon="Cleared forest", colour="#84cc16",
        description="Green cover lost from ground that was forest: dense, and dark in short-wave "
        "infrared, which meadows and crops are not.",
        rules=[Rule(measure="index", index="ndvi", on="change", op="le", value=-0.3),
               Rule(measure="index", index="ndvi", on="a", op="ge", value=0.6),
               Rule(measure="band", band="B11", on="a", op="le", value=0.2)],
        checks=_checks(
            "2019-07-26", "2020-08-01", "NDVI",
            ("site", "The factory site, cleared", (13.78069, 52.38559, 13.80538, 52.40374),
             [(13.79269, 52.39574), (13.79235, 52.39359)], []),
            ("forest", "Pine forest still standing", (13.73383, 52.37376, 13.75783, 52.38976),
             [], [(13.74583, 52.38176)]),
            ("meadows", "Meadows mown between the passes", (13.72499, 52.38203, 13.77723, 52.41856),
             [], [(13.76523, 52.39003), (13.73699, 52.41056)]),
        )),
    # The Kakhovka reservoir after the dam broke on 6 June 2023. Water that
    # only cleared reads higher, not lower: "moved either way" flags the river
    # and the cooling pond.
    _example(
        "drained", "Kakhovka reservoir, Ukraine", "June 2023", "medium",
        name="Water drained", phenomenon="Drained water", colour="#0ea5e9",
        description="Open water on A that turned to land by B, in the modified water index. "
        "Water that only cleared or clouded keeps its reading.",
        rules=[Rule(measure="index", index="mndwi", on="change", op="le", value=-0.3),
               Rule(measure="index", index="mndwi", on="a", op="ge", value=0.2)],
        checks=_checks(
            "2023-06-05", "2023-06-20", "FALSE_COLOR",
            ("bed", "The reservoir bed, exposed", (34.44845, 47.51769, 34.48845, 47.56371),
             [(34.46845, 47.55171), (34.46845, 47.52969)], []),
            ("river", "The river channel, still water", (34.41497, 47.55378, 34.45497, 47.57778),
             [], [(34.43497, 47.56578)]),
            ("pond", "The power plant cooling pond", (34.51557, 47.50111, 34.55557, 47.52511),
             [], [(34.53454, 47.51311)]),
        )),
    # Panel fields laid in the Dubai desert between 2019 and 2023. Dunes the
    # wind moved change their shading, never their short-wave brightness; a
    # rule on B alone would flag the fields that were already there.
    _example(
        "solar", "Dubai, United Arab Emirates", "2019 → 2023", "medium",
        name="Solar farm built", phenomenon="New solar panels", colour="#a78bfa",
        description="Desert that turned darker and ends dark in short-wave infrared, as panels do "
        "and sand does not.",
        rules=[Rule(measure="brightness", on="change", op="le", value=-0.08),
               Rule(measure="band", band="B12", on="b", op="le", value=0.35)],
        checks=_checks(
            "2019-02-08", "2023-02-07", "TRUE_COLOR",
            ("panels", "New panel fields", (55.38901, 24.69238, 55.41935, 24.73338),
             [(55.40435, 24.72138), (55.40401, 24.70438)], []),
            ("old", "Panels already there on A", (55.36832, 24.74976, 55.39832, 24.77376),
             [], [(55.38332, 24.76176)]),
            ("dunes", "Dunes the wind moved", (55.32893, 24.64411, 55.35893, 24.66811),
             [], [(55.34393, 24.65611)]),
        )),
    # The anchorage off Fujairah, on one pass. Near infrared alone takes the
    # whole town as brighter than its ground; the water index against the
    # surroundings keeps what floats. Large is too big a size for a hull.
    _example(
        "ships", "Fujairah, United Arab Emirates", "one pass, January 2024", "small",
        name="Ships at anchor", phenomenon="Vessel candidate", colour="#38bdf8",
        description="Brighter in near infrared than the water around it, and far less watery than it. "
        "Breakwaters and piers read like hulls.",
        rules=[Rule(measure="band", band="B08", on="b", op="ge", value=0.04, around=150),
               Rule(measure="index", index="mndwi", on="b", op="le", value=-0.4, around=150)],
        checks=_checks(
            "", "2024-01-23", "TRUE_COLOR",
            ("ships", "Ships at anchor", (56.55259, 25.13071, 56.59311, 25.18666),
             [(56.57259, 25.17166), (56.57311, 25.14571)], []),
            ("town", "Fujairah town, on land", (56.32643, 25.1332, 56.36643, 25.1632),
             [], [(56.34643, 25.1482)]),
            ("water", "Open water", (56.51818, 25.13242, 56.55818, 25.16242),
             [], [(56.53818, 25.14742)]),
        )),
]


def catalogue() -> list[dict[str, Any]]:
    """The examples as the builder offers them."""
    return [{"id": example.id, "place": example.place, "when": example.when,
             "recipe": example.recipe.model_dump()} for example in EXAMPLES]
