"""An analyzer as a file, so one analyst can hand it to another.

A recipe is the one piece of app-wide work that means the same thing on every
machine: its rules read Sentinel bands, its checks name Copernicus passes by
date, and nothing in it points at this workspace. The only way to pass one on
today is the settings backup, which carries the user's API keys — so sharing an
analyzer means sharing secrets. This is the file that doesn't.

How a shared file is read matters. It is history another build wrote, not a
request: unknown fields are dropped (`stored`) instead of refusing the file, and
the legacy readers in `analysis_models` migrate an older shape on the way in.
Only the envelope carries a version, and only a change to the envelope's own
shape would raise it.
"""

from __future__ import annotations

import re
from typing import Any

from .. import __version__
from . import sentinel
from .analysis_models import Check, Recipe, Rule, Source

#: What a shared analyzer file says it is, so an import can tell one from a
#: settings backup or a case bundle and say which it was handed.
KIND = "azimut-analyzer"

#: The envelope's shape, not the recipe's. The recipe inside is versionless by
#: design — it is read as history, which is what lets two analysts on two builds
#: trade analyzers at all.
VERSION = 1


def envelope(recipe: Recipe, *, checks: bool = True) -> dict[str, Any]:
    """The analyzer as it leaves this machine.

    A check's `result` stays behind: it was read on this machine's images, and
    the analyzer should arrive having proved nothing here yet. The receiving
    analyst presses Test and earns the ticks.

    The checks themselves travel unless the caller drops them, since rerunning
    the calibration is the point of sharing a rule set — but they carry
    coordinates, which is why it is a choice and not a default nobody sees.
    """
    kept = [check.model_copy(update={"result": None}) for check in recipe.checks] if checks else []
    return {
        "azimut": KIND,
        "version": VERSION,
        # Which build wrote it, so an import can say it was handed something
        # newer than it reads rather than quietly narrowing the analyzer.
        "app": __version__,
        "recipe": recipe.model_copy(update={"checks": kept}).model_dump(),
    }


def filename(recipe: Recipe) -> str:
    """A download name taken from the analyzer's own, safe as a header value."""
    slug = re.sub(r"[^a-z0-9]+", "-", recipe.name.lower()).strip("-")[:60]
    return f"azimut-analyzer-{slug or recipe.id}.json"


def unknown_fields(raw: Any) -> list[str]:
    """Field names in a shared file that this version does not know.

    `stored` drops them in silence, which is right for the app's own history and
    wrong for a file from another machine: a rule field a newer build added
    changes what the analyzer finds, and the analyst has to hear it was left
    out rather than wonder why the results differ from the sender's.
    """
    if not isinstance(raw, dict):
        return []
    found = set(raw) - set(Recipe.model_fields)
    for rule in raw.get("rules") or []:
        if isinstance(rule, dict):
            found |= set(rule) - set(Rule.model_fields)
    for check in raw.get("checks") or []:
        if not isinstance(check, dict):
            continue
        found |= set(check) - set(Check.model_fields)
        for side in ("a", "b"):
            if isinstance(source := check.get(side), dict):
                found |= set(source) - set(Source.model_fields)
    return sorted(found)


def for_this_machine(recipe: Recipe, settings: dict[str, Any]) -> Recipe:
    """The analyzer retuned to what this configuration serves.

    A Sentinel-1 layer is named by the instance it was found on, and two
    configurations rarely name it alike, so a radar check that kept the sender's
    name would read nothing here. The pass it names — the date and the time of
    day that pick one look out of two — is what the check is actually about, and
    that travels untouched.
    """
    radar = str(settings.get("sentinel1_layer") or "")
    if not radar or recipe.sensor != "sentinel1":
        return recipe
    checks = [
        check.model_copy(update={
            side: source.model_copy(update={"layer": radar})
            for side in ("a", "b")
            if (source := getattr(check, side)).provider == "sentinel1"
        })
        for check in recipe.checks
    ]
    return recipe.model_copy(update={"checks": checks})


def missing_layers(recipe: Recipe, settings: dict[str, Any]) -> list[str]:
    """Copernicus layers this analyzer's checks read and this machine lacks.

    A standard layer is taken as served: `sentinel.LAYERS` is a fallback list
    rather than the instance's full catalogue, so flagging everything outside it
    would cry wolf over layers that work. What really fails to travel is a layer
    the sender wrote themselves, and that is what is left once the known ones go.

    Radar is left out — its layer is retuned to this machine by
    `for_this_machine`, and a configuration with no radar layer at all is
    already told so by the analyzer's own lock.
    """
    known = {layer.id for layer in sentinel.LAYERS} | set(sentinel.KNOWN_HINTS)
    mine = {layer["id"] for layer in sentinel.custom_layers(settings)}
    used = {
        source.layer
        for check in recipe.checks
        for source in (check.a, check.b)
        if source.layer and source.provider != "sentinel1"
    }
    return sorted(used - known - mine)


def free_name(name: str, taken: set[str]) -> str:
    """A name the library doesn't already hold: "Fresh burn", then "Fresh burn 2".

    Importing the same analyzer twice gives two rows rather than overwriting the
    first, so the copies have to be told apart on sight.
    """
    next_name = name
    count = 2
    while next_name in taken:
        next_name = f"{name} {count}"
        count += 1
    return next_name
