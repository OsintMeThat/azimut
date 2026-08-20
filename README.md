<p align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://raw.githubusercontent.com/OsintMeThat/azimut/main/docs/media/lockup-dark.svg"
    >
    <img
      src="https://raw.githubusercontent.com/OsintMeThat/azimut/main/docs/media/lockup-light.svg"
      alt="Azimut"
      height="52"
    >
  </picture>
</p>

<p align="center"><b>The OSINT workspace that runs on your machine.</b></p>

<p align="center">
  <a href="https://pypi.org/project/azimut/"><img alt="PyPI" src="https://img.shields.io/pypi/v/azimut?color=e8a33d"></a>
  <a href="https://pypi.org/project/azimut/"><img alt="Python versions" src="https://img.shields.io/pypi/pyversions/azimut"></a>
  <a href="https://github.com/OsintMeThat/azimut/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/OsintMeThat/azimut/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/OsintMeThat/azimut/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-4c6ef5"></a>
  <a href="https://github.com/OsintMeThat/azimut/releases/latest"><img alt="Platforms" src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-6b7280"></a>
</p>

![One case in Azimut, from the clip that arrives to the proof, the analysis surfaces and the published report](https://raw.githubusercontent.com/OsintMeThat/azimut/main/docs/media/demo.gif)

## Install & run

```bash
pipx install azimut   # isolated app install; plain `pip install azimut` also works
azimut                # starts on http://127.0.0.1:8477 and opens a browser tab
```

No Python? Every release attaches a self-contained binary for Windows, macOS
(Apple Silicon) and Linux on the
[Releases page](https://github.com/OsintMeThat/azimut/releases) — download, run,
and it opens in your browser.

Your cases and settings live under `~/Azimut`, outside the app: upgrading or
removing Azimut leaves them alone. [Install in detail](#install-in-detail) covers
the binaries' first-run warnings, building from source and the development loop.

## What Azimut is

A local OSINT workspace for reviewing media, building geolocation proofs and
keeping case notes together. It is built for open-source investigators,
journalists and researchers. Each case is a plain folder that can be reopened,
archived or shared.

*The name is the French word for azimuth, the compass bearing you sight along
to fix a point on the map.*

| Tool | What it does |
|------|--------------|
| **Board** | The whole case as one sortable table: typed identity fields per entity, one filter bar whose values are all taken from the case, and shared Details. |
| **Graph** | The same case drawn. Lenses pick what a reading is about, nodes cluster, edges carry their verb, and a click opens what a node connects to without losing the picture you were reading. |
| **Timeline** | The same case on a time axis. Dated statements and media stack in coloured tracks, the ruler reads in any zone or at a saved place, date quality is drawn instead of flattened, and the window can be handed to Board, Graph or the map. |
| **Media** | Import local files or download by URL (X, Telegram, TikTok, YouTube, Instagram and more via yt-dlp, with a gallery-dl fallback for image-only posts). Public media is fetched cookie-less; a login-walled post prompts once for a browser session or an exported `cookies.txt`. Each item gets a clean local file, metadata and a SHA-256. Multi-photo posts open a picker. |
| **Files** | Every saved artifact in one Finder-style view of your folders, not just media: select several, drag them into a folder, search across the lot. |
| **Reverse Search** | Prepare an image or a video frame for keyless reverse-image services. Nothing uploads on its own. |
| **Inspect** | A scratch workspace over any photo or video: frame adjustments, editable crop, sharpest-frame capture, hand-made collage with per-piece warp/scale/rotate, auto-stitch to solve a panorama's layout, and ELA hints. Nothing enters the case until you save. |
| **Satellite** | Coordinates or a place name become an imagery crop. The search bar proposes matches as you type: saved work, coordinates and a bundled city list answer offline, and the geocoder fills in the rest once you pause. Select-area capture, map rotation, measurement tools, reference overlays and editable AOI grids for area review. Esri/OSM by default, plus Sentinel-2 with a date calendar and a cloud-ceiling slider; add a Mapbox or Google key for more basemaps. |
| **Coords & Sky** | Convert common coordinate formats, copy the result, open map or geocoding links, and read the sun and moon at that point on a date: rise, set, azimuth, altitude, twilights, moon phase and bright-limb angle, in local time and UTC, computed offline. |
| **Geo Proof** | Start a named proof from a reusable house style, select case panels with search, compose them in a grid or free layout, annotate with colored shapes/freehand/text, and export `proof.png` plus a re-editable spec. |
| **Geo Report** | Turn a proof into a prepared thread for X, Bluesky, or Mastodon: coordinates, plus code, attribution, target-specific character counts, media, and a structured Markdown case note with linked evidence. |
| **Notebook** | Tabbed Markdown notes with local media, Mermaid diagrams, linked case evidence, broken-reference markers, and PDF export of one note or a whole selection. |

Under the hood: reusable proof and thread templates, per-case SQLite with a
bounded catalog, a durable one-worker thumbnail queue, the map-capture browser
extension, and cross-platform binaries with a bundled ffmpeg.

Every tool works one-shot (a scratch session, no setup) or inside a case, a
plain directory holding the whole investigation.

## New in v0.2.8

Entities, graph and timeline:

- Read the whole case as a table, with one filter bar whose values and counts all
  come from the case, and file a person, an account or a statement by hand.
- Draw the same question in the Graph: lenses, clustered nodes, verbs on the
  edges, sources folded onto the edge they stand for, and an undo for the drawing
  that never writes to the case.
- Put dated statements and media on a Timeline, in coloured tracks, on any zone's
  clock, with daylight under the ruler at a saved place.
- Create and edit dates on the axis itself, and measure two entries without
  pretending a coarse date is an exact one.
- Hand one period from Timeline to Board, Graph and a session-only map layer.
  Fact time never mixes with the date something was filed.
- Keep statement confidence and source reliability apart, with support and
  contradiction stated as their own links.
- Date a statement through a guided editor for a year, a day, a bounded range or
  a zoned time range, with the raw syntax still accepted.
- Existing cases upgrade to SQLite schema 17 when they open, and bundles exported
  by v0.2.7 still import.

## Cases on disk

Inside a case, Azimut owns only the `azimut/` directory. `README.txt` explains
the boundary; anything else at the case root is yours and travels with the case
bundle.

The workspace root stays equally readable: permanent case folders sit directly
under `~/Azimut`. Azimut keeps scratch sessions, bundles, settings, runtime
tools and tile caches under the hidden `~/Azimut/.azimut/` directory. Settings →
Storage moves the workspace anywhere you like, including an external drive, or
adopts one you moved yourself. The old copy is kept until you delete it.

The Case Doctor checks case integrity, including the derived Timeline index. It
only changes a case after you choose a repair, and states what a database rebuild
cannot recover before it starts.

## Install in detail

Azimut runs in a normal browser tab (Firefox/Chrome); there is no separate
window. Closing the terminal it prints its URL into stops the app.

Update with `pipx upgrade azimut`, remove with `pipx uninstall azimut`. Your
cases and settings live under `~/Azimut`; upgrades and uninstalling the app do
not remove them. Delete `~/Azimut` manually if you also want to remove the data.

### Ready-to-run binary (no Python)

Each release attaches a self-contained binary per OS. Download it from the
[Releases page](https://github.com/OsintMeThat/azimut/releases) and run it; it
opens Azimut in your browser.

| OS | Asset |
|----|-------|
| Windows | `azimut-windows-x86_64.exe` |
| macOS (Apple Silicon) | `azimut-macos-arm64` |
| macOS (Intel, 14+) | No standalone binary; install with `pipx` or `pip` |
| Linux | `azimut-linux-x86_64` |

First run, the binaries are **unsigned**, so the OS warns before letting them
open:
- **macOS**: right-click the file → **Open** → **Open** (Gatekeeper only
  offers "Open" from the context menu for unidentified developers), or run
  `xattr -d com.apple.quarantine ./azimut-macos-*` once.
- **Windows**: SmartScreen shows "Windows protected your PC"; click **More
  info** → **Run anyway**.
- **Linux**: mark it executable with `chmod +x azimut-linux-x86_64`.

Azimut checks for a newer release on startup by default and links the download.
Settings can disable that check, and **Settings → System → Check for updates**
runs it manually. Replace the old binary with the new one. To uninstall, delete
the binary. Either way `~/Azimut` stays put, so cases open unchanged.

The downloadable binaries bundle a static **ffmpeg** (and ffprobe), so video
thumbnails, frame scans, video enhancement, and downloads that merge separate
audio+video streams work out of the box. If you `pip install azimut` instead,
put ffmpeg on your `PATH` for those features. Everything else works without it.
The bundled ffmpeg is redistributed under its own license; see
[ffmpeg.org/legal.html](https://ffmpeg.org/legal.html).

### From source

Requires Python 3.11+ and Node.js 20+ for the frontend build.

macOS and Linux:

```bash
git clone https://github.com/OsintMeThat/azimut && cd azimut
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cd frontend && npm ci && npm run build && cd ..
.venv/bin/azimut
```

Windows PowerShell:

```powershell
git clone https://github.com/OsintMeThat/azimut
Set-Location azimut
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
Set-Location frontend
npm ci
npm run build
Set-Location ..
.venv\Scripts\azimut.exe
```

Rebuild and relaunch the local app with the cross-platform helper:

```bash
python3 scripts/relaunch.py       # macOS / Linux
py scripts\relaunch.py            # Windows
```

The tool rebuilds the frontend, stops the previous Azimut instance started
through the same tool, and launches the fresh build. It never kills unrelated
processes by name. Use `--no-browser` to keep it from opening a new tab.

Frontend development (hot reload, proxied API):

```bash
.venv/bin/azimut --no-browser &     # backend on :8477
cd frontend && npm run dev          # UI on :5173
```

Checks (CI runs these on every push):

```bash
uv run ruff check src tests   # lint
uv run mypy                    # type-check the backend
cd frontend && npm run check   # svelte-check (blocks on errors)
```

### Capture extension (optional)

A browser extension (Chrome/Edge and Firefox) captures external map sites
straight into a case: Google Maps & Earth, Bing, Yandex, OSM, Apple Maps,
Zoom Earth, Copernicus Browser and Satellites.pro, one screenshot per click
with coordinates parsed from the URL. It also powers the Capture button on
the Google (Maps JS) basemap. Install it from **Settings → Capture extension**
(download the zip, load unpacked, pair with the token shown there); full
instructions in [extension/README.md](extension/README.md).

## Building & releasing

The Svelte frontend builds into `src/azimut/static/` (git-ignored) and is
bundled into the Python wheel via hatchling `artifacts`. So `npm run build`
**must** run before building the package, or the shipped UI is stale.

```bash
cd frontend && npm run build && cd ..    # refresh the bundled UI
uv sync --frozen --no-dev --group release --no-install-project
uv sync --frozen --no-dev --group release --no-build-isolation --no-editable
uv run --no-sync python -m build --no-isolation
uv run --no-sync pyinstaller packaging/azimut.spec
```

### Versions

The app version lives in `src/azimut/__init__.py` alone; `pyproject.toml` reads
it back, and the release tag must match it.

The capture extension keeps **its own** version: the app release that last
changed a shipped file, so it lags whenever the extension is left alone.
Settings reads "bundled newer than installed" as "go reinstall the unpacked
folder", which is worth saying once and never for a zip that hasn't moved.
`tests/test_updates.py` digests what `extension.zip` carries and fails either
way — a change without a bump, or a bump without a change. When you do change
the extension, set `extension/manifest.json` to the current app version and
record the digest the failing test prints.

### Dependencies

`pyproject.toml` declares **ranges** (the contract for `pip install azimut`
users); `uv.lock` pins the **exact** set, and is what CI and the release
builds install. The wheel only declares its dependencies, but the binary
*contains* them, so building it outside the lock ships whatever the resolver
happened to pick that day.

```bash
uv lock --check                  # CI does this: is the lock in sync with pyproject?
uv lock --upgrade                # refresh everything, then run the suite
uv lock --upgrade-package yt-dlp # refresh one
```

Raising an upper bound is a deliberate act: bump it in `pyproject.toml`, run
`uv lock`, and make sure the suite passes before it lands. The weekly
"latest deps" CI job re-resolves past the lock, so upstream breakage shows up
as a red run of ours rather than a broken install for someone else.

The map's offline city list is data, not a dependency:
`src/azimut/engine/data/cities.tsv.gz`, about 770 KiB, trimmed from GeoNames
(CC BY 4.0) by `python scripts/build_cities.py`. Rebuild it when it goes stale;
nothing else reads it.

**yt-dlp and gallery-dl are deliberately unbounded**: they track sites that
change, so pinning them just schedules a breakage. They can also be updated
from inside the app (Settings → System → Downloaders), which is what keeps a
months-old binary working.

Releases are automated: push a semver tag and GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds the
wheel + Windows/Linux/macOS binaries, attaches them to a GitHub release, and
publishes to PyPI. **Don't publish by hand.**

```bash
git tag v0.2.8 && git push origin v0.2.8
```

One-time setup: register the repo as a
[PyPI Trusted Publisher](https://docs.pypi.org/trusted-publishers/) for the
`azimut` project (no API token to store).

## Principles

1. No account, telemetry or automatic upload. The server binds to
   `127.0.0.1`, and Azimut never posts on your behalf.
2. A case contains the investigation's files and SQLite graph. A closed case
   folder is complete and portable; bundle export carries both Azimut's files
   and anything kept beside them.
3. One tab = one tool, useful in 30 seconds.
4. Azimut integrates specialized services instead of recreating them.
5. The analyst decides; tools do not produce automated verdicts.
6. Every artifact records how it was produced.
7. Free and open source. No paid key is ever required; bring your own for
   more basemaps.

Full spec: [docs/SPEC.md](docs/SPEC.md).

## License

[AGPL-3.0-only](LICENSE): free and open source; hosted or modified versions
must share their source.
