# Azimut

Azimut is a local OSINT workspace for reviewing media, building geolocation
proofs and keeping case notes together.

It is built for open-source investigators, journalists and researchers. Each
case is a plain folder that can be reopened, archived or shared.

*The name is the French word for azimuth, the compass bearing you sight along
to fix a point on the map.*

## v0.2.1: Scalable case workspace

| Tool | What it does |
|------|--------------|
| **Media Library** | Import local files or download by URL (X, Telegram, TikTok, YouTube, Instagram and more via yt-dlp, with a gallery-dl fallback for image-only posts). Each item gets a clean local file, metadata and a SHA-256. Multi-photo posts open a picker. |
| **Inspect** | A scratch workspace over any photo or video: frame adjustments, editable crop, sharpest-frame capture, hand-made collage with per-piece warp/scale/rotate, and auto-stitch to solve a panorama's layout for you. Nothing enters the case until you save. |
| **Satellite** | Coordinates or a place name become an imagery crop, with select-area capture, map rotation, measurement tools and reference-image overlays. Esri/OSM by default; add a Mapbox or Google key for more basemaps. |
| **Geo Proof** | Start a named proof from a reusable house style, select case panels with search, compose them in a grid or free layout, annotate with colored shapes/freehand/text, and export `proof.png` plus a re-editable spec. |
| **Geo Report** | Turn a proof into a prepared thread for X, Bluesky, or Mastodon: coordinates, plus code, attribution, target-specific character counts, media, and a structured Markdown case note with linked evidence. |

Every tool works one-shot (a scratch session, no setup) or inside a case, a
plain directory holding the whole investigation.

New in v0.2.1:

- Existing JSON case graphs migrate automatically to per-case SQLite on open.
  Media, notes and proofs remain ordinary files, the original graph is retained
  as a recoverable backup, and a closed case folder stays portable.
- The case sidebar now loads a bounded catalog, with folders, suggestions and
  unfiled work fetched as needed. Video thumbnails use a durable one-worker
  queue, so large cases remain responsive.
- Case Notebook adds tabbed Markdown notes with local media, linked evidence,
  broken-reference markers and a print-ready PDF view.
- Geo Proof, Geo Report, Inspect and Satellite now have clearer, componentised
  canvas workflows. Browser tests exercise real Konva and Leaflet gestures in
  Chromium and Firefox.
- Release builds now use the lock for distribution tooling, smoke-test the
  launched binary and verify its bundled `ffmpeg` and `ffprobe`. The local
  relaunch helper works on Windows, Linux and macOS.

## Install & run

```bash
pipx install azimut   # isolated app install; plain `pip install azimut` also works
azimut                # starts on http://127.0.0.1:8477 and opens a browser tab
```

Update with `pipx upgrade azimut`, remove with `pipx uninstall azimut`. Your
cases and settings live under `~/Azimut`; upgrades and uninstalling the app do
not remove them. Delete `~/Azimut` manually if you also want to remove the data.

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
| macOS (Intel) | No standalone binary; install with `pipx` or `pip` |
| Linux | `azimut-linux-x86_64` |

Intel Macs are supported through the Python package. They do not have a
downloadable standalone binary.

First run, the binaries are **unsigned**, so the OS warns before letting them
open:
- **macOS**: right-click the file → **Open** → **Open** (Gatekeeper only
  offers "Open" from the context menu for unidentified developers), or run
  `xattr -d com.apple.quarantine ./azimut-macos-*` once.
- **Windows**: SmartScreen shows "Windows protected your PC"; click **More
  info** → **Run anyway**.
- **Linux**: mark it executable with `chmod +x azimut-linux-x86_64`.

To update, **Settings → About → Check for updates** tells you when a newer
release is out and links the download; replace the old file with the new one.
To uninstall, delete the file. Either way `~/Azimut` stays put, so your cases
open unchanged in the new version.

The downloadable binaries bundle a static **ffmpeg** (and ffprobe), so video
thumbnails, frame scans, video enhancement, and downloads that merge separate
audio+video streams work out of the box. If you `pip install azimut` instead,
put ffmpeg on your `PATH` for those features. Everything else works without it.
The bundled ffmpeg is redistributed under its own license; see
[ffmpeg.org/legal.html](https://ffmpeg.org/legal.html).

From source:

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
git tag v0.2.1 && git push origin v0.2.1
```

One-time setup: register the repo as a
[PyPI Trusted Publisher](https://docs.pypi.org/trusted-publishers/) for the
`azimut` project (no API token to store).

## Principles

1. **Local-first, privacy-first.** No account, no telemetry, no upload; the
   server binds to `127.0.0.1` only, and Azimut never posts anywhere on your
   behalf.
2. **The case is the product.** Media and notes stay as files and the graph lives
   in per-case SQLite. A closed case folder is complete and portable; a ZIP
   import/export workflow is planned.
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
