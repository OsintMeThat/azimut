"""The entity vocabulary: which types a case may hold, and what each one is.

One registry, read by every surface. A type declares five things: how it reads in
words, which **family** it belongs to, the **role** it plays once the case is drawn,
the icon that stands for it, and the fields an analyst may fill on it.
``GET /api/cases/entity-types`` serves it, so a create form is generated rather than
written per type and no screen keeps its own copy of the vocabulary.

The family is the load-bearing part. Relations start from families and may narrow
an endpoint to explicit types (``engine/links.py``). Broad verbs therefore extend
to a new family member, while type-specific verbs stay deliberately narrow:

``actor``
    A person or organization that can act or hold ownership.

``asset``
    It is owned, it appears in collected material, it sits somewhere. A vehicle, a
    vessel, an aircraft, a building.

``identifier``
    A handle on some system, and **the value is the identity**: two ``email``
    entities holding the same address are a bug, not two objects. This is the one
    family where ONTOLOGY §2's "the label never defines identity" does not hold.

``collected``
    Bytes collected into the case: imported, downloaded, extracted or captured. Not
    named ``imagery``, because ``media_kind`` also answers ``audio`` and ``file`` —
    a PDF dropped into the Media Library is a ``media`` too — and not ``material``,
    which was the first name and said nothing a reader could act on: every family
    holds material of some sort. What unites these is that they were **gathered
    rather than written**, so one of them may turn out to depict a place.

``document``
    It is read rather than gathered — made or merely consulted. A proof, a note, a
    bookmarked URL. Two of its members are also *sources*, and carry how much they
    are worth: see ``RELIABILITY_GRADES``.

``place``
    A point, never a thing. A building is an ``asset`` that *sits at* a place; if
    ``place`` were also a thing, two families would carry geometry and "what is on
    the map" would have two answers.

``class``
    A model or a class of thing, never one particular object: "T-72B3", not the tank
    with turret number 214. It is **not a fact about the world under investigation,
    it is a term the case counts with**, which is why it is not an ``asset``: the
    three verbs an asset takes are all wrong for it — nobody owns a model, a model
    sits nowhere, and letting one *appear in* footage would be a second way of saying
    what a counted statement says better. Its whole vocabulary is being pointed at:
    ``instance-of`` from an object that was actually named, and ``about`` from a
    statement that counts. It lives in the case rather than in the workspace, because
    a closed case folder is complete (SPEC §2) and statistics whose labels live
    elsewhere do not travel.

``claim``
    A statement someone makes about the rest of the graph, carrying its own reasoning
    and its own sources. This is followthemoney's reification: a claim that holds
    values is a node with edges, never an edge with an attribute bag. It is a family
    of its own because its verbs are the inverse of everyone else's — it points *at*
    subjects rather than being pointed at.

Splitting actor from asset is what keeps the layer honest. Held as one "subject"
family, three verbs out of four would have had to narrow themselves back down —
the picker would offer "this car owns this person" — and a family layer where
every verb narrows is decoration. followthemoney draws the same line with
``LegalEntity`` above ``Person`` and ``Company``; STIX draws it between a domain
object and an observable.

Beside its family, a type declares a **role**: what it is for once the case is
*drawn* (``engine/graph.py``). A family says what a thing is and decides its verbs; a
role says whether a picture of the case is about it. The line between the first two
is the one that matters: **the file is a subject, its wrapper is an edge.**

``subject``
    A node. A video has content — it shows a place, it carries a geolocation — and so
    does a person, an account or a statement.

``attestation``
    A wrapper around something the case already holds: a bookmark is a URL, a proof
    is a rendering of media, a capture is a screenshot of a place. Drawn as a node
    today, folded into the edge that carries its provenance later (SPEC §6).

``annex``
    Consulted rather than seen. It hangs off one node and carries no path through
    itself, so it is fetched back rather than drawn by default.

``deliverable``
    What the case produced. Nothing cites a post.

``manual`` was checked first and does not answer this: ``media`` and ``place`` are
not manual and are subjects, ``post`` is not manual and is a deliverable, ``claim``
is manual and is a subject. The two axes are independent.

Adding a type is one entry here and one line in ``artifacts.NO_FILES``: the icon
travels with the entry, so no screen keeps a list of its own. Adding a *family* is
not cheap: its verbs have to be decided. The families are the commitment, the types
are disposable.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from ..workspace import CaseError
from .temporal import TemporalError, parse_temporal

#: The families, in the order a menu should show them.
ACTOR = "actor"
ASSET = "asset"
CLASS = "class"
IDENTIFIER = "identifier"
COLLECTED = "collected"
DOCUMENT = "document"
PLACE = "place"
CLAIM = "claim"

FAMILIES: tuple[str, ...] = (
    ACTOR, ASSET, CLASS, IDENTIFIER, COLLECTED, DOCUMENT, PLACE, CLAIM,
)

#: The roles, in the order a case flows: sources feed statements, statements make
#: outputs. What a type is for once the case is drawn — the axis a graph lens narrows
#: nodes on, where the family decides verbs.
SUBJECT = "subject"
ATTESTATION = "attestation"
ANNEX = "annex"
DELIVERABLE = "deliverable"

ROLES: tuple[str, ...] = (SUBJECT, ATTESTATION, ANNEX, DELIVERABLE)

#: What each family means, in one clause, for the surface that has to explain itself.
#: The families are the load-bearing idea of the vocabulary and the one part an
#: analyst never types, so a menu naming them has to say what they are. Served with
#: the registry for the reason every other reading is: one wording, not one per
#: screen.
FAMILY_READS: dict[str, str] = {
    ACTOR: "a person or organization that can act or hold ownership",
    ASSET: "a thing that is owned, appears in footage or sits somewhere",
    CLASS: "a model the case counts with, rather than one particular object",
    IDENTIFIER: "a handle on a system, where the value is the identity",
    COLLECTED: "bytes gathered into the case rather than written, and one may show a place",
    DOCUMENT: "something read rather than gathered, made or merely consulted",
    PLACE: "a point on the map, never a thing standing on it",
    CLAIM: "a statement about the rest of the case, carrying its own reasoning",
}

#: What an `attrs` field is edited as, and what the validator checks. Presentation
#: only in the sense that everything is stored as written; a kind is added here when
#: a type needs it, never in advance — an editor nothing uses is a screen nobody can
#: reach. `temporal` holds the Claim profile parsed by ``engine.temporal``.
#:
#: `longtext` holds the same value as `text` and is checked by the same rule; what it
#: says is that the field expects sentences. A quoted source and the reasoning behind
#: a claim run to paragraphs, and a one-line box that scrolls sideways at eighty
#: characters is a field nobody fills — the reason those two exist at all.
ATTR_KINDS: tuple[str, ...] = (
    "text", "longtext", "number", "url", "geojson", "choice", "temporal",
)

#: Longest a declared text field may be. Generous: `verbatim` quotes a source and
#: `method` explains a match, and truncating either would defeat the point of
#: keeping them.
MAX_TEXT = 4000
#: A radius wider than this is not a location. Half of Earth's meridian, so any
#: honest "somewhere on this continent" still fits.
MAX_RADIUS_M = 5_000_000
#: Vertices a footprint may hold, summed over its rings. A drawn AOI uses tens; a
#: traced coastline can use thousands; past this it is a payload, not a shape.
MAX_FOOTPRINT_POINTS = 4096
#: How many of a thing one statement may count. High enough for an order of battle
#: or a crowd, low enough that a mistyped field is caught rather than stored.
MAX_COUNT = 1_000_000

#: Radius shortcuts, coarsest reading last. These exist because metres are the
#: right thing to store and the wrong thing to ask for: an analyst knows "this
#: block", not "100 m". Deriving them from Plus Code lengths instead would leave a
#: hole — the valid lengths jump from 8 (~280 m cells) straight to 6 (~5.6 km),
#: which is exactly the band a live geolocation lives in. So the rungs are the
#: input and any Plus Code shown is derived from them, never the other way round.
PRECISION_RUNGS: tuple[tuple[str, int], ...] = (
    ("This building", 25),
    ("This block", 100),
    ("This neighbourhood", 500),
    ("This town", 2_000),
    ("This region", 10_000),
)

#: How much a source is worth, on the Admiralty/NATO letter scale — and it is a
#: field of the *source*, never of the edge that cites it. The scheme exists to keep
#: two axes apart: distrust of a source must not contaminate what it said, and an
#: implausible claim from a reliable source stays implausible. Storing reliability on
#: the entity and credibility on the link (``links.confidence``) makes combining them
#: impossible rather than merely discouraged: they are not on the same object.
#:
#: The letters are the analyst's vocabulary, so they are what is stored. **F —
#: "cannot be judged" — is deliberately left out**: an absent grade already says it,
#: and a scale that spells one state twice is a scale nobody answers the same way
#: twice. Same rule as the confidence ordinal, where "not assessed" is the lack of a
#: value rather than a level.
RELIABILITY_GRADES: tuple[tuple[str, str], ...] = (
    ("A", "Completely reliable"),
    ("B", "Usually reliable"),
    ("C", "Fairly reliable"),
    ("D", "Not usually reliable"),
    ("E", "Unreliable"),
)

#: What state a thing is in, on the one scale two very different fields share.
#:
#: It sits on an ``asset``, where it is the **last known state** and a later
#: observation overwrites it, and on a ``claim``, where it is the state **at the
#: moment that statement describes**. Same word, two speakers — the pattern
#: ``notes``/``verbatim``/``method`` already follows — and deliberately the same list,
#: because a count that groups by condition has to reach both.
#:
#: **"Captured" is not here.** Changing hands is a change of owner, which ``owns``
#: already states; folding it in would make the field a mixture of condition and
#: possession, and a mixture does not aggregate. Absent means unknown, the same
#: honest state an ungraded source is in.
ASSET_CONDITIONS: tuple[tuple[str, str], ...] = (
    ("intact", "Intact"),
    ("damaged", "Damaged"),
    ("destroyed", "Destroyed"),
    ("abandoned", "Abandoned"),
)

#: Confidence belongs to a rich statement, not to its ``about``/``at``/``cites``
#: connectors. Strings keep the stored value readable in a case export and avoid
#: coupling entity attributes to the integer representation used by older edge
#: ratings.
CLAIM_CONFIDENCE: tuple[tuple[str, str], ...] = (
    ("certain", "Certain"),
    ("probable", "Probable"),
    ("possible", "Possible"),
    ("refuted", "Ruled out"),
)

#: Which question a Claim's date answers. Kept separate from confidence and source
#: reliability: the same instant can be when a fact happened, when somebody saw it,
#: or when a state held, and treating those as one event would move evidence in time.
CLAIM_TIME_ROLES: tuple[tuple[str, str], ...] = (
    ("occurred", "Occurred"),
    ("observed", "Observed"),
    ("valid", "Valid during"),
)


@dataclass(frozen=True)
class Attr:
    """One field an analyst may fill on an entity of this type.

    Declaring them is what lets one generated form serve every hand-made type.
    Nothing here is required: a type and a label are all an entity ever needs, and
    an empty field means *unknown*, never *to be filled in*.

    ``rungs`` are optional shortcut values for a numeric field, served with the
    registry so the picker and the validator cannot drift apart. ``minimum`` and
    ``maximum`` bound a number; both are served too, so the form refuses what the
    API would refuse rather than finding out on submit.

    ``options`` are the whole of what a ``choice`` field may hold, as
    ``(stored, reading)`` pairs in scale order. Served for the same reason the rungs
    are, and it is what makes the field closed: anything else is refused.

    ``group`` heads this field and the ones after it that share it, which is what
    lets one type hold several subjects: a Claim says *what* it states, *when* it
    applies and *why* it is believed. Running every field under one heading would
    file a count as reasoning. Empty means the field stands on its own label. Fields
    sharing a heading are declared next to each other, since the heading is emitted
    where the group changes rather than by regrouping the list — a form whose fields
    reordered themselves would not be the registry's order any more.
    """

    key: str
    label: str
    kind: str = "text"
    #: One clause saying what the field is for, shown where its label is. Empty
    #: when the label already says it.
    hint: str = ""
    rungs: tuple[tuple[str, int], ...] = ()
    minimum: float | None = None
    maximum: float | None = None
    #: A number with nothing between its values: two and a half destroyed tanks is
    #: not a quantity anyone can defend, the same argument the zero radius makes.
    whole: bool = False
    options: tuple[tuple[str, str], ...] = ()
    group: str = ""
    #: Legacy fields remain readable without staying writable. A write may retain
    #: the exact stored value, but creation and edits cannot introduce a new one.
    editable: bool = True


@dataclass(frozen=True)
class EntityType:
    """One type the vocabulary knows.

    ``manual`` is whether an analyst creates these by hand. A ``media`` is born
    from an import and a ``proof`` from an export, so neither belongs in a create
    menu; a ``person`` exists only because someone typed it.

    ``role`` is what the type is for once the case is drawn (see the module
    docstring). It has no default: a new type has to decide whether a picture of the
    case is about it, and a default would answer that question by omission.

    Headings belong to the fields (``Attr.group``), not here: a place's four fields
    do all answer one question, but a Claim's fields answer three.
    """

    type: str
    label: str
    family: str
    icon: str
    role: str
    #: The field that becomes ``entity.label``. Calling every one "Name" hid the
    #: actual identity field on identifiers: an IP address appeared to have no IP
    #: box even though its value was stored in the label. These two readings let the
    #: generated form name the field without duplicating the value into ``attrs``.
    identity_label: str = "Title"
    identity_placeholder: str = ""
    attrs: tuple[Attr, ...] = ()
    manual: bool = False
    #: One clause saying what this type is, for the menus that offer it. The
    #: vocabulary is deliberately terse — `capture`, `claim`, `collected` — and a
    #: terse word nobody can look up is jargon.
    hint: str = ""
    #: Whether Details offers a photo gallery for this type. Explicit per type:
    #: a future family member has to decide whether a representative image makes
    #: sense rather than inheriting a UI it may not need.
    image_gallery: bool = False


#: The state an asset is in, declared once and shared by the whole family. Written
#: out per type it would drift — a fifth level on one of the four, a different
#: wording on another — and a scale that differs between two rows of the same list
#: is a scale nothing can count over.
_CONDITION = Attr(
    "condition", "Condition",
    hint="the last known state, overwritten by whatever is seen next",
    kind="choice", options=ASSET_CONDITIONS,
)


#: The vocabulary, in menu order. Tool-born types are declared here too: the
#: registry is the single truth for what a family a type sits in, and a relation
#: cannot be validated against a type it has never heard of.
ENTITY_TYPES: tuple[EntityType, ...] = (
    # -- actors ---------------------------------------------------------------
    EntityType(
        "person", "Person", ACTOR, "user", SUBJECT,
        identity_label="Full name", identity_placeholder="Name or known alias",
        attrs=(
            Attr("aliases", "Other names", hint="aliases, spellings or transliterations"),
            Attr("role", "Role", hint="job, rank or public role"),
            Attr("nationality", "Nationality"),
        ),
        manual=True, hint="a named individual", image_gallery=True,
    ),
    EntityType(
        "organization", "Organization", ACTOR, "layers", SUBJECT, manual=True,
        hint="a company, a ministry or a military unit",
        identity_label="Organization name",
        identity_placeholder="Name of the organization", image_gallery=True,
        # A company, a ministry, and a military unit: all of them own things, post
        # and turn up somewhere, so none of them needs a type of its own. `echelon`
        # is what lets an order of battle render and sort — brigade above battalion
        # above company — and the tree itself is `part-of` edges.
        attrs=(
            Attr("echelon", "Echelon",
                 hint="brigade, battalion, company: what lets an order of battle sort"),
            Attr("country", "Country"),
        ),
    ),
    # -- assets ---------------------------------------------------------------
    # Every one of the four can be damaged, so `condition` is declared on the family
    # rather than on the two types it was first wanted for. A field three members out
    # of four carry is an inconsistency an analyst sees in the form.
    EntityType(
        "vehicle", "Vehicle", ASSET, "car", SUBJECT, manual=True,
        hint="one particular vehicle, not a model", image_gallery=True,
        identity_label="Vehicle name",
        identity_placeholder="How this vehicle is known",
        attrs=(
            Attr("plate", "Plate", hint="the registration as read, not as guessed"),
            Attr("make", "Make"),
            Attr("model", "Model"),
            Attr("colour", "Colour"),
            _CONDITION,
        ),
    ),
    EntityType(
        "vessel", "Vessel", ASSET, "ship", SUBJECT, manual=True,
        hint="one ship, identified by its IMO or its MMSI", image_gallery=True,
        identity_label="Vessel name",
        identity_placeholder="Name of the vessel",
        # The IMO number is permanent, the MMSI changes with the flag. Both are
        # fields of the vessel: an identifier entity is only worth minting the day
        # a value turns up without its object, which is the AIS tracker's problem.
        attrs=(
            Attr("imo", "IMO number", hint="permanent, unlike the MMSI"),
            Attr("mmsi", "MMSI", hint="changes with the flag"),
            Attr("flag", "Flag state"),
            Attr("kind", "Kind"),
            _CONDITION,
        ),
    ),
    EntityType(
        "aircraft", "Aircraft", ASSET, "plane", SUBJECT, manual=True,
        hint="one airframe, identified by its registration", image_gallery=True,
        identity_label="Aircraft name",
        identity_placeholder="How this airframe is known",
        # Registration and the ICAO 24-bit address belong to the airframe. A
        # callsign belongs to a flight, which is a dated claim and not a field.
        attrs=(
            Attr("registration", "Registration"),
            Attr("icao24", "ICAO 24-bit address",
                 hint="belongs to the airframe, where a callsign belongs to a flight"),
            Attr("model", "Model"),
            _CONDITION,
        ),
    ),
    EntityType(
        "structure", "Structure", ASSET, "building", SUBJECT, manual=True,
        hint="a building, bridge, mast or dam, placed by a relation rather than by coordinates",
        image_gallery=True,
        identity_label="Structure name",
        identity_placeholder="How this structure is known",
        # A building, and also a bridge, a mast, a dam. Its position is stated by
        # `sited-at` rather than held here, so only `place` carries geometry.
        attrs=(
            Attr("kind", "Kind"),
            Attr("address", "Address"),
            _CONDITION,
        ),
    ),
    # -- class ----------------------------------------------------------------
    # The model an object is one of, and the thing a counted statement is about.
    # Not an asset: nobody owns "T-72B3", and it sits nowhere. It exists so a case
    # can say "two of these" without minting two anonymous vehicles — a fake
    # identity per sighting is what makes a graph unreadable by the third month.
    #
    # One type, with `category` as a field rather than five types (`tank-type`,
    # `gun-type`…): a count groups on that field, and five types would be five
    # things to keep in step for no answer the field does not already give.
    EntityType(
        "equipment-type", "Equipment type", CLASS, "stack", SUBJECT, manual=True,
        hint="a model or class, counted in statements rather than owned",
        image_gallery=True,
        identity_label="Model or class",
        identity_placeholder="T-72B3, ZU-23-2, Mi-8",
        attrs=(
            Attr("category", "Category",
                 hint="what a count groups on: tank, air defence, artillery"),
            Attr("aliases", "Other designations",
                 hint="the other names the same model is reported under"),
        ),
    ),
    # -- identifiers ----------------------------------------------------------
    EntityType(
        "account", "Account", IDENTIFIER, "at", SUBJECT, manual=True,
        hint="a profile or a bare username, whoever it turns out to belong to",
        identity_label="Handle",
        identity_placeholder="@account or username",
        # `platform` is optional on purpose: a bare username is the same idea as a
        # platform-bound account, and minting `alias` beside it would be a second
        # type for one thing — the point where a vocabulary starts to bloat.
        attrs=(
            Attr("platform", "Platform"),
            Attr("url", "Profile URL", kind="url"),
            # An account is one of the two things a case actually sources from, so
            # it carries the Admiralty grade. A claim cannot `cites` it directly —
            # the verb reaches material and documents — but "who said it" is one hop
            # back along `posted`, which is where the grade is read.
            Attr(
                "reliability", "Source reliability",
                hint="how much this source is worth in general, never how sure one claim is",
                kind="choice", options=RELIABILITY_GRADES,
            ),
        ),
    ),
    EntityType(
        "email", "Email", IDENTIFIER, "mail", SUBJECT,
        identity_label="Email address", identity_placeholder="name@example.org",
        manual=True, hint="an address, which is its own identity",
    ),
    EntityType(
        "phone", "Phone", IDENTIFIER, "phone", SUBJECT,
        identity_label="Phone number", identity_placeholder="Include the country code",
        attrs=(Attr("country", "Country"),),
        manual=True, hint="a number, which is its own identity",
    ),
    EntityType(
        "domain", "Domain", IDENTIFIER, "globe", SUBJECT,
        identity_label="Domain", identity_placeholder="example.org",
        attrs=(Attr("registrar", "Registrar"),),
        manual=True, hint="a hostname, which is its own identity",
    ),
    EntityType(
        "ip", "IP address", IDENTIFIER, "hash", SUBJECT,
        identity_label="IP address", identity_placeholder="203.0.113.42",
        attrs=(
            Attr(
                "network", "Legacy network",
                hint="older free text, replaced by the In network relation",
                editable=False,
            ),
            Attr("asn", "ASN", hint="the autonomous system number, if known"),
            Attr("provider", "Provider"),
        ),
        manual=True, hint="an address, which is its own identity",
    ),
    EntityType(
        "network", "Network", IDENTIFIER, "network", SUBJECT,
        identity_label="Network or CIDR", identity_placeholder="203.0.113.0/24",
        attrs=(
            Attr("asn", "ASN", hint="the autonomous system number, if known"),
            Attr("provider", "Provider"),
            Attr("country", "Country"),
        ),
        manual=True, hint="an IP range, named by its network or CIDR",
    ),
    # -- material -------------------------------------------------------------
    # `media` is whatever the library imported: image, video, audio or plain file.
    # An imported PDF is one of these today; the `document` type that gives it a
    # viewer and full-text search waits on text extraction (a native dependency on
    # three platforms), which is the same gate as OCR.
    EntityType("media", "Media", COLLECTED, "image", SUBJECT,
               hint="a file the case collected: image, video, audio or document"),
    EntityType("capture", "Capture", COLLECTED, "satellite", ATTESTATION,
               hint="a map screenshot, with the provider and view it was taken from"),
    # -- documents ------------------------------------------------------------
    EntityType("proof", "Proof", DOCUMENT, "proof", ATTESTATION,
               hint="a composed panel image, exported and still editable"),
    EntityType("post", "Post", DOCUMENT, "post", DELIVERABLE,
               hint="a prepared thread or report, saved rather than published"),
    EntityType("note", "Note", DOCUMENT, "note", ANNEX,
               hint="a Markdown page in the case notebook"),
    EntityType("inspect-session", "Inspect session", DOCUMENT, "inspect", ANNEX,
               hint="saved adjustments over one file, which die with it"),
    # The page a claim rests on. `url` and `fetched_at` are written by whatever
    # filed it — the extension is on the page, so the server stamps the moment it
    # was seen — and are not declared here: a declared attr is a field an analyst
    # fills, and neither of those is typed. What is typed is the archived copy,
    # once someone has made one, and how much the source is worth.
    EntityType(
        "bookmark", "Bookmark", DOCUMENT, "bookmark", ATTESTATION,
        hint="a page the case points at, stored as a link rather than a copy",
        attrs=(
            Attr("archive_url", "Archived copy", kind="url",
                 hint="a snapshot that survives the page being taken down"),
            Attr(
                "reliability", "Source reliability",
                hint="how much this source is worth in general, never how sure one claim is",
                kind="choice", options=RELIABILITY_GRADES,
            ),
        ),
    ),
    # -- place ----------------------------------------------------------------
    # Only the precision fields are declared: `lat`, `lon`, `coords`, `plus_code`,
    # `zoom`, `bearing`, `geo` and `notes` are the Satellite tool's, written by the
    # save that made the point. A declared attr means "a field an analyst may fill",
    # not "everything this type holds", so the tool's keys pass through untouched.
    EntityType(
        "place", "Place", PLACE, "pin", SUBJECT,
        hint="a saved point, as exact or as vague as the evidence allows",
        attrs=(
            # Darwin Core's rule, kept verbatim: this is the radius of the smallest
            # circle containing the whole location, not a standard deviation — so
            # two analysts write the same number. And **zero is not valid**: an
            # empty radius means *unknown*, which is a different and honest state,
            # where `0` would claim infinite precision. Hence a minimum of one
            # metre; below that there is no claim anyone can defend from imagery.
            Attr(
                "radius_m", "Uncertainty radius (m)", kind="number",
                hint="the smallest circle that contains the whole location",
                rungs=PRECISION_RUNGS, minimum=1, maximum=MAX_RADIUS_M,
                group="How precise",
            ),
            Attr("footprint", "Footprint", kind="geojson",
                 hint="the shape itself, for a place a circle describes badly"),
            Attr("verbatim", "As the source put it", kind="longtext",
                 hint="the original wording, which outlives every reinterpretation"),
            Attr("method", "How this point was found", kind="longtext",
                 hint="what was matched against what, so the point can be audited"),
        ),
    ),
    # -- claim ----------------------------------------------------------------
    # The node that exists so connectors never carry statement metadata. It points
    # `about` at its subject, `at` at places and `cites` at its sources; confidence
    # belongs to this node, not to any one connector (`engine/links.py`).
    #
    # `count` and `condition` are what let a statement be counted: "two of these,
    # destroyed". They sit on the node and not on `about`, because a Claim may point
    # at several subjects and one number on the node could not say which it meant —
    # so one statement counts one kind of thing, and a second kind is a second Claim
    # with its own confidence. That is the same call §3 already makes for competing
    # candidates, and it is what keeps every value on this node assessable as one.
    EntityType(
        "claim", "Claim", CLAIM, "quote", SUBJECT, manual=True,
        hint="something you are saying about the case, with its reasoning and its sources",
        identity_label="Statement",
        identity_placeholder="What are you asserting?",
        attrs=(
            Attr(
                "count", "How many", kind="number",
                hint="how many of the one thing this statement counts",
                minimum=1, maximum=MAX_COUNT, whole=True,
                group="What it states",
            ),
            Attr(
                "condition", "Condition",
                hint="the state at the moment this statement describes",
                kind="choice", options=ASSET_CONDITIONS,
            ),
            Attr(
                "when", "When", kind="temporal",
                hint="when this statement applies",
                group="When",
            ),
            Attr(
                "time_role", "Time role", kind="choice",
                hint="what this value means for the statement",
                options=CLAIM_TIME_ROLES,
            ),
            Attr(
                "confidence", "Confidence",
                hint="how strongly the statement is supported",
                kind="choice", options=CLAIM_CONFIDENCE,
                group="Reasoning",
            ),
            Attr("method", "How this was worked out", kind="longtext",
                 hint="the reasoning a reader would need to check this"),
            Attr("verbatim", "As the source put it", kind="longtext",
                 hint="the original wording, quoted rather than paraphrased"),
        ),
    ),
)

_BY_TYPE: dict[str, EntityType] = {entry.type: entry for entry in ENTITY_TYPES}


def entity_type(type_: str) -> EntityType | None:
    """The registry entry for a type, or None when the vocabulary has none.

    Free-string types stay storable (ONTOLOGY §2): they are a label in the graph
    until a tool or this registry gives them a meaning. What they cannot be is the
    end of a relation, since nothing states what they may join.
    """
    return _BY_TYPE.get(type_)


def family_of(type_: str) -> str | None:
    """Which family a type sits in, or None for an undeclared free type."""
    entry = _BY_TYPE.get(type_)
    return entry.family if entry else None


#: Declared kinds whose value is worth finding an entity by. A plate, an IMO, a
#: handle's platform and a claim's reasoning are what an analyst types into a search
#: box; a radius in metres, a footprint's coordinates and a stored grade letter are
#: not — matching "500" against every radius in the case would bury the rows that
#: actually say 500.
SEARCHABLE_KINDS: frozenset[str] = frozenset({"text", "longtext", "url"})


def search_values(type_: str, attrs: Mapping[str, Any] | None) -> list[str]:
    """The declared field values an entity should be findable by.

    The label, the type and the notes were the whole index before this, which meant
    a vehicle could not be found by the plate that identifies it and a claim not by
    the wording it quotes — the fields the vocabulary went to the trouble of
    declaring were the ones search could not see. Only declared keys are read, so a
    tool's own payload (a spec, a sidecar path, a geometry) never enters the index.
    """
    entry = _BY_TYPE.get(type_)
    if entry is None or not attrs:
        return []
    return [
        str(attrs[attr.key])
        for attr in entry.attrs
        if attr.kind in SEARCHABLE_KINDS and attrs.get(attr.key) not in (None, "")
    ]


def search_matches(entity: Mapping[str, Any], query: str | None) -> list[dict[str, str]]:
    """Which human-readable fields explain a text-search match.

    The stored index stays the fast predicate. This is the small explanation added
    only to rows that already matched it, so a plate hit can say ``Plate · AB-123``
    instead of making the analyst open the entity to discover why it appeared.
    """
    terms = [term for term in str(query or "").casefold().split() if term]
    if not terms:
        return []
    type_ = str(entity.get("type") or "")
    raw_attrs = entity.get("attrs")
    attrs: Mapping[str, Any] = raw_attrs if isinstance(raw_attrs, Mapping) else {}
    entry = _BY_TYPE.get(type_)
    fields: list[tuple[str, str, Any]] = [
        ("label", "Name", entity.get("label")),
        ("type", "Type", type_),
        ("folder", "Folder", attrs.get("folder")),
        ("notes", "Notes", attrs.get("notes")),
    ]
    if entry is not None:
        fields.extend(
            (attr.key, attr.label, attrs.get(attr.key))
            for attr in entry.attrs
            if attr.kind in SEARCHABLE_KINDS
        )
    matches: list[dict[str, str]] = []
    covered: set[str] = set()
    for key, label, value in fields:
        if value in (None, ""):
            continue
        text = str(value)
        folded = text.casefold()
        hit = {term for term in terms if term in folded}
        if not hit:
            continue
        covered.update(hit)
        matches.append({"field": key, "label": label, "value": text[:300]})
    return matches if covered == set(terms) else []


#: Punctuation a phone number is spaced with rather than identified by. A number
#: written `+33 6 12 34 56 78` and the same one written `+33612345678` are one
#: identity; `+33612345678` and `0612345678` are **not**, because supplying a
#: country code is a guess about what the analyst meant.
_PHONE_NOISE = " \t-.()/"


def identity_key(type_: str, label: str) -> str:
    """What makes two records of an identifier the same record, or `""`.

    The ``identifier`` family is the one place ONTOLOGY §2's "the label never
    defines identity" does not hold: two ``email`` entities holding one address are
    a bug rather than two objects (module docstring). Nothing else has this — two
    people really can share a name — so every other family answers `""` and is never
    compared.

    **It catches the same value typed twice, not every spelling that resolves to the
    same thing.** `203.0.113.42` is not compared against a padded IPv6 form and
    `example.org` is not compared against `www.example.org`: those need a parser or a
    guess, and a guard that guesses refuses two entities that are genuinely
    different — which is a worse failure than missing one, since the analyst can see
    a duplicate and cannot see a refusal that should not have happened.

    Served through ``GET /cases/{id}/entities/twin`` rather than reimplemented in the
    browser, so the form's warning and any later check compare the same way. The
    create form used to lowercase the raw label and compare that, which let `@handle`
    and `handle` sit side by side as two accounts.
    """
    entry = _BY_TYPE.get(type_)
    if entry is None or entry.family != IDENTIFIER:
        return ""
    value = str(label).strip().casefold()
    if not value:
        return ""
    if type_ == "account":
        # A handle is written with or without its sigil by the same analyst on the
        # same afternoon, and the platform is a separate field either way.
        return value.lstrip("@")
    if type_ == "phone":
        return "".join(ch for ch in value if ch not in _PHONE_NOISE)
    if type_ == "domain":
        # The root label is optional in a fully-qualified name and means nothing here.
        return value.rstrip(".")
    return value


def types_in(*families: str) -> frozenset[str]:
    """Every declared type in these families.

    This is what turns a relation declared against families into the concrete type
    set the endpoint check compares against, resolved once at import.
    """
    wanted = set(families)
    return frozenset(e.type for e in ENTITY_TYPES if e.family in wanted)


def role_of(type_: str) -> str | None:
    """What a type is for once the case is drawn, or None for a free type.

    A free type has no role for the same reason it has no family: nothing declares
    what it is. A drawing keeps it — leaving out what the vocabulary cannot speak for
    would drop an entity nobody agreed to drop.
    """
    entry = _BY_TYPE.get(type_)
    return entry.role if entry else None


def types_with_role(*roles: str) -> frozenset[str]:
    """Every declared type playing one of these roles.

    The node half of a graph lens, resolved the same way ``types_in`` resolves the
    endpoints of a verb: the vocabulary is stated once here, and a reading of the case
    derives its type set from it rather than listing one of its own.
    """
    wanted = set(roles)
    return frozenset(e.type for e in ENTITY_TYPES if e.role in wanted)


# -- validation ---------------------------------------------------------------
#
# Only *declared* fields are checked. A tool's own keys on the same entity — a
# place's `lat`, `geo` or `notes` — pass through untouched, because a declared attr
# means "a field an analyst may fill", not "everything this type holds". That is
# what makes this additive: no existing write can start failing.


def check_attrs(
    type_: str,
    attrs: Mapping[str, Any],
    *,
    current: Mapping[str, Any] | None = None,
) -> None:
    """Raise ``CaseError`` on a malformed value in a declared field.

    Clearing is always allowed: ``None`` and ``""`` mean *unknown*, which every
    field may be, and refusing them would make "I do not know how precise this is"
    impossible to say.
    """
    entry = _BY_TYPE.get(type_)
    if entry is None:
        return
    for attr in entry.attrs:
        if attr.key not in attrs:
            continue
        value = attrs[attr.key]
        if not attr.editable and value not in (None, ""):
            previous = (current or {}).get(attr.key)
            if previous != value:
                raise CaseError(f"'{attr.key}' is read-only legacy data")
        if value is None or value == "":
            continue
        _CHECKS[attr.kind](attr, value)


def _check_text(attr: Attr, value: Any) -> None:
    if not isinstance(value, str):
        raise CaseError(f"'{attr.key}' must be text")
    if len(value) > MAX_TEXT:
        raise CaseError(f"'{attr.key}' is longer than {MAX_TEXT} characters")


def _check_number(attr: Attr, value: Any) -> None:
    # bool is an int in Python, and `True` metres is not a radius.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CaseError(f"'{attr.key}' must be a number")
    if not math.isfinite(value):
        raise CaseError(f"'{attr.key}' must be a finite number")
    # A count has nothing between its values. Two and a half destroyed tanks is not
    # a quantity anyone can defend, and stored once it would be summed with the rest.
    if attr.whole and float(value) != int(value):
        raise CaseError(f"'{attr.key}' must be a whole number")
    if attr.minimum is not None and value < attr.minimum:
        raise CaseError(f"'{attr.key}' must be at least {attr.minimum}")
    if attr.maximum is not None and value > attr.maximum:
        raise CaseError(f"'{attr.key}' must be at most {attr.maximum}")


def _check_url(attr: Attr, value: Any) -> None:
    _check_text(attr, value)
    # A declared url is rendered as a link, so the scheme is checked at the edge
    # rather than trusted: `javascript:` in an anchor is the whole reason.
    if not str(value).lower().startswith(("http://", "https://")):
        raise CaseError(f"'{attr.key}' must be an http or https URL")


def _check_geojson(attr: Attr, value: Any) -> None:
    """A footprint: one GeoJSON Polygon or MultiPolygon, and nothing exotic.

    Darwin Core's `footprintWKT` in the shape the map already speaks. Points and
    lines are refused because a footprint is an area — a point is what `lat`/`lon`
    with a radius already says.
    """
    if not isinstance(value, dict):
        raise CaseError(f"'{attr.key}' must be a GeoJSON geometry")
    if value.get("type") not in ("Polygon", "MultiPolygon"):
        raise CaseError(f"'{attr.key}' must be a Polygon or MultiPolygon")
    rings = value.get("coordinates")
    if not isinstance(rings, list) or not rings:
        raise CaseError(f"'{attr.key}' has no coordinates")
    points = _count_positions(rings, attr.key)
    if points < 3:
        raise CaseError(f"'{attr.key}' needs at least three points to be an area")
    if points > MAX_FOOTPRINT_POINTS:
        raise CaseError(f"'{attr.key}' holds more than {MAX_FOOTPRINT_POINTS} points")


def _count_positions(node: Any, key: str, depth: int = 0) -> int:
    """Count `[lon, lat]` pairs, checking each as it goes.

    Recursive because a Polygon nests one level deeper than a MultiPolygon's rings,
    and bounded by ``depth`` so a hand-made payload cannot nest its way past the
    point cap.
    """
    if depth > 4:
        raise CaseError(f"'{key}' is nested too deeply")
    if not isinstance(node, list):
        raise CaseError(f"'{key}' has a malformed coordinate")
    # a position is the innermost list: two numbers, lon then lat
    if node and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in node):
        if len(node) < 2:
            raise CaseError(f"'{key}' has a coordinate that is not a lon/lat pair")
        lon, lat = float(node[0]), float(node[1])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise CaseError(f"'{key}' has a coordinate off the globe")
        return 1
    return sum(_count_positions(child, key, depth + 1) for child in node)


def _check_choice(attr: Attr, value: Any) -> None:
    """One of the readings the field declares, and nothing else.

    A closed scale is only closed if the store enforces it: a grade the registry has
    never heard of would render as itself in the panel and read as a sixth level
    nobody agreed on.
    """
    # `isinstance` first: an unhashable body — a list, an object — would raise out
    # of a set membership test instead of answering the 400 it deserves.
    if not isinstance(value, str) or value not in {stored for stored, _ in attr.options}:
        allowed = ", ".join(stored for stored, _ in attr.options)
        raise CaseError(f"'{attr.key}' must be one of {allowed}, or nothing")


def _check_temporal(attr: Attr, value: Any) -> None:
    try:
        parse_temporal(value)
    except TemporalError as exc:
        raise CaseError(f"'{attr.key}' {exc}") from exc


_CHECKS: dict[str, Callable[[Attr, Any], None]] = {
    "text": _check_text,
    "longtext": _check_text,
    "number": _check_number,
    "url": _check_url,
    "geojson": _check_geojson,
    "choice": _check_choice,
    "temporal": _check_temporal,
}
