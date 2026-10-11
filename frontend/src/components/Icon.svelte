<script module>
  /** Inline icon set (24×24, stroke-based, lucide-style). No external assets.
   *  Exported so code that has to build SVG outside a component (the map's
   *  marker glyphs) draws from this one set instead of copying paths. */
  export const paths = {
    // navigation / tools
    media: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 11 4.5-4.5a1 1 0 0 1 1.4 0L14 15.5m-1.5-1.5 2.6-2.6a1 1 0 0 1 1.4 0L21 15M9 9.5h.01',
    satellite: 'M9 4.2 3.6 6.4a1 1 0 0 0-.6.9v11.2a1 1 0 0 0 1.4.9L9 17.4l6 2.4 5.4-2.2a1 1 0 0 0 .6-.9V5.5a1 1 0 0 0-1.4-.9L15 6.6 9 4.2Zm0 0v13.2M15 6.6v13.2',
    compare: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm8 0v14M7 9h2m6 6h2',
    proof: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm11.5 0v7m-3.5-3.5h7',
    // the case as its graph: one entity and what it holds onto. The three spokes
    // sit on the rose's thirds — north, then 210° and 330° — so the case reads in
    // the same geometry as the mark
    graph: 'M12 11.6a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM12 3.5a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8ZM4.7 16.1a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8ZM19.3 16.1a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8ZM12 7.3v4.3M10.1 14.9 6.4 17.1M13.9 14.9l3.7 2.2',
    post: 'M20 4 9 15m11-11-6.5 17-2.7-7.5L3 10.5 20 4Z',
    // ui
    plus: 'M12 5v14m-7-7h14',
    minus: 'M5 12h14',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-1.5l1.6-6A1.5 1.5 0 0 0 20.1 10H6.4a2 2 0 0 0-1.9 1.4L3 16',
    folderMinus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm6 6h6',
    x: 'M6 6l12 12M18 6 6 18',
    chevronRight: 'm9 6 6 6-6 6',
    chevronLeft: 'm15 6-6 6 6 6',
    chevronDown: 'm6 9 6 6 6-6',
    chevronUp: 'm6 15 6-6 6 6',
    panelRight: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm11 0v16',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35',
    trash: 'M4 7h16m-2 0-1 13H7L6 7m3 0V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-6 4v6m4-6v6',
    download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    upload: 'M12 15V3m0 0 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    link: 'M10 14a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    // a source attached to what is being written: the entry line's evidence press
    paperclip: 'M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3',
    copy: 'M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm-4 8V4a1 1 0 0 1 1-1h12',
    save: 'M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 0v5h7V3M7 21v-7h10v7',
    check: 'm4.5 12.5 5 5 10-11',
    note: 'M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6m-6 4h4',
    pin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',
    flag: 'M5 21V3m0 1h13l-3 4 3 4H5',
    // Map symbols for infrastructure, vehicles and conflict observations.
    radar: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l7-7M7 14h.01M14 17h.01',
    radarAntenna: 'M5 5a9 9 0 0 0 14 14L5 5Zm7 7 7-7m-1-1 2 2M11 16v5M7 21h9',
    telecomAntenna: 'M12 8v13M8 21l4-9 4 9M6 3a8 8 0 0 0 0 10m12-10a8 8 0 0 1 0 10M9 6a4 4 0 0 0 0 4m6-4a4 4 0 0 1 0 4M12 6h.01',
    powerPylon: 'M12 3 6 21m6-18 6 18M7 7h10M5 11h14M8 7l8 4-8 6 8 4M5 11v3m14-3v3M4 21h16',
    tank: 'M6 13h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8Zm0 4h12M7 13V9h7l3 4M14 9h7',
    armouredVehicle: 'M3 16V9h12l6 5v3H3M5 9l2-4h7l2 4M14 6h7M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    truck: 'M3 16V5h11v11M14 9h4l3 5v3h-1M3 17h2m4 0h7M14 14h7M7 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm11 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    pickup: 'M3 16v-5h7V7h5l4 5h2v5h-1M10 12h9M3 17h2m4 0h6M7 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    ambulance: 'M3 16V5h12v11M15 10h3l3 4v3h-1M3 17h2m4 0h7M7 9h4m-2-2v4M7 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm11 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    bomb: 'M10 8a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm4 1 2-3 2 2-3 3M17 6l2-3h2M7 12l-1 2',
    missile: 'M7 16 14 6l7-3-3 7-10 7-1-1ZM9 12H4l-1 7 5-2M12 9V4l7-1M4 20l-1 1',
    artillery: 'M7 14 17 6l3 3-10 8M7 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm4 4h8l2 3M17 6l2-2 3 4-2 1',
    airDefence: 'M4 17h16v4H4v-4ZM6 17l6-12 3 1-6 11m3 0 6-12 3 1-6 11',
    drone: 'M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm14 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm14 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7 7l3 3m4 0 3-3M7 17l3-3m4 0 3 3M10 10h4v4h-4v-4Z',
    fpvDrone: 'M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm14 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm14 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7 7l2 2m6 0 2-2M7 17l2-3m6 0 2 3M9 9h6v5H9V9ZM12 11h.01M12 9V5',
    helicopter: 'M4 3h16M12 3v5M7 8h9l5 5v3H9l-4-4H2V7h3l2 1ZM14 8v5h7M8 20h12M11 16v4m6-4v4',
    fighter: 'M12 3l2 7 7 5v3l-7-3v4l3 2h-4l-1-2-1 2H7l3-2v-4l-7 3v-3 7-5 2-7Z',
    house: 'M3 11l9-8 9 8M5 10v11h14V10M10 21v-7h4v7',
    highRise: 'M4 21V3h10v18M14 9h6v12M2 21h20M7 7h4m-4 4h4m-4 4h4M17 13v4M8 21v-3h2v3',
    trench: 'M3 7h5v5h8V7h5M3 11h1v5h16v-5h1M6 5V3m6 7V8m6-3V3M7 20l1-2m8 2-1-2',
    bunker: 'M3 13c0-9 18-9 18 0v7H3v-7Zm0 0h18M6 16h3m6 0h3M10 20v-3h4v3',
    checkpoint: 'M4 21V10h3v11M4 6h17v4H4V6Zm5 0-2 4m7-4-2 4m7-4-2 4M18 16h3v5h-3v-5Z',
    roadblock: 'M3 7h18v7H3V7Zm3 7-2 7m14-7 2 7M5 14l7-7m1 7 7-7',
    factory: 'M3 21V11l6 4v-6l6 5V4h5v17H3ZM6 18h2m3 0h2m3 0h2M15 8h5',
    fuelDepot: 'M3 7a4 2 0 1 1 8 0v12a4 2 0 0 1-8 0V7Zm0 0a4 2 0 0 0 8 0M15 7a3 2 0 1 1 6 0v12a3 2 0 0 1-6 0V7Zm0 0a3 2 0 0 0 6 0',
    bridge: 'M2 16h20M5 20V5m14 15V5M5 7c4 8 10 8 14 0M9 12v4m6-4v4',
    crater: 'M3 12h3c1 7 11 7 12 0h3M7 12l2 2m8-2-2 2M6 7 4 5m8 2V3m6 4 2-2',
    hospital: 'M4 21V5h16v16H4Zm5-11h6m-3-3v6M9 21v-5h6v5',
    camp: 'M3 21 12 4l9 17H3Zm5 0 4-8 4 8',
    harbour: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v14M8 10h8M3 13v4l3-2m15-2v4l-3-2M3 17c5 6 13 6 18 0',
    railway: 'M6 21l3-18m9 18L15 3M8 5h8M7 9h10M6 13h12M5 17h14M4 21h16',
    powerStation: 'M4 21V9h16v12H4ZM2 9l10-6 10 6M13 12l-4 4h4l-2 3 5-5h-4l1-2Z',
    // A pushpin, and deliberately not the marker above it: `pin` means a point on
    // the ground, so it would read as "this is a place" on a graph where place is
    // a family. This one means "somebody put this here and it stays".
    //
    // One closed outline plus the needle, and no separate bar across the cap: drawn
    // at 15 pixels, a bar meeting the two body verticals at the same point fills in
    // under its own round joins and the top reads as a blob.
    pushpin: 'M8.4 4h7.2v4.8l3.2 4.3H5.2l3.2-4.3V4ZM12 13.1V20',
    crosshair: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0-1v4m0 12v4M2 12h4m12 0h4',
    user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-8 17c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
    layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9.5 9 5 9-5M3 17l9 5 9-5',
    // A funnel: what a filter is drawn as everywhere, and deliberately not a
    // magnifier — that one already means the search over the rows, and two
    // magnifiers on one screen doing two different things is a third thing to learn.
    filter: 'M4 5h16l-6.2 7.4V20l-3.6-2.2v-5.4L4 5Z',
    grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
    // A table: the frame, its header row, one column divider. Distinct from `grid`
    // above, which is four equal cells and means an AOI sweep.
    table: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 4.5h18M10 9.5V19',
    video: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm12 4 5-3v10l-5-3',
    image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 12 4-4a1 1 0 0 1 1.4 0l4.6 4M9 9.5h.01',
    audio: 'M9 18V6l10-2v11.5M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
    file: 'M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6',
    hash: 'M9 4 7 20M17 4l-2 16M4 9h17M3 15h17',
    // a numeral in a ring, and a box of blurred dots: the two marks a proof
    // makes that are neither a line nor a word
    numbered: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM10.4 9.6 12.4 8.2V16M10.6 16h3.6',
    blurBox: 'M4.5 4.5h15v15h-15zM9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.8 5.7 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z',
    // a page the case points at, not a hostname: `domain` keeps the globe, and the
    // two stopped being the same row at a glance
    bookmark: 'M6.5 3.5h11a1 1 0 0 1 1 1V20.5L12 16.4l-6.5 4.1V4.5a1 1 0 0 1 1-1Z',
    leaf: 'M6 21c0-6 2-13 14-15 0 0 1 13-9 14-2.5.3-4-.5-5 1Zm0 0c1.5-5 4-9 9-11',
    settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5 5.5-2 5-5 2 2-5 5-2Z',
    arrowRight: 'M4 12h16m0 0-6-6m6 6-6 6',
    edit: 'M14 5.5 18.5 10M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z',
    // Add event: a point on the Timeline's own line, with the plus above it
    eventAdd: 'M3 18h6.5m5 0H21M12 15.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM12 3.5v7M8.5 7h7',
    external: 'M14 4h6v6m0-6L10 14M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3',
    grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
    // One column of `grip`'s dots: the settings of the thing beside it, rather than
    // a handle to drag it. A chevron here read as "sort", which is the button next to
    // this one.
    more: 'M12 6h.01M12 12h.01M12 18h.01',
    // the three assets, each drawn as itself: one shared handle icon made a lorry,
    // a freighter and an airframe read as the same row in a list of twenty
    car: 'M5 17h14M4 17v-4.5l2-5A1.5 1.5 0 0 1 7.4 6h9.2a1.5 1.5 0 0 1 1.4 1.5l2 5V17M4 12.5h16M7.5 17v2M16.5 17v2M8 14.5h.01M16 14.5h.01',
    ship: 'M3 17.5c1.8 0 1.8 2 3.5 2s1.7-2 3.5-2 1.8 2 3.5 2 1.7-2 3.5-2 1.8 2 3.5 2M4.5 15l1.5-5h12l1.5 5M12 10V5M9 5h6',
    plane: 'M12 3a1.6 1.6 0 0 1 1.5 1.7V9l7 4v2l-7-2v4l2.5 2v1.5L12 19.5 8 20.5V19l2.5-2v-4l-7 2v-2l7-4V4.7A1.6 1.6 0 0 1 12 3Z',
    // a model rather than an object: three cards of the same shape, because what an
    // equipment type means is "there are several of these"
    stack: 'M8 4h9a1 1 0 0 1 1 1v9M6 7h9a1 1 0 0 1 1 1v9M4 10h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
    // a statement, not a page: the quotation marks say "somebody is asserting this"
    quote: 'M9 5.5C6 7 4.5 9.5 4.5 12.5V18h6v-6h-3c0-2 .8-3.6 2.4-4.6L9 5.5Zm10 0c-3 1.5-4.5 4-4.5 7V18h6v-6h-3c0-2 .8-3.6 2.4-4.6L19 5.5Z',
    // the identifiers, told apart: a globe for a domain said nothing about the
    // account, the address and the range that were drawn with the same glyph
    at: 'M15.5 12a3.5 3.5 0 1 0-1 2.5M15.5 8.5v5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9',
    mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm-.6.6 8.6 7 8.6-7',
    phone: 'M7.5 3h-2A2 2 0 0 0 3.5 5 15.5 15.5 0 0 0 19 20.5a2 2 0 0 0 2-2v-2l-4.5-2-2 2.5a12 12 0 0 1-4.5-4.5L12.5 10 10.5 5.5 7.5 3Z',
    network: 'M12 3.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM5 16a2.25 2.25 0 1 1 0 4.5A2.25 2.25 0 0 1 5 16Zm14 0a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM12 8v4m0 0-7 4m7-4 7 4',
    building: 'M5 21V4.5A1 1 0 0 1 6 3.5h7a1 1 0 0 1 1 1V21M14 10h4a1 1 0 0 1 1 1v10M3 21h18M8 7.5h.01M11 7.5h.01M8 11h.01M11 11h.01M8 14.5h3',
    alert: 'M12 3 2.5 19.5h19L12 3Zm0 7v4m0 3.5h.01',
    // A ghosted collage piece: an editing state, so it must stay distinct from an alert.
    ghost: 'M12 3a8 8 0 0 0-8 8v10l4-2 4 2 4-2 4 2V11a8 8 0 0 0-8-8Zm-3 8h.01m5.99 0H15',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-10h.01',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2',
    // a month with its head rule: what a field opens when a date is built rather
    // than typed
    calendar: 'M4 6.5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13Zm4-3v4m8-4v4M4 10h16',
    play: 'm8 5 11 7-11 7V5Z',
    pause: 'M8 5v14m8-14v14',
    volume: 'M5 10v4h3l4 4V6L8 10H5Zm11-2a6 6 0 0 1 0 8m2.5-10.5a9 9 0 0 1 0 13',
    volumeOff: 'M5 10v4h3l4 4V6L8 10H5m8.5.5 5 5m0-5-5 5',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
    eyeOff: 'M9.9 9.9a3 3 0 1 0 4.2 4.2M10.7 5.7A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.8 17.8 0 0 1-2.2 3M6.6 6.6C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1.1M3 3l18 18',
    key: 'm21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
    lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
    shield: 'M12 21.5s7.5-3.7 7.5-9.3V5.4L12 2.5 4.5 5.4v6.8c0 5.6 7.5 9.3 7.5 9.3Z',
    chart: 'M3.5 3.5v17h17m-4-5v-6m-5 6V8m-5 8.5v-3',
    // a ridge over its baseline: the elevation profile
    profile: 'M3 20h18M3 16.5l4.5-6.5 3.5 4 3.5-6 6.5 9.5',
    // an eye and the cone it looks through, a ridge across its far end: a Horizon view
    horizon: 'M5 17.5 20.5 7M5 17.5h15.5M12.5 13.5l2.5-2.5 2 1.5 3.5-3.5M5 16a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
    square: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    circle: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z',
    line: 'M5 19 19 5',
    curve: 'M4 18c4 0 4-12 8-12s4 12 8 12',
    freehand: 'M3 17c3-9 5 5 8-2s4-8 6-2 3-2 4-5',
    // a rubber at a slant over the line it leaves
    eraser: 'M7 21 2.7 16.7a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21M22 21H7M5 11l9 9',
    arrow: 'M5 19 19 5m0 0h-8m8 0v8',
    text: 'M5 6V4h14v2M12 4v16m-3 0h6',
    cursor: 'm4 3 6.2 15.5 2.2-6.5 6.5-2.2L4 3Z',
    inspect: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35M8 11h6m-3-3v6',
    crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
    screen: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 15h6m-3-4v4',
    reset: 'M4 9a8 8 0 1 1-1.6 4.7M4 9H1m3 0V6',
    undo: 'M8 5 4 9l4 4M4 9h10a6 6 0 0 1 0 12h-4',
    redo: 'm16 5 4 4-4 4m4-4H10a6 6 0 0 0 0 12h4',
    // no mark at the point: the crosshair's ring, struck through
    noMark: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8',
    // the point held at the middle of the frame
    centre: 'M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3m8-4.5v1m-.5-.5h1',
    // free to be moved anywhere
    move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
    // an open hand, the thumb out: what a drag takes hold of. Three wide fingers
    // rather than four, which merge into one at the band's 15 px
    hand: 'M7.5 12.5V7a2 2 0 0 1 4 0v4M11.5 10.5V5a2 2 0 0 1 4 0v5.5M15.5 10.5V7a2 2 0 0 1 4 0v7a7 7 0 0 1-7 7h-1.3a6 6 0 0 1-4.6-2.2L3.2 14.6a1.8 1.8 0 0 1 2.7-2.3l1.6 1.8',
    sliders: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h13m4 0h3M13 4v4m0 6v4m4-12v4',
    wand: 'M4 20 13 11M15 3l1.1 3 3 1.1-3 1.1L15 11.3l-1.1-3-3-1.1 3-1.1L15 3ZM19.5 11.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6.6-1.8Z',
    maximize: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3',
    minimize: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3',
    ruler: 'M4 15.5 15.5 4l4.5 4.5L8.5 20 4 15.5Zm3.5-.5 1.5 1.5m1-4.5 1.5 1.5m1-4.5L14 11',
    polygon: 'M12 3.5 20 9.5l-3 9.5H7L4 9.5l8-6Z',
    mapArea: 'M3 5l7-2 4 4 7-2v14l-7 2-4-4-7 2V5Zm7-2v14m4-10v14',
    // Compare's reading modes: two panes, a divider, a blend, alternation, a change
    columns: 'M4 5h6.5v14H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9.5 0H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6.5V5Z',
    swipe: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm8-2v18m-3-9-1.5 0M16.5 12H15',
    fade: 'M9 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm6 0a5.5 5.5 0 1 1 0 11',
    blink: 'M4 6h7v12H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm9 0h7a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7M16 9.5v5',
    changes: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9.5 2.5-3 2.5 2 3-4',
    swap: 'M7 4 3.5 7.5 7 11M3.5 7.5H18M17 13l3.5 3.5L17 20m3.5-3.5H6',
    angle: 'M5 4v15h15M5 19 20 6',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    // Active fires. A flame rather than the warning triangle it borrowed at
    // first: a detection is a thing seen, not an alarm raised.
    flame: 'M12 3c3.2 3.4 5 6 5 8.6a5 5 0 0 1-10 0c0-1.6.6-3 1.9-4.3.1 1.2.6 2 1.4 2.6C10 7.6 10.6 5.3 12 3Z',
    // The guide, wherever it is asked for. A question mark rather than a book: the
    // press means "what is this tab", not "open a document".
    help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.1 9.6a2.9 2.9 0 1 1 4.2 2.6c-.8.4-1.3 1-1.3 1.9v.4M12 16.3a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6Z',
    keyboard: 'M3 7h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm3.5 3.2h.01m3.2 0h.01m3.2 0h.01m3.2 0h.01M8 13.8h8',
    // The Enter key drawn on a keycap: the arrow every keyboard prints on it.
    enter: 'M19 5v6a3 3 0 0 1-3 3H5m0 0 4-4m-4 4 4 4',
  };
</script>

<script>
  let { name, size = 18, stroke = 1.8 } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name] ?? paths.alert} />
</svg>
