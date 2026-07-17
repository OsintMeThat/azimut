# Azimut

**The OSINT investigator's workbench.** One case, one folder, every tool.
Local-first: your media and your investigations never leave your machine.

Built for the open-source-investigation community — GeoConfirmed contributors,
journalists, researchers.

> Close Azimut. Reopen the case six months later. Everything is there: the
> downloaded media, the annotated proofs, the entities and their links, the
> notes, the exports — in one plain folder you can zip, git, or share.

*The name is the French word **azimut** — the compass bearing you sight along to
fix a point on the map (English *azimuth*). A fitting namesake for a geolocation
workbench: fix a direction, fix a location.*

## v0.1.1 — Proof Studio

| Tool | What it does |
|------|--------------|
| **Media Library** | Import local files or download by URL (X, Telegram, TikTok, YouTube, Instagram… via yt-dlp, with a gallery-dl fallback for image-only posts) → clean local file + metadata + SHA-256. Multi-photo posts open a picker. |
| **Inspect** | Scratch workspace over any photo/video: frame adjustments, editable crop, sharpest-frame capture, hand-made collage with per-piece warp/scale/rotate, and **auto-stitch** to solve a panorama's layout for you (then hand-tune it) — nothing enters the case until you save. |
| **Satellite** | Coordinates or place name → imagery crop, with select-area capture, map rotation, measurement tools, and reference-image overlays. Esri/OSM by default; add your own Mapbox/Google key for more basemaps (stored locally, never shared). |
| **Proof Composer** | Compose panels in a grid or free layout, annotate with colored shapes and text (same color = same feature), reorderable legend → export `proof.png` + a re-editable spec. |
| **Post Composer** | Turn a proof into a publishable thread: coordinates in all formats, plus code, attribution, character count, RTL-safe text. Copy-paste ready — Azimut never posts for you. |

Every tool works **one-shot** (no setup, scratch session) or inside a **case**
— a plain directory holding the whole investigation.

**New in v0.1.1** — a polish pass over the v1 tools:

- **Satellite** — OSM labels overlay, true browser fullscreen, Esri overzoom
  (upscales past World Imagery's last level instead of a "not available" tile),
  and imagery acquisition dates surfaced on the map and in captures.
- **Keyed providers** — a Settings tab for Mapbox/Google keys with per-provider
  toggles, monthly usage counters, a soft block at 90% of the free tier, an eco
  mode that falls back to free imagery when zoomed out, and a disk tile cache.
  Free by default: keys stay optional and local.
- **Proof Composer** — free layout mode (drag panels anywhere, overlap with
  z-order), corner-drag panel resize, and satellite panels that auto-caption
  with provider · coordinates · imagery date.
- **Inspect** — shift-click a block of collage pieces to move, scale and rotate
  them as one.

## Install & run

```bash
pip install azimut
azimut            # starts on http://127.0.0.1:8477 and opens your browser
```

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

A small browser extension (Chrome/Edge + Firefox) files the map you are
looking at straight into a case: external map sites (Google Maps & Earth,
Bing, Yandex, OSM, Apple Maps, Zoom Earth, Satellites.pro — one screenshot
per click, coordinates parsed from the URL), and it is also what powers the
Capture button on the Google (Maps JS) basemap. Install it from **Settings →
Capture extension** (download the zip, load unpacked, pair with the token
shown there) — full instructions in [extension/README.md](extension/README.md).

## Building & releasing

The Svelte frontend builds into `src/azimut/static/` (git-ignored) and is
bundled into the Python wheel via hatchling `artifacts`. So `npm run build`
**must** run before building the package, or the shipped UI is stale/missing.

```bash
cd frontend && npm run build && cd ..   # refresh the bundled UI
uv sync --frozen                         # the exact deps CI tested
python -m build                          # wheel + sdist (UI included)
uv run pyinstaller packaging/azimut.spec # optional: standalone binary
```

### Dependencies

`pyproject.toml` declares **ranges** (that's the contract for `pip install
azimut` users); `uv.lock` pins the **exact** set, and is what CI and the release
builds install. The wheel only declares its dependencies, but the binary
*contains* them — so building it outside the lock ships whatever the resolver
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

**yt-dlp and gallery-dl are deliberately unbounded** — they track sites that
change, so an old version is a broken version. They're also updatable from
inside the app (Settings → About → Downloaders), which is what keeps a
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

1. **Local-first, privacy-first** — no account, no telemetry, no upload; the
   server binds to `127.0.0.1` only.
2. **The case is the product** — plain JSON + media files, versionable,
   portable.
3. **One tab = one tool**, useful in 30 seconds.
4. **Orchestrator, not replacer** — integrate specialized services, don't clone
   them.
5. **Tools emit facts, the analyst decides** — no automated "magic button".
6. **Honest output** — every artifact records how it was produced.
7. **Free and open source** — no paid keys required, ever. Optional
   bring-your-own-key providers.

Full spec: [docs/SPEC.md](docs/SPEC.md).

## License

[AGPL-3.0-only](LICENSE) — free and open source; hosted or modified versions
must share their source.
