"""The default home page Azimut writes when the site's root holds none of its own.

It is a template with the same markers a hand-made home carries, filled by the same
renderer as every marked page (`engine/site.py`), so there is one list for both: the
site's title and logo, a line under them, the pages linked from its header, tabs (All, one
per category in use with its count, Maps when the site has maps), the newest article large
and a grid of the rest, then RSS and, unless the analyst turned it off in Settings ›
Website, "Made with Azimut <version>" in the footer.

Its files go under `azimut-site/`, a folder of Azimut's own beside the home: the style
sheet, the script of its tabs, the logo, the faces (the same as Azimut's published pages, cut
to the Latin letters so that the files are the same from one publish to the next) and, with a
GoatCounter site named, the counting script. The home is Azimut's while it holds
`<meta name="generator" content="Azimut <version>">` (`site.owns_home`).
"""

from __future__ import annotations

import html
from typing import Any

from .. import __version__
from . import notes_html as html_engine
from . import notes_style, site
from .notelook import NoteLook
from .site import Site

#: Where the home's own files live, which a home written by Azimut is the only one to use.
KIT = "azimut-site"
STYLE = f"{KIT}/site.css"
SCRIPT = f"{KIT}/site.js"
LOGO = f"{KIT}/logo.png"
COUNT = f"{KIT}/count.js"
FONTS = f"{KIT}/fonts"
#: The faces of the home, by the name its style sheet gives each and the file it is cut to.
FACES = (("az-head", 400, "normal", "head-400"), ("az-head", 700, "normal", "head-700"),
         ("az-body", 400, "normal", "body-400"), ("az-body", 700, "normal", "body-700"),
         ("az-body", 400, "italic", "body-400-italic"))
#: The letters every face is cut to: what a page draws in Latin, and the marks the home writes.
LATIN = (html_engine.ALWAYS_DRAWN + "".join(chr(code) for code in range(0x100, 0x180)) + "◎€")

