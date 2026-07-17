# Azimut

The OSINT investigator's workbench: one case, one folder, every tool.
Local-first, so your media and your investigations stay on your machine.

Built for the open-source-investigation community: GeoConfirmed contributors,
journalists, researchers. Reopen a case months later and everything is still
there, in one plain folder you can zip, git, or share.

*The name is the French word for azimuth, the compass bearing you sight along
to fix a point on the map.*

## v0.1.1 — Proof Studio

| Tool | What it does |
|------|--------------|
| **Media Library** | Import local files or download by URL (X, Telegram, TikTok, YouTube, Instagram and more via yt-dlp, with a gallery-dl fallback for image-only posts). Each item gets a clean local file, metadata and a SHA-256. Multi-photo posts open a picker. |
| **Inspect** | A scratch workspace over any photo or video: frame adjustments, editable crop, sharpest-frame capture, hand-made collage with per-piece warp/scale/rotate, and auto-stitch to solve a panorama's layout for you. Nothing enters the case until you save. |
| **Satellite** | Coordinates or a place name become an imagery crop, with select-area capture, map rotation, measurement tools and reference-image overlays. Esri/OSM by default; add a Mapbox or Google key for more basemaps. |
| **Proof Composer** | Compose panels in a grid or free layout, annotate with colored shapes and text (same color = same feature), write a per-color legend, and export `proof.png` plus a re-editable spec. |
| **Post Composer** | Turn a proof into a publishable thread: coordinates, plus code, attribution, character count, RTL-safe text, ready to paste into X. |

Every tool works one-shot (a scratch session, no setup) or inside a case, a
plain directory holding the whole investigation.

New in v0.1.1, a polish pass over the v1 tools:

- Satellite: OSM labels overlay, true browser fullscreen, Esri overzoom past
  World Imagery's last level, and imagery acquisition dates on the map and in
  captures.
- Keyed providers: a Settings tab for Mapbox/Google keys with per-provider
  toggles, monthly usage counters, a soft block at 90% of the free tier, an
  eco mode that uses free imagery when zoomed out, and a disk tile cache.
  Keys stay optional and local.
- Proof Composer: free layout mode with z-order, corner-drag panel resize,
  and satellite panels that auto-caption with provider, coordinates and
  imagery date.
- Inspect: shift-click a block of collage pieces to move, scale and rotate
  them as one.

## Install & run

```bash
pip install azimut
azimut            # starts on http://127.0.0.1:8477 and opens a browser tab
```

Azimut runs in a normal browser tab (Firefox/Chrome); there is no separate
window. Closing the terminal it prints its URL into stops the app.

### Ready-to-run binary (no Python)

Each release attaches a self-contained binary per OS. Download it from the
[Releases page](https://github.com/OsintMeThat/azimut/releases) and run it; it
opens Azimut in your browser.

| OS | Asset |
|----|-------|
| Windows | `azimut-windows-x86_64.exe` |
| macOS (Apple Silicon) | `azimut-macos-arm64` |
| macOS (Intel) | `azimut-macos-x86_64` |
| Linux | `azimut-linux-x86_64` |

First run, the binaries are **unsigned**, so the OS warns before letting them
open:
- **macOS**: right-click the file → **Open** → **Open** (Gatekeeper only
  offers "Open" from the context menu for unidentified developers), or run
  `xattr -d com.apple.quarantine ./azimut-macos-*` once.
- **Windows**: SmartScreen shows "Windows protected your PC"; click **More
  info** → **Run anyway**.
- **Linux**: mark it executable with `chmod +x azimut-linux-x86_64`.

Optional: install **ffmpeg** on your `PATH` for video thumbnails and video
metadata (dimensions/duration). Everything else works without it.

From source:

```bash
git clone https://github.com/OsintMeThat/azimut && cd azimut
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cd frontend && npm install && npm run build && cd ..
.venv/bin/azimut
```

Frontend development (hot reload, proxied API):

```bash
.venv/bin/azimut --no-browser &     # backend on :8477
cd frontend && npm run dev          # UI on :5173
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
uv sync --frozen                         # the exact deps CI tested
pipx run build                           # wheel + sdist (UI included)
uv run pyinstaller packaging/azimut.spec # optional: standalone binary
```

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

**yt-dlp and gallery-dl are deliberately unbounded**: they track sites that
change, so pinning them just schedules a breakage. They can also be updated
from inside the app (Settings → About → Downloaders), which is what keeps a
months-old binary working.

Releases are automated: push a semver tag and GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds the
wheel + Windows/Linux/macOS binaries, attaches them to a GitHub release, and
publishes to PyPI. **Don't publish by hand.**

```bash
git tag v0.1.0 && git push origin v0.1.0
```

One-time setup: register the repo as a
[PyPI Trusted Publisher](https://docs.pypi.org/trusted-publishers/) for the
`azimut` project (no API token to store).

## Principles

1. **Local-first, privacy-first.** No account, no telemetry, no upload; the
   server binds to `127.0.0.1` only, and Azimut never posts anywhere on your
   behalf.
2. **The case is the product.** Plain JSON + media files, versionable,
   portable.
3. One tab = one tool, useful in 30 seconds.
4. **Orchestrator, not replacer.** Integrate specialized services rather than
   cloning them.
5. Tools emit facts; the analyst decides. No automated "magic button".
6. **Honest output.** Every artifact records how it was produced.
7. Free and open source. No paid key is ever required; bring your own for
   more basemaps.

Full spec: [docs/SPEC.md](docs/SPEC.md).

## License

[AGPL-3.0-only](LICENSE): free and open source; hosted or modified versions
must share their source.
