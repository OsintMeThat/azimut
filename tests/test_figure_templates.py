"""Figure templates: an infographic's, a chart's or a map's layout, without its data.

What must hold (`engine/figuretemplates.py`, `api/templates.py`):

- **the templates file** keeps the figure as its block's text, and a save takes out what
  is a case's (rows, ``data:``, ``from:``, titles, sources, a map's layers and place)
  whatever the browser sent; a block that is not the figure it says is refused;
- **the ready ones** are neutral (no row, no case id), kept as they are written, and each
  applies with no data and to a table of its columns;
- **the backup** carries every kind of template, figures included, and brings them back;
- **the columns** are matched by name, a column the data does not name is asked, never
  guessed, and what the answer writes holds the data's rows, the title they propose, and
  none of the template's values the data does not hold.

`tests/fixtures/figure_templates.json` holds each ready template applied with no data, which
`frontend/src/lib/notes/figureTemplates.test.js` opens in the chart's own form.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from azimut import config
from azimut.engine import figuretemplates as ft
from azimut.engine import notes_charts as nc
from azimut.engine import notes_infographic as ni

FIXTURE = Path(__file__).parent / "fixtures" / "figure_templates.json"

REGISTER = "\n".join([
    "| # | Model | Made in | Class | Grade | Group |",
    "| ---: | --- | --- | --- | --- | --- |",
    "| 1 | Cougar | Country A | Armoured | Confirmed | North |",
    "| 2 | Cougar | Country A | Armoured | Almost sure | North |",
    "| 3 | Kirpi | Country B | Armoured | Confirmed | South |",
    "| 4 | Pickup | | Light | Strong doubt | South |",
])

#: A page as a case writes one: its band, a figure typed in, two charts of a register,
#: a donut of its own rows, words naming the case, and a map of the case's layers.
CASE_PAGE = "\n".join([
    ":::: infographic",
    "data: sheet:s_9f2e",
    "kicker: A place · a month",
    "title: At least 4 vehicles lost on one road",
    "standfirst: Every figure is a minimum.",
    "widths: wide, half, half, half, wide, wide",
    "",
    "::: chart",
    "kind: key figures",
    "| Figure | Words |",
    "| --- | --- |",
    "| 4 of 4 | placed on the road |",
    ":::",
    "",
    "::: chart",
    "kind: silhouette rows",
    "title: What was lost",
    "caption: One glyph a vehicle.",
    "count: rows",
    "by: Model",
    "colour by: Grade",
    "order: Confirmed, Almost sure, Strong doubt",
    "only: Class is Armoured",
    "icon: armoured vehicle",
    "source: our register",
    REGISTER,
    ":::",
    "",
    "::: chart",
    "kind: donut",
    "title: Where 3 were made",
    "count: Vehicles",
    "highlight: Country A",
    "source: [[entity:e_1a2b3c|our register]]",
    "| Made in | Vehicles |",
    "| --- | ---: |",
    "| Country A | 2 |",
    "| Country B | 1 |",
    ":::",
    "",
    "::: chart",
    "kind: segments",
    "count: rows",
    "colour by: Grade",
    "from: note:e_77aa#the-register",
    REGISTER,
    ":::",
    "",
    "### Where they lie",
    "Two groups, seen in [[media:m_42ab|the second video]].",
    "",
    "::: map",
    "title: The road",
    "layer: Vehicles and route",
    "ground: e_c76d8fac71",
    "view: 12.72400, 43.51600, 12.6",
    "frame: 43.40000, 12.60000, 43.60000, 12.80000",
    "base: dark",
    "north: on",
    "legend: folded",
    "step: 2026-11-15 | Day one | 12.7, 43.5, 12",
    ":::",
    "::::",
])


def _page(text: str) -> ni.Infographic:
    return ni.parse_block(ni.block_of(text))


def _panel_block(text: str, index: int) -> nc.ChartBlock:
    return nc.parse_block(_page(text).panels[index].body)


# -- what a template keeps ----------------------------------------------------------------------------


def test_a_page_of_a_case_keeps_its_layout_and_leaves_its_data():
    made = ft.from_block(CASE_PAGE)
    text = made["text"]
    assert made["figure"] == "infographic"
    page = _page(text)
    # the layout: its panels in order, their widths
    assert [panel.kind for panel in page.panels] == ["chart", "chart", "chart", "chart", "words", "map"]
    assert [panel.width for panel in page.panels] == ["wide", "half", "half", "half", "wide", "wide"]
    # the case's own: its data, its band, its titles, captions, sources, its rows, its place
    for gone in ("data:", "kicker:", "standfirst:", "At least 4", "title:", "caption:", "source:", "from:", "e_1a2b3c",
                 "m_42ab", "Cougar", "Country A |", "layer:", "ground:", "view:", "frame:", "step:", "The road"):
        assert gone not in text, gone
    # its words left with the case: the panel is the builder's own words to write over
    assert page.panels[4].body == ft.WORDS_PANEL
    # each chart names the columns it is drawn by, with a header and no row
    rows = _panel_block(text, 1)
    assert (rows.kind, rows.count, rows.by, rows.colour_by) == ("silhouette rows", "rows", "Model", "Grade")
    assert rows.table.headers == ["Model", "Class", "Grade"] and rows.table.cells == []
    assert [only.text() for only in rows.only] == ["Class is Armoured"]
    assert rows.extra["icon"] == "armoured vehicle"
    donut = _panel_block(text, 2)
    assert (donut.count, donut.by, donut.table.headers) == ("Vehicles", "Made in", ["Made in", "Vehicles"])
    # a kind of parts is drawn by its colour column, written as its by
    segments = _panel_block(text, 3)
    assert (segments.by, segments.colour_by, segments.table.headers) == ("Grade", "", ["Grade"])
    # the map keeps its look only
    assert page.panels[5].body.split("\n") == ["base: dark", "north: on", "legend: folded"]


def test_a_template_reads_back_as_it_was_saved():
    made = ft.from_block(CASE_PAGE)["text"]
    assert ft.canonical("infographic", made) == made
    for ready in ft.READY:
        assert ft.canonical("infographic", ready.text) == ready.text


def test_a_template_typed_in_settings_keeps_its_own_band():
    text = ":::: infographic\nkicker: Our desk\ntitle: Losses\n::::"
    kept = ft.canonical("infographic", text)
    assert "kicker: Our desk" in kept and "title: Losses" in kept
    # the same band made from a case is the case's, and stays there
    assert "kicker" not in ft.canonical("infographic", text, from_case=True)


def test_a_chart_keeps_its_settings_and_a_map_its_look():
    chart = ft.from_block("::: chart\nkind: stacked bars\ntitle: At least 3\ncount: rows\nby: Group\ncolour by: Grade\n"
                          "style: dark\nsource: ours\n" + REGISTER + "\n:::")
    block = nc.parse_block(ft._inner(chart["text"], ft.CHART_OPEN))
    assert (block.kind, block.title, block.source, block.style) == ("stacked bars", "", "", "dark")
    assert block.table.headers == ["Grade", "Group"] and not block.table.cells
    assert chart["name"] == "Stacked chart"
    shown = ft.from_block("::: map\nlayer: Front\nplate: p1\nproofs: all\nbase: topographic\nsize: half\ncard: picture, source\n:::")
    assert shown["text"] == "::: map\nbase: topographic\ncard: picture, source\nsize: half\n:::"
    assert ft.map_settings(shown["text"])["base"] == "topographic"
    assert ft.map_settings(shown["text"])["north"] == ""


def test_a_waffle_never_keeps_a_number_as_its_whole():
    text = ft.chart_template("::: chart\nkind: waffle\ncount: Cost\nof: 64bn\n| Part | Cost |\n| --- | ---: |\n| Ours | 2 |\n:::")
    assert "of:" not in text


# -- the templates file -------------------------------------------------------------------------------------


def test_figure_templates_are_saved_listed_and_deleted(client):
    made = client.post("/api/templates/figure/from", json={"text": CASE_PAGE})
    assert made.status_code == 200, made.text
    body = made.json()
    saved = client.post("/api/templates/figure", json={"name": "Losses, our way", "data": {"figure": body["figure"], "text": body["text"]}})
    assert saved.status_code == 200, saved.text
    record = saved.json()
    listed = client.get("/api/templates").json()["figure"]
    assert [one["id"] for one in listed] == [record["id"]]
    assert listed[0]["data"] == {"figure": "infographic", "text": body["text"]}
    assert client.delete(f"/api/templates/figure/{record['id']}").json() == {"deleted": True}
    assert client.get("/api/templates").json()["figure"] == []


def test_a_save_takes_out_what_is_a_case_whatever_was_sent(client):
    sent = {"figure": "chart", "text": "::: chart\nkind: donut\ntitle: At least 41\nfrom: sheet:s1\n" + REGISTER + "\n:::"}
    data = client.post("/api/templates/figure", json={"name": "Donut", "data": sent}).json()["data"]
    assert "At least" not in data["text"] and "from:" not in data["text"] and "Cougar" not in data["text"]
    assert "kind: donut" in data["text"]


@pytest.mark.parametrize("data", [
    {"figure": "chart", "text": "::: map\n:::"},
    {"figure": "graph", "text": ""},
    {"figure": "map", "text": "no block at all"},
])
def test_a_template_that_is_not_its_figure_is_refused(client, data):
    assert client.post("/api/templates/figure", json={"name": "Bad", "data": data}).status_code == 422


def test_a_blank_template_of_each_figure_is_saved(client):
    for figure in ft.FIGURES:
        answer = client.post("/api/templates/figure", json={"name": figure, "data": {"figure": figure, "text": ""}})
        assert answer.status_code == 200
        assert answer.json()["data"]["text"] == ft.EMPTY[figure]


def test_a_figure_that_is_none_is_refused_as_a_start(client):
    assert client.post("/api/templates/figure/from", json={"text": "# Just words"}).status_code == 422


def test_an_unreadable_figure_template_on_disk_is_left_out_of_the_list(client):
    config.save_templates({**config.DEFAULT_TEMPLATES, "figure": [
        {"id": "a1", "name": "Fine", "data": {"figure": "map", "text": "::: map\nnorth: on\n:::"}},
        {"id": "a2", "name": "Broken", "data": {"figure": "chart", "text": "::: map\n:::"}},
    ]})
    assert [one["name"] for one in client.get("/api/templates").json()["figure"]] == ["Fine"]


# -- the ready ones ---------------------------------------------------------------------------------------


def test_the_ready_ones_are_listed(client):
    ready = client.get("/api/templates/figure/ready").json()["ready"]
    assert [one["name"] for one in ready] == ["Losses at a glance", "A front on a map", "Who supplied them"]
    assert all(one["about"] and one["data"]["figure"] == "infographic" for one in ready)


@pytest.mark.parametrize("ready", ft.READY, ids=lambda one: one.id)
def test_a_ready_one_holds_no_data(ready):
    page = _page(ready.text)
    assert not page.data and not page.unread
    for line in ("data:", "from:", "ground:", "layer:", "[[", "title:", "source:"):
        assert line not in ready.text
    for panel in page.panels:
        if panel.kind == ni.CHART:
            assert nc.parse_block(panel.body).table.cells == []


def test_the_ready_ones_are_what_their_names_say():
    kinds = {ready.id: [nc.effective_kind(nc.parse_block(panel.body)).name if panel.kind == "chart" else panel.kind
                        for panel in _page(ready.text).panels] for ready in ft.READY}
    assert kinds == {
        "losses-at-a-glance": ["key figures", "pictograms", "donut", "segments", "timeline"],
        "a-front-on-a-map": ["map", "key figures", "timeline"],
        "who-supplied-them": ["silhouette rows", "donut"],
    }


@pytest.mark.parametrize("ready", ft.READY, ids=lambda one: one.id)
def test_a_ready_one_applies_with_no_data_each_panel_its_own_form(ready):
    applied = ft.apply("infographic", ready.text)
    page = _page(applied["text"])
    assert not page.data
    for panel, said in zip(page.panels, applied["panels"]):
        if panel.kind == "chart":
            block = nc.parse_block(panel.body)
            assert said["reads"] == "own" and block.own_rows and block.table.cells == []
        else:
            assert said["reads"] in ("map", "words")


def test_the_ready_ones_applied_with_no_data_are_the_fixture():
    """The fixture the browser's tests open in each chart's form, kept equal to the engine."""
    wanted = {"_about": "Each ready figure template applied with no data (engine/figuretemplates.py): "
                        "figureTemplates.test.js opens each chart panel in its own form.",
              "ready": [{"id": ready.id, "text": ready.text, "applied": ft.apply("infographic", ready.text)["text"]}
                        for ready in ft.READY]}
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == wanted


def test_losses_at_a_glance_meets_a_register_of_its_columns():
    register = "\n".join(["| Grade | Status | Type | Date | What happened |", "| --- | --- | --- | --- | --- |",
                          "| Confirmed | destroyed | tank | 2026-10-05 | Hit on the road |",
                          "| Almost sure | abandoned | truck | 2026-10-06 | Left in a ditch |"])
    applied = ft.apply("infographic", ft.READY[0].text, table_text=register, origin="sheet:s1")
    page = _page(applied["text"])
    assert page.data == "sheet:s1"
    assert [said["reads"] for said in applied["panels"]] == ["own", "data", "data", "data", "data"]
    pictograms = nc.parse_block(page.panels[1].body)
    assert pictograms.table.headers == ["Grade", "Status", "Type", "Date", "What happened"]
    assert len(pictograms.table.cells) == 2 and pictograms.title


# -- the columns --------------------------------------------------------------------------------------------


def test_columns_are_matched_by_name_and_the_rest_asked(client):
    template = ft.from_block(CASE_PAGE)
    first = client.post("/api/templates/figure/apply", json={"template": template, "table": REGISTER, "origin": "sheet:s1"}).json()
    assert first["ask"] is True and "text" not in first
    needs = {need["column"]: need for need in first["needs"]}
    assert needs["Model"]["match"] == "Model" and needs["Grade"]["match"] == "Grade"
    # the donut's count is no column of the register: asked, and counting the rows is offered
    assert needs["Vehicles"]["match"] == "" and needs["Vehicles"]["counts"] is True
    assert [use["kind"] for use in needs["Grade"]["uses"]] == ["Silhouette rows", "Segments"]
    assert first["columns"] == ["#", "Model", "Made in", "Class", "Grade", "Group"]


def test_matching_ignores_case_and_spaces_and_suggests_a_near_name():
    wanted = ft.needs("chart", "::: chart\nkind: bars\ncount: rows\nby: grade\n| grade |\n| --- |\n:::")
    assert ft.match(wanted, ["  GRADE "]) == {"grade": "  GRADE "}
    assert ft.suggest("Grade", ["Model", "Confidence grade"]) == "Confidence grade"
    assert ft.suggest("Grade", ["Grade one", "Grade two"]) == ""
    assert ft.suggest("Grade", ["Upgraded"]) == ""


def test_the_columns_given_are_read_and_the_rows_counted_where_asked(client):
    template = ft.from_block(CASE_PAGE)
    answer = client.post("/api/templates/figure/apply", json={
        "template": template, "table": REGISTER, "origin": "sheet:s1", "mapping": {"Vehicles": ""}, "rows": ["Vehicles"],
    }).json()
    page = _page(answer["text"])
    assert page.data == "sheet:s1"
    assert [said["reads"] for said in answer["panels"]] == ["own", "data", "data", "data", "words", "map"]
    donut = nc.parse_block(page.panels[2].body)
    assert (donut.count, donut.by, donut.origin) == ("rows", "Made in", "")
    # a value the data holds keeps its highlight; the title is the one the rows propose
    assert donut.highlight == ["Country A"]
    assert donut.title == "3 rows, by made in"
    # every chart that takes the data inherits it, as the builder's Data line reads it
    columns = ["#", "Model", "Made in", "Class", "Grade", "Group"]
    assert [ni.inherits(panel, columns) for panel in page.panels] == [False, True, True, True, False, False]


def test_a_column_left_to_the_hand_opens_its_panel_s_form(client):
    template = ft.from_block(CASE_PAGE)
    answer = client.post("/api/templates/figure/apply", json={
        "template": template, "table": REGISTER, "origin": "sheet:s1", "mapping": {"Vehicles": ""},
    }).json()
    donut = nc.parse_block(_page(answer["text"]).panels[2].body)
    assert answer["panels"][2]["reads"] == "own"
    assert donut.own_rows and donut.table.cells == [] and donut.table.headers == ["Made in", "Vehicles"]
    assert not donut.highlight


def test_a_column_given_another_name_is_renamed_in_every_setting():
    template = "::: chart\nkind: stacked columns\ncount: rows\nby: Unit\ncolour by: Grade\nonly: Grade is not Set aside\n" \
               "| Unit | Grade |\n| --- | --- |\n:::"
    data = ft.data_of("| Formation | Confidence |\n| --- | --- |\n| 1st | Confirmed |\n| 2nd | Set aside |")
    applied = ft.apply_chart(nc.parse_block(ft._inner(template, ft.CHART_OPEN)), data,
                             {"Unit": "Formation", "Grade": "Confidence"}, [])
    assert (applied.reads, applied.block.by, applied.block.colour_by) == ("data", "Formation", "Confidence")
    assert [only.text() for only in applied.block.only] == ["Confidence is not Set aside"]


def test_what_the_data_does_not_hold_is_dropped_never_drawn():
    template = "::: chart\nkind: donut\ncount: rows\nby: Grade\norder: Confirmed, Almost sure\n" \
               "colours: Confirmed #184f95, Unknown #ff0000\nhighlight: Unknown\n| Grade |\n| --- |\n:::"
    data = ft.data_of("| Grade |\n| --- |\n| Confirmed |\n| Confirmed |")
    block = ft.apply_chart(nc.parse_block(ft._inner(template, ft.CHART_OPEN)), data, {"Grade": "Grade"}, []).block
    assert block.order == ["Confirmed", "Almost sure"]  # a grade scale keeps its steps
    assert block.colours == {"Confirmed": "#184f95"} and block.highlight == []
    other = ft.data_of("| Grade |\n| --- |\n| Yes |")
    assert ft.apply_chart(nc.parse_block(ft._inner(template, ft.CHART_OPEN)), other, {"Grade": "Grade"}, []).block.order == []


def test_key_figures_are_always_typed():
    applied = ft.apply("infographic", ft.READY[1].text, table_text="| Figure | What it says |\n| --- | --- |\n| 4 | lost |",
                       origin="sheet:s1")
    assert applied["panels"][1]["reads"] == "own"
    assert "| 4 | lost |" not in applied["text"]


def test_flags_one_per_category_are_found_by_their_names():
    template = ft.READY[2].text
    data = "| Supplier |\n| --- |\n| Country A |\n| Country A |\n| Country B |"
    icons = [("a" * 64, "Country A flag"), ("b" * 64, "Unrelated")]
    applied = ft.apply("infographic", template, table_text=data, origin="sheet:s1", icons=icons)
    rows = nc.parse_block(_page(applied["text"]).panels[0].body)
    assert rows.extra["flags"] == f"Country A = own:{'a' * 64}"
    none = ft.apply("infographic", template, table_text=data, origin="sheet:s1", icons=[])
    assert "flags" not in nc.parse_block(_page(none["text"]).panels[0].body).extra
    assert "pick each in its card" in none["panels"][0]["notes"][0]


def test_a_chart_template_sets_its_settings_over_a_chart_s_own_rows(client):
    template = {"figure": "chart", "text": "::: chart\nkind: donut\ncount: rows\nby: Grade\nstyle: dark\n| Grade |\n| --- |\n:::"}
    answer = client.post("/api/templates/figure/apply", json={"template": template, "table": REGISTER}).json()
    assert answer["ask"] is False and answer["reads"] == "data"
    changes = answer["changes"]
    assert (changes["kind"], changes["by"], changes["count"], changes["style"], changes["colour by"]) == \
           ("donut", "Grade", "rows", "dark", "")
    assert "title" not in changes and "source" not in changes and "from" not in changes


def test_a_map_template_answers_its_whole_look(client):
    template = {"figure": "map", "text": "::: map\nbase: dark\nnorth: on\n:::"}
    changes = client.post("/api/templates/figure/apply", json={"template": template}).json()["changes"]
    assert changes["base"] == "dark" and changes["north"] == "on" and changes["legend"] == ""
    assert set(changes) == set(ft.MAP_KEYS)


# -- the backup -------------------------------------------------------------------------------------------


def test_figure_templates_travel_with_the_backup(client):
    record = client.post("/api/templates/figure", json={"name": "Ours", "data": {"figure": "map", "text": "::: map\nnorth: on\n:::"}}).json()
    bundle = client.get("/api/settings/export").json()
    assert [one["name"] for one in bundle["templates"]["figure"]] == ["Ours"]
    client.delete(f"/api/templates/figure/{record['id']}")
    restored = client.post("/api/settings/import", json=bundle).json()
    assert restored["templates"] == 1
    assert client.get("/api/templates").json()["figure"][0]["data"]["text"] == "::: map\nnorth: on\n:::"


@pytest.mark.parametrize("kind", config.TEMPLATE_KINDS)
def test_every_kind_of_template_travels_with_the_backup(client, kind):
    """The drift gate for templates.json: a kind added to TEMPLATE_KINDS is carried by the
    backup and restored by it, or this fails."""
    config.save_templates({**config.DEFAULT_TEMPLATES, kind: [{"id": "t1", "name": "One", "data": {}}]})
    bundle = client.get("/api/settings/export").json()
    assert [one["id"] for one in bundle["templates"][kind]] == ["t1"]
    config.save_templates(dict(config.DEFAULT_TEMPLATES))
    client.post("/api/settings/import", json={"templates": bundle["templates"]})
    assert [one["id"] for one in config.load_templates()[kind]] == ["t1"]