CSS = """:root{--paper:#fff;--ink:#1f2023;--ink-2:#3d4046;--muted:#62676f;--rule:#dedad3;--tint:#f6f4f0;--accent:#1f4e79;
--head:az-head,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--body:az-body,"Iowan Old Style","Palatino Linotype",Georgia,serif}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 1.0625rem/1.6 var(--body)}
a{color:var(--accent)}
img{max-width:100%;display:block}
.wrap{max-width:72rem;margin:0 auto;padding:0 1.5rem}
.site-head{border-bottom:1px solid var(--rule)}
.site-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.25rem 0}
.site-brand{display:flex;align-items:center;gap:.75rem;text-decoration:none;color:var(--ink);font:700 1.5rem/1.1 var(--head);letter-spacing:-.02em}
.site-brand img{width:2.75rem;height:2.75rem;border-radius:50%}
.site-pages{display:flex;gap:1.25rem;font:400 .95rem var(--head)}
.site-pages a{color:var(--ink-2);text-decoration:none}
.site-pages a:hover{color:var(--accent)}
.site-intro{padding:0 0 1.75rem;max-width:40rem;color:var(--ink-2);font-size:1.15rem;margin:0}
.site-tabs{display:flex;flex-wrap:wrap;gap:.5rem;margin:2rem 0 1.75rem;font:500 .9rem var(--head)}
.site-tabs button{border:1px solid var(--rule);background:var(--paper);color:var(--ink-2);border-radius:999px;padding:.35rem .9rem;cursor:pointer;font:inherit}
.site-tabs button[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
.site-tabs .count{opacity:.6;margin-left:.3rem}
.az-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2.25rem 1.75rem}
.az-item{display:flex;flex-direction:column;min-width:0}
.az-item[hidden]{display:none!important}
.az-list:not(.az-maps):not(.is-filtered) .az-item:first-child{grid-column:1/-1;display:grid;grid-template-columns:3fr 2fr;gap:0 1.75rem;grid-auto-rows:min-content;align-content:center;align-items:start;padding-bottom:2.25rem;border-bottom:1px solid var(--rule)}
.az-list:not(.az-maps):not(.is-filtered) .az-item:first-child .az-cover{grid-row:1/span 6;margin:0}
.az-list:not(.az-maps):not(.is-filtered) .az-item:first-child .az-title{font-size:2rem}
.az-cover{display:block;aspect-ratio:1200/630;overflow:hidden;border-radius:.375rem;background:var(--tint);margin-bottom:.9rem}
.az-cover img{width:100%;height:100%;object-fit:cover}
.az-category{font:700 .72rem var(--head);text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.az-title{margin:.3rem 0 .35rem;font:700 1.3rem/1.2 var(--head);letter-spacing:-.015em}
.az-title a{color:var(--ink);text-decoration:none}
.az-title a:hover{color:var(--accent)}
.az-meta{margin:0 0 .6rem;color:var(--muted);font:400 .85rem var(--head)}
.az-face{width:1.25em;height:1.25em;margin-right:.35em;border-radius:50%;object-fit:cover;vertical-align:-.3em}
.az-summary{margin:0 0 .75rem;color:var(--ink-2)}
.az-links{margin:0;display:flex;flex-wrap:wrap;gap:.4rem 1rem;font:500 .9rem var(--head)}
.az-links a{text-decoration:none}
.az-map::before{content:"◎ "}
.az-from{color:var(--muted)}
.az-from::before{content:"From: "}
.az-empty{color:var(--muted)}
.maps-block[hidden]{display:none}
.site-foot{margin-top:4rem;border-top:1px solid var(--rule);padding:1.5rem 0 2.5rem;font:400 .9rem var(--head);color:var(--muted)}
.site-foot .wrap{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;justify-content:space-between}
.site-foot a{color:var(--muted)}
.made-with a{color:var(--ink-2);text-decoration:none}
.made-with a:hover{color:var(--accent)}
@media (max-width:56rem){.az-list{grid-template-columns:repeat(2,minmax(0,1fr))}
.az-list:not(.az-maps):not(.is-filtered) .az-item:first-child{grid-template-columns:1fr}.az-list:not(.az-maps):not(.is-filtered) .az-item:first-child .az-cover{grid-row:auto}}
@media (max-width:36rem){.az-list{grid-template-columns:1fr}.site-top{flex-direction:column;align-items:flex-start}
.az-list:not(.az-maps):not(.is-filtered) .az-item:first-child .az-title{font-size:1.5rem}}
"""

TABS_JS = """// The tabs filter the list in place; without script every article shows, which is fine.
(function () {
  var tabs = document.querySelectorAll('.site-tabs button');
  var items = document.querySelectorAll('.articles-block .az-item');
  var maps = document.querySelector('.maps-block');
  var articles = document.querySelector('.articles-block');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.setAttribute('aria-pressed', String(t === tab)); });
      var want = tab.dataset.category;
      var onMaps = want === '__maps';
      maps.hidden = !onMaps;
      articles.hidden = onMaps;
      items.forEach(function (item) { item.hidden = !onMaps && want !== '' && item.dataset.category !== want; });
      // a filtered list shows its articles alike: the large first one is the whole list's newest
      var list = articles.querySelector('.az-list');
      if (list) list.classList.toggle('is-filtered', want !== '');
    });
  });
})();
"""

#: What the home may load: its own files, its pictures from the site or any https address a
#: card names, and nothing else; a count adds its own host (`site.stats_sources`).
POLICY = ("default-src 'none'; img-src 'self' https:; font-src 'self'; style-src 'self'; script-src 'self'; "
          "base-uri 'none'; form-action 'none'")


def faces() -> dict[str, bytes]:
    """The home's faces as WOFF, by file name: Azimut's own, cut to the Latin letters. A face
    that cannot be cut is left out, and the style sheet says nothing of it."""
    theme = notes_style.theme_for(NoteLook(style="article"))
    codes = sorted({ord(char) for char in LATIN})
    made: dict[str, bytes] = {}
    for family, weight, style, name in FACES:
        families = theme.heading_family if family == "az-head" else theme.body_family
        files = html_engine.FAMILY_FILES.get(families)
        woff = html_engine._subset(files[(weight, style)], codes) if files else None
        if woff is not None:
            made[f"{name}.woff"] = woff
    return made


