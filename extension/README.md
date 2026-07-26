# Azimut Capture browser extension

Files map captures, places and bookmarks into
[Azimut](https://github.com/OsintMeThat/azimut). Captures retain their source
URL, timestamp, parsed coordinates when available and visible attribution.

The extension sends the screenshot and page URL. Azimut parses supported sites,
coordinates, place names and imagery dates, so URL-format fixes ship with the
app.

It supports three flows:

- On a supported map site, the popup can capture a selected area or save its
  coordinates as a place.
- On another page, it can save the URL and title as a bookmark without
  downloading the page.
- On Azimut's Google basemap, the in-app Capture button requests the current
  tab image without a screen-share prompt.

## Install

Get the zip from Azimut → **Settings → Capture extension** (or use this
folder directly from a repo checkout), unzip it somewhere permanent, then:

- **Chrome / Edge / Brave** (Windows, macOS, Linux): open
  `chrome://extensions`, enable **Developer mode** (top right), click
  **Load unpacked**, then pick the unzipped folder. Keep the folder in place
  because Chrome loads it there on every start.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, pick `manifest.json` inside the unzipped folder.
  Firefox drops temporary add-ons when it closes. Reload it next session, or
  use Firefox Developer Edition / ESR with `xpinstall.signatures.required`
  set to `false` in `about:config` for a permanent install.

## Pair (external sites only)

1. Azimut → **Settings → Capture extension** → copy the pairing token.
2. Extension options (right-click the toolbar icon → Options) → paste the
   token → **Save & test**.

The token allows this extension to file captures through the local Azimut
server. Rotate it in Settings to revoke existing pairings.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Reads the current URL and captures the tab only after you click the extension. |
| `scripting` | Shows the area-selection overlay. |
| `storage` | Stores the local app URL, pairing token and last-used case. |
| `notifications` | Reports an area capture after the popup closes. |
| `http://127.0.0.1/*`, `http://localhost/*` | Connects to the local Azimut app. |

The in-app Capture button may require one initial toolbar click for a new tab.
Browsers require that gesture before allowing a tab screenshot. The extension
does not request `<all_urls>`, history access or remote-server access.
