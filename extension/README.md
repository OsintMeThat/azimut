# Azimut Capture — browser extension

Files the map you are looking at into [Azimut](https://github.com/OsintMeThat/azimut)
as a `capture` with provenance: one screenshot per explicit click, coordinates
read from the page **URL only** (never scraped from the page), source URL +
site + timestamp always recorded, attribution burned into the image footer by
the app.

The extension is deliberately thin: it screenshots and it sends the URL —
**all URL parsing (sites, coordinates, place names, imagery dates) happens in
the Azimut app**, so when a map site changes its URL format, updating Azimut
fixes it and the extension never needs a reinstall.

It serves two flows:

- **External map sites** — Google Maps, Google Earth (web), Bing Maps, Yandex
  Maps, OpenStreetMap, Apple Maps, Zoom Earth, Copernicus Browser, and
  whatever Azimut learns to recognize later. Click the toolbar icon (or
  `Alt+Shift+A`): a popup shows what Azimut parsed from the URL (correctable),
  a case picker, and one button — drag the area to capture. The result
  appears in the open app instantly. On any other kind of site the extension
  refuses: it is for maps only.
- **Azimut's own Google (Maps JS) basemap** — the app's Capture button asks
  the extension for the tab's pixels instead of prompting for a screen share.
  No pairing needed for this: the app files everything itself, same-origin.

## Install

Get the zip from Azimut → **Settings → Capture extension** (or use this
folder directly from a repo checkout), unzip it somewhere permanent, then:

- **Chrome / Edge / Brave** (Windows, macOS, Linux): open
  `chrome://extensions`, enable **Developer mode** (top right), click
  **Load unpacked**, pick the unzipped folder. The folder must stay in place —
  Chrome loads it from there on every start.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, pick `manifest.json` inside the unzipped folder.
  Firefox drops temporary add-ons when it closes — reload it next session, or
  use Firefox Developer Edition / ESR with `xpinstall.signatures.required`
  set to `false` in `about:config` for a permanent install.

## Pair (external sites only)

1. Azimut → **Settings → Capture extension** → copy the pairing token.
2. Extension options (right-click the toolbar icon → Options) → paste the
   token → **Save & test**.

The token only authorizes filing captures into your local Azimut
(`127.0.0.1`) — nothing ever leaves your machine. Rotate it from Azimut
Settings at any time; every paired extension then needs the new one.

## Permissions, and why

| Permission | Why |
|---|---|
| `activeTab` | read the URL + screenshot the tab you pressed the button on — granted per click, per tab. This is also why the **first** capture from Azimut's own Capture button on a fresh tab asks you to click the extension icon once: browsers refuse tab screenshots (`captureVisibleTab`) until the extension has been invoked on that tab, and the alternative — the `<all_urls>` permission — would mean "read all data on all websites", which this extension will never request |
| `scripting` | inject the area-selection overlay when you choose "Select area" |
| `storage` | the backend URL, pairing token and last-used case |
| `notifications` | report the result of an area capture (the popup has closed by then) |
| `http://127.0.0.1/*`, `http://localhost/*` | talk to the local Azimut app and answer its Capture button |

No history access, no reading pages, no remote servers.
