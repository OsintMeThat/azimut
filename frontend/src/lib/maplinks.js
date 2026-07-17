// Quick-jump links to external maps we can't embed in-tool, for a coordinate.
// Used by the Satellite "Open in…" panel: the point is to reach the maps that
// aren't reachable from inside Azimut (Esri/OSM are already in-tool tile
// providers, so they're deliberately left out). Pure URL construction.
export function mapLinks(lat, lon, zoom = 17) {
  const z = Math.round(zoom);
  return [
    { id: 'google', label: 'Google Maps', url: `https://www.google.com/maps/@${lat},${lon},${z}z` },
    {
      id: 'google_sat',
      label: 'Google Satellite',
      url: `https://www.google.com/maps/@${lat},${lon},2000m/data=!3m1!1e3`,
    },
    {
      id: 'google_earth',
      label: 'Google Earth',
      url: `https://earth.google.com/web/@${lat},${lon},0a,1000d,35y,0h,0t,0r`,
    },
    {
      id: 'apple',
      label: 'Apple Maps',
      // t=k selects the satellite/hybrid basemap
      url: `https://maps.apple.com/?ll=${lat},${lon}&z=${z}&t=k`,
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
    { id: 'zoom_earth', label: 'Zoom Earth', url: `https://zoom.earth/#view=${lat},${lon},${z}z` },
  ];
}
