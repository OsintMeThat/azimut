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
| **Inspect** | Scratch workspace over any photo/video: frame adjustments, editable crop, sharpest-frame capture, hand-made collage with per-piece warp/scale/rotate — nothing enters the case until you save. |
| **Satellite** | Coordinates or place name → imagery crop, with select-area capture, map rotation, measurement tools, and reference-image overlays. Esri/OSM by default; add your own Mapbox/Google key for more basemaps (stored locally, never shared). |
| **Proof Composer** | Compose panels side by side, annotate with colored shapes and text (same color = same feature), reorderable legend → export `proof.png` + a re-editable spec. |
| **Post Composer** | Turn a proof into a publishable thread: coordinates in all formats, plus code, attribution, character count, RTL-safe text. Copy-paste ready — Azimut never posts for you. |

Every tool works **one-shot** (no setup, scratch session) or inside a **case**
— a plain directory holding the whole investigation.

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

## Building & releasing

The Svelte frontend builds into `src/azimut/static/` (git-ignored) and is
bundled into the Python wheel via hatchling `artifacts`. So `npm run build`
**must** run before building the package, or the shipped UI is stale/missing.

```bash
cd frontend && npm run build && cd ..   # refresh the bundled UI
python -m build                          # wheel + sdist (UI included)
pyinstaller packaging/azimut.spec        # optional: standalone binary
```

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
