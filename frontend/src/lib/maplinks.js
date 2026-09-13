// Quick-jump links to external maps we can't embed in-tool, for a coordinate.
// Used by the Satellite "Open in…" panel: the point is to reach the maps that
// aren't reachable from inside Azimut (Esri/OSM are already in-tool tile
// providers, so they're deliberately left out). Pure URL construction.
//
// Every form here was opened in a real browser at a known zoom and read back
// out of the address bar, and `docs/MAP_SITES.md` records what came back. Two
// rules came out of that and are worth stating where the URLs are written:
//
// * **The zoom is the same number on all of them.** Google's `z`, Bing's `lvl`,
//   Yandex's `z`, Copernicus's `zoom`, Zoom Earth's `z`, Satellites.pro's third
//   field and Apple's `z` are all the tile level of a 256-pixel Web Mercator —
//   measured, not assumed, including Apple's, whose documentation declines to
//   say so.
// * **Order and layer are not.** Yandex writes longitude first. Zoom Earth
//   opens its weather layer unless the path says otherwise. Google needs a
//   `data=` code for satellite, and passing it a distance in metres instead of
//   a zoom lands somewhere else entirely.
export function mapLinks(lat, lon, zoom = 17) {
  const z = Math.round(zoom);
  return [
    { id: 'google', label: 'Google Maps', url: `https://www.google.com/maps/@${lat},${lon},${z}z` },
    {
      id: 'google_sat',
      label: 'Google Satellite',
      // the zoom is kept and `!3m1!1e3` picks the imagery: Google rewrites it
      // into its own `,3231m` viewport height on arrival, at this same level
      url: `https://www.google.com/maps/@${lat},${lon},${z}z/data=!3m1!1e3`,
    },
    {
      id: 'google_earth',
      label: 'Google Earth',
      // Earth takes a camera distance and a field of view, not a zoom, and it
      // honours both: `1y` here once opened every link 35 times too close.
      url: `https://earth.google.com/web/@${lat},${lon},0a,${earthDistance(z, lat)}d,${EARTH_FOV}y,0h,0t,0r`,
    },
    {
      id: 'apple',
      label: 'Apple Maps',
      // map=satellite selects the satellite basemap in Apple's current web URL
      url: `https://maps.apple.com/?ll=${lat},${lon}&z=${z}&map=satellite`,
    },
    { id: 'bing', label: 'Bing Maps', url: `https://www.bing.com/maps?cp=${lat}~${lon}&lvl=${z}&style=h` },
    {
      id: 'yandex',
      label: 'Yandex Satellite',
      url: `https://yandex.com/maps/?ll=${lon},${lat}&z=${z}&l=sat`,
    },
    {
      id: 'sentinel',
      label: 'Copernicus Browser',
      url: `https://browser.dataspace.copernicus.eu/?zoom=${z}&lat=${lat}&lng=${lon}`,
    },
    {
      id: 'zoom_earth',
      label: 'Zoom Earth',
      // /maps/satellite/ or it opens on the live weather layer instead
      url: `https://zoom.earth/maps/satellite/#view=${lat},${lon},${z}z`,
    },
    {
      id: 'satellites_pro',
      label: 'Satellites.pro',
      url: `https://satellites.pro/#${lat},${lon},${z}`,
    },
  ];
}

/** Metres of ground per pixel at the equator, zoom 0, on 256-pixel tiles. */
const EQUATOR_M_PER_PX = (2 * Math.PI * 6378137) / 256;

/** The field of view Earth writes for itself, in degrees. */
const EARTH_FOV = 35;

/** The window height a link is sized for, in CSS pixels. Earth's view covers
 *  the same ground in any window, so a shorter one lands a little further out. */
const EARTH_WINDOW_PX = 1000;

/**
 * How far Google Earth's camera sits from the ground for a tile zoom, in metres.
 *
 * Earth's 2D map covers `2·d·tan(y/2)` metres of ground across the window's
 * height, measured in a browser (`engine/mapsites.py`, `_earth_height_m`), so a
 * level `z` of Web Mercator in a 1000 px window is the `d` below. The ground's
 * height is not in a link, so Earth draws it that much closer until the map is
 * first moved.
 */
function earthDistance(zoom, lat) {
  const metresPerPx = (EQUATOR_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / 2 ** Math.max(0, zoom);
  const halfFov = (EARTH_FOV * Math.PI) / 360;
  return Math.max(25, Math.round((metresPerPx * EARTH_WINDOW_PX) / (2 * Math.tan(halfFov))));
}
