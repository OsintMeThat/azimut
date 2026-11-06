/**
 * What each free imagery source lets a picture of it be used for, in one place:
 * Settings › Imagery shows it, always visible and never as a pop-up. The keyed
 * providers say theirs on their own cards. Each line is the provider's own terms,
 * shortened; the link is the page it comes from.
 */
export const FREE_IMAGERY = [
  {
    id: 'esri',
    name: 'Esri World Imagery and Wayback',
    note: 'The default basemap, and its archive of past releases.',
    reuse: "Esri's terms allow its pictures for personal use, internal work, a report or presentation for a client, "
      + 'academic papers and your own marketing. Anything else, a news article say, needs Esri\'s permission.',
    link: 'https://doc.arcgis.com/en/arcgis-online/reference/static-maps.htm',
  },
  {
    id: 'eox',
    name: 'Sentinel-2 cloudless (EOX)',
    note: 'A cloud-free mosaic a year.',
    reuse: '2016 is CC BY 4.0. From 2018, CC BY-NC-SA 4.0: non-commercial use only, and what is made from it shared alike.',
    link: 'https://cloudless.eox.at/license-non-commercial',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    note: 'The street context map.',
    reuse: 'Free to reuse under the ODbL, credited © OpenStreetMap contributors; a printed picture also carries '
      + 'openstreetmap.org/copyright.',
    link: 'https://osmfoundation.org/wiki/Licence/Attribution_Guidelines',
  },
];