def stylesheet(present: set[str]) -> str:
    """The home's style sheet: a rule for each face that exists, then the page's own."""
    rules = "".join(
        f"@font-face{{font-family:{family};font-weight:{weight};"
        f"{'font-style:italic;' if style == 'italic' else ''}src:url(fonts/{name}.woff) format('woff');"
        "font-display:swap}\n"
        for family, weight, style, name in FACES if f"{name}.woff" in present)
    return rules + CSS


def kit(home_site: Site) -> dict[str, bytes]:
    """Every file the default home carries beside itself, by its path from the site's root."""
    woff = faces()
    files: dict[str, bytes] = {STYLE: stylesheet(set(woff)).encode("utf-8"), SCRIPT: TABS_JS.encode("utf-8")}
    files.update({f"{FONTS}/{name}": data for name, data in woff.items()})
    if home_site.logo:
        files[LOGO] = home_site.logo
    if home_site.counter:
        files[COUNT] = html_engine._asset("reader.count.js").encode("utf-8")
    return files


def home(home_site: Site, lines: list[dict[str, Any]], maps: list[dict[str, Any]],
         pages: list[dict[str, str]]) -> str:
    """The home page, its two markers still empty: `site.fill` puts the lists in."""
    e = html.escape
    counts: dict[str, int] = {}
    for line in lines:
        if line["category"]:
            counts[line["category"]] = counts.get(line["category"], 0) + 1
    tabs = [f'<button type="button" data-category="" aria-pressed="true">All<span class="count">{len(lines)}</span></button>']
    tabs += [f'<button type="button" data-category="{site.slug(c)}" aria-pressed="false">{e(c)}'
             f'<span class="count">{n}</span></button>' for c, n in sorted(counts.items())]
    if maps:
        tabs.append(f'<button type="button" data-category="__maps" aria-pressed="false">Maps'
                    f'<span class="count">{len(maps)}</span></button>')
    prefix = home_site.prefix
    links = "".join(f'<a href="{e(site._at(prefix, p["address"]))}">{e(p["title"])}</a>' for p in pages)
    nav = f'<nav class="site-pages">{links}</nav>' if links else ""
    logo = f'<img src="{LOGO}" alt="">' if home_site.logo else ""
    intro = f'\n<p class="site-intro">{e(home_site.tagline)}</p>' if home_site.tagline else ""
    description = e(home_site.tagline or home_site.title)
    credit = (f'\n<span class="made-with"><a href="{site.AZIMUT_REPO}">Made with Azimut {__version__}</a></span>'
              if home_site.credit else "")
    policy = html_engine.widen_policy(POLICY, site.stats_sources(home_site.counter, home_site.beacon))
    counter = f'<meta name="az-counter" content="{e(home_site.counter)}">\n' if home_site.counter else ""
    count_script = f'<script src="{COUNT}" defer></script>' if home_site.counter else ""
    beacon = f"{site.cloudflare_tag(home_site.beacon)}\n" if home_site.beacon else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{policy}">
<meta name="generator" content="Azimut {__version__}">
{counter}<title>{e(home_site.title)}</title><meta name="description" content="{description}">
<link rel="alternate" type="application/rss+xml" title="{e(home_site.title)}" href="feed.xml">
<link rel="stylesheet" href="{STYLE}"><script src="{SCRIPT}" defer></script>{count_script}</head>
<body>
<header class="site-head"><div class="wrap">
<div class="site-top"><a class="site-brand" href="./">{logo}{e(home_site.title)}</a>{nav}</div>{intro}</div></header>
<main class="wrap">
<nav class="site-tabs" aria-label="Categories">{''.join(tabs)}</nav>
<div class="articles-block">
<!-- azimut:articles -->
<!-- /azimut:articles -->
</div>
<div class="maps-block" hidden>
<!-- azimut:articles layout="map" -->
<!-- /azimut:articles -->
</div>
</main>
<footer class="site-foot"><div class="wrap"><span><a href="feed.xml">RSS</a></span>{credit}</div></footer>
{beacon}</body></html>
"""
