# Credits for the guide's pictures

What the pictures of the `?` guide show, and whose it is. The maps carry their
own credit line on screen as well, as the app draws it.

## Photos of the demo case

The guide's pictures are taken in a demo case filed from these photos
(`photos.mjs`). Every one is in the public domain, mostly as the work of a US
federal agency, and was taken from Wikimedia Commons at 1600 px wide with its
metadata stripped. The accounts and posts the demo case says they came from are
made up; the places and dates are the photos' own.

| File | What it shows | Credit | Source |
|---|---|---|---|
| `bridge_channel.jpg` | The Vincent Thomas Bridge and the Evergreen terminal over the Main Channel, Port of Los Angeles, 3 February 2009 | U.S. Food and Drug Administration | [Commons](https://commons.wikimedia.org/wiki/File:FDA%E2%80%99s_China_Offices_Focus_on_Product_Safety_(6549753597).jpg) |
| `channel_departure.jpg` | A ship leaving the Port of Los Angeles by the Main Channel, 15 May 2020 | U.S. Navy | [Commons](https://commons.wikimedia.org/wiki/File:200515-N-VI515-1131_(49909392933).jpg) |
| `container_yard.jpg` | A container yard on Terminal Island with the Vincent Thomas Bridge behind, 2 November 2006 | U.S. Customs and Border Protection | [Commons](https://commons.wikimedia.org/wiki/File:Port_of_Long_Beach,_California_-4.jpg) |
| `wando_terminal.jpg` | The Wando Welch Terminal, Mount Pleasant, South Carolina, 19 November 2020 | U.S. Department of Agriculture | [Commons](https://commons.wikimedia.org/wiki/File:20201119-TFAA-LSC-0050_(50700627321).jpg) |
| `miami_port_aerial.jpg` | The container port of Miami from the air | U.S. Customs and Border Protection | [Commons](https://commons.wikimedia.org/wiki/File:Aerial_photograph_of_the_Port_of_Miami_Container_Port.jpg) |
| `half_dome_1901.jpg` | Half Dome, Vernal and Nevada Falls from Glacier Point, Yosemite, 1901, its plate border trimmed | California Historical Society, photographer unknown | [Commons](https://commons.wikimedia.org/wiki/File:Vernal_Falls,_Nevada_Falls_and_Half_Dome_from_Glacier_Point_in_Yosemite_National_Park,_California,_1901_(CHS-1175).jpg) |

`half_dome_1901.jpg` also ships in the app, which files it with its source when a
reader presses *Try this search* (`src/lib/findExample.js`).

A replacement keeps to the same rule: public domain or CC0, no face anyone
could recognise, metadata stripped, and a line here.

## Maps and imagery

| Where it shows | What it is | Credit |
|---|---|---|
| Satellite, Compare, Detect, Horizon's ground, the proof's capture | USGS The National Map orthoimagery | Public domain |
| Create your analyzer: the Al Udeid Air Base passes of 27 July and 30 September 2026 | Copernicus Sentinel-2, read through Sentinel Hub | Contains modified Copernicus Sentinel data 2026. Free and open under the Copernicus data policy |
| The capture extension's pictures, the analyzer library's map | OpenStreetMap tiles | © OpenStreetMap contributors, ODbL |
| Compare's map side | OpenTopoMap | Map data © OpenStreetMap contributors, SRTM; map style © OpenTopoMap (CC-BY-SA) |
| Place and peak names, the plate's ground | OpenFreeMap | © OpenMapTiles, data © OpenStreetMap contributors |
| Horizon's terrain | Mapterhorn elevation | © Mapterhorn, as the app credits it |

The Sentinel-2 passes are not fetched when the pictures are made: they are copied
from the tile cache of an Azimut that already read them, for the Detect tutorial
film (`airbase.mjs`). No base map with restrictive terms (Esri, Google) is shown in
a picture.
