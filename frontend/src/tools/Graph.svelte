<script>
  /**
   * The case drawn as nodes and edges (SPEC §6, v2 "Case graph").
   *
   * The Board lists the same entities and lists them better — it sorts, filters
   * and shows columns. So this is not a second rendering of that list. It answers
   * what a table cannot: what sits at the centre of the case, what is connected to
   * what, and what nobody has connected to anything yet.
   *
   * It opens on the **whole case**, bounded, because a case is a subject before it
   * is a set of statements: a conflict followed over months has no single root to
   * expand out from. Expansion is the drill-down, not the entry point. On a case
   * too large to draw, the server keeps the most connected nodes, so what stays on
   * screen is the shape of the case rather than an arbitrary slice — and the view
   * says how much it left out instead of presenting the slice as the whole.
   *
   * Four things carry the interaction, and each answers a way a graph usually
   * fails:
   *
   * - **Hover reads, selection commits.** Passing over a node lights it and its
   *   edges and names them; only a click narrows the picture. A graph that
   *   restyles everything under a moving mouse is a graph that flickers.
   * - **Focus and context.** Selecting a node fades everything more than one hop
   *   away instead of hiding it. A graph where selection hides is a graph that
   *   loses your place; one where it does nothing is a wall.
   * - **Every edge says which way it goes and in what words.** The vocabulary is
   *   directed, so each edge carries a head, and the verbs are written along the
   *   edges of whatever is under the eye.
   * - **The cost of a click is on the node.** A node shows its degree before it is
   *   expanded, so nothing ever explodes without warning.
   * - **A node can be put somewhere, and stays there.** Dragging one pins it: the
   *   case remembers the spot, the layout treats it as a fixed point and arranges
   *   everything else around it, and what arrives later joins the arrangement
   *   instead of restarting it. Moves are saved as they are made, and there are three
   *   ways back at three sizes: `Ctrl+Z` for the last one, one node at a time from
   *   the panel, the whole arrangement from the toolbar. **Each lens keeps its own
   *   arrangement**,
   *   because a lens is a reading: it draws its own nodes and its own edges, so it
   *   clusters differently, and one shared arrangement would anchor every reading
   *   into the shape of whichever one it was built in. Offered on the whole case
   *   only: a neighbourhood gives its horizontal axis to distance from the root, and
   *   a node moved off its column would contradict what that view is drawn to show.
   *
   * Drawn on canvas through Konva, already in the bundle for Geo Proof and Inspect,
   * so the graph costs no new dependency. **Canvas resolves no CSS variable**, so
   * every colour is read off the document at draw time and re-read when the theme
   * changes. The placement is pure and lives in `lib/graph.js`: the same case draws
   * the same picture every time, because a graph screenshot goes into a report
   * beside a satellite capture and a capture is reproducible.
   */
  import Konva from 'konva';
  import { fileUrl } from '../lib/fileUrl.js';
  import { mergedArrangement, validPins } from '../lib/graphArrangement.js';
  import {
    clampZoom,
    toCanvasPoint,
    visibleRect,
    within,
    zoomAround,
  } from '../lib/graphViewport.js';
  import { tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import {
    analysisSearch,
    catalogViews,
    openAnalysisCase,
    setAnalysisFilter,
    setAnalysisPeriod,
  } from '../lib/analysisSearch.svelte.js';
  import {
    analysisPeriodQuery,
    analysisPeriodSpec,
    emptyAnalysisPeriod,
    hasAnalysisPeriod,
    normalizeAnalysisPeriod,
  } from '../lib/analysisPeriod.js';
  import { buildCatalogQuery, fetchAttrFacets } from '../lib/catalog.js';
  import {
    chipsOf,
    clearAxis,
    emptyFilter,
    isFiltering,
    normalizeFilter,
    toGraphQuery,
  } from '../lib/entityFilter.js';
  import { caseState, toast, uiState } from '../lib/state.svelte.js';
  import {
    entityIcon,
    entityKindLabel,
    madeAsWord,
    madeHereBy,
    madeHereLabel,
  } from '../lib/entityIcon.js';
  import {
    entityFamily,
    entityLabel,
    entityTypes,
    familyReads,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import {
    CHAIN_TYPES,
    confidenceHint,
    confidenceLabel,
    confidenceLevels,
    isRatable,
    loadRelationTypes,
    relationOptions,
    relationQualifier,
    relationReading,
    relationVerb,
  } from '../lib/relations.svelte.js';
  import {
    CARD,
    CARD_SCALE,
    EDGE_KINDS,
    FAMILY_ORDER,
    familyRank,
    arrange,
    arrangementDiff,
    boxRadius,
    cardFactor,
    cropToFill,
    drawingSnapshot,
    drawableLinks,
    edgeKind,
    edgeMidpoint,
    edgePoints,
    edgeStyle,
    fit,
    foldAway,
    foldableCount,
    nodeAt,
    nodeRadius,
    parallelBends,
    positionsById,
    ringsAround,
    shortLabel,
  } from '../lib/graph.js';
  import { createHistory } from '../lib/history.js';
  import { createBookmark } from '../lib/bookmarks.js';
  import { windowWords } from '../lib/timeline.js';
  import { listenForPaste, pasteImage, resolvePaste } from '../lib/clipboardPaste.js';
  import Icon, { paths } from '../components/Icon.svelte';
  import AnalysisViews from '../components/AnalysisViews.svelte';
  import AnalysisPeriodBar from '../components/AnalysisPeriodBar.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import Modal from '../components/Modal.svelte';
  import EntityCreate from '../components/EntityCreate.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import PasteDialog from '../components/PasteDialog.svelte';
  import SnapshotDetails from '../components/SnapshotDetails.svelte';

  loadEntityTypes();
  loadRelationTypes();

  /** How wide a dot has to be drawn, in screen pixels, before its glyph is worth
   *  putting inside it. Below this the icon is a smudge and the cost is a few
   *  hundred shapes at the one zoom that cannot afford them. */
  const GLYPH_MIN = 17;

  /** How far the park's frame stands off the column it encloses, in canvas units.
   *  Enough for a node's own radius and the label under the bottom row. */
  const PARK_PAD = { x: 46, top: 34, bottom: 30 };

  /** Below this scale a label is noise, so only the node in hand keeps one. */
  const LABEL_SCALE = 0.62;
  /** Pointer travel that turns a click into a pan, so a hand tremor still selects. */
  const DRAG_SLOP = 4;
  /** How long a drag waits before it is filed, so a flurry of them is one request. */
  const SAVE_AFTER = 400;
  /** How far one arrow key moves a node, in canvas units. The keyboard path to the
   *  same act: a canvas cannot otherwise be arranged without a mouse. */
  const NUDGE = 12;
  const NUDGE_FAR = 60;
  /** How long the search waits before asking the case, so typing a name is one
   *  request rather than one per letter. */
  const FIND_AFTER = 220;
  /** Letters before the case is worth asking. One matches most of it. */
  const FIND_MIN = 2;
  /** How many connections of one kind the panel lists before the rest are asked for.
   *  A node with forty of the same verb is a hub, and reading it is not the same act
   *  as reading its forty rows. */
  const GROUP_ROWS = 8;
  /**
   * How many nodes the placement starts to cost at, and how many it freezes at.
   *
   * Measured rather than guessed: the relaxation compares every node against every
   * other, sixty times over, on the main thread — 500 nodes place in a quarter of a
   * second, a thousand in one, two thousand in four with the tab frozen throughout.
   * The drawing refuses nothing at either line. It says what the next change will
   * cost, which is the honest half of having no ceiling.
   */
  const HEAVY = 1000;
  const FREEZING = 2000;
  /** A type no registry can declare, standing for "an allow-list with nothing in it".
   *  Two narrowings that share no type is a real answer, and it is an empty one.
   *  Written as an escape: a raw NUL byte in the source makes the file binary to
   *  git and to every search tool, so the whole module goes quiet under `grep`. */
  const NOTHING = '\0none';

  let lenses = $state([]);
  let orders = $state([]);
  let lens = $state('all');
  let order = $state('degree');
  let payload = $state(null);
  let root = $state(null); // the node an expansion is centred on, null for the case
  let hops = $state(1);
  /**
   * The nodes that have been opened, whose neighbours joined the view.
   *
   * The whole case is still on screen behind them: opening a node adds to the
   * picture rather than replacing it with a different question, which is what
   * makes this a place to work rather than a thing to navigate.
   */
  let expanded = $state([]);
  /**
   * The nodes whose surroundings are folded away.
   *
   * The other half of one switch, and the only one of these lists the case never
   * hears about. Folding is a reading of the drawing already on screen: it asks no
   * question, so it costs no read, and unfolding is instant because nothing left.
   *
   * It is what lets the picture the case **opened on** be tidied, which no other
   * list can do. Opening a node adds to the drawing and hiding one takes it away;
   * neither speaks for the two hundred nodes that were there before the analyst
   * touched anything, and those are the ones in the way.
   *
   * Because it draws rather than asks, a fold does not give the budget its room
   * back — the case still sent those nodes. Hiding is the act that does, and the
   * two are worded apart for exactly that reason: folding tidies, hiding edits.
   */
  let collapsed = $state([]);
  /**
   * The nodes drawn because they were named, and **nothing around them**.
   *
   * The other half of what one list used to conflate. Opening a node is right for a
   * node you are reading; it is wrong for a route, which arrived with one whole
   * neighbourhood per step and buried the sentence it was drawn to say. So the two
   * acts are two lists: this one draws exactly what it names.
   */
  let kept = $state([]);
  /**
   * The nodes taken out of the drawing by hand.
   *
   * What makes the drawing a set the analyst owns rather than a query's answer they
   * have to live with. Nothing hands one of these back — the case applies it last, so
   * a removal survives an expansion that reaches the same node — and the ways back are
   * the neighbour it was hanging on, `Ctrl+Z`, and **Reset view** for the lot.
   *
   * The reason it is not optional: everything already drawn is a fixed point, so a
   * drawing can grow indefinitely without re-placing itself. Without a way to take one
   * node out, the only way back was folding every expansion, which takes the reading
   * that raised the question down with it.
   */
  let omitted = $state([]);
  /**
   * What hiding took off each node still drawn, so the node it hung on can hand it
   * back.
   *
   * Hiding is the analyst's own act on their own picture, and undoing one node of it
   * used to cost either the whole drawing (**Reset view**) or the name of a node they
   * had just decided not to look at. Recorded at the moment of the hiding, because
   * that is the only moment the edge to it is still drawn: the case applies `omit`
   * last, so the read that follows sends neither the node nor the link.
   *
   * Keyed by the node that stays, one entry per **link** taken with it — the case
   * prices a degree per link, so two entries are what makes the count add up on the
   * pair joined twice.
   */
  let putAway = $state({});
  /**
   * The one folder being drawn, or the whole case. The analyst's own bucket, read the
   * way the Board reads it.
   *
   * The Board's other two filters are deliberately **not** here. Review state would
   * draw the proposals alone, and a proposal's other end is nearly always a confirmed
   * entity — so the closed link set drops every edge and the picture becomes a column
   * of dots, while the dash on a node and on an edge already says "proposed" in
   * place. An exact type is the same failure for the same reason: the verbs run
   * between families, so one type on its own has almost nothing to join. The two
   * verbs that do stay inside a family — organizational containment, a network
   * holding an address — are reached by leaving one family switched on.
   */
  let pickFolder = $state('');
  let folders = $state([]);
  let summary = $state(null);
  let searchFilter = $state(emptyFilter());
  let facets = $state([]);
  let facetState = $state('unasked');
  let fieldsWanted = $state(false);
  /**
   * A question the Board worked out, being drawn here.
   *
   * `{ terms, label }`: the catalog filter as request parameters, and the sentence it
   * reads as. The **question** travels rather than the rows it matched, which is what
   * makes the hand-over work at any size — the case is asked the same thing the table
   * asked, so nothing is capped and the drawing stays live. It is announced over the
   * canvas and let go in one press, because a narrowing nothing explains is a drawing
   * that looks broken.
   */
  let fromBoard = $state(null);
  /**
   * The families switched off, and why this control still matters.
   *
   * A lens narrows nodes by **role** — what the analyst wrote leaves the drawing —
   * which is a decision about the reading, taken once. This narrows by **family**,
   * which is a decision about the budget: on a real case one family dwarfs the rest,
   * so switching `collected` off can turn two thousand nodes into three hundred and
   * spend the budget on the actors, places and statements instead.
   *
   * A handful of checkboxes, and no knowledge of the case needed to use them — the
   * opposite trade from picking entities, which asks the analyst to answer the
   * question they came to ask.
   */
  let hiddenFamilies = $state([]);
  /** Every type the case actually holds, from the catalog summary. */
  let caseTypes = $state([]);
  const familyTitle = (family) => family.charAt(0).toUpperCase() + family.slice(1);
  const searchFamilies = $derived(
    [...new Set(caseTypes.map((type) => entityFamily(type)).filter(Boolean))].sort()
  );
  const searchTypeOptions = $derived(
    entityTypes().filter(
      (entry) =>
        !searchFilter.families.length || searchFilter.families.includes(entry.family)
    )
  );
  const searchWantedTypes = $derived(
    searchFilter.types.length
      ? searchFilter.types
      : searchFilter.families.length
        ? searchTypeOptions.map((entry) => entry.type)
        : []
  );
  const searchTerms = $derived(
    toGraphQuery(searchFilter, { types: searchWantedTypes })
  );
  const activePeriod = $derived(hasAnalysisPeriod(analysisSearch.period));
  const temporalTerms = $derived.by(() => {
    const period = analysisPeriodQuery(analysisSearch.period);
    if (!period.temporalFrom) return {};
    return {
      temporal_from: period.temporalFrom,
      temporal_to: period.temporalTo,
      temporal_category: period.temporalCategories.join(','),
    };
  });
  const searchSaid = $derived(
    [
      searchFilter.q.trim() ? `“${searchFilter.q.trim()}”` : '',
      ...chipsOf(searchFilter, { type: entityLabel, family: familyTitle })
        .map((chip) => chip.text),
      activePeriod ? `Fact time · ${windowWords(
        analysisSearch.period.from, analysisSearch.period.to, 'UTC'
      )}` : '',
    ].filter(Boolean).join(' · ')
  );
  let loading = $state(false);
  /**
   * Why the case could not be read, and **only** that.
   *
   * It draws as a message where the drawing would be, which is the truth when there
   * is no drawing. A write that failed over a case still on screen belongs in `say`
   * instead: put here, a pin that did not save covered the graph with a sentence
   * that read as the graph having failed, and nothing cleared it until the next read.
   */
  let failed = $state('');
  let selected = $state(null);
  /**
   * How far the focus reaches from the selected node, in hops.
   *
   * One hop answers "what touches this", which is the question a click asks. Two
   * answers "what does this sit between", and it is the one that finds the account
   * two people both cite without either of them naming the other — a shape that is
   * invisible at one hop and drowned at the whole case. Three is the ceiling because
   * past it a well-connected case is reached entirely, and a highlight that covers
   * everything highlights nothing.
   *
   * Kept across a change of node: how far you are looking is a stance, not a
   * property of what you happen to be looking at. It goes back to one only when the
   * focus itself is let go.
   */
  let focusHops = $state(1);
  /**
   * Whether the focus **removes** the rest of the case rather than dimming it.
   *
   * Dimming keeps your place — the shape of the case is still there behind the
   * reading — and that is why it is the default. But a subset you mean to work on
   * has to be readable on its own: at 0.16 opacity a thousand faded nodes are still
   * a texture the eye has to fight, and a card at that strength still occludes what
   * is under it.
   *
   * It never touches `nodes`, and this is the point: `placed` is derived from
   * `arrange`, so filtering the list would re-run the relaxation and put every
   * surviving node somewhere new. Switched off, the case comes back exactly where it
   * was, which is what makes this something to try rather than something to commit
   * to.
   */
  let onlyThis = $state(false);
  /** Where the view stood before the subset was framed, so switching back is a
   *  return rather than a second thing to undo. */
  let beforeOnly = null;
  /**
   * Whether a path is being walked, and the steps of it so far.
   *
   * **The primitive the tool was missing.** A case answers "what connects to what"
   * one hop at a time, but the question an investigation actually asks is "how does
   * this reach that" — and until now the only way to ask it was to click through the
   * case and hold the answer in your head.
   *
   * Each step is the node arrived at and the edge arrived by, because the edge is
   * the half that carries the meaning: two nodes joined by `posted` and by
   * `mentions` are two different findings, and a path recorded as nodes alone cannot
   * tell them apart when both edges exist.
   *
   * It is an **armed gesture**, not a mode a click can wander into, and that is the
   * whole of why it can be trusted. A click that extended a path whenever it landed
   * on a neighbour would leave a click on a *non*-neighbour with three bad answers:
   * do nothing (a canvas that ignores a click), read the node and leave a path
   * half-built beside it (two questions on one screen), or break the path (six hops
   * lost to a slip). Armed, there is no such click: what the path can reach is lit
   * before the press, exactly as `drawing` lights only the ends a relation may land
   * on, so an impossible step cannot be taken rather than being taken and refused.
   *
   * Nothing is stored. A path is derived from edges that can be deleted, so a saved
   * one goes quietly false the day a link in its middle is removed — the sentence it
   * reads out is what gets kept, in a note, written by a person.
   */
  let tracing = $state(false);
  let path = $state([]); // [{ id, via }], via being the link arrived by
  /**
   * The node a route is being asked *from*, while the gesture waits for its other
   * end. Armed exactly like a connection: the act is named first, and the click that
   * follows means the one thing the arming said it would.
   *
   * **Nothing is dimmed while it waits**, and that is the one place this parts
   * company with `drawing`. A relation has a vocabulary that says which pairs are
   * legal, so an illegal end can be refused before the press. A route has no such
   * rule: the case is searched, not the drawing, and the view holds five hundred of
   * a thousand nodes — so a node with no route on screen may be two hops away in the
   * case. Greying it out would be the picture asserting something only the server
   * can know. "No route within four hops" is the honest form of that answer, and it
   * arrives after the question rather than instead of it.
   */
  let asking = $state(null); // { from }
  /**
   * Every equally short route the case answered with, and which one is being read.
   *
   * All of them are lit, and this is the point rather than a flourish: two accounts
   * reaching the same place through two different sources is what independence looks
   * like on a real case, and an answer that drew one of them would hide the finding.
   * The drawing says *how these are connected*; the sentence takes one at a time and
   * says *by what exactly*, because a sentence cannot be read three times over.
   */
  let routes = $state([]);
  let routeAt = $state(0);
  let hovered = $state(null);
  let hoveredLink = $state(null);
  let openId = $state(null);
  let snapshotOpen = $state(null);
  let dirty = $state(false);
  /** The edge under the panel. An edge is a statement, and often the finding. */
  let chosenLink = $state(null);
  /** A relation being drawn: where it started, where the pointer is, what it can
   *  legally land on, and the menu once it has landed. */
  let drawing = $state(null);
  let offer = $state(null); // { x, y, from, to, options }
  /** The node menu, where a node says what can be done with it. */
  let menu = $state(null); // { id, x, y }
  /** The canvas menu: what can be done to the drawing where nothing is. Until this
   *  existed the empty space answered a right-click with nothing, and the only way to
   *  put a new entity into a case being read here was to leave for the Board. */
  let blank = $state(null); // { x, y, at: {x, y} in canvas units }
  /** An entity being filed from the drawing, and where on the canvas it goes.
   *  `{ at }` — the spot the right-click landed on, which is where the node appears
   *  and stays. */
  let creating = $state(null);
  /** What the last write said, cleared on its own: a banner that never leaves stops
   *  being read, and the next failure would go unnoticed under it. */
  let saving = $state('');
  let sayTimer = 0;
  function say(message) {
    saving = message;
    clearTimeout(sayTimer);
    if (message) sayTimer = setTimeout(() => (saving = ''), 6000);
  }
  let tip = $state(null); // { x, y, label, type, degree } in screen pixels
  let zoom = $state(1);
  let panning = $state(false);
  /** Whether a card shows the picture the case holds or the entity's own glyph.
   *  Session-only: it is how the analyst is looking at the case right now, not a
   *  setting the workspace has to carry to another machine. */
  let showPreviews = $state(true);

  let host = $state();
  let width = $state(0);
  let height = $state(0);

  /** The whole tool, which is what full screen takes over: a canvas alone would
   *  leave the toolbar behind, and the toolbar is how the drawing is steered. */
  let toolElement = $state(null);
  let fullscreen = $state(false);

  /**
   * Where nodes have been dragged to, and why this map is deliberately not `$state`.
   *
   * Dropping a node must not re-arrange the case. If the layout re-ran on every
   * drop, every *other* node would slide to a new resting place under the hand —
   * which is the opposite of direct manipulation, and the thing that makes most
   * graph editors unusable. So the drag moves the one shape it is holding, records
   * the spot here, and leaves `placed` alone. The map is read the next time the
   * layout genuinely does run — a resize, a lens change, a reload — and then the
   * dropped node is an anchor and the rest settle around it.
   *
   * `pinnedIds` is the same fact in the form the markup can read, and `pinCount`
   * counts the whole case rather than this view, because the control that undoes an
   * arrangement has to appear even when the pinned nodes were cut from the view.
   */
  const pins = new Map();
  let pinnedIds = $state([]);
  let pinCount = $state(0);
  // A named graph owns its arrangement. The case-wide pins remain the default
  // everywhere else and are never rewritten by a view-local drag.
  let arrangementOwner = $state(null);
  let arrangementRevision = $state(0);
  let arrangementSaveRevision = $state(0);
  let cameraRevision = $state(0);
  let pending = new Map(); // dropped, not filed yet
  let savingCase = null; // the case those drops came from
  let savingFor = null; // the lens those drops belong to
  let saveTimer = 0;

  /**
   * Where the drawing put each node last time, and not `$state` for the same reason
   * `pins` is not: writing it back must not re-derive the thing it was read from.
   *
   * This is what makes growing a drawing cost the arrivals rather than the case.
   * Opening twenty nodes into two thousand re-ran the relaxation over all two
   * thousand — four seconds of frozen tab on every click, and every node on screen
   * sliding somewhere new while the analyst was reading it. Held here, the two
   * thousand are fixed points and only the twenty are placed.
   *
   * **It is emptied whenever the question changes**, which is the same seam
   * `resetView` already turns on: a lens, a filter or a folder is a different reading
   * and gets a fresh arrangement. Growing, folding back and unpinning are the same
   * question, and keep it.
   */
  const settled = new Map();

  /**
   * What the case sent, and what is left of it once the folds are applied.
   *
   * The seam the whole fold lives on, and it is deliberately this early: everything
   * downstream — the placement, the edges, the legend, the search, the focus — reads
   * `nodes` and `links`, so a folded node is absent from all of them at once without
   * one of them having to know that folding exists.
   *
   * A node the analyst placed by hand anchors its piece: an arrangement somebody
   * built outranks a rule that tidies.
   */
  const sentNodes = $derived(payload?.nodes ?? []);
  const sentLinks = $derived(payload?.links ?? []);
  const folds = $derived(foldAway(collapsed, sentNodes, sentLinks, new Set(pinnedIds)));
  const nodes = $derived(
    folds.hidden.size ? sentNodes.filter((node) => !folds.hidden.has(node.id)) : sentNodes,
  );
  const links = $derived(
    folds.hidden.size
      ? sentLinks.filter((link) => !folds.hidden.has(link.from) && !folds.hidden.has(link.to))
      : sentLinks,
  );
  const mode = $derived(root ? 'hops' : 'rings');
  const ownsViewArrangement = () => Boolean(
    arrangementOwner &&
    catalogViews.activeView?.surface === 'graph' &&
    catalogViews.activeView?.id === arrangementOwner
  );
  const placed = $derived.by(() => {
    void arrangementRevision;
    // A view with no local pin means "let the layout decide", not "borrow the
    // case-wide pin that happened to be stored under this lens".
    const placementNodes = ownsViewArrangement()
      ? nodes.map((node) => node.pin ? { ...node, pin: null } : node)
      : nodes;
    return arrange(placementNodes, mode, links, pins, settled);
  });
  const positions = $derived(positionsById(placed));
  const edges = $derived(drawableLinks(links, positions));
  const bends = $derived(parallelBends(edges));
  const byId = $derived(new Map(nodes.map((node) => [node.id, node])));
  const chosen = $derived(selected ? (byId.get(selected) ?? null) : null);
  const edgeById = $derived(new Map(edges.map((link) => [link.id, link])));
  const chosenEdge = $derived(chosenLink ? (edgeById.get(chosenLink) ?? null) : null);
  const snapshotReading = $derived(Boolean(catalogViews.snapshotId || payload?.snapshot));

  /**
   * The readings a landed connection offers, under the registry's own headings.
   *
   * A pointer must not borrow the weight of a finding (ONTOLOGY §3), and in one
   * unheaded list it does: "mentions" sitting under "owns" makes a document naming a
   * place look like a statement about it. The heading is the registry's `group`, the
   * same one the Details picker puts over its verbs, so nothing is worded here — and
   * the ungrouped readings come first because that is the order the registry sorts.
   */
  const offerGroups = $derived.by(() => {
    const groups = new Map();
    for (const option of offer?.options ?? []) {
      const group = option.group ?? '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(option);
    }
    return [...groups].map(([group, options]) => ({ group, options }));
  });

  /** Whether the drawing has been edited at all, and so whether there is anything to
   *  put back. Four lists, one way back: which of them is in the way is not a question
   *  the analyst should have to answer before undoing their own picture. */
  const edited = $derived(
    Boolean(expanded.length || kept.length || omitted.length || collapsed.length),
  );
  /** How many nodes the folds are currently holding off the screen. */
  const foldedCount = $derived(folds.hidden.size);
  /**
   * What the switch on the node in hand would do, and to how many.
   *
   * Computed for one node rather than for all of them, and that is a decision about
   * the picture before it is one about the cost: a count pinned to every dot is a
   * few hundred numbers nobody reads. The badge belongs to the node under the eye.
   */
  const switchFor = $derived.by(() => {
    const id = hovered ?? selected;
    if (!id || !byId.has(id)) return null;
    if (collapsed.includes(id)) return { id, act: 'unfold', count: folds.by.get(id) ?? 0 };
    const away = root ? 0 : offScreen(id);
    if (away > 0) return { id, act: 'expand', count: away };
    const takes = foldableCount(id, nodes, links, new Set(pinnedIds));
    return takes ? { id, act: 'fold', count: takes } : null;
  });
  /**
   * What a drawing this size costs to place, once it costs anything worth saying.
   *
   * The drawing has no ceiling — one that refuses is the app overruling the analyst
   * about their own picture — so what is left is telling them what the next change
   * will cost. Null below the first line, where it costs nothing worth a word.
   */
  const weight = $derived(
    nodes.length >= FREEZING ? 'freezing' : nodes.length >= HEAVY ? 'heavy' : null,
  );

  /**
   * How many of a node's connections are **not** on screen.
   *
   * The number that makes expanding a node worth offering. A node states its whole
   * degree, but a view that already holds every one of its neighbours has nothing
   * left to bring in — which is most of the time on a case that fits. Offering it
   * there was offering an act that could only appear to do nothing.
   */
  const offScreen = $derived.by(() => {
    const held = new Map();
    // Counted over the connections the **drawing holds**, not the ones the case sent:
    // a fold takes nodes off the screen, and their connections are missing from the
    // picture in exactly the sense this number means. An edge from a node onto itself
    // is dropped by the canvas — a loop has no length and would smudge under the dot —
    // but the view has it and no expansion can bring it in again, so counting it as
    // missing left a node saying "1 more not drawn" for ever, under a control that
    // could never do anything about it. Both ends every time, undeduplicated, because
    // that is how the case counts a degree: the server's tally is one row per end, so
    // a loop is two there and has to be two here or the subtraction never reaches zero.
    for (const link of links) {
      for (const end of [link.from, link.to]) held.set(end, (held.get(end) ?? 0) + 1);
    }
    // Plus what hiding took off it. The case prices a degree against the picture it
    // sent, so a hidden neighbour is not in that number — and the node would say every
    // connection was drawn while the analyst was looking at the gap they had just made.
    return (id) =>
      Math.max((byId.get(id)?.degree ?? 0) - (held.get(id) ?? 0), 0) + (putAway[id]?.length ?? 0);
  });

  /**
   * Ids within `focusHops` of the selected node: the focus, and the weakest of the
   * questions that narrow the picture (see `narrowing`).
   *
   * Selection only, and never the root of an expansion. Fading the whole case
   * under a moving mouse made the picture strobe, and left Escape looking broken:
   * the highlight stayed as long as the pointer had not moved off the node. Fading
   * around the root of a neighbourhood was worse than cosmetic — asking for three
   * hops and getting hops two and three greyed out contradicts the question.
   *
   * Walked over the edges already drawn, so no read is owed to a change of reach:
   * the case on screen is a closed set of connections, and the second and third
   * rings are already in it. The one that does cost a read is the neighbourhood's
   * own Hops, which asks the case a different question.
   */
  const focused = $derived.by(() => {
    if (!selected || selected === root) return null;
    return ringsAround(edges, selected, focusHops);
  });

  const neighbours = $derived.by(() => {
    if (!selected) return [];
    return edges
      .filter((link) => link.from === selected || link.to === selected)
      .map((link) => {
        const far = link.from === selected ? link.to : link.from;
        return { link, entity: byId.get(far), outgoing: link.from === selected };
      })
      .filter((row) => row.entity);
  });

  /**
   * The same connections, grouped by what they say about the node.
   *
   * A flat list in edge order is a list of edges rather than a reading of a node:
   * forty rows with "posted" written on twelve of them say less than one heading
   * that says twelve. The key is the verb **and** its direction, because the registry
   * words those apart — a document that mentions something and one that is mentioned
   * by it are not the same fact — and because the heading is where the verb now
   * lives, so two directions under one heading would each read as the wrong one.
   *
   * Biggest group first. What a node mostly is, is the first thing to say about it.
   */
  const neighbourGroups = $derived.by(() => {
    const groups = new Map();
    for (const row of neighbours) {
      const way = row.outgoing ? 'out' : 'in';
      const key = `${row.link.type} ${way}`;
      if (!groups.has(key)) {
        groups.set(key, { key, reading: relationReading(row.link.type, way), rows: [] });
      }
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].sort(
      (a, b) => b.rows.length - a.rows.length || a.reading.localeCompare(b.reading),
    );
  });

  /**
   * The groups showing all their rows rather than the first few.
   *
   * Cleared with the selection: it is how one node is being read right now, not a
   * setting about how nodes are read. Keeping it would open the next node's list
   * half-unfolded on whichever verbs the last one happened to share.
   */
  let allOf = $state([]);
  $effect(() => {
    void selected;
    allOf = [];
  });

  /**
   * The types this reading leaves out of the drawing, as the case states them.
   *
   * A lens narrows nodes as well as verbs: what the analyst *wrote* — a post, a note,
   * an Inspect session — is the filing rather than the case, so the four readings of
   * the case leave it out and **My work** is where it lives. Read from the lens
   * registry rather than listed here, for the same reason the lenses are: the roles
   * live on the server, and a copy would go stale the day a type is added.
   *
   * Two controls need it *before* the case is asked, and both would otherwise appear
   * broken: a legend row that switches nothing, and "bring this in" on an entity this
   * reading is going to refuse.
   */
  const lensHides = $derived(lenses.find((entry) => entry.id === lens)?.hides ?? []);

  /**
   * The families this **case** holds, in drawing order.
   *
   * Read off the catalog summary rather than off the drawing, which is the change
   * that lets the legend be a control: a family read from what is drawn disappears
   * the moment it is switched off, taking with it the only thing that could switch
   * it back on. It still never advertises a family the case does not hold — nor one
   * whose every member this reading leaves out, since that row would be a switch with
   * nothing behind it.
   */
  const caseFamilies = $derived.by(() => {
    const seen = new Set();
    for (const type of caseTypes) {
      if (lensHides.includes(type)) continue;
      const family = entityFamily(type);
      if (family) seen.add(family);
    }
    // Until the summary lands, whatever is drawn: the legend is never blank while
    // there are nodes on screen.
    if (!seen.size) for (const node of nodes) if (node.family) seen.add(node.family);
    return [...seen].sort((a, b) => familyRank(a) - familyRank(b) || a.localeCompare(b));
  });

  /** The legend: each family the case holds, how many of it is drawn, and whether it
   *  is switched on. The count is of the drawing, because that is what a legend
   *  explains; the row is of the case, because that is what it switches. */
  const legend = $derived.by(() => {
    const counts = new Map();
    for (const node of nodes) counts.set(node.family, (counts.get(node.family) ?? 0) + 1);
    return caseFamilies.map((family) => ({
      family,
      count: counts.get(family) ?? 0,
      on: !hiddenFamilies.includes(family),
    }));
  });

  /**
   * The types a narrowed set of families resolves to, as one comma-separated list.
   *
   * Resolved here rather than by a route of its own, the way the Board resolves its
   * own family filter: the family layer is server vocabulary, and the catalog read
   * already speaks types.
   *
   * Built from the types the **case** holds, not from the registry's, for one reason
   * that would otherwise be a silent loss: a free-typed entity has no declared
   * family (`family_of` answers None), so an allowlist drawn from the registry would
   * drop it the moment any family was switched off. Here it is always kept, because
   * no tick claims to speak for it.
   */
  const familyTypes = $derived.by(() => {
    if (!hiddenFamilies.length) return '';
    const held = caseTypes.length ? caseTypes : entityTypes().map((entry) => entry.type);
    return held
      .filter((type) => {
        const family = entityFamily(type);
        return !family || !hiddenFamilies.includes(family);
      })
      .join(',');
  });

  /**
   * Switch a family off, or back on.
   *
   * The last one on stays on: every family off is a blank canvas, which is not a
   * reading of anything, and the empty `type` filter would be read server-side as
   * "no narrowing" and draw the whole case back — a control that does the opposite
   * of what it says at one particular setting.
   */
  function toggleFamily(family) {
    const off = hiddenFamilies.includes(family);
    if (!off && hiddenFamilies.length >= caseFamilies.length - 1) return;
    hiddenFamilies = off
      ? hiddenFamilies.filter((entry) => entry !== family)
      : [...hiddenFamilies, family];
  }

  /**
   * The few nodes that keep their name at any zoom.
   *
   * What sits at the centre of the case is the question this tool exists to answer,
   * and a wide view of unnamed dots answers it only as a shape. Six is the number
   * that stays readable: labels are held at a fixed size on screen, so naming forty
   * of them at a wide zoom would be a wall of overlapping text, which is the reason
   * labels declutter in the first place.
   */
  const hubs = $derived.by(() => {
    const ranked = nodes
      .filter((node) => node.degree >= 2)
      .sort((a, b) => b.degree - a.degree || String(a.id).localeCompare(String(b.id)));
    return new Set(ranked.slice(0, 6).map((node) => node.id));
  });

  /** The strokes on screen, worded. An unexplained dash pattern is decoration. */
  const strokes = $derived.by(() => {
    const present = new Set(edges.map((link) => edgeKind(link, CHAIN_TYPES)));
    return EDGE_KINDS.filter((entry) => present.has(entry.kind));
  });

  const lensHint = $derived(lenses.find((entry) => entry.id === lens)?.hint ?? '');

  /**
   * Finding a node by name. On a case drawn at a few hundred nodes, hunting one by
   * eye is hopeless, and a canvas is unreachable from the keyboard — so this is
   * both the way in without a mouse and the only practical way to reach a
   * particular entity. Matches are ranked the way the rings are, most connected
   * first, so the obvious answer is the first one.
   */
  let find = $state('');

  /**
   * Whether the list under the field is showing, which is not the same question as
   * whether anything was typed.
   *
   * The two used to be one, and that was fine while a search only fed a list. Now the
   * typing lights the drawing, so the answer is on the canvas — and the list is a
   * panel sitting on top of the answer, in the way of every click that would follow
   * it. Pressing on the case puts it away without giving the search up: the matches
   * stay lit, the count stays, and the node under the pointer can be read. The field
   * brings the list back, because asking for it again is what returning to the field
   * means.
   */
  let listing = $state(true);

  /**
   * Every drawn node the typed name matches, uncapped.
   *
   * Uncapped because this is what the **drawing** lights, and the count beside it
   * states. A picture that lit eight of twenty-three matches would answer a
   * different question from the one written over it. The list under the field is the
   * capped one, and deliberately so: a dropdown is a handful to pick from, where the
   * canvas is the reading.
   */
  const found = $derived.by(() => {
    const term = find.trim().toLowerCase();
    const hit = new Set();
    if (!term) return hit;
    for (const node of nodes) {
      if (String(node.label).toLowerCase().includes(term)) hit.add(node.id);
    }
    return hit;
  });

  /**
   * Finding a node by name. On a case drawn at a few hundred nodes, hunting one by
   * eye is hopeless, and a canvas is unreachable from the keyboard — so this is
   * both the way in without a mouse and the only practical way to reach a
   * particular entity. Matches are ranked the way the rings are, most connected
   * first, so the obvious answer is the first one.
   */
  const matches = $derived.by(() => {
    const term = find.trim().toLowerCase();
    if (!term) return [];
    // Over what the case **sent**, not over what is drawn, so a folded node is found
    // where it is rather than reported missing and fetched again. It says it is
    // folded, and picking it gives its fold back.
    return sentNodes
      .filter((node) => String(node.label).toLowerCase().includes(term))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 8);
  });

  // -- the path --------------------------------------------------------------

  // What the drawing lights. A walked path is the one route there is; an answered
  // question is every route that ties for shortest, all of them at once.
  const pathIds = $derived(
    routes.length
      ? new Set(routes.flatMap((route) => route.nodes))
      : new Set(path.map((step) => step.id)),
  );
  const pathLinks = $derived(
    routes.length
      ? new Set(routes.flatMap((route) => route.links))
      : new Set(path.map((step) => step.via).filter(Boolean)),
  );
  /** Where the sentence currently ends, and so where a further step would leave from. */
  const pathEnd = $derived(path.at(-1)?.id ?? null);

  /**
   * Where the path may go next: the neighbours of its far end it has not been
   * through, each with the edge that would carry it there.
   *
   * Lit before the click rather than judged after it. A node already on the path is
   * deliberately not here — walking back onto it truncates instead, since a route
   * that visits a node twice is not a path — and the first edge found wins when two
   * nodes are joined more than once, which the sentence then names.
   */
  const nextSteps = $derived.by(() => {
    const steps = new Map();
    if (!tracing || !pathEnd) return steps;
    for (const link of edges) {
      const far = link.from === pathEnd ? link.to : link.to === pathEnd ? link.from : null;
      if (!far || pathIds.has(far) || steps.has(far)) continue;
      steps.set(far, link);
    }
    return steps;
  });

  /**
   * Whether the drawing is narrowed to the statements that rest on one account.
   *
   * The toolbar's number named a set and gave no way to reach it: "2 on one account"
   * left the analyst opening statements one at a time to find out which two. Pressing
   * it asks the question the number was only half answering.
   */
  let singling = $state(false);

  /**
   * Those statements and one hop around them, or null while nothing is narrowed.
   *
   * One hop is where the finding is. The sources a statement rests on are folded into
   * its edges, so the statement and what its edges reach **is** the shape being
   * reported — a claim, one account, and nothing else lit. Unfolded, the sources are
   * the hop and the account stands one step behind them in the context, which is the
   * honest reading of that gesture: asking to see the sources themselves is a
   * different question from asking who published them.
   *
   * Null rather than an empty set when nothing qualifies, so a lens drawing no such
   * statement fades nothing instead of fading everything.
   */
  const singled = $derived.by(() => {
    if (!singling) return null;
    const resting = new Set(nodes.filter((node) => node.rests?.one).map((node) => node.id));
    if (!resting.size) return null;
    // One pass over the edges, collecting into a second set: growing the set being
    // read from would let a neighbour pull in its own neighbours, and the one hop
    // this promises would quietly become two.
    const near = new Set(resting);
    for (const link of edges) {
      if (resting.has(link.from)) near.add(link.to);
      if (resting.has(link.to)) near.add(link.from);
    }
    return near;
  });

  /**
   * Ask for those statements, or give the case back.
   *
   * The typed name outranks this question, so it goes when this one is asked: left
   * standing it would answer the press with an unchanged picture, and a control that
   * does nothing the first time is one nobody presses twice.
   */
  function showResting() {
    singling = !singling;
    if (singling) find = '';
  }

  /**
   * What the picture is narrowed around: the one set that keeps full strength while
   * everything else falls to context.
   *
   * Several questions dim the case — a path, a search, the statements on one account,
   * the focused node — and **only one may do it at a time**. Two fades composited over
   * each other are not a third reading, they are an unreadable one: typing a name
   * while a node was selected left two sets of context over each other, with nothing
   * on screen saying which question the drawing was answering.
   *
   * So they are ranked rather than combined, the most recently asked first — a name
   * is typed after the node was clicked, and a path is walked after both. The
   * selection is the weakest, which is why a click narrows nothing while a search is
   * on: it still rings the node and opens the panel, which is what a click is for.
   *
   * A path keeps its next steps at full strength alongside itself. They are the
   * question the gesture is asking — *where can this go* — and a walk whose choices
   * were dimmed into the context would be a walk taken blind.
   */
  const narrowing = $derived.by(() => {
    // A question waiting for its other end narrows **nothing**, and this is not a
    // detail of taste. Every node is a legal answer, so the focus fade left over
    // from selecting the node the question starts from says "only these can be
    // pressed" — the exact opposite of what the strip above it says, and it makes a
    // gesture that works everywhere look like one that works on five nodes.
    if (asking) return null;
    if (tracing) return new Set([...pathIds, ...nextSteps.keys()]);
    if (found.size) return found;
    if (singled) return singled;
    return focused;
  });

  /**
   * The path read as a sentence: the nodes it goes through and the verb of each edge
   * between them, in the direction that edge actually points.
   *
   * The deliverable, and the reason a path beats a highlight. A drawing says *these
   * are joined*; a sentence says **what the joining is**, and that is the thing that
   * goes into a report — an account that posted a video and a video that mentions an
   * account are not the same claim, and a sentence that flattened both to "connects
   * to" would say nothing.
   *
   * **Every step reads forwards, in the order it was walked.** An edge traversed
   * against its arrow takes the registry's inverse wording, exactly as the node
   * panel does — the same edge, said from the other end. Writing the plain verb with
   * a reversed arrow instead was the first attempt, and it made a true sentence
   * unreadable: *A ← made from B ← made from C* is a route the eye has to walk
   * backwards to understand, and the analyst has to hold the reversal for every step
   * to see that it says C was made from B was made from A.
   */
  const sentence = $derived.by(() =>
    path.map((step, index) => {
      const link = index ? edgeById.get(step.via) : null;
      const forward = link ? link.from === path[index - 1].id : true;
      return {
        id: step.id,
        label: byId.get(step.id)?.label ?? '',
        node: byId.get(step.id) ?? null,
        verb: link ? relationReading(link.type, forward ? 'out' : 'in') : '',
      };
    }),
  );

  /** Arm the walk on the node in hand, which becomes its first step. */
  function traceFrom(id) {
    if (!id) return;
    asking = null;
    routes = [];
    tracing = true;
    path = [{ id, via: null }];
    selected = id;
    letGoOnly();
  }

  /** Arm the question, and wait for the node that answers it. */
  function askWayFrom(id) {
    if (!id) return;
    traceStop();
    asking = { from: id };
    selected = id;
    letGoOnly();
  }

  /** Give the walk up whole. A path is one thing, so half of it is not worth keeping. */
  function traceStop() {
    tracing = false;
    path = [];
    routes = [];
    routeAt = 0;
  }

  /** A route the case answered with, waiting for the read that draws its nodes. */
  let routing = null;
  let routeRun = 0;

  /**
   * Ask the case how one node reaches another.
   *
   * The other end is named by clicking it or by typing its name, and the second is
   * not a convenience: the view holds five hundred nodes of a thousand, and "are
   * these two connected" is asked precisely about things far enough apart to be off
   * screen. A node that cannot be clicked would otherwise be a node that cannot be
   * asked about.
   *
   * What comes back fills the same object a hand-walked path does, so it is drawn,
   * worded and stepped back through identically — and can be walked onward from,
   * which is what makes an answer a place to keep working rather than a result.
   */
  async function wayTo(to) {
    const cid = caseState.current?.id;
    const start = asking?.from;
    const run = ++routeRun;
    find = '';
    asking = null;
    if (!cid || !start || to === start) return;
    let body;
    try {
      body = await api.get(
        `/api/cases/${cid}/graph/paths?${new URLSearchParams({ from: start, to, lens })}`,
      );
    } catch {
      if (run !== routeRun || caseState.current?.id !== cid) return;
      say('The case could not be asked for a route.');
      return;
    }
    if (run !== routeRun || caseState.current?.id !== cid) return;
    if (!body.found) {
      // An answer, not a failure: that two entities are *not* connected within the
      // budget is a finding about the case, and the only one nothing else reports.
      say(`No route to that one in this lens, within ${body.searched} hops.`);
      return;
    }
    // A sentence whose nodes are not on screen points at nothing, so a route through
    // what the budget cut is drawn first — **as itself**. Opened instead, each step of
    // the route brought its whole neighbourhood, and a four-node answer arrived inside
    // a crowd of forty. A named node outranks the cut that hid it either way.
    const drawn = body.routes.every((route) => route.nodes.every((id) => byId.has(id)));
    if (!drawn) {
      routing = body.routes;
      holdOn(body.routes.flatMap((route) => route.nodes));
      return;
    }
    layRoutes(body.routes);
  }

  function layRoutes(answered) {
    routes = answered;
    routeAt = 0;
    tracing = true;
    readRoute(0);
  }

  /** Read one of the tied routes as the sentence, leaving all of them lit. */
  function readRoute(index) {
    const route = routes[index];
    if (!route) return;
    routeAt = index;
    path = route.nodes.map((id, at) => ({ id, via: at ? route.links[at - 1] : null }));
    selected = route.nodes.at(-1);
  }

  /** Lay the answered routes once the read that draws them has landed. */
  function settleRoute() {
    const answered = routing;
    if (!answered) return;
    routing = null;
    // A route outranks a fold for the same reason a typed name does: the sentence is
    // the answer, and half of it put away is not one.
    showAgain(answered.flatMap((route) => route.nodes));
    const held = new Set(payload?.nodes.map((node) => node.id) ?? []);
    const drawn = answered.filter((route) => route.nodes.every((id) => held.has(id)));
    if (!drawn.length) {
      say('That route did not fit in the view. Narrow the case and ask again.');
      return;
    }
    layRoutes(drawn);
  }

  function stepTo(id) {
    // Stepping by hand leaves the case's answer behind: the tied routes were the
    // reply to one question, and taking a step is asking a different one.
    routes = [];
    const back = path.findIndex((step) => step.id === id);
    if (back >= 0) {
      path = path.slice(0, back + 1);
    } else {
      const link = nextSteps.get(id);
      if (!link) return;
      path = [...path, { id, via: link.id }];
    }
    selected = id;
    if (!inSight(id)) bringUnderEye(id);
  }

  /**
   * What "Only this" is currently taking off the screen, or null while it is not.
   *
   * It answers to the same ladder the fade does, and for the same reason: a name
   * typed while the rest of the case is hidden outranks the hiding, so the case
   * comes back with the matches lit, and the same goes for the statements on one
   * account — a question asked of the whole drawing cannot be answered by a drawing
   * cut down to one node. The alternative was worse than a rule broken —
   * hiding everything outside the matches strands them, since an edge is only drawn
   * when both of its ends survive, and the answer to a search would have been a
   * scatter of unconnected dots.
   *
   * Read by the drawing **and** by the connection band, so a relation cannot be
   * landed on a node that is not on screen to receive it.
   */
  const hiding = $derived(onlyThis && !tracing && !found.size && !singling ? focused : null);

  /**
   * The entities the case holds under this name that the drawing does **not**.
   *
   * The reason this exists: a view is bounded, so on a case larger than the budget
   * most of it is not on screen — and a search that only read the drawing answered
   * "no such entity" for entities the case plainly holds. Nothing distinguished
   * "not in the case" from "not in this picture", which is the worse of the two
   * silences.
   *
   * Asked of the catalog, the read the Board uses, so the two surfaces cannot
   * disagree about what a name matches. **The narrowing is deliberately ignored**:
   * an analyst typing a name is asking about the case, not about the filters they
   * set earlier — the same argument `expand` already makes server-side, and the same
   * one that lets a brought-in node survive them.
   */
  let elsewhere = $state([]);
  /** The node asked for, waiting for the read that brings it into the picture. */
  let bringing = null;
  let lookupRun = 0;

  $effect(() => {
    const term = find.trim();
    const cid = caseState.current?.id;
    // Not in a neighbourhood: that read is one node and its hops, and it takes no
    // `expand`, so there is nowhere to bring an entity into. The filters are folded
    // away there for the same reason.
    // One letter matches most of a case, so the local list carries it and the case
    // is not asked. Below two, there is nothing worth a request.
    if (!cid || root || term.length < FIND_MIN) {
      elsewhere = [];
      return;
    }
    const timer = setTimeout(() => lookUp(cid, term), FIND_AFTER);
    return () => clearTimeout(timer);
  });

  async function lookUp(caseId, term) {
    const run = ++lookupRun;
    try {
      const page = await api.get(
        buildCatalogQuery(caseId, { query: term, limit: 12 }),
      );
      // A later keystroke owns the field now, and its own request is in flight.
      if (
        run !== lookupRun ||
        caseState.current?.id !== caseId ||
        term !== find.trim()
      ) return;
      // What the case sent counts as held, folded or not: a node the drawing has put
      // away is not one to go and fetch, it is one to unfold, and the list above
      // already offers it.
      const drawn = new Set(sentNodes.map((node) => node.id));
      elsewhere = (page.items ?? []).filter((entity) => !drawn.has(entity.id)).slice(0, 6);
    } catch {
      if (run !== lookupRun || caseState.current?.id !== caseId) return;
      // A failed lookup leaves the local matches alone: the drawing is still
      // searchable, and a banner over a search box nobody has finished typing in
      // would be noise.
      elsewhere = [];
    }
  }

  /**
   * Bring an entity the drawing does not hold into it.
   *
   * The same act as opening a node, and deliberately the same mechanism: `expand`
   * keeps the named node whatever the ranking and the filters would have done with
   * it, and brings what touches it. An entity alone in a picture about connections
   * says nothing, so its neighbours come too.
   *
   * **A lens is the one thing it cannot be brought past.** A filter is a narrowing set
   * earlier and a name outranks it; a reading that does not draw notes would stop
   * being that reading with a note in it. Said here rather than after the read, or the
   * case would answer with an unchanged picture and the sentence would blame the
   * budget for a refusal the reading made.
   */
  function bringIn(entity) {
    if (snapshotReading) {
      say('This snapshot is read-only. Leave it to change the drawing.');
      return;
    }
    const { id, type } = entity;
    if (lensHides.includes(type)) {
      find = '';
      elsewhere = [];
      say('Not drawn in this lens. My work draws it.');
      return;
    }
    find = '';
    elsewhere = [];
    bringing = id;
    // A name typed outranks a removal made earlier, or the case would answer the
    // search with the same unchanged picture the removal left.
    backIn([id]);
    if (!expanded.includes(id)) expanded = [...expanded, id];
  }

  /** Put a node in the middle of the view, keeping the current zoom. */
  function bringUnderEye(id) {
    const spot = positions.get(id);
    if (!spot || !group) return;
    const scale = group.scaleX();
    group.position({ x: width / 2 - spot.x * scale, y: height / 2 - spot.y * scale });
    cameraRevision += 1;
    restyle();
  }

  /**
   * Select a node and bring it under the eye, keeping the current zoom.
   *
   * While a walk is armed the search moves the **eye** and not the selection: the
   * walk owns where the path is, and a name typed into the field cannot teleport it
   * to a node nothing connects to. The node arrives under the pointer, and it is
   * stepped onto by clicking it if it is lit.
   */
  function jumpTo(id) {
    // A name typed outranks a fold, as it outranks a removal: the node comes back
    // before anything is done with it, or the eye would be sent to a spot the
    // drawing is not drawing.
    showAgain([id]);
    // An armed gesture takes the name as its other end. This is the half a click
    // cannot cover: the node being asked about is often not drawn, and Find is the
    // keyboard's way into a canvas.
    if (drawing) {
      find = '';
      bringUnderEye(id);
      landOn(id);
      return;
    }
    if (asking) {
      wayTo(id);
      return;
    }
    // During a hand-walk the search moves the eye and not the path: the walk owns
    // where the path is, and a name cannot teleport it to a node nothing joins.
    if (tracing) {
      find = '';
      bringUnderEye(id);
      return;
    }
    selected = id;
    find = '';
    bringUnderEye(id);
  }

  /**
   * Whether a node is already in front of the analyst.
   *
   * Not `onScreen`, which pads by two cards so that a drag reveals cards already
   * built. The question here is whether following a connection has to move anything,
   * and a node sitting half off the edge is one that cannot be read where it is.
   */
  function inSight(id) {
    const spot = positions.get(id);
    if (!spot || !group) return false;
    const scale = group.scaleX() || 1;
    const left = -group.x() / scale;
    const top = -group.y() / scale;
    const pad = 60 / scale;
    return (
      spot.x > left + pad &&
      spot.x < left + width / scale - pad &&
      spot.y > top + pad &&
      spot.y < top + height / scale - pad
    );
  }

  /**
   * Read the node at the other end of a connection.
   *
   * **The view moves only when it has to.** Following a thread through a case is a
   * sequence of these, and recentring on every one of them makes the drawing lurch
   * under the reading — the neighbour was usually right there, since the layout puts
   * linked nodes next to each other. When it is off screen the view goes to it at the
   * current zoom, which is what the search already does.
   *
   * A running search is left alone, unlike picking a name out of the list: following
   * a connection is not answering the question that was typed, and dropping the
   * highlight would put the case back just as the analyst walks into it.
   *
   * While a walk is armed the same row steps the path instead, which is what makes
   * the walk reachable without a mouse: a row is always a neighbour of the node the
   * path currently ends on, so it is always a legal step or a step back. While a
   * question is armed it names the other end, for the same reason — an armed gesture
   * owns every way of pointing at a node, or the keyboard would be left out of the
   * one act the canvas cannot offer it.
   */
  function followTo(id) {
    selected = id;
    if (!inSight(id)) bringUnderEye(id);
  }

  // -- the locked focus ------------------------------------------------------

  /** Frame what the focus reaches, so a subset drawn alone is drawn at a size worth
   *  reading. Uses the placement as it stands, dragged nodes included. */
  function frameOnly() {
    if (!focused || !group || !width || !height) return;
    const view = fit(
      placed.filter((node) => focused.has(node.id)),
      width,
      height,
    );
    group.position({ x: view.x, y: view.y });
    group.scale({ x: view.scale, y: view.scale });
    zoom = view.scale;
    cameraRevision += 1;
    restyle();
  }

  /** Put the case back, and the view with it. */
  function letGoOnly() {
    if (!onlyThis) return;
    onlyThis = false;
    if (beforeOnly && group) {
      group.position({ x: beforeOnly.x, y: beforeOnly.y });
      group.scale({ x: beforeOnly.scale, y: beforeOnly.scale });
      zoom = beforeOnly.scale;
      cameraRevision += 1;
    }
    beforeOnly = null;
    restyle();
  }

  function toggleOnly() {
    if (onlyThis) {
      letGoOnly();
      return;
    }
    if (!focused || !group) return;
    beforeOnly = { x: group.x(), y: group.y(), scale: group.scaleX() };
    onlyThis = true;
    frameOnly();
  }

  /**
   * How far the focus reaches, changed.
   *
   * Reframing happens only while the rest is hidden, and only here. Asking for a
   * different reach is asking for a subset of a different size, and nothing else on
   * screen says by how much. Walking from node to node deliberately does **not**
   * reframe: that is a reading in progress, and a view that jumps on every step is
   * the lurch `followTo` exists to avoid.
   */
  function setFocusHops(count) {
    if (!focused || focusHops === count) return;
    focusHops = count;
    if (onlyThis) frameOnly();
  }

  // Letting the node go lets its reach go with it: a hop count with nothing to count
  // from is a setting nobody can see, and it would silently apply itself to whatever
  // was clicked next.
  $effect(() => {
    if (selected) return;
    untrack(() => {
      focusHops = 1;
      letGoOnly();
    });
  });

  // -- reading ---------------------------------------------------------------

  async function loadRegistry() {
    try {
      const body = await api.get('/api/cases/graph-lenses');
      lenses = body.lenses ?? [];
      orders = body.orders ?? [];
    } catch {
      // A missing registry degrades the controls, never the drawing: the default
      // lens still reads the whole case.
      lenses = [];
    }
  }

  /** Which read answers the question currently being asked, and with what. */
  function request() {
    if (root) return ['/graph/neighborhood', { root, lens, hops: String(hops) }];
    // A question handed over by the Board, already spelled the way this route asks
    // for it (`lib/entityFilter.js`). Applied as **terms** rather than as the ids it
    // matched: the drawing then answers the same question the table did, at any size,
    // and goes on answering it as the case changes underneath.
    const params = {
      lens,
      order,
      ...searchTerms,
      ...(catalogViews.snapshotId ? {} : temporalTerms),
    };
    if (catalogViews.snapshotId) params.view = catalogViews.snapshotId;
    // The types the switched-on families resolve to, as the catalog's own
    // comma-separated list. Empty when every family is on, which is no narrowing.
    // Intersected with a handed-over type set rather than replacing it: both are
    // narrowings, and a legend switch that widened the question it was applied to
    // would be a control doing the opposite of what it says.
    if (familyTypes) {
      const legend = familyTypes.split(',');
      const asked = params.type ? params.type.split(',') : null;
      const both = asked ? legend.filter((type) => asked.includes(type)) : legend;
      // An empty allow-list is not "no narrowing". The two questions genuinely have
      // nothing in common, and an empty `type` reads server-side as asking for
      // everything — so the drawing would answer a contradiction with the whole case.
      params.type = both.length ? both.join(',') : NOTHING;
    }
    // Exactly this folder, as the Board reads it. Including descendants made a
    // folder holding one entity draw three, which is a filter nobody can trust.
    if (pickFolder && !params.folder) params.folder = pickFolder;
    // Sent as one parameter each rather than repeated, matching the catalog's own
    // comma-separated type list. Three lists, because the drawing is a set: draw
    // these, draw these and one hop, leave these out.
    if (kept.length) params.keep = kept.join(',');
    if (expanded.length) params.expand = expanded.join(',');
    if (omitted.length) params.omit = omitted.join(',');
    return ['/graph', params];
  }

  let loadRun = 0;

  async function load() {
    const run = ++loadRun;
    const cid = caseState.current?.id;
    if (!cid) {
      payload = null;
      loading = false;
      return;
    }
    // A drag that has not been filed yet must reach the case before the case is
    // read back, or the answer overwrites it with the position it replaced.
    await flushPins();
    if (run !== loadRun || caseState.current?.id !== cid) return;
    loading = true;
    failed = '';
    // What is being asked, minus what was opened: two reads that differ only by an
    // expansion are the same question, and the view stays where the analyst left it.
    const asked = [
      cid, lens, order, root ?? '', hops, pickFolder, hiddenFamilies.join(','),
      // A question the Board handed over is the question: arriving with one, and
      // letting it go, both refit the view rather than growing what was on screen.
      JSON.stringify(searchTerms), JSON.stringify(temporalTerms), catalogViews.snapshotId ?? '',
    ].join('|');
    try {
      const [path, params] = request();
      const next = await api.get(`/api/cases/${cid}${path}?${new URLSearchParams(params)}`);
      // Reads are allowed to overlap: a filter, a mutation or a case switch can ask
      // a newer question before this one answers. Only the latest read may own the
      // canvas, even when an older response arrives last.
      if (run !== loadRun || caseState.current?.id !== cid) return;
      payload = next;
      // Only what the case confirmed it drew and opened, so a node deleted elsewhere
      // stops being offered as something to fold back or hand over. A removal needs no
      // such answer: taking a node out of a picture always succeeds.
      if (Array.isArray(payload.kept)) kept = payload.kept;
      if (Array.isArray(payload.expanded)) expanded = payload.expanded;
      if (selected && !payload.nodes.some((node) => node.id === selected)) selected = null;
      if (chosenLink && !payload.links.some((link) => link.id === chosenLink)) chosenLink = null;
      if (ownsViewArrangement()) {
        // The payload still carries case-wide pins because the graph route serves
        // every reading. A named view keeps its own map instead of adopting them.
        pinnedIds = [...pins.keys()];
        pinCount = pinnedIds.length;
      } else {
        // Outside a named graph, the case is the source of truth for arrangement.
        pins.clear();
        pinnedIds = payload.nodes.filter((node) => node.pin).map((node) => node.id);
        pinCount = payload.pinned ?? 0;
      }
      // A handful gathered in one reading means nothing in the next one, and half of
      // it may not even be drawn there.
      held = [];
      // A new *question* refits the view **and re-places it**; growing the picture
      // does neither. Opening a node and watching the whole case slide to a new
      // position is the fastest way to lose your place, and losing your place is
      // exactly what growing in place was built to stop. Cleared here rather than in
      // an effect, because the placement is derived from the payload just assigned
      // and reads this map the first time anything asks for it.
      const fresh = asked !== askedFor;
      if (fresh) settled.clear();
      resetView = fresh;
      askedFor = asked;
      settleArrival();
      settleRoute();
      // The stack starts at the picture the case opened on, not at the empty state
      // before the first read: anchored there, one undo too many would ask the case
      // to drop every pin it had never sent.
      if (anchored !== cid) {
        anchored = cid;
        history.reset(snapshotNow());
        mark();
      }
    } catch (err) {
      if (run !== loadRun || caseState.current?.id !== cid) return;
      failed = err.message || 'The graph could not be read.';
      payload = null;
    } finally {
      if (run === loadRun && caseState.current?.id === cid) loading = false;
    }
  }

  /**
   * Pick out the node that was asked for, once the read that brings it has landed.
   *
   * Selected and centred, because being told "it is here now" without being shown
   * where is the same as not having found it — on a case of a few hundred nodes an
   * arrival that lands off screen is indistinguishable from nothing happening.
   *
   * Centred on the next frame, not now: the placement is derived from the payload
   * that has only just been set, and the scene is rebuilt by an effect that has not
   * run yet. Selecting is safe here; moving the view is not.
   */
  function settleArrival() {
    const id = bringing;
    if (!id) return;
    bringing = null;
    if (!payload?.nodes.some((node) => node.id === id)) {
      // The budget ended the walk before it reached. Said rather than left silent:
      // the analyst asked for one named thing and the picture did not change.
      say('That one did not fit in the view. Narrow the case and try again.');
      return;
    }
    selected = id;
    requestAnimationFrame(() => jumpTo(id));
  }

  /**
   * Expand a node: its neighbours join the picture, and the picture stays.
   *
   * The gesture the whole tool turns on. Replacing the view with a neighbourhood
   * answered the question and lost the case it was asked about, so following a
   * thread meant navigating back and forth to keep your place. Here nothing is
   * taken away, and the arrivals say they arrived.
   */
  function expandNode(id) {
    // A folded node is expanded by giving back what it is holding, which costs no
    // read and is what the switch on it offers first.
    if (collapsed.includes(id)) {
      unfoldNode(id);
      return;
    }
    // Then what hiding took off it, before anything is asked of the case: those are
    // connections this node really has and the picture really lacks, so they are what
    // the count on it is offering. A node hidden by hand is undone from the node it
    // was hanging on, rather than costing the whole drawing or a name typed into Find.
    if (bringBackAt(id)) return;
    // Asked once and answered whole: an expansion brings every neighbour the picture
    // lacks, so a second press on the same node has nothing left to ask for.
    if (expanded.includes(id)) return;
    expanded = [...expanded, id];
  }

  /**
   * Fold a node: what only hung off it leaves the picture, and it stays.
   *
   * The act the drawing was missing, and the only one that reaches the nodes the case
   * **opened on**. Expanding adds and hiding removes; neither speaks for the two
   * hundred nodes that were on screen before the analyst touched anything, and those
   * are the ones in the way.
   *
   * Nothing is asked of the case and nothing is given up: the nodes are still in the
   * payload, so unfolding is instant. What it does not do is make room — the case
   * still sent them. Hiding is the act that frees the budget.
   */
  function foldNode(id) {
    if (collapsed.includes(id)) return;
    // Never offered where it would do nothing: a node holding nothing up has nothing
    // to fold, and a switch that answers a press with an unchanged picture is the
    // failure every count in this tool exists to prevent.
    if (!foldableCount(id, nodes, links, new Set(pinnedIds))) return;
    collapsed = [...collapsed, id];
    menu = null;
  }

  /** The nodes hidden off this one, each named once however many edges it took. */
  function putAwayAt(id) {
    return [...new Set(putAway[id] ?? [])];
  }

  /**
   * Give back what hiding took off one node. True when there was something to give.
   *
   * Whole rather than one node at a time, like the fold: what left together was one
   * act, and half of an act undone is not one.
   */
  function bringBackAt(id) {
    const back = putAwayAt(id);
    if (!back.length) return false;
    omitted = omitted.filter((entry) => !back.includes(entry));
    forgetHidden(back);
    return true;
  }

  /** Stop holding a way back to nodes that are drawn again, whatever brought them. */
  function forgetHidden(ids) {
    const back = new Set(ids);
    const left = {};
    for (const [near, gone] of Object.entries(putAway)) {
      const rest = gone.filter((id) => !back.has(id));
      if (rest.length) left[near] = rest;
    }
    putAway = left;
  }

  /** Give one node's surroundings back. */
  function unfoldNode(id) {
    collapsed = collapsed.filter((entry) => entry !== id);
  }

  /**
   * The one switch, in the one place it can be pressed: on the node.
   *
   * Grow first, and that ordering is the whole of what makes it learnable. A node
   * holding folded nodes gives them back; a node with neighbours the drawing does not
   * have goes and gets them; a node with everything already around it puts that away.
   * The badge states which of the three the press will do before it is pressed, so
   * there is never a click whose outcome has to be remembered.
   */
  function toggleAround(id) {
    if (collapsed.includes(id)) unfoldNode(id);
    else if (!root && offScreen(id) > 0) expandNode(id);
    else foldNode(id);
  }

  /**
   * Draw these nodes and nothing around them.
   *
   * The act a route and a named entity want: an answer of four nodes stays four
   * nodes. Opening them instead brought one neighbourhood per node, and on a
   * well-connected case the sentence was drawn inside a crowd.
   */
  function holdOn(ids) {
    const named = ids.filter(Boolean);
    if (!named.length) return;
    kept = [...new Set([...kept, ...named])];
    backIn(named);
  }

  // -- filing from the drawing ------------------------------------------------
  //
  // The hole this closes: the graph could state a relation between two nodes it was
  // already drawing, and could not put a third thing into the case. An analyst
  // reading a picture and realising it is missing an account had to leave for the
  // Board, create it, come back, search for it and bring it in — five screens for a
  // sentence they were in the middle of.

  /**
   * Draw what was just filed, where the gesture aimed, and offer the way back.
   *
   * Three acts on the drawing and one on the case, and the split is the point: `keep`
   * and the pin are presentation, so `Ctrl+Z` reaches them like every other edit here.
   * **The creation itself is not on that stack.** A single stack mixing *I hid a node*
   * with *I filed an entity* would write to the case on the fourth press to get a view
   * back, which is exactly the boundary this tool's undo is built on — so the way back
   * out of the writing is the toast, with the standard recoverable delete behind it.
   */
  function drewIn(entity, at, caseId = caseState.current?.id) {
    if (!caseId || caseState.current?.id !== caseId) return;
    if (at && canArrange) {
      // Pinned before the read rather than after it: the placement runs on the
      // payload that read brings back, and a node pinned afterwards would be put
      // somewhere by the layout first and moved a frame later.
      pins.set(entity.id, { x: at.x, y: at.y });
      dropNode(entity.id);
    }
    // The same arrival the search already uses: the reading effect sees `kept` change
    // and reads the case once, then `settleArrival` selects the node and brings it
    // under the eye. Reading here as well would be two requests for one act.
    bringing = entity.id;
    holdOn([entity.id]);
    toast(`${entity.label} filed`, 'ok', 6000, {
      label: 'Undo',
      onClick: () => dropEntity(entity, caseId),
    });
  }

  /** Take back a creation. The standard delete, so it lands in the case trash with the
   *  same recovery as every other one: a mis-typed entity is not a reason to make it
   *  unrecoverable. */
  async function dropEntity(entity, caseId = caseState.current?.id) {
    const cid = caseId;
    if (!cid) return;
    try {
      await api.del(`/api/cases/${cid}/entities/${entity.id}`);
      if (caseState.current?.id !== cid) return;
      kept = kept.filter((id) => id !== entity.id);
      if (selected === entity.id) selected = null;
      await load();
    } catch (err) {
      say(err.message || 'That one could not be taken back.');
    }
  }

  /**
   * Take files dropped on the canvas into the case, at the spot they were dropped.
   *
   * The Media Library's own import, offered where the case is being **read**: the
   * fastest thing an analyst does with a screenshot is drop it beside the thing it is
   * about, and the drawing was the one surface that could not take one.
   */
  let dropOver = $state(false);
  let importing = $state(false);

  async function importDropped(fileList, at) {
    const files = [...(fileList ?? [])];
    const cid = caseState.current?.id;
    if (snapshotReading) {
      say('This snapshot is read-only. Leave it to add files.');
      return;
    }
    if (!files.length || !cid || importing) return;
    importing = true;
    let last = null;
    let duplicates = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        try {
          const result = await api.post(`/api/cases/${cid}/media/upload`, form);
          if (result.duplicate) duplicates += 1;
          last = result.entity ?? last;
        } catch (err) {
          say(`${file.name}: ${err.message}`);
        }
      }
      // The same bytes twice is not an error and not a second item: the case keeps the
      // one it has, and saying so is what stops the analyst importing again.
      if (duplicates) {
        say(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped (same SHA-256)`);
      }
      // One file lands where it was dropped; a batch has no such spot, so it joins the
      // drawing and the layout places it.
      if (last) drewIn(last, files.length === 1 ? at : null, cid);
    } finally {
      importing = false;
    }
  }

  // ── paste ────────────────────────────────────────────────────────────────────
  /**
   * Ctrl+V draws what the clipboard holds, in the middle of what is being looked at.
   *
   * The drawing is where a case is thought about, so a screenshot or a link arriving
   * mid-thought should land here rather than send the analyst to another tab and
   * back. The centre of the viewport is the honest spot: a paste has no pointer
   * position the way a drop does.
   */
  let pasted = $state(null);
  let pasteBusy = $state(false);
  $effect(() => {
    if (uiState.tool !== 'graph') return;
    return listenForPaste((payload) => {
      if (snapshotReading) {
        say('This snapshot is read-only. Leave it to paste.');
        return;
      }
      pasted ??= resolvePaste('graph', payload);
    });
  });

  async function confirmPaste(resolved) {
    const cid = caseState.current?.id;
    if (pasteBusy || !cid) return;
    pasteBusy = true;
    const { kind, values, payload } = resolved;
    const at = width && height ? toCanvas({ x: width / 2, y: height / 2 }) : null;
    try {
      if (kind === 'image') {
        const result = await pasteImage(cid, {
          file: payload.file,
          title: values.title,
          sourceUrl: values.source,
        });
        pasted = null;
        // The same bytes twice is not an error and not a second node: the case keeps
        // the one it has, and saying so is what stops the analyst pasting again.
        if (result.duplicate) say('Already in the case (same SHA-256)');
        drewIn(result.entity, at, cid);
      } else {
        const entity = await createBookmark(cid, { ...values, url: payload.url });
        pasted = null;
        drewIn(entity, at, cid);
      }
    } catch (err) {
      say(err.message);
    } finally {
      pasteBusy = false;
    }
  }

  /**
   * Undo a removal, because a node named again outranks the edit that took it out.
   *
   * Left standing, an earlier removal would silently refuse the thing just asked for:
   * a route through it would come back short, and a source handed over from an edge
   * would answer with the edge it was pressed on.
   */
  function backIn(ids) {
    const named = new Set(ids);
    if (omitted.some((id) => named.has(id))) {
      omitted = omitted.filter((id) => !named.has(id));
      // Drawn again, so no node is still holding a way back to it: a neighbour
      // offering to bring in what is already on screen is the empty act again.
      forgetHidden(ids);
    }
    showAgain(ids);
  }

  /**
   * Unfold whatever is keeping these nodes off the screen.
   *
   * A node asked for by name outranks a fold, exactly as it outranks a removal. Left
   * standing, a fold would answer a search, a route or a followed connection with the
   * picture it was already showing — and the analyst would be looking for a node the
   * drawing had quietly decided not to draw.
   *
   * The fold that hides a node is undone whole rather than for that one node: a fold
   * is a reading of one node's surroundings, and half a fold is not one.
   */
  function showAgain(ids) {
    const wanted = new Set(ids.filter(Boolean));
    if (!wanted.size || !collapsed.length) return;
    const anchors = new Set(pinnedIds);
    const still = collapsed.filter((id) => {
      const { hidden } = foldAway([id], sentNodes, sentLinks, anchors);
      for (const gone of hidden) if (wanted.has(gone)) return false;
      return true;
    });
    if (still.length !== collapsed.length) collapsed = still;
  }

  /**
   * Take nodes out of the drawing, whatever put them there.
   *
   * **Any node, not only one you opened**, which is the whole point: a drawing that
   * grows without re-placing itself grows indefinitely, and the only way back used to
   * be folding every expansion — trading the reading away to tidy the picture.
   *
   * Nothing is deleted. The case still holds the entity and every one of its
   * connections; this says only that this picture is not about it.
   */
  function takeOut(ids) {
    const going = new Set(ids.filter(Boolean));
    if (!going.size) return;
    // Which nodes are left holding an edge to what is leaving, counted before the read
    // that drops both. This is what lets the neighbour offer it back.
    const record = { ...putAway };
    for (const link of links) {
      for (const [near, far] of [[link.from, link.to], [link.to, link.from]]) {
        if (going.has(far) && !going.has(near)) record[near] = [...(record[near] ?? []), far];
      }
    }
    putAway = record;
    // Added here and taken from nowhere else, and that is deliberate: the case applies
    // this list last, so it wins over the name that drew the node and over the hop that
    // reached it. Pruning those lists instead would make **Bring back** a half-undo —
    // a node that was only in the picture because it was named would not return.
    omitted = [...new Set([...omitted, ...going])];
    held = held.filter((id) => !going.has(id));
    // The panel and the walk are let go of here rather than after the read: a node on
    // its way out of the picture must not be left being read, and half a path is not
    // worth keeping — the same bargain Escape already makes with a walk.
    if (going.has(selected)) selected = null;
    if (path.some((step) => going.has(step.id))) traceStop();
    menu = null;
  }

  /**
   * Put the drawing back the way the case opened it.
   *
   * One way back rather than one per list. Growing, naming, hiding and folding are
   * four ways of editing one picture, and four separate undos meant reading four
   * counts in the toolbar to work out which of them was in the way. The arrangement
   * is deliberately left alone: **Reset pins** undoes work done by hand, and this
   * undoes a reading.
   *
   * Still worth its button beside the step-by-step undo: this is *back to the
   * beginning* in one press, where undo is *not that last one*. On a picture edited
   * thirty times they are not the same act.
   */
  function resetDrawing() {
    expanded = [];
    kept = [];
    omitted = [];
    collapsed = [];
    putAway = {};
  }

  /** Give every fold back at once. Costs no read, since nothing ever left. */
  function unfoldAll() {
    collapsed = [];
  }

  // -- the way back, one act at a time ---------------------------------------
  //
  // The drawing is **derived** from the lists above, which is what makes an undo
  // cheap here: there is no inverse to write per act, and therefore no inverse that
  // can be wrong. Remember the lists, put them back. An act added later is undone by
  // the same code without being told about it, because the history follows the
  // *state* rather than the acts — recorded by an effect over everything the picture
  // is made of, and deduplicated by the snapshot string, so a read that hands back
  // the same lists records nothing.
  //
  // **It stops at the drawing and the arrangement.** Both are presentation: a fold,
  // a hiding, a lens, a dragged node. Writing to the case is deliberately outside —
  // a single stack mixing "I hid a node" with "I deleted a statement" means four
  // presses to get a view back quietly rewrite the case, and an edge cannot be
  // un-deleted anyway: re-filing one mints a new id, a new date and a new author, so
  // the undo would forge the provenance it claims to restore. A relation filed by a
  // mis-drop is offered back where it is announced instead.

  const history = createHistory();
  let canUndo = $state(false);
  let canRedo = $state(false);
  /** The case whose first read anchored the stack, so nothing before it is undone. */
  let anchored = null;
  /**
   * True while a snapshot is being put back, and it is not belt and braces.
   *
   * Restoring an arrangement waits on the case, and an effect that ran between the
   * pins landing and the lists being assigned would record a picture that was never
   * asked for — one entry off the state being restored, which forks the timeline and
   * takes the redo with it. Only an undone *drag* reaches that seam; every other act
   * files nothing and returns at once.
   */
  let restoring = $state(false);
  /**
   * Bumped by a restore, and read by the question the view asks.
   *
   * An undo that only puts an arrangement back changes nothing the reading is keyed
   * on, so without this the pins would be filed and the picture would sit there
   * showing the drag that was just undone. One counter, one read, through the single
   * path everything else already takes.
   */
  let rereads = $state(0);

  function replaceViewArrangement(wanted, owner = arrangementOwner) {
    pins.clear();
    settled.clear();
    for (const [id, spot] of validPins(wanted)) pins.set(id, spot);
    arrangementOwner = owner;
    pinnedIds = [...pins.keys()];
    pinCount = pinnedIds.length;
    arrangementRevision += 1;
    arrangementSaveRevision += 1;
  }

  function releaseViewArrangement() {
    if (!arrangementOwner) return;
    arrangementOwner = null;
    pins.clear();
    settled.clear();
    pinnedIds = [];
    pinCount = 0;
    arrangementRevision += 1;
  }

  /** Where every pin in the active arrangement stands. A named view retains local
   *  off-screen pins; the case-wide undo remains limited to nodes currently drawn. */
  function arrangementNow() {
    return mergedArrangement({
      nodes: payload?.nodes ?? [],
      pins,
      held: pinnedIds,
      fromView: ownsViewArrangement(),
    });
  }

  function snapshotNow() {
    return drawingSnapshot({
      lens,
      order,
      root,
      hops,
      folder: pickFolder,
      families: hiddenFamilies,
      kept,
      expanded,
      omitted,
      collapsed,
      putAway,
      arrangement: arrangementNow(),
    });
  }

  function mark() {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  }

  /**
   * Record where the picture stands now, unless it stands where it already did.
   *
   * **The snapshot is taken before the guard, and that is load bearing**: the effect
   * that calls this tracks whatever it reads, so a run that returned early would
   * subscribe to nothing but the case id — and the recorder would go deaf the moment
   * it was anchored, which is the moment it starts mattering.
   */
  function record() {
    const now = snapshotNow();
    if (restoring || !anchored || anchored !== caseState.current?.id) return;
    history.push(now);
    mark();
  }

  /**
   * Put one snapshot back.
   *
   * The arrangement first and the lists second, in that order and on purpose: the
   * lists are what the reading is keyed on, so assigning them before the pins were
   * filed would read the case back with the arrangement still undone. The counter
   * goes last, so the whole restore is one question and one read.
   *
   * **The arrangement is only touched inside the reading it was taken in.** Pins are
   * per lens and survive a switch, so an undo that crosses one finds that lens's
   * arrangement already where it was left; diffing against the lens on screen would
   * take one reading's pins off with the other reading's list.
   */
  async function restore(text) {
    let was;
    try {
      was = JSON.parse(text);
    } catch {
      return;
    }
    restoring = true;
    try {
      if (ownsViewArrangement() || was.lens === lens) {
        await putArrangement(lens, was.arrangement ?? []);
      }
      lens = was.lens;
      order = was.order;
      root = was.root;
      hops = was.hops;
      pickFolder = was.folder;
      hiddenFamilies = was.families;
      kept = was.kept;
      expanded = was.expanded;
      omitted = was.omitted;
      collapsed = was.collapsed;
      putAway = was.putAway;
      // A menu opened on a node the restore may take away would act on nothing.
      menu = null;
      rereads += 1;
    } finally {
      // Let the effects settle before the recorder is listening again, or the run
      // that answers this restore is the one that undoes the undo.
      await tick();
      restoring = false;
    }
  }

  /** File the pins one snapshot asks for, and let go of the ones it does not. */
  async function putArrangement(reading, wanted) {
    if (ownsViewArrangement()) {
      replaceViewArrangement(wanted);
      return;
    }
    const { place, drop } = arrangementDiff(arrangementNow(), wanted);
    if (!place.length && !drop.length) return;
    const cid = caseState.current?.id;
    if (!cid) return;
    // A drag still in hand reaches the case first, or it lands on top of the undo.
    await flushPins();
    if (caseState.current?.id !== cid) return;
    try {
      if (place.length) {
        await api.put(`/api/cases/${cid}/graph/pins`, { lens: reading, pins: place });
      }
      for (const id of drop) {
        await api.del(`/api/cases/${cid}/graph/pins/${id}?lens=${reading}`);
      }
      for (const id of drop) {
        // The layout owns the node again, and where it came to rest is forgotten with
        // the pin — kept, it would stay the one fixed point nothing can place.
        pins.delete(id);
        settled.delete(id);
      }
    } catch (err) {
      say(err.message || 'The arrangement could not be put back.');
    }
  }

  function undo() {
    const back = history.undo();
    mark();
    if (back !== null) restore(back);
  }

  function redo() {
    const forward = history.redo();
    mark();
    if (forward !== null) restore(forward);
  }

  /**
   * Centre a neighbourhood on one node: the other reading, now asked for.
   *
   * **Not the same act as `expandNode`**, and the two are worded apart because they
   * were once both called expanding. This one *replaces* the case with one node and
   * its distance rings; that one *adds* a node's missing neighbours to the case
   * already drawn. Two near-synonyms for opposite acts, one in the panel and one in
   * the menu, is a trap the words have to close.
   */
  function focusOn(id) {
    if (snapshotReading) {
      selected = id;
      bringUnderEye(id);
      return;
    }
    root = id;
    selected = id;
    hops = 1;
  }

  function wholeCase() {
    root = null;
    hops = 1;
  }



  /**
   * What the case holds, in one read: its folders, and every type present in it.
   *
   * The types are what the family switches resolve against. Read from the case
   * rather than from the registry so a free-typed entity — one no family speaks for
   * — is never dropped by a switch that does not claim to cover it.
   */
  let holdingsRun = 0;

  async function loadHoldings(caseId = caseState.current?.id) {
    const run = ++holdingsRun;
    const cid = caseId;
    if (!cid) return;
    try {
      const body = await api.get(`/api/cases/${cid}/catalog/summary`);
      if (run !== holdingsRun || caseState.current?.id !== cid) return;
      summary = body;
      folders = Object.keys(body.by_folder ?? {}).sort();
      caseTypes = Object.keys(body.by_type ?? {});
    } catch {
      if (run !== holdingsRun || caseState.current?.id !== cid) return;
      summary = null;
      folders = [];
      caseTypes = [];
    }
  }

  // -- arranging by hand -----------------------------------------------------
  //
  // Dragging is only offered on the whole case. A neighbourhood gives its
  // horizontal axis to distance from the root, so a node moved off its column
  // would contradict the one thing that arrangement is drawn to show.

  const canArrange = $derived(!root && !snapshotReading);

  /**
   * The nodes ctrl-clicked into one handful, so a drag moves all of them together.
   *
   * A separate act from selection, and deliberately: selection is what the panel
   * reads and what the fade is computed from, and turning it into a set would make
   * "one hop from the selected node" a question with no single answer. This says
   * only "these move together", which is the whole of what it is for.
   */
  let held = $state([]);
  /** Where each held node stood when the current drag began, for one shared delta. */
  let grip = null;

  function toggleHeld(id) {
    held = held.includes(id) ? held.filter((entry) => entry !== id) : [...held, id];
  }

  /**
   * Expand the whole handful in one read, rather than one node per read.
   *
   * Growth over a list is the other half of owning the drawing: five nodes expanded
   * one at a time is five reads and five arrivals landing in five different places,
   * where the analyst asked one question about five nodes.
   */
  function expandGathered() {
    expanded = [...new Set([...expanded, ...held])];
    // The handful was gathered for the act. Kept, it would sit over the arrivals as a
    // group nobody is still building.
    held = [];
  }

  /**
   * Move one node and remember it, without re-arranging anything else.
   *
   * The shapes are moved in place and the seat is rewritten, so the edges follow
   * on the next redraw. `placed` is deliberately untouched: re-deriving it would
   * re-run the relaxation and slide every other node out from under the hand.
   */
  function moveNode(id, x, y) {
    const spot = positions.get(id);
    if (!spot) return;
    spot.x = x;
    spot.y = y;
    spot.pinned = true;
    pins.set(id, { x, y });
    shapes.get(id)?.circle.position({ x, y });
    // Not while the case is being panned: the pan owns the frame budget, and the
    // band is redrawn with everything else the moment the pointer comes up.
    if (dragged) return;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      restyle();
    });
  }

  /** File a move, once the hand has stopped. */
  function dropNode(id) {
    const spot = pins.get(id);
    if (!spot) return;
    const cid = caseState.current?.id;
    if (!cid) return;
    if (!pinnedIds.includes(id)) {
      pinnedIds = [...pinnedIds, id];
      pinCount += 1;
    }
    if (ownsViewArrangement()) {
      arrangementSaveRevision += 1;
      record();
      return;
    }
    savingCase ??= cid;
    savingFor ??= lens;
    pending.set(id, spot);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPins, SAVE_AFTER);
    // Recorded here rather than by the effect above: a node already pinned moves
    // without any reactive state changing, so the drag would go unseen. Once the hand
    // has stopped, so a drag is one entry rather than one per frame.
    record();
  }

  /**
   * Send the moves nobody has filed yet.
   *
   * Saved as they are made rather than behind a Save button: asking for a
   * keystroke after every drag would put friction on the one gesture this is for.
   * A failure says so and keeps the positions in hand, so the next drag retries
   * them rather than losing the arrangement.
   */
  async function flushPins() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    // The case and lens are captured when the drag happens. Reading the current case
    // here sent a last move from A to B when the debounce expired during a switch.
    const cid = savingCase;
    if (!cid || !pending.size) return;
    const batch = [...pending.entries()].map(([id, at]) => ({ id, x: at.x, y: at.y }));
    // The reading the drag happened in, captured with the batch: a lens change
    // reloads, and a pin filed under the lens that arrived after the drag would
    // arrange a picture nobody was looking at.
    const reading = savingFor ?? lens;
    pending = new Map();
    savingCase = null;
    savingFor = null;
    try {
      const body = await api.put(`/api/cases/${cid}/graph/pins`, {
        lens: reading,
        pins: batch,
      });
      if (caseState.current?.id === cid && reading === lens) {
        pinCount = body.pinned ?? pinCount;
      }
    } catch (err) {
      // Keep a failed batch for the next save only while no newer case/lens owns the
      // pending slot. Mixing two readings would be worse than asking for another drag.
      if (!pending.size) {
        for (const entry of batch) pending.set(entry.id, { x: entry.x, y: entry.y });
        savingCase = cid;
        savingFor = reading;
      }
      say(err.message || 'The arrangement could not be saved.');
    }
  }

  /**
   * Hand one node back to the layout.
   *
   * One node, and only that one: forgetting where it settled makes it the single
   * thing the relaxation still owns, so it is placed against a case that stays where
   * it is. Dropping the whole arrangement to answer a question asked about one node
   * would take the reading down with it.
   */
  async function unpinNode(id) {
    const cid = caseState.current?.id;
    if (!cid) return;
    pins.delete(id);
    settled.delete(id);
    pending.delete(id);
    pinnedIds = pinnedIds.filter((entry) => entry !== id);
    if (ownsViewArrangement()) {
      pinCount = pinnedIds.length;
      arrangementRevision += 1;
      arrangementSaveRevision += 1;
      return;
    }
    try {
      const body = await api.del(`/api/cases/${cid}/graph/pins/${id}?lens=${lens}`);
      if (caseState.current?.id !== cid) return;
      pinCount = body.pinned ?? Math.max(pinCount - 1, 0);
    } catch (err) {
      say(err.message || 'The pin could not be removed.');
    }
    // The layout has to run again for the node to be placed by it, and for its
    // neighbours to close the gap it leaves.
    loadedFor = null;
    load();
  }

  /**
   * Redraw the cards after the preview toggle, since a card is built once and kept.
   *
   * Destroyed rather than restyled: what a card holds — an `Image` or a `Path` — is
   * decided when it is built, and a picture and a glyph are not the same shape.
   */
  function forgetCards() {
    for (const entry of shapes.values()) {
      entry.card?.destroy();
      entry.card = null;
    }
    restyle();
  }

  /** Drop this reading's arrangement. The way back out of an autosave. */
  async function resetLayout() {
    const cid = caseState.current?.id;
    if (!cid) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    pending = new Map();
    savingCase = null;
    savingFor = null;
    pins.clear();
    // And where everything came to rest, or "let the layout place these again" would
    // answer with the picture it was asked to drop: a case whose every node is a
    // fixed point has nothing left to place.
    settled.clear();
    pinnedIds = [];
    if (ownsViewArrangement()) {
      pinCount = 0;
      arrangementRevision += 1;
      arrangementSaveRevision += 1;
      return;
    }
    try {
      await api.del(`/api/cases/${cid}/graph/pins?lens=${lens}`);
      if (caseState.current?.id !== cid) return;
      pinCount = 0;
    } catch (err) {
      say(err.message || 'The arrangement could not be cleared.');
    }
    loadedFor = null;
    load();
  }

  /**
   * Move the selected node from the keyboard.
   *
   * The same act as a drag, reachable without a mouse — a canvas has no keyboard
   * path into it at all, so without this the arrangement is mouse-only.
   */
  function nudge(dx, dy, far) {
    if (!canArrange) return false;
    // The handful if there is one, so the keyboard reaches the group move too.
    const moving = held.length ? held : selected ? [selected] : [];
    const step = far ? NUDGE_FAR : NUDGE;
    let moved = false;
    for (const id of moving) {
      const spot = positions.get(id);
      if (!spot) continue;
      moveNode(id, spot.x + dx * step, spot.y + dy * step);
      dropNode(id);
      moved = true;
    }
    return moved;
  }

  /** Put every case-owned reading aside before the next case is asked anything. */
  let openedFor = null;
  function startCase(cid) {
    openedFor = cid;

    // In-flight answers belong to the case that asked for them. Invalidating them
    // here makes the boundary immediate, before the next request has even started.
    loadRun += 1;
    lookupRun += 1;
    routeRun += 1;
    holdingsRun += 1;

    payload = null;
    summary = null;
    failed = '';
    loading = true;
    folders = [];
    caseTypes = [];
    openAnalysisCase(cid);
    searchFilter = normalizeFilter(analysisSearch.filter);

    root = null;
    hops = 1;
    pickFolder = '';
    fromBoard = null;
    hiddenFamilies = [];
    expanded = [];
    kept = [];
    omitted = [];
    collapsed = [];
    putAway = {};

    selected = null;
    focusHops = 1;
    onlyThis = false;
    beforeOnly = null;
    find = '';
    listing = true;
    elsewhere = [];
    bringing = null;
    singling = false;
    traceStop();
    asking = null;
    routing = null;
    routes = [];
    routeAt = 0;

    held = [];
    hovered = null;
    hoveredLink = null;
    chosenLink = null;
    openId = null;
    dirty = false;
    drawing = null;
    offer = null;
    menu = null;
    blank = null;
    creating = null;
    dropOver = false;

    // A pending drag is deliberately not cleared: `flushPins` still owns its case
    // id and files it there. Only the drawing-side copy is put away now.
    pins.clear();
    arrangementOwner = null;
    arrangementRevision += 1;
    arrangementSaveRevision += 1;
    pinnedIds = [];
    pinCount = 0;
    settled.clear();
    askedFor = null;
    anchored = null;
    canUndo = false;
    canRedo = false;
  }

  let loadedFor = null;
  /** The question the current drawing answers, so a growth is not read as a new one. */
  let askedFor = null;
  $effect(() => {
    const cid = caseState.current?.id ?? '';
    const rev = caseState.rev;
    if (cid !== (openedFor ?? '')) startCase(cid || null);
    const key = [
      cid,
      // Every case mutation bumps this shared revision. The graph is a live reading
      // of the case, so an entity or edge filed on any other surface must reread it.
      String(rev),
      lens,
      order,
      root ?? '',
      hops,
      kept.join(','),
      expanded.join(','),
      omitted.join(','),
      pickFolder,
      hiddenFamilies.join(','),
      JSON.stringify(searchTerms),
      JSON.stringify(temporalTerms),
      catalogViews.snapshotId ?? '',
      // An undo that only puts an arrangement back changes nothing else the reading
      // is keyed on, and the picture has to move all the same.
      String(rereads),
    ].join('|');
    if (key === loadedFor) return;
    loadedFor = key;
    load();
  });

  /** Folders and present types change with the same writes as the graph payload. */
  let holdingsFor = null;
  $effect(() => {
    const cid = caseState.current?.id;
    const key = cid ? `${cid}|${caseState.rev}` : '';
    if (key === holdingsFor) return;
    holdingsFor = key;
    if (!cid) {
      summary = null;
      folders = [];
      caseTypes = [];
      return;
    }
    loadHoldings(cid);
  });

  // Board and Graph stay mounted while only one is visible. Search+ therefore lives
  // above either component and both mirrors follow it, including a case switch.
  $effect(() => {
    const cid = caseState.current?.id;
    const shared = JSON.stringify(analysisSearch.filter);
    if (
      !cid || analysisSearch.caseId !== cid ||
      shared === untrack(() => JSON.stringify(searchFilter))
    ) return;
    untrack(() => (searchFilter = normalizeFilter(analysisSearch.filter)));
  });

  $effect(() => {
    const cid = caseState.current?.id;
    const local = JSON.stringify(searchFilter);
    const shared = untrack(() => JSON.stringify(analysisSearch.filter));
    if (!cid || untrack(() => analysisSearch.caseId) !== cid) return;
    if (local !== shared) {
      setAnalysisFilter(cid, untrack(() => searchFilter));
    }
  });

  let facetsFor = null;
  $effect(() => {
    const cid = caseState.current?.id;
    caseState.rev;
    const key = `${cid ?? ''}|${searchWantedTypes.join(',')}|${caseState.rev}`;
    if (!cid) {
      facets = [];
      facetsFor = null;
      facetState = 'unasked';
      return;
    }
    if (!searchWantedTypes.length && !fieldsWanted) {
      facets = [];
      facetsFor = null;
      facetState = 'unasked';
      return;
    }
    if (facetsFor === key) return;
    facetsFor = key;
    facetState = 'loading';
    fetchAttrFacets(cid, searchWantedTypes)
      .then((rows) => {
        if (caseState.current?.id !== cid) return;
        facets = rows;
        facetState = 'ready';
        if (
          searchFilter.attrKey &&
          !rows.some((row) => row.key === searchFilter.attrKey && row.values.length)
        ) {
          const dropped = searchFilter.attrKey;
          searchFilter = clearAxis(searchFilter, 'field');
          toast(`Nothing on screen carries ${dropped}, so that term went`, 'warn');
        }
      })
      .catch(() => {
        facets = [];
        facetState = 'ready';
      });
  });

  $effect(() => {
    if (!searchFilter.attrValue) return;
    const heldValues = facets.find((row) => row.key === searchFilter.attrKey)?.values ?? [];
    if (
      heldValues.length &&
      !heldValues.some((row) => row.value === searchFilter.attrValue)
    ) {
      searchFilter = { ...searchFilter, attrValue: '' };
    }
  });

  /**
   * Take the question the Board handed over, and frame what it answers.
   *
   * Cleared out of `uiState` as it is taken, like every other hand-off here: left
   * standing it would re-apply itself on the next visit to this tab, and the analyst
   * would find a narrowing they let go of two questions ago.
   */
  $effect(() => {
    const asked = uiState.drawInGraph;
    if (!asked) return;
    uiState.drawInGraph = null;
    untrack(() => {
      // A question about the case is a question about the whole of it: arriving into
      // a neighbourhood would answer it with one node's surroundings.
      root = null;
      selected = null;
      fromBoard = asked;
      searchFilter = normalizeFilter(asked.filter ?? searchFilter);
      setAnalysisFilter(caseState.current?.id, searchFilter);
    });
  });

  /** One entity, drawn and selected wherever the ask came from. The mirror of the
   *  board's own `openBoardEntity`: a row has to reach its node as much as a node has
   *  to reach its row. */
  $effect(() => {
    const id = uiState.openGraphEntity;
    if (!id) return;
    uiState.openGraphEntity = null;
    untrack(() => {
      if (snapshotReading && byId.has(id)) {
        selected = id;
        bringUnderEye(id);
      } else {
        bringIn({ id, type: byId.get(id)?.type ?? '' });
      }
    });
  });

  $effect(() => {
    loadRegistry();
  });

  /**
   * Record the picture whenever it changes, rather than at every act that changes it.
   *
   * Hooking the acts one by one is the version that rots: the next control added to
   * the toolbar is undoable only if somebody remembered, and nothing fails when they
   * did not. This reads the state instead, so an act is undoable by existing.
   *
   * Safe against its own restores because the snapshot is a string: `undo` moves the
   * index onto the entry being restored, so the push that follows is equal to it and
   * is dropped, and the redo tail survives. A drag is the one thing this cannot see —
   * the coordinates live outside the reactive state — so `dropNode` records its own.
   */
  $effect(() => {
    record();
  });

  // -- drawing ---------------------------------------------------------------
  //
  // Konva is imperative. The scene is rebuilt when the *structure* changes and
  // only restyled when the selection does, so panning to a corner and clicking a
  // node does not throw the view back to where it started.

  let stage = null;
  let layer = null;
  let group = null;
  let cards = null; // mini cards, built on the first zoom that shows them
  let trays = null; // regions drawn behind everything: the park
  let glyphs = null; // what each dot is, drawn inside it once it is big enough
  let rings = null; // the handful's rings, over whichever shape a node is drawn as
  let names = null; // labels and verbs, drawn over the edges they sit on
  let pills = null; // the switch on the node: what a press would grow or fold
  let shapes = new Map(); // id -> { circle, label, card, glyph, ring, mark, pill }
  let lines = []; // { arrow, link, points, verb }
  let parkBox = null; // the region the unconnected column is set apart into
  let band = null; // the relation being drawn, from its node to the pointer
  let resetView = true;
  let colours = {};
  /** Canvas takes a real font stack; `inherit` is not one, and silently fell back
   *  to the browser's default face for every label on the graph. */
  let fontStack = 'sans-serif';
  /** Loaded previews, by url: an `Image`, or 'failed' once it will never load. */
  const previews = new Map();

  /** Canvas has no CSS variables, so the palette is read off the document. */
  function readColours() {
    const style = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    fontStack = pick('--font-sans', 'sans-serif');
    colours = {
      accent: pick('--accent', '#e8a33d'),
      edge: pick('--text-3', '#6c6c6c'),
      label: pick('--text-2', '#9f9f9f'),
      strong: pick('--text-1', '#e6e6e6'),
      surface: pick('--bg-0', '#1c1c1c'),
      panel: pick('--bg-1', '#232323'),
      border: pick('--border', '#333333'),
      warn: pick('--warn', '#d9a53f'),
      family: Object.fromEntries(
        FAMILY_ORDER.map((family) => [family, pick(`--graph-${family}`, '#8f9aa8')]),
      ),
    };
  }

  const familyColour = (family) => colours.family?.[family] ?? colours.label ?? '#8f9aa8';

  function applyView() {
    if (!stage || !group) return;
    const view = fit(placed, width, height);
    group.position({ x: view.x, y: view.y });
    group.scale({ x: view.scale, y: view.scale });
    zoom = view.scale;
    cameraRevision += 1;
  }

  function rebuild() {
    if (!host || !width || !height) return;
    readColours();
    // A resize, a theme change or a reload of the same case must not throw away
    // where the analyst had panned to. Only a new question resets the view.
    const keep = group && !resetView
      ? { x: group.x(), y: group.y(), scale: group.scaleX() }
      : null;

    if (!stage) {
      stage = new Konva.Stage({ container: host, width, height });
      // Clicking the background clears the selection, which is what a click on
      // nothing means everywhere else in the app. Bound to the stage once, because
      // `destroyChildren` leaves stage-level listeners in place and a rebuild would
      // otherwise stack another copy of this one every time the case reloaded.
      stage.on('click tap', (event) => {
        // The right button opens the canvas menu and does nothing else. Konva reports
        // a `click` on any button, so without this the same press that opened the menu
        // closed it again on release — and the menu could only be read while the
        // button was held down. `ctrlKey` is the same press on macOS.
        if (event?.evt?.button === 2 || event?.evt?.ctrlKey) return;
        if (dragged) return;
        // Whatever is mid-gesture goes first, as everywhere else: a click on nothing
        // calls off a connection rather than silently leaving it armed.
        if (menu) menu = null;
        else if (blank) blank = null;
        else if (drawing) {
          drawing = null;
          restyle();
        } else selected = null;
      });
      stage.on('contextmenu', (event) => {
        // The browser's own menu over a canvas offers nothing but "save image".
        event.evt?.preventDefault();
        // A node's own handler stops this one, so reaching here means the press
        // landed on nothing — which is the one place the drawing can be added to
        // rather than only read.
        if (!canArrange || snapshotReading) return;
        const at = stage?.getPointerPosition();
        if (!at) return;
        blank = { x: at.x, y: at.y, at: toCanvas(at) };
        menu = null;
      });
    }
    stage.width(width);
    stage.height(height);
    stage.destroyChildren();
    shapes = new Map();
    lines = [];

    layer = new Konva.Layer();
    group = new Konva.Group();
    trays = new Konva.Group({ listening: false });
    // The edges listen now: an edge is a statement, and on a well-worked case it
    // is more often the finding than either node it joins.
    const wires = new Konva.Group();
    const dots = new Konva.Group();
    cards = new Konva.Group();
    glyphs = new Konva.Group({ listening: false });
    rings = new Konva.Group({ listening: false });
    names = new Konva.Group({ listening: false });
    // Listens, unlike every other annotation here: this one is a control.
    pills = new Konva.Group();

    for (const link of edges) {
      // An arrow rather than a line: the vocabulary is directed, and a line
      // without a head hides half of what the edge says. The points are set in
      // `restyle`, since where an edge stops depends on whether the thing it
      // points at is currently a dot or a card.
      //
      // `perfectDrawEnabled: false` is what makes the graph pannable, and it is not
      // a micro-optimisation. A Konva shape that has a fill *and* a stroke *and* an
      // opacity is composited through a buffer canvas the size of the whole stage —
      // so every faded arrow allocated and cleared a full-screen canvas on every
      // frame of a drag. Forty-five of them cost 246ms of a 247ms redraw. Without
      // the buffer the same redraw is one millisecond, and all it gives up is the
      // exact blend where a translucent head overlaps its own line.
      const arrow = new Konva.Arrow({
        tension: 0.4,
        // A stroke one pixel wide is unhittable with a mouse. The hit region is
        // widened rather than the line, so the picture is unchanged.
        hitStrokeWidth: 14,
        perfectDrawEnabled: false,
      });
      arrow.on('click tap', (event) => {
        event.cancelBubble = true;
        if (dragged) return;
        chosenLink = chosenLink === link.id ? null : link.id;
        selected = null;
      });
      arrow.on('mouseenter', () => {
        if (panning || drawing) return;
        hoveredLink = link.id;
      });
      arrow.on('mouseleave', () => {
        if (panning) return;
        hoveredLink = null;
      });
      lines.push({ arrow, link, points: [], verb: null });
      wires.add(arrow);
    }

    for (const node of placed) {
      const data = byId.get(node.id);
      if (!data) continue;
      const circle = new Konva.Circle({
        x: node.x,
        y: node.y,
        radius: nodeRadius(data.degree),
        // A node is small at a wide zoom; the hit region stays clickable.
        hitStrokeWidth: 10,
        perfectDrawEnabled: false,
      });
      answerTo(circle, data);
      const label = new Konva.Text({
        x: node.x - 70,
        y: node.y + nodeRadius(data.degree) + 5,
        width: 140,
        align: 'center',
        text: shortLabel(data.label),
        fontSize: 11,
        fontFamily: fontStack,
        listening: false,
        // Text over an edge is unreadable without a halo, and the graph is drawn
        // edges-first on purpose.
        fillAfterStrokeEnabled: true,
        lineJoin: 'round',
        perfectDrawEnabled: false,
      });
      shapes.set(data.id, { circle, label, card: null });
      dots.add(circle);
      names.add(label);
    }

    parkedTray();

    band = new Konva.Arrow({ listening: false, visible: false, perfectDrawEnabled: false });
    names.add(band);


    group.add(trays);
    group.add(wires);
    group.add(dots);
    group.add(glyphs);
    group.add(cards);
    group.add(rings);
    group.add(names);
    group.add(pills);
    layer.add(group);
    stage.add(layer);

    if (keep) {
      group.position({ x: keep.x, y: keep.y });
      group.scale({ x: keep.scale, y: keep.scale });
      zoom = keep.scale;
    } else {
      applyView();
      resetView = false;
    }
    restyle();
  }

  /**
   * Make a shape answer for a node: pick it, move it, expand it, name it.
   *
   * Shared, because a node is a dot at a wide zoom and a card at a close one, and
   * both have to behave identically — a card that could not be clicked would be a
   * picture of a graph rather than a graph, and one that could not be dragged while
   * the dot could would be a trapdoor at a particular zoom.
   *
   * `moves` is the shape the drag actually moves, which for a card is the group
   * rather than the rectangle carrying the pointer: the picture, the title and the
   * stripe have to travel with it.
   */
  function answerTo(shape, data, { named = false, moves = shape } = {}) {
    if (canArrange) grabbable(shape, moves, data);
    shape.on('contextmenu', (event) => {
      event.cancelBubble = true;
      event.evt?.preventDefault();
      if (!canArrange) return;
      // On macOS this same press is also a ctrl-click, which gathers. The menu is
      // not offered on top of that: one press, one act.
      if (event.evt?.ctrlKey && event.evt?.button === 0) return;
      openMenu(data.id, stage?.getPointerPosition());
    });
    shape.on('click tap', (event) => {
      event.cancelBubble = true;
      // The right button opens the menu and does nothing else. Konva reports it here
      // too, and without this the press that opened the menu also toggled the
      // selection under it.
      if (event.evt?.button === 2) return;
      if (dragged || arranged) return;
      // A connection was armed from the menu, so this click names its other end.
      if (drawing && landOn(data.id)) return;
      // A question was armed, so this click names the node it is about. Every node
      // is a legal answer here, unlike a connection: the case is searched, not the
      // drawing, so nothing on screen can be ruled out before asking.
      if (asking) {
        wayTo(data.id);
        return;
      }
      // A walk was armed, so this click is a step along it. Every node it could
      // reach is lit, and no other node listens — an armed gesture owns the click.
      if (tracing) {
        stepTo(data.id);
        return;
      }
      // Ctrl or Cmd gathers instead of choosing, so several nodes can be moved as
      // one. `preventDefault` because ctrl-click is the right-button gesture on
      // macOS and would otherwise open the browser's own menu over the canvas.
      if (canArrange && (event.evt?.ctrlKey || event.evt?.metaKey)) {
        event.evt?.preventDefault();
        toggleHeld(data.id);
        return;
      }
      selected = selected === data.id ? null : data.id;
    });
    // The same act as the switch on the node, reachable without aiming at a badge:
    // at a wide zoom the pill is a few pixels across, and a case is read wide.
    //
    // Konva counts a double-click by the clock alone, so two presses of the *right*
    // button on one node arrive here as well — and the second time a menu was opened
    // on a node, the drawing folded under it. The right button opens the menu and
    // does nothing else, exactly as the single click already says.
    shape.on('dblclick dbltap', (event) => {
      event.cancelBubble = true;
      if (event.evt?.button === 2) return;
      toggleAround(data.id);
    });
    shape.on('mouseenter', () => {
      if (panning) return;
      hovered = data.id;
      // A card already carries its name, its type and its picture, so a tooltip
      // over one would repeat the thing being pointed at. A dot carries nothing.
      if (named) return;
      const box = shape.getClientRect({ relativeTo: stage });
      tip = {
        x: box.x + box.width / 2,
        y: box.y,
        label: data.label,
        type: data.type,
        // What the bytes are, for the one type where that is the real answer.
        kind: data.kind ?? '',
        // And whether the case made them, which the card says and a dot cannot.
        origin: data.origin ?? '',
        op: data.op ?? '',
        degree: data.degree,
        folder: data.folder ?? '',
        thumb: data.thumb ?? '',
      };
    });
    shape.on('mouseleave', () => {
      // Not while dragging: the shapes slide out from under a still pointer, and
      // each of those would restyle the whole scene in the middle of a pan.
      if (panning) return;
      hovered = null;
      tip = null;
    });
  }

  /**
   * Let a node be picked up and put somewhere.
   *
   * Konva does the dragging, which is why the pointer press has to be kept from
   * reaching the container: that listener pans the canvas, and a node drag that
   * also panned would move the node and the case in opposite directions. Konva
   * dispatches shape events from a div inside the host, so stopping the native
   * event there is what keeps it from bubbling out to the pan.
   *
   * `dragDistance` is the same slop a click already tolerates, so a hand tremor on
   * a node still selects it rather than moving it a pixel and pinning it there.
   */
  function grabbable(shape, moves, data) {
    moves.draggable(true);
    moves.dragDistance(DRAG_SLOP);
    shape.on('pointerdown', (event) => {
      event.evt?.stopPropagation();
      // The container's own press handler is what normally clears this, and the line
      // above is what stops it from running. Without clearing it here, the flag left
      // true by the last pan survives, and the next click on a node is swallowed by
      // the guard that exists to ignore the click ending a pan.
      dragged = false;
    });
    moves.on('dragstart', () => {
      arranged = false;
      tip = null;
      // Picking up one of a handful picks up the handful. Their starting positions
      // are copied, so every one of them moves by the drag's own delta rather than
      // being read back mid-move from a seat this is in the middle of rewriting.
      grip = null;
      if (held.includes(data.id)) {
        grip = {
          from: { x: moves.x(), y: moves.y() },
          at: new Map(
            held
              .filter((id) => positions.has(id))
              .map((id) => [id, { x: positions.get(id).x, y: positions.get(id).y }]),
          ),
        };
      }
    });
    moves.on('dragmove', () => {
      arranged = true;
      if (!grip) {
        moveNode(data.id, moves.x(), moves.y());
        return;
      }
      const dx = moves.x() - grip.from.x;
      const dy = moves.y() - grip.from.y;
      for (const [id, start] of grip.at) moveNode(id, start.x + dx, start.y + dy);
    });
    moves.on('dragend', () => {
      if (arranged) for (const id of grip ? grip.at.keys() : [data.id]) dropNode(id);
      grip = null;
      // Cleared on the next frame, so the click that ends this drag still sees it
      // and does not toggle the selection.
      requestAnimationFrame(() => {
        arranged = false;
      });
    });
  }

  // -- stating a relation ----------------------------------------------------
  //
  // The graph drew links it could not make. To connect two entities sitting side
  // by side on screen an analyst had to leave, open Details and find the second one
  // again by name — in the one surface where it was already under the eye.
  //
  // **Right-click a node** and the menu says what can be done with it, "Connect
  // to…" among them. Then the next node clicked is the other end.
  //
  // Two drag gestures were tried first and both were wrong. A press on an invisible
  // rim band covered most of a small node, so moving one started a link by
  // accident. A visible handle fixed that and was still a drag: fiddly on a
  // trackpad, and invisible until you already knew it was there. A menu is where
  // people look for what a thing can do, it needs no aim, and it names the act in
  // words instead of hoping a ring is understood.
  //
  // Between arming and landing, the pointer drags a dashed arrow and only the
  // endpoints the vocabulary accepts stay lit — so an illegal pair cannot be drawn
  // rather than being drawn and then refused.

  /**
   * The node menu: where it sits, and what it is about.
   *
   * It selects nothing. Asking what can be done with a node is not the same act as
   * choosing it, and making it one made the whole case dim behind the menu — every
   * node more than a hop away faded, which read as the graph flickering under a
   * right-click.
   */
  function openMenu(id, at) {
    menu = { id, x: at?.x ?? 0, y: at?.y ?? 0 };
    offer = null;
    tip = null;
  }

  /**
   * Run a menu item against the node the menu is about, then close it.
   *
   * The id is read *before* the menu is cleared. Closing it first destroys what the
   * markup read the node from, and an item that did that reached for the id of
   * something that no longer existed — which is how every item here silently did
   * nothing at all.
   */
  function chose(act) {
    const id = menu?.id;
    menu = null;
    if (id) act(id);
  }



  /**
   * Arm a connection out of a node, and work out what it may land on.
   *
   * The vocabulary is asked once, here, rather than on every pointer move: the
   * answer cannot change while the pointer travels, and asking it per move would
   * run the registry over every node a hundred times a second.
   */
  function startDrawing(id) {
    const from = byId.get(id);
    if (!from) return;
    const targets = new Set();
    for (const node of nodes) {
      if (node.id !== id && relationOptions(from, node).length) targets.add(node.id);
    }
    menu = null;
    const at = positions.get(id);
    drawing = { from: id, targets, at: { x: at?.x ?? 0, y: at?.y ?? 0 }, to: null, over: null };
    tip = null;
    restyle();
  }

  /** Land the armed connection on a node, or say why it cannot land there. */
  function landOn(id) {
    if (!drawing) return false;
    const { from } = drawing;
    if (id === from) {
      // Clicking the node it started from is how the gesture is called off from the
      // canvas, without reaching for a key.
      drawing = null;
      restyle();
      return true;
    }
    if (!drawing.targets.has(id)) {
      say(`The vocabulary has no connection between those two.`);
      return true;
    }
    const options = relationOptions(byId.get(from), byId.get(id));
    const at = positions.get(id);
    const scale = group?.scaleX() || 1;
    drawing = null;
    restyle();
    offer = {
      from,
      to: id,
      options,
      x: (at?.x ?? 0) * scale + (group?.x() ?? 0),
      y: (at?.y ?? 0) * scale + (group?.y() ?? 0),
    };
    return true;
  }

  /**
   * Follow the pointer, and light the node it could land on.
   *
   * Redrawn once per frame like the pan is, not once per pointer event: a pointer
   * reports faster than the screen refreshes, and a full restyle of a few hundred
   * shapes per report is what makes a canvas feel like treacle.
   */
  function drawTo(event) {
    if (!drawing || !stage || !group) return;
    if (!host?.contains(event.target) && event.target !== host) return;
    stage.setPointersPositions(event);
    const spot = stage.getPointerPosition();
    if (!spot) return;
    const scale = group.scaleX() || 1;
    // The *pending* transform when a pan is in flight, not the committed one. A pan
    // stores where the group is going and only applies it on the next frame, so
    // reading the group here put the arrow one transform behind the case sliding
    // under it — and it caught up in a jump when the pointer came up.
    const origin = drag?.to ?? { x: group.x(), y: group.y() };
    const point = { x: (spot.x - origin.x) / scale, y: (spot.y - origin.y) / scale };
    const over = nodeAt(placed, byId, point, { carded: scale >= CARD_SCALE, scale });
    // What is hidden cannot receive a connection: the placement still knows where it
    // stands, so without this the band snapped to a node the analyst cannot see and
    // the menu named an entity that was nowhere on screen.
    const landable = over && (!hiding || hiding.has(over));
    drawing = {
      ...drawing,
      to: point,
      over: landable && over !== drawing.from && drawing.targets.has(over) ? over : null,
    };
    // One frame does both when a pan is running, since both want the same redraw and
    // there is one slot for it. Two callers racing for that slot was the other half
    // of the arrow's stutter.
    if (drag) return;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      restyle();
    });
  }

  /** File the chosen reading, then read the case back so the edge is the case's. */
  async function stateRelation(option) {
    if (snapshotReading) return;
    const cid = caseState.current?.id;
    const chosenOffer = offer;
    offer = null;
    if (!cid || !chosenOffer) return;
    say('');
    try {
      const [from, to] =
        option.direction === 'out'
          ? [chosenOffer.from, chosenOffer.to]
          : [chosenOffer.to, chosenOffer.from];
      const filed = await api.post(`/api/cases/${cid}/links`, {
        from_id: from,
        to_id: to,
        type: option.type,
      });
      if (caseState.current?.id !== cid) return;
      loadedFor = null;
      await load();
      // The edge appearing is the confirmation, so nothing is said when it does.
      // A lens holds one set of verbs, though, and one that does not hold this verb
      // draws nothing new — a write with no visible result reads as a write that
      // failed, which is the one case worth a sentence.
      if (filed?.id && !payload?.links?.some((edge) => edge.id === filed.id)) {
        say('Filed, and not drawn in this lens.');
      }
    } catch (err) {
      say(err.message || 'That connection was refused.');
    }
  }

  /** Rule on a proposal from the panel: the review queue, in the picture. */
  async function ruleOn(linkId, status) {
    if (snapshotReading) return;
    const cid = caseState.current?.id;
    if (!cid) return;
    say('');
    try {
      await api.patch(`/api/cases/${cid}/links/${linkId}`, { status });
      if (caseState.current?.id !== cid) return;
      loadedFor = null;
      await load();
    } catch (err) {
      say(err.message || 'That edge could not be updated.');
    }
  }

  /**
   * How sure of this edge, said where the edge is read.
   *
   * The assessment lived one panel away: reading a line here and grading it meant
   * leaving the drawing for the node's Details and finding the row again among the
   * grouped connections. On a worked case the finding is more often on the edge than
   * on either node it joins, so the judgement belongs on the same click as the reading.
   *
   * `''` is *not assessed*, and it sends `null` rather than being left out: absence is
   * a state to be able to return to, so a level picked by mistake is not a hole. The
   * control is not offered on a proposal at all — reviewing a machine's claim and
   * grading it are two gestures, and the API refuses the second before the first.
   *
   * The whole view is re-read afterwards, like every other write here, because the
   * rating can change the stroke: a relation ruled out is drawn apart.
   */
  async function rateEdge(linkId, raw) {
    if (snapshotReading) return;
    const cid = caseState.current?.id;
    if (!cid) return;
    say('');
    try {
      await api.patch(`/api/cases/${cid}/links/${linkId}`, {
        confidence: raw === '' ? null : Number(raw),
      });
      if (caseState.current?.id !== cid) return;
      loadedFor = null;
      await load();
    } catch (err) {
      say(err.message || 'That edge could not be rated.');
    }
  }

  /**
   * Say what kind of tie this edge states, or clear it.
   *
   * The drawing already writes it on the line — *is associated with (sister)* — and
   * could not change it, which is the odd half of the seam this closes: the word was
   * readable in the picture and editable only outside it.
   *
   * On `change` rather than on every keystroke, so "sister" is one request rather than
   * six. A value equal to what the edge already holds files nothing: `change` fires on
   * blur, and a click through the panel would otherwise re-read the case for nothing.
   */
  async function qualifyEdge(link, raw) {
    if (snapshotReading) return;
    const cid = caseState.current?.id;
    const value = raw.trim();
    if (!cid || value === (link.nature ?? '')) return;
    say('');
    try {
      await api.patch(`/api/cases/${cid}/links/${link.id}`, { nature: value || null });
      if (caseState.current?.id !== cid) return;
      loadedFor = null;
      await load();
    } catch (err) {
      say(err.message || 'That edge could not be qualified.');
    }
  }

  /**
   * How a collapsed edge reads: how many sources it stands for, and how many accounts
   * published them.
   *
   * "3 sources · 1 account" is the whole finding — three citations are not three
   * sources when one account published all three — and it is what makes the
   * independence a measurement rather than a computation somebody has to do by eye.
   * The account clause is left off when nothing published these, since a proof and a
   * capture have no publisher and "0 accounts" would read as a gap rather than as
   * "not that kind of source".
   *
   * A collapsed derivation says the act instead of the type — *derived from 2 frames*,
   * not *2 medias* — because "there was a step here" is the whole of what the edge is
   * for, and the step is what the analyst named it by in Inspect.
   *
   */
  function standsFor(link) {
    const { sources, accounts, via } = link.folded;
    const what = via.length === 1 ? madeAsWord(via[0]) : 'source';
    const many = sources === 1 ? what : `${sources} ${what}s`;
    return accounts ? `${many} · ${accounts} account${accounts === 1 ? '' : 's'}` : many;
  }

  /**
   * How the count on a node reads: what came out of it and was used by nothing.
   *
   * The same words as the collapsed step, for the same reason — *3 frames* is the act
   * the analyst named it by, where *3 medias* spends the sentence saying nothing. The
   * number is always written, because this one appears mid-sentence and "frame made
   * from it" is not one.
   */
  function rolledReads(rolled) {
    const { count, via } = rolled;
    const what = via.length === 1 ? madeAsWord(via[0]) : 'derivative';
    return `${count} ${count === 1 ? what : `${what}s`}`;
  }

  /**
   * What one line says, and it says it whether or not the pointer is on it when the
   * line stands for more than itself.
   *
   * A collapsed wrapper spells out what it replaced — *cites 3 sources · 1 account* is
   * the finding. A merged arrow is the case's own statement plus the ones saying the
   * same thing off the same material, so it carries a bare `+3`: writing the material
   * into the verb would put words in the statement's mouth, and the panel is where the
   * three are named and handed back.
   */
  function lineReads(link) {
    const verb = relationVerb(link.type);
    if (link.folded) return `${verb} ${standsFor(link)}`;
    if (link.merged) return `${verb} (+${link.merged.sources})`;
    // What kind of tie, where the verb alone cannot say it. Two people being
    // "associated with" each other is the thin half of the statement; *sister* is
    // the half worth reading, and it is on the line rather than a panel away.
    if (link.nature) return `${verb} (${link.nature})`;
    return verb;
  }

  /**
   * Bring back the nodes a collapsed edge stands for.
   *
   * Named rather than opened, and that is the difference the split bought: a source is
   * wanted as itself, where opening it dragged whatever else it touches in with it. A
   * node the analyst named is never folded, so naming these draws them with their own
   * edges again — which is what makes the collapse a reading rather than a loss.
   */
  function unfold(link) {
    const back = link.folded?.open ?? link.merged?.open ?? [];
    if (!back.length) return;
    // The selection is left where it is: the edge keeps its id while it still stands
    // for something, so the panel shows the count come down as the nodes arrive, and
    // the read that follows clears it once there is nothing left to stand for.
    holdOn(back);
  }

  /** Drop an edge. The case keeps the two entities; only the statement goes. */
  async function dropLink(linkId) {
    if (snapshotReading) return;
    const cid = caseState.current?.id;
    if (!cid) return;
    say('');
    try {
      await api.del(`/api/cases/${cid}/links/${linkId}`);
      if (caseState.current?.id !== cid) return;
      chosenLink = null;
      loadedFor = null;
      await load();
    } catch (err) {
      say(err.message || 'That edge could not be removed.');
    }
  }

  /**
   * A node as a mini card: what it is a picture of, what it is called, and one
   * line of what it is.
   *
   * Built on the first zoom that actually shows one, and only for the nodes on
   * screen. A case draws a few hundred nodes; building every card up front would
   * mean five shapes and one image request per node for cards nobody looked at.
   */
  function buildCard(data) {
    const art = CARD.stripe;
    const textLeft = art + CARD.art + CARD.pad;
    const textWidth = CARD.w - textLeft - CARD.pad;
    const card = new Konva.Group();
    card.add(
      new Konva.Rect({
        name: 'bg',
        width: CARD.w,
        height: CARD.h,
        cornerRadius: 7,
        perfectDrawEnabled: false,
        shadowBlur: 6,
        shadowOpacity: 0.35,
        shadowOffsetY: 1,
      }),
    );
    card.add(
      new Konva.Rect({
        name: 'stripe',
        width: CARD.stripe,
        height: CARD.h,
        cornerRadius: [7, 0, 0, 7],
        listening: false,
      }),
    );
    if (showPreviews && data.thumb) {
      // A ground under the picture and a rule down its right side. A thumbnail is
      // whatever colours its source was, and dropped straight onto the card it read
      // as a scrap lying on top of one; given a seat and an edge it reads as a side
      // of the card. The ground also holds the column while the picture loads, or
      // for good if it never does.
      card.add(
        new Konva.Rect({
          name: 'ground',
          x: art,
          width: CARD.art,
          height: CARD.h,
          // Rounded on the left only, and tighter than the card's own corner, which
          // keeps the column inside the curve it sits in.
          cornerRadius: [4, 0, 0, 4],
          listening: false,
        }),
      );
      card.add(
        new Konva.Image({
          name: 'art',
          x: art,
          width: CARD.art,
          height: CARD.h,
          cornerRadius: [4, 0, 0, 4],
          listening: false,
        }),
      );
      card.add(
        new Konva.Rect({
          name: 'rule',
          x: art + CARD.art,
          width: 1,
          height: CARD.h,
          listening: false,
        }),
      );
      showPreview(card, data.thumb);
    } else {
      // No picture to show: the entity's own glyph, from the one icon set, so a
      // card without a preview still says what kind of thing it is. Centred in the
      // column the picture would have filled, which is where it already sat.
      const glyph = CARD.glyph / 24;
      card.add(
        new Konva.Path({
          name: 'glyph',
          data: paths[entityIcon(data)] ?? paths.alert,
          x: art + (CARD.art - CARD.glyph) / 2,
          y: (CARD.h - CARD.glyph) / 2,
          scaleX: glyph,
          scaleY: glyph,
          strokeWidth: 1.8 / glyph,
          lineCap: 'round',
          lineJoin: 'round',
          listening: false,
        }),
      );
    }
    // Clipped with an ellipsis rather than wrapped: a card is one fixed shape, and
    // a title that took two lines would push the type line off the bottom of it.
    card.add(
      new Konva.Text({
        name: 'title',
        x: textLeft,
        y: CARD.pad + 1,
        width: textWidth,
        text: data.label,
        fontSize: 12,
        fontStyle: '600',
        fontFamily: fontStack,
        wrap: 'none',
        ellipsis: true,
        listening: false,
      }),
    );
    card.add(
      new Konva.Text({
        name: 'meta',
        x: textLeft,
        y: CARD.pad + 19,
        width: textWidth,
        text: cardMeta(data),
        fontSize: 10,
        fontFamily: fontStack,
        wrap: 'none',
        ellipsis: true,
        listening: false,
      }),
    );
    card.offset({ x: CARD.w / 2, y: CARD.h / 2 });
    answerTo(card.findOne('.bg'), data, { named: true, moves: card });
    cards.add(card);
    return card;
  }

  /** The one line under a card's title: what it is, and how connected it is. */
  function cardMeta(data) {
    // A media node says what it holds — a video, an image — because `media` covers
    // all of them and "Media" answers a question nobody asked. Material the case
    // *made* says the act instead: a video with twelve saved frames drew as thirteen
    // images, and "Image" on the twelve was the true word for the least useful thing
    // about them. The glyph still says it is a picture.
    const parts = [madeHereLabel(data) ?? entityKindLabel(data, entityLabel(data.type))];
    if (data.status === 'suggested') parts.push('proposed');
    parts.push(`${data.degree} link${data.degree === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }

  /**
   * Put a preview in a card, once. Thumbnails are served immutable and shared with
   * the Media Library, so the second view of the same picture costs nothing; a
   * thumbnail that will not load leaves the card as it is rather than a broken box.
   */
  function showPreview(card, thumb) {
    const cid = caseState.current?.id;
    if (!cid) return;
    const url = thumb.startsWith('data:') ? thumb : fileUrl(cid, thumb);
    const draw = (image) => {
      const art = card.findOne('.art');
      if (!art || !image?.naturalWidth) return;
      art.image(image);
      art.crop(cropToFill(image.naturalWidth, image.naturalHeight, CARD.art / CARD.h));
      stage?.batchDraw();
    };
    const held = previews.get(url);
    if (held === 'failed') return;
    if (held) {
      draw(held);
      return;
    }
    const image = new Image();
    image.onload = () => {
      previews.set(url, image);
      draw(image);
    };
    image.onerror = () => previews.set(url, 'failed');
    image.src = url;
  }

  /**
   * Draw the park as a region, with its name inside it.
   *
   * The park is a place, not a caption: these nodes are set apart on purpose, and
   * that only reads if the area they are set apart *into* is drawn. Floating a line
   * of text over the canvas above them left the words belonging to nothing and the
   * column looking like a layout accident.
   *
   * One word, and not the sentence the toolbar already says: the chip up there counts
   * them, this says which ones, and stating the same finding twice in two wordings is
   * how a picture starts arguing with itself.
   */
  function parkedTray() {
    const parked = placed.filter((node) => node.parked);
    parkBox = null;
    if (!parked.length) return;
    // The column's own extent, in canvas units, widened to clear the dots and the
    // labels under them and to leave the title a line of its own at the top.
    const xs = parked.map((node) => node.x);
    const ys = parked.map((node) => node.y);
    parkBox = {
      x: Math.min(...xs) - PARK_PAD.x,
      y: Math.min(...ys) - PARK_PAD.top,
      w: Math.max(...xs) - Math.min(...xs) + PARK_PAD.x * 2,
      h: Math.max(...ys) - Math.min(...ys) + PARK_PAD.top + PARK_PAD.bottom,
    };
    trays.add(
      new Konva.Rect({
        name: 'parked-tray',
        cornerRadius: 10,
        listening: false,
        perfectDrawEnabled: false,
      }),
    );
    names.add(
      new Konva.Text({
        name: 'parked-caption',
        text: 'Unconnected',
        fontSize: 11,
        fontFamily: fontStack,
        listening: false,
        fillAfterStrokeEnabled: true,
        lineJoin: 'round',
        perfectDrawEnabled: false,
      }),
    );
  }

  /**
   * Selection, hover and zoom, applied without rebuilding the scene.
   *
   * Also where a node decides what it is drawn as. Past `CARD_SCALE` there is room
   * on screen for a card, so the picture stops being a diagram of the case and
   * starts being a reading of it; below that, a card would cover its neighbours and
   * a dot is what the eye wants anyway.
   */
  function restyle() {
    if (!stage || !group) return;
    const scale = group.scaleX() || 1;
    // Hover only lights what it is over; narrowing the picture is a question being
    // asked of it, and one question does it at a time.
    const lit = hovered ?? selected;
    const near = narrowing;
    const asCards = scale >= CARD_SCALE;
    // What one of the card's units is worth out here. Everything hung off a card —
    // its rim, the ring around it, the pin, the switch — is measured with it, so the
    // card and its furniture grow as one shape.
    const unit = cardFactor(scale);
    const rim = { x: (CARD.w / 2) * unit, y: (CARD.h / 2) * unit };
    const seen = onScreen(scale);
    // Built once per redraw rather than asked per node: a few hundred nodes each
    // scanning these lists would be the one quadratic thing in the loop.
    const marked = new Set(pinnedIds);
    const inHand = new Set(held);

    for (const entry of lines) {
      const { arrow, link } = entry;
      // An edge survives the hiding only when both of its ends do. A line running off
      // to a node that is not there points at nothing, and would read as the case
      // continuing off screen when it does not.
      if (hiding && !(hiding.has(link.from) && hiding.has(link.to))) {
        arrow.visible(false);
        styleVerb(entry, false, scale);
        continue;
      }
      arrow.visible(true);
      const style = edgeStyle(link, CHAIN_TYPES);
      // An edge under the pointer or under the panel lights the same way a node
      // does: the two are the same kind of thing to be reading.
      //
      // And when one edge is singled out that way, the node's others step back.
      // Otherwise the answer to "which line is this row" was every line the node
      // has, since selecting it already lit all of them and wrote all their verbs —
      // which is exactly the question the panel's rows exist to answer.
      const picked = link.id === chosenLink || link.id === hoveredLink;
      const singled = Boolean(chosenLink || hoveredLink);
      // A path outranks all of that: it is the most recently asked question, and its
      // edges *are* the answer. Nothing else on a walked case may light.
      const onPath = pathLinks.has(link.id);
      const touching = tracing
        ? onPath
        : singled
          ? picked
          : Boolean(lit && (link.from === lit || link.to === lit));
      const faded = near && !(near.has(link.from) && near.has(link.to));
      const stands = Boolean(link.folded || link.merged);
      const from = positions.get(link.from);
      const to = positions.get(link.to);
      // A response swap updates derived positions before the scene rebuild effect
      // replaces its old Konva arrows. Hide that one-frame mismatch; leaving a
      // snapshot for another surface used to send an old edge into `edgePoints`
      // with no endpoint and raise after the navigation had already succeeded.
      if (!from || !to) {
        arrow.visible(false);
        styleVerb(entry, false, scale);
        continue;
      }
      // Where an edge stops depends on what it points at: the rim of a circle, or
      // the side of a card. A head buried under either one points at nothing.
      const side = asCards ? boxRadius(rim.x, rim.y, to.x - from.x, to.y - from.y) : 0;
      entry.points = edgePoints(
        from,
        to,
        asCards ? side : nodeRadius(byId.get(link.from)?.degree),
        asCards ? side : nodeRadius(byId.get(link.to)?.degree),
        bends.get(link.id) ?? 0,
      );
      arrow.points(entry.points);
      arrow.stroke(touching ? colours.accent : colours.edge);
      arrow.fill(touching ? colours.accent : colours.edge);
      // A path edge is drawn as a ribbon: three times the weight, and solid whatever
      // its verb would dash. **The distinction is in the stroke, not in the hue** —
      // a graph that reaches a report gets printed, and a printed graph is grey, so
      // a route told apart by colour alone is a route the page cannot show. Every
      // free colour is taken anyway: the families own the palette and the accent is
      // the selection.
      // A line that replaced nodes carries their weight too, so it is not read as one
      // statement among the others.
      arrow.strokeWidth(
        (onPath
          ? style.width + 3
          : (touching ? style.width + 0.6 : style.width) + (stands ? 0.9 : 0)) / scale,
      );
      arrow.dash(onPath ? [] : style.dash.map((n) => n / scale));
      arrow.pointerLength((style.kind === 'mention' ? 6 : 8) / scale);
      arrow.pointerWidth((style.kind === 'mention' ? 5 : 7) / scale);
      // A faded edge is context, not decoration: what keeps your place is the shape
      // of the rest of the case, and the shape is in the lines as much as in the
      // dots. At 0.07 a one-pixel stroke was gone in both themes, so the nodes were
      // carrying it alone and the far clusters read as loose points.
      arrow.opacity(touching ? 0.95 : faded ? 0.12 : 0.45);
      // Every verb on the path is written at once: the path is a sentence, and the
      // sentence is on the drawing as well as under it.
      //
      // A line standing for more than itself is written **once the drawing is close
      // enough to read**, which is the same threshold the nodes become cards at. Its
      // count is the whole reason those nodes are not on screen, so leaving it to the
      // hover lost them; writing it at every zoom put three hundred sentences over the
      // shape of the case, which is the one thing this tool exists to show. Wide, the
      // extra weight below carries it instead.
      styleVerb(entry, Boolean(touching) || (stands && asCards), scale);
    }

    for (const [id, entry] of shapes) {
      const data = byId.get(id);
      if (!data) continue;
      const { circle, label } = entry;
      const isSelected = id === selected;
      const isNear = !near || near.has(id);
      // A node whose name was typed is outlined rather than only left at full
      // strength: on a picture where most of the case is already dim, "not faded" is
      // not a mark, and the eye has to be able to count the matches.
      const matched = found.has(id);
      const carded = asCards && seen(circle);
      // Whether the node is on screen at all, which "Only this" is the only thing
      // that decides. Threaded through the annotations rather than left to opacity:
      // a glyph or a pin mark drawn over nothing is the tell that a node was removed
      // by painting rather than by being left out.
      const drawn = !hiding || hiding.has(id);
      // On the path, or offered as its next step. The two are told apart because
      // they are different claims: one is a route taken, the other is a route
      // available, and a walk that drew them alike would be a walk you cannot read.
      const stepped = tracing && pathIds.has(id);
      const offered = tracing && nextSteps.has(id);
      circle.visible(drawn && !carded);
      circle.fill(familyColour(data.family));
      circle.stroke(
        stepped || offered || isSelected || id === hovered || matched
          ? colours.accent
          : colours.surface,
      );
      // The path's own nodes are ringed heaviest, an offered step half that: the
      // weight says how settled the claim is, which the stroke can carry in grey.
      circle.strokeWidth(
        (stepped ? 3.6 : offered ? 2 : isSelected ? 3 : id === hovered || matched ? 2.2 : 1.5) /
          scale,
      );
      // A proposal is drawn as one everywhere it appears (ONTOLOGY §4).
      circle.dash(data.status === 'suggested' ? [3 / scale, 3 / scale] : []);
      circle.opacity(isNear ? 1 : 0.16);

      // Whatever is in hand keeps its name, and so does its neighbourhood: a
      // selection is read as a sentence, and an unnamed neighbour cannot be read.
      // The lit node itself gives its label up, because the words of its own edges
      // are written where that label sits, and the panel and the tooltip both name
      // it anyway.
      const named =
        isSelected || id === hovered || Boolean(near) || hubs.has(id) || scale >= LABEL_SCALE;
      label.visible(drawn && !carded && named && isNear && id !== lit);
      label.fill(isSelected ? colours.accent : colours.label);
      label.stroke(colours.surface);
      label.strokeWidth(3 / scale);
      label.fontSize(11 / scale);
      label.x(circle.x() - 70 / scale);
      label.width(140 / scale);
      label.y(circle.y() + circle.radius() + 5 / scale);

      if (carded || entry.card) {
        styleCard(entry, data, { scale, unit, carded, isSelected, isNear, matched, drawn });
      }
      styleGlyph(entry, data, { scale, carded, isNear, drawn });
      stylePill(entry, data, { scale, unit, carded, isNear, drawn });
      styleMark(entry, { scale, unit, carded, marked: drawn && isNear && marked.has(id) });
      styleHeld(entry, { scale, unit, carded, inHand: drawn && isNear && inHand.has(id) });
      // While a relation is being drawn, what it cannot land on steps back. The
      // vocabulary decides that, so an illegal pair is never drawn and then refused.
      if (drawing) {
        const target = drawing.from === id || drawing.targets.has(id);
        circle.opacity(target ? 1 : 0.12);
        entry.card?.opacity(target ? 1 : 0.12);
      }
    }

    styleBand(scale);

    // The park: a drawn region with its name inside it, so the nodes set apart read
    // as set apart rather than as a column that drifted there. The frame is in canvas
    // units because it encloses canvas things; only its stroke and its title are held
    // at a fixed size on screen.
    const tray = trays?.findOne('.parked-tray');
    const caption = names?.findOne('.parked-caption');
    // The park holds what nothing connects to, so it has no place in a picture of
    // what one node reaches: an empty frame captioned "Unconnected" beside a subset
    // reads as a claim about the subset.
    tray?.visible(!hiding);
    caption?.visible(!hiding);
    if (tray && parkBox) {
      tray.position({ x: parkBox.x, y: parkBox.y });
      tray.width(parkBox.w);
      tray.height(parkBox.h);
      tray.fill(colours.panel);
      tray.stroke(colours.border);
      tray.strokeWidth(1 / scale);
      tray.opacity(near ? 0.25 : 0.55);
    }
    if (caption && parkBox) {
      caption.fill(colours.label);
      caption.stroke(colours.surface);
      caption.strokeWidth(3 / scale);
      caption.fontSize(11 / scale);
      // Inside the frame, at its top left: a region's name belongs in the region.
      caption.x(parkBox.x + 12 / scale);
      caption.y(parkBox.y + 9 / scale);
      caption.opacity(near ? 0.25 : 0.85);
    }
    stage.batchDraw();
  }

  /**
   * A test for whether a node is in view, in canvas units.
   *
   * Cards are only built and only ask for their picture once they are actually on
   * screen: zooming in on one corner of a 500-node case must not fire 500 image
   * requests for cards nobody can see.
   */
  function onScreen(scale) {
    // Two cards of slack, so a normal drag reveals cards that already exist rather
    // than the dots underneath them: the scene is only redressed when the drag ends.
    const margin = CARD.w * 2 * cardFactor(scale);
    const rect = visibleRect({ x: group.x(), y: group.y(), scale }, width, height, margin);
    return (shape) => within(rect, shape.x(), shape.y());
  }

  /**
   * Put the entity's own glyph inside the dot.
   *
   * A family colour says which of seven groups a node belongs to; the glyph says
   * what it *is*, which is the question the eye asks first. The card already answers
   * it close up, and this answers it at the zoom where a case is actually read.
   *
   * **Only where it can be read.** A dot is eleven to twenty-four canvas units, so
   * below `GLYPH_MIN` screen pixels the glyph is a smudge — and a wide zoom is
   * exactly where a case draws the most nodes. Gating on the drawn size is what
   * keeps this from adding a few hundred shapes to the one view that cannot afford
   * them, and it costs nothing where they would not have been legible anyway.
   */
  function styleGlyph(entry, data, { scale, carded, isNear, drawn = true }) {
    const across = entry.circle.radius() * scale * 2;
    const show = drawn && !carded && across >= GLYPH_MIN;
    if (!show && !entry.glyph) return;
    if (!entry.glyph) {
      entry.glyph = new Konva.Path({
        data: paths[entityIcon(data)] ?? paths.alert,
        listening: false,
        perfectDrawEnabled: false,
        lineCap: 'round',
        lineJoin: 'round',
      });
      glyphs.add(entry.glyph);
    }
    const glyph = entry.glyph;
    glyph.visible(show);
    if (!show) return;
    // Sized off the dot, not off the screen: it has to sit inside the circle at
    // every zoom, and the circle is measured in canvas units.
    const box = entry.circle.radius() * 1.3;
    const unit = box / 24;
    glyph.scale({ x: unit, y: unit });
    glyph.strokeWidth(1.9 / unit / scale);
    // Struck in the background colour, so it reads as cut out of the family hue
    // rather than as a second thing drawn on top of it.
    glyph.stroke(colours.surface);
    glyph.position({ x: entry.circle.x() - box / 2, y: entry.circle.y() - box / 2 });
    glyph.opacity(isNear ? 0.9 : 0.16);
  }

  /**
   * Ring a node that is in the handful, so a group drag is not a surprise.
   *
   * Outside the node rather than on it, because the node's own stroke already says
   * whether it is selected and whether it is a proposal. A ring around it is the one
   * free place left to say "this one moves with the others".
   */
  function styleHeld(entry, { scale, unit, carded, inHand }) {
    if (!inHand && !entry.ring) return;
    if (!entry.ring) {
      entry.ring = new Konva.Circle({
        listening: false,
        perfectDrawEnabled: false,
        fillEnabled: false,
      });
      rings.add(entry.ring);
    }
    const ring = entry.ring;
    ring.visible(inHand);
    if (!inHand) return;
    ring.position({ x: entry.circle.x(), y: entry.circle.y() });
    // Clear of a card too, which is wider than it is tall: the ring has to sit
    // outside whichever shape the node is currently drawn as.
    const around = carded
      ? Math.hypot(CARD.w / 2, CARD.h / 2) * unit + 4 / scale
      : entry.circle.radius() + 6 / scale;
    ring.radius(around);
    ring.stroke(colours.accent);
    // Solid, never dashed: a dashed outline means "proposed" everywhere else in this
    // picture (ONTOLOGY §4), and a handful of nodes is not a claim about the case.
    ring.strokeWidth(1.6 / scale);
    ring.opacity(0.8);
  }

  /** One card, sized off the screen and centred on the node it stands for. */
  function styleCard(
    entry,
    data,
    { scale, unit, carded, isSelected, isNear, matched, drawn = true },
  ) {
    if (!carded || !drawn) {
      entry.card?.visible(false);
      return;
    }
    entry.card ??= buildCard(data);
    const card = entry.card;
    card.visible(true);
    card.opacity(isNear ? 1 : 0.16);
    // Sized off the screen rather than off the canvas, which is the whole reason a
    // card can exist here: the gap between two nodes grows with the zoom faster than
    // the card does, so the cards never close back in on each other (`cardFactor`).
    card.scale({ x: unit, y: unit });
    card.position({ x: entry.circle.x(), y: entry.circle.y() });
    // A card carries the search the same way a dot does, or a name typed at a zoom
    // close enough to read the cards would light nothing at all.
    const lit = isSelected || matched || data.id === hovered;
    const bg = card.findOne('.bg');
    bg.fill(colours.panel);
    bg.stroke(lit ? colours.accent : colours.border);
    bg.strokeWidth(lit ? 2 : 1);
    bg.shadowColor(colours.surface);
    bg.dash(data.status === 'suggested' ? [3, 3] : []);
    card.findOne('.stripe').fill(familyColour(data.family));
    card.findOne('.glyph')?.stroke(familyColour(data.family));
    card.findOne('.ground')?.fill(colours.surface);
    card.findOne('.rule')?.fill(lit ? colours.accent : colours.border);
    card.findOne('.title').fill(lit ? colours.accent : colours.strong);
    card.findOne('.meta').fill(colours.label);
  }

  /**
   * The switch on the node: one press, and it says what the press does.
   *
   * A canvas teaches no gesture on its own, so the count is the teaching. `+5` is
   * five connections the drawing does not have; `−35` is thirty-five nodes that hang
   * off this one and nothing else; a filled `+35` is thirty-five it is currently
   * holding. The sign is the promise — plus grows the picture, minus shrinks it — and
   * it is the same promise in all three states.
   *
   * Drawn only on the node under the eye, and permanently on a node that is holding
   * something. A pill on every dot would be a few hundred numbers competing with the
   * shape of the case, which is the one thing this tool exists to show.
   */
  function stylePill(entry, data, { scale, unit, carded, isNear, drawn }) {
    const on = switchFor?.id === data.id ? switchFor : null;
    const holding = collapsed.includes(data.id);
    const act = holding ? 'unfold' : on?.act;
    const count = holding ? (folds.by.get(data.id) ?? 0) : (on?.count ?? 0);
    // Never over an armed gesture: while a connection, a route or a walk is waiting
    // for its other end, every press on the case belongs to that gesture.
    const show =
      drawn && isNear && Boolean(act) && count > 0 && !drawing && !tracing && !asking;
    if (!show && !entry.pill) return;
    if (!entry.pill) {
      const box = new Konva.Rect({ cornerRadius: 7, perfectDrawEnabled: false });
      const text = new Konva.Text({
        fontSize: 10,
        fontFamily: fontStack,
        align: 'center',
        listening: false,
        perfectDrawEnabled: false,
      });
      const pill = new Konva.Group();
      pill.add(box, text);
      pill.on('click tap', (event) => {
        event.cancelBubble = true;
        if (dragged || arranged) return;
        toggleAround(data.id);
      });
      entry.pill = { pill, box, text };
      pills.add(pill);
    }
    const { pill, box, text } = entry.pill;
    pill.visible(show);
    if (!show) return;
    text.text(`${act === 'fold' ? '−' : '+'}${count}`);
    const width = Math.max(text.getTextWidth() + 10, 20);
    const height = 15;
    box.width(width);
    box.height(height);
    text.width(width);
    text.y(3);
    // Filled while it is holding something, outlined while it is offering: a state
    // and an offer must not read alike, or the drawing stops saying which nodes have
    // something put away under them.
    box.fill(holding ? colours.accent : colours.panel);
    box.stroke(holding ? colours.accent : colours.border);
    box.strokeWidth(1);
    text.fill(holding ? colours.surface : colours.label);
    // Held at a fixed size on screen like every other annotation, and hung off the
    // node's top right — clear of the label, which sits under it.
    pill.scale({ x: 1 / scale, y: 1 / scale });
    const reach = carded
      ? { x: (CARD.w / 2) * unit, y: (CARD.h / 2) * unit }
      : { x: 0, y: 0 };
    const radius = carded ? 0 : entry.circle.radius() * 0.7;
    pill.position({
      x: entry.circle.x() + radius + reach.x - (carded ? width / scale : 0),
      y: entry.circle.y() - radius - reach.y - height / scale,
    });
  }

  /**
   * Mark a node the analyst placed by hand.
   *
   * Without it a pinned node is a mystery: it ignores the lens, it does not move
   * when the case is re-arranged around it, and nothing on screen says why. The mark
   * is the entity vocabulary's own pin glyph, held at a fixed size on screen like
   * every other annotation here, and built on the first node that needs one.
   */
  function styleMark(entry, { scale, unit, carded, marked }) {
    if (!marked && !entry.mark) return;
    if (!entry.mark) {
      entry.mark = new Konva.Path({
        data: paths.pushpin,
        listening: false,
        lineCap: 'round',
        lineJoin: 'round',
        perfectDrawEnabled: false,
      });
      names.add(entry.mark);
    }
    const mark = entry.mark;
    mark.visible(marked);
    if (!marked) return;
    // The icon set draws in a 24-unit box; this holds the glyph and its stroke at a
    // fixed size on screen whatever the zoom, like every other annotation here.
    const size = 15 / scale;
    const glyph = size / 24;
    mark.scale({ x: glyph, y: glyph });
    mark.strokeWidth(1.7 / (glyph * scale));
    mark.stroke(colours.accent);
    const circle = entry.circle;
    const half = carded
      ? { x: (CARD.w / 2) * unit, y: (CARD.h / 2) * unit }
      : { x: circle.radius(), y: circle.radius() };
    mark.position({
      x: circle.x() + half.x - (carded ? size * 1.1 : size * 0.35),
      y: circle.y() - half.y - (carded ? -size * 0.15 : size * 0.55),
    });
  }


  /**
   * The relation being drawn, from its node to the pointer.
   *
   * Drawn as an arrow because what it will become is one, and dashed because it is
   * not a statement yet. It lands on the node under the pointer rather than on the
   * pointer itself once there is a legal target, so the gesture snaps and the drop
   * is not a pixel hunt.
   */
  function styleBand(scale) {
    if (!band) return;
    band.visible(Boolean(drawing?.to));
    if (!drawing?.to) return;
    const from = positions.get(drawing.from);
    const to = drawing.over ? positions.get(drawing.over) : drawing.to;
    if (!from || !to) return;
    band.points([from.x, from.y, to.x, to.y]);
    band.stroke(drawing.over ? colours.accent : colours.label);
    band.fill(drawing.over ? colours.accent : colours.label);
    band.strokeWidth(1.8 / scale);
    band.dash([7 / scale, 5 / scale]);
    band.pointerLength(9 / scale);
    band.pointerWidth(8 / scale);
    band.opacity(drawing.over ? 0.95 : 0.6);
  }

  /**
   * Write the verb along an edge under the eye.
   *
   * The **forward** wording, not the panel's inverse reading: here the words sit
   * beside a head that already points somewhere, so "has member" pointing at the
   * unit would contradict the arrow. The panel has no arrow and reads from the
   * selected node outwards, which is why the two differ.
   *
   * Created on the first edge that needs one rather than up front: a case draws a
   * few hundred edges and only the handful under the pointer are ever worded.
   *
   * A collapsed edge says what it stands for beside its verb, because that is the
   * whole point of collapsing it: *cites 3 sources · 1 account* is the finding, where
   * "cites" alone would be a thinner line saying less than the three it replaced.
   */
  function styleVerb(entry, show, scale) {
    if (!show && !entry.verb) return;
    if (!entry.verb) {
      entry.verb = new Konva.Text({
        text: lineReads(entry.link),
        fontSize: 10,
        fontFamily: fontStack,
        listening: false,
        fillAfterStrokeEnabled: true,
        lineJoin: 'round',
        perfectDrawEnabled: false,
      });
      names.add(entry.verb);
    }
    const text = entry.verb;
    text.visible(show);
    if (!show) return;
    text.fontSize(10 / scale);
    text.stroke(colours.surface);
    text.strokeWidth(3.5 / scale);
    text.fill(colours.accent);
    const mid = edgeMidpoint(entry.points, 13 / scale);
    text.offsetX(text.width() / 2);
    text.offsetY(text.height() / 2);
    text.position(mid);
  }

  /** A screen point in the canvas units the placement and the pins are stated in.
   *  The same inverse `zoomBy` already takes to keep the pointer over the same spot
   *  while zooming, said once so a dropped file and a new entity land where the
   *  gesture aimed. */
  /** Where the camera stands, as `lib/graphViewport.js` states it. */
  function camera() {
    return { x: group.x(), y: group.y(), scale: group.scaleX() || 1 };
  }

  function toCanvas(point) {
    if (!group) return { x: point.x, y: point.y };
    return toCanvasPoint(point, camera());
  }

  function zoomBy(factor, anchor) {
    if (!group || !stage) return;
    const moved = zoomAround(factor, anchor ?? { x: width / 2, y: height / 2 }, camera());
    if (!moved) return; // already at the bound; nothing to redraw
    group.scale({ x: moved.scale, y: moved.scale });
    group.position({ x: moved.x, y: moved.y });
    zoom = moved.scale;
    cameraRevision += 1;
    restyle();
  }

  function onWheel(event) {
    event.preventDefault();
    const pointer = stage?.getPointerPosition();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, pointer);
  }

  // -- panning ---------------------------------------------------------------
  //
  // Done by hand rather than with Konva's `draggable`, which is the bug this
  // replaces: a draggable Group only drags where the pointer hits one of its own
  // shapes, so the canvas could only be moved by grabbing a node — and the empty
  // space, which is most of a graph, did nothing at all.

  let drag = null;
  let dragged = false; // a click that ended a pan must not also select
  let arranged = false; // nor a click that ended a node's own drag
  let frame = 0; // the redraw already asked for, so a pan draws once per frame

  function onPointerDown(event) {
    // Whatever the press turns out to be, it was aimed at the case, and the list is
    // sitting over the case.
    listing = false;
    if (event.button !== 0 || !group) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: group.position() };
    dragged = false;
    panning = true;
    tip = null;
  }

  function onPointerMove(event) {
    // An armed connection follows the pointer, and does not stop the case being
    // panned under it: the two nodes worth joining are often nowhere near each
    // other, and a mode that pinned the view would make those the hard ones.
    if (drawing) drawTo(event);
    if (!drag || event.pointerId !== drag.id || !group) return;
    // A button released outside the window never reaches us, so a move with no
    // button held ends the pan instead of dragging the case around behind a
    // pointer nobody is pressing.
    if (event.buttons === 0) {
      onPointerUp(event);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!dragged) {
      dragged = true;
      // Nothing can be picked mid-pan, so the hit canvas — a second full drawing of
      // every shape — is not worth redrawing on the way. This is most of what made
      // dragging feel heavy.
      layer?.listening(false);
    }
    drag.to = { x: drag.at.x + dx, y: drag.at.y + dy };
    // A pointer reports faster than the screen refreshes, so several moves per
    // frame would each pay for a full redraw and only the last would be seen.
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (!drag?.to || !group) return;
      group.position(drag.to);
      // Only the arrow, never the scene: a pan deliberately does not restyle, and
      // paying for a few hundred shapes on every frame of one to keep a single line
      // in step would undo the whole reason it draws this way. What the arrow could
      // land on is caught up when the pointer comes up.
      if (drawing) styleBand(group.scaleX() || 1);
      layer?.batchDraw();
    });
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.to && group) group.position(drag.to);
    drag = null;
    panning = false;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    layer?.listening(true);
    // What the pan brought into view has to be dressed: a card is only built once
    // it is on screen, so panning to a new corner is what asks for its cards. Drawn
    // straight away rather than on the next batch, so releasing the mouse does not
    // leave the last stretch of the drag one frame behind the pointer.
    if (dragged) {
      cameraRevision += 1;
      restyle();
      layer?.draw();
    }
  }

  function fitView() {
    applyView();
    restyle();
  }

  /** Native full screen, so the drawing gets the browser chrome's rows too. The
   *  canvas is measured with `bind:clientWidth`, so the stage follows on its own.
   *  Esc leaves it without asking us, which is why the flag is read back from the
   *  document rather than toggled here. */
  async function toggleFullscreen() {
    if (!toolElement || typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await toolElement.requestFullscreen();
    } catch {
      toast('Full screen is not available', 'danger');
    }
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    const changed = () => (fullscreen = document.fullscreenElement === toolElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  });

  /** Which way one arrow key moves a node. */
  const ARROWS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function onKey(event) {
    // Escape still reaches the search field, because leaving it is what Escape is
    // for there. Everything else belongs to the canvas, and a field that is being
    // typed into owns its own keys: without this, naming a node "0" fits the view
    // and an arrow key moves the case instead of the cursor.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '');
    if (event.key === 'Escape') {
      // The search list is what Escape closes first, then the handful, then the
      // selection: the shallower thing goes first, as everywhere else. A menu or a
      // half-drawn relation is shallower than any of them — it is mid-gesture.
      //
      // One press takes the list and the term together, and it is the browser that
      // decides: Escape in a `type="search"` field clears it natively, so a first
      // press that only put the list away would be fighting the platform to stage a
      // distinction the pointer already makes.
      if (menu) menu = null;
      else if (blank) blank = null;
      else if (offer) offer = null;
      else if (drawing) {
        drawing = null;
        restyle();
      }
      // A question waiting for its other end is the shallowest thing here: nothing
      // has been drawn from it yet, so giving it up costs nothing.
      else if (asking) asking = null;
      // A path is mid-gesture like a half-drawn relation, and goes the same way:
      // whole, in one press. Keeping the steps taken would leave a route on screen
      // that nothing is still building, which is a picture nobody asked for.
      else if (tracing) traceStop();
      else if (find) find = '';
      // A narrowing is shallower than a gathered handful: it costs one click to ask
      // again, where the handful was built node by node.
      else if (singling) singling = false;
      else if (held.length) held = [];
      else if (chosenLink) chosenLink = null;
      // The case comes back before the node is let go, which is the same ladder run
      // one rung deeper: showing the rest again is a smaller step than giving up what
      // you were reading, and it leaves the panel open on the node you kept.
      else if (onlyThis) letGoOnly();
      else if (selected) selected = null;
      hovered = null;
      tip = null;
      return;
    }
    if (typing) return;
    if (event.ctrlKey || event.metaKey) {
      // The same three chords ProofComposer binds, so one undo is learned once. Never
      // over an armed gesture: a relation, a route or a walk waiting for its other end
      // owns the press, exactly as the switch on the node already gives it up.
      const chord = event.key.toLowerCase();
      if (drawing || tracing || asking) return;
      if (chord === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (chord === 'y') {
        event.preventDefault();
        redo();
      }
      // Everything else with a modifier belongs to the browser: Ctrl+0 and Ctrl+- are
      // its zoom, and the bare keys below are the canvas's own.
      return;
    }
    const arrow = ARROWS[event.key];
    if (arrow && nudge(arrow[0], arrow[1], event.shiftKey)) {
      // Only once a node actually moved: with nothing selected the arrows still
      // scroll the page, which is what they should do.
      event.preventDefault();
    } else if (event.key === '0') fitView();
    // Beside the key that fits the case, because they are the same kind of act: how
    // much of it you are looking at. Silent with nothing selected rather than arming
    // a reach that nothing on screen is reading.
    else if (event.key === '1' || event.key === '2' || event.key === '3') {
      setFocusHops(Number(event.key));
    } else if (event.key === '+' || event.key === '=') zoomBy(1.2);
    else if (event.key === '-') zoomBy(1 / 1.2);
  }

  // Structure changed: rebuild. Selection or hover changed: restyle only. Both
  // read state, so both are untracked — a rebuild triggered by a hover was the
  // bug that teleported the view back to its starting position on every mouseover.
  // Where this drawing came to rest, kept for the next read of the same question.
  // The parked column is deliberately left out: it is placed against the cluster's
  // edge rather than against the case, so remembering a spot beside a cluster that
  // has since grown would strand it — and a node that leaves the park has no reason
  // to be nailed to where it sat while nothing linked to it.
  $effect(() => {
    for (const seat of placed) {
      if (!seat.parked) settled.set(seat.id, { x: seat.x, y: seat.y });
    }
  });

  $effect(() => {
    void placed;
    void edges;
    void bends;
    void width;
    void height;
    untrack(rebuild);
  });

  $effect(() => {
    void selected;
    void hovered;
    // Typing a name narrows the picture, which is a restyle and never a rebuild:
    // nothing moves while a search runs, or the shape being read would come apart
    // under the letters being typed.
    void find;
    // An edge under the pointer or under the panel lights like a node does.
    void chosenLink;
    void hoveredLink;
    // How far the focus reaches, and whether it removes the rest rather than dimming
    // it. Both change what is drawn and neither moves anything, which is the whole
    // reason the locked focus never has to touch the layout.
    void focusHops;
    void onlyThis;
    // A step taken lights one more edge and offers a different set of next ones,
    // and an answered question lights every route that tied for shortest.
    void tracing;
    void path;
    void routes;
    // The handle hides while a menu is up, so it is not left hanging over one.
    void offer;
    // Which nodes are marked or in hand is a restyle, not a rebuild: both change what
    // is drawn on a node without moving anything.
    void pinnedIds;
    void held;
    // And so is the switch on the node under the eye. A fold itself is a rebuild, since
    // nodes leave the drawing; what the switch *offers* is drawn on one node.
    void switchFor;
    // Narrowing to the statements on one account dims the rest, like a search does,
    // and moves nothing for the same reason.
    void singling;
    untrack(restyle);
  });

  $effect(() => {
    const observer = new MutationObserver(() => {
      readColours();
      untrack(restyle);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => observer.disconnect();
  });

  /** A saved graph is a question plus presentation state. Its arrangement belongs
   * to the view, so reopening it restores the reading without rewriting case pins. */
  function openPeriodInTimeline() {
    uiState.timelineRange = {
      from: analysisSearch.period.from,
      to: analysisSearch.period.to,
    };
    uiState.tool = 'timeline';
  }

  function openPeriodOnMap() {
    uiState.mapTimelineRange = {
      from: analysisSearch.period.from,
      to: analysisSearch.period.to,
      categories: analysisSearch.period.categories ?? [],
    };
    uiState.tool = 'satellite';
  }

  function clearPeriod() {
    fromBoard = null;
    setAnalysisPeriod(caseState.current?.id, emptyAnalysisPeriod());
  }

  function captureAnalysisView(mode) {
    const graph = JSON.parse(snapshotNow());
    graph.camera = group
      ? { x: group.x(), y: group.y(), zoom: group.scaleX() }
      : null;
    return {
      version: 1,
      query: {
        filter: normalizeFilter(searchFilter),
        terms: searchTerms,
        label: searchSaid,
      },
      graph,
      timeline: analysisPeriodSpec(analysisSearch.period),
      ...(mode === 'snapshot' ? { capture_ids: nodes.map((node) => node.id) } : {}),
    };
  }

  let appliedViewId = null;

  async function applyGraphView(view) {
    if (!view || view.surface !== 'graph') return;
    restoring = true;
    // Finish a case-wide drag before replacing the drawing-side map with the view's
    // own arrangement. The two stores never borrow coordinates from each other.
    await flushPins();
    if (catalogViews.activeView?.id !== view.id) {
      restoring = false;
      return;
    }
    appliedViewId = view.id;
    const saved = view.spec?.graph ?? {};
    try {
      replaceViewArrangement(saved.arrangement ?? [], view.id);
      root = view.mode === 'live' && typeof saved.root === 'string' ? saved.root : null;
      selected = null;
      openId = null;
      snapshotOpen = null;
      lens = typeof saved.lens === 'string' ? saved.lens : lens;
      order = typeof saved.order === 'string' ? saved.order : order;
      hops = [1, 2, 3].includes(saved.hops) ? saved.hops : 1;
      pickFolder = typeof saved.folder === 'string' ? saved.folder : '';
      hiddenFamilies = Array.isArray(saved.families) ? saved.families : [];
      kept = Array.isArray(saved.kept) ? saved.kept : [];
      expanded = Array.isArray(saved.expanded) ? saved.expanded : [];
      omitted = Array.isArray(saved.omitted) ? saved.omitted : [];
      collapsed = Array.isArray(saved.collapsed) ? saved.collapsed : [];
      putAway = saved.putAway && typeof saved.putAway === 'object' ? saved.putAway : {};
      anchored = null;
      rereads += 1;
      await tick();
      if (saved.camera && group) {
        const scale = clampZoom(Number(saved.camera.zoom) || 1);
        group.position({ x: Number(saved.camera.x) || 0, y: Number(saved.camera.y) || 0 });
        group.scale({ x: scale, y: scale });
        zoom = scale;
        cameraRevision += 1;
        restyle();
      }
    } finally {
      restoring = false;
    }
  }

  async function openAnalysisView(view) {
    if (view.surface !== 'graph') {
      // The only other surface in this family is the Board: same question, rows.
      uiState.tool = 'board';
      return;
    }
    await applyGraphView(view);
  }

  async function leaveAnalysisReading() {
    appliedViewId = null;
    releaseViewArrangement();
    searchFilter = normalizeFilter(analysisSearch.filter);
    root = null;
    selected = null;
    openId = null;
    snapshotOpen = null;
    resetDrawing();
    rereads += 1;
  }

  // A view can be opened from the other surface while this component is hidden.
  $effect(() => {
    const view = catalogViews.activeView;
    if (!view || view.surface !== 'graph') {
      appliedViewId = null;
      if (arrangementOwner) {
        untrack(() => {
          releaseViewArrangement();
          rereads += 1;
        });
      }
      return;
    }
    if (view.id === appliedViewId) return;
    untrack(() => void applyGraphView(view));
  });

  let observedLiveView = null;
  let observedLiveState = '';
  $effect(() => {
    const view = catalogViews.activeView;
    void arrangementRevision;
    void arrangementSaveRevision;
    void cameraRevision;
    void zoom;
    if (!view || view.mode !== 'live' || view.surface !== 'graph') {
      observedLiveView = null;
      observedLiveState = '';
      return;
    }
    if (restoring) return;
    const current = {
      filter: normalizeFilter(searchFilter),
      period: normalizeAnalysisPeriod(analysisSearch.period),
      graph: captureAnalysisView('live').graph,
    };
    const saved = {
      filter: normalizeFilter(view.spec?.query?.filter),
      period: normalizeAnalysisPeriod(view.spec?.timeline),
      graph: view.spec?.graph ?? {},
    };
    const currentState = JSON.stringify(current);
    if (observedLiveView !== view.id) {
      observedLiveView = view.id;
      observedLiveState = currentState;
    } else if (currentState !== observedLiveState) {
      observedLiveState = currentState;
      catalogViews.changeVersion += 1;
    }
    catalogViews.modified = currentState !== JSON.stringify(saved);
  });

  $effect(() => () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    // A drag inside the debounce window would otherwise be lost to the tab closing.
    flushPins();
    stage?.destroy();
    stage = null;
    layer = null;
    group = null;
  });
</script>

<svelte:window
  onkeydown={onKey}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
/>

<div class="graph-tool" bind:this={toolElement}>
  <div class="toolbar">
    {#if root}
      <button class="btn btn-ghost btn-sm" onclick={wholeCase}>
        <Icon name="chevronLeft" size={15} /> Whole case
      </button>
      <label class="control">
        Hops
        <select class="select pick" bind:value={hops}>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </label>
    {:else if payload?.truncated}
      <!-- Only on a case too large to draw whole, because that is the only time it
           does anything: it picks which nodes survive the cut. On a case that fits,
           the control changed nothing on screen and read as a sort order. -->
      <!-- Named for what it decides rather than for what it does to the survivors:
           *Keep* read as a verb the analyst was pressing, and the drawing has a list
           of nodes kept by name that this control has nothing to do with. -->
      <label class="control" title="Which nodes this view keeps, now that the case is too large to draw whole">
        Ranking
        <select class="select pick" bind:value={order}>
          {#each orders as entry (entry.value)}
            <option value={entry.value} title={entry.hint}>{entry.label}</option>
          {/each}
        </select>
      </label>
    {/if}

    <label class="control">
      Lens
      <select class="select pick" bind:value={lens} title={lensHint}>
        {#each lenses as entry (entry.id)}
          <option value={entry.id} title={entry.hint}>{entry.label}</option>
        {/each}
      </select>
    </label>

    <!-- Off, a card shows what the entity is rather than what it looks like — and
         asks for no pictures at all, which is the other half of what this is for. -->
    <label class="control check" title="Show the pictures the case holds, or the entity glyphs">
      <input type="checkbox" bind:checked={showPreviews} onchange={forgetCards} />
      Preview
    </label>

    <div class="find">
      <Icon name="search" size={13} />
      <input
        class="input"
        type="search"
        placeholder="Find a node"
        aria-label="Find a node"
        bind:value={find}
        oninput={() => (listing = true)}
        onpointerdown={() => (listing = true)}
        onfocus={() => (listing = true)}
        onkeydown={(event) => {
          if (event.key !== 'Enter') return;
          if (matches.length) jumpTo(matches[0].id);
          else if (elsewhere.length) bringIn(elsewhere[0]);
        }}
      />
      {#if listing && (matches.length || elsewhere.length)}
        <ul class="found">
          {#each matches as row (row.id)}
            <li>
              <!-- A folded match says so rather than being left out: the drawing has
                   it, put away, and picking it gives its fold back. Reported missing
                   instead, it would be fetched from the case a second time. -->
              <button
                onclick={() => jumpTo(row.id)}
                title={folds.hidden.has(row.id) ? 'Folded away. Picking it unfolds it.' : null}
              >
                <Icon name={entityIcon(row)} size={13} />
                <span>{shortLabel(row.label, 30)}</span>
                <em>{folds.hidden.has(row.id) ? 'folded' : row.degree}</em>
              </button>
            </li>
          {/each}
          <!-- What the case holds under this name and the drawing does not. Told
               apart rather than mixed in, because clicking one costs a read and
               changes the picture, where clicking a drawn one only moves the eye. -->
          {#each elsewhere as row (row.id)}
            {@const filed = lensHides.includes(row.type)}
            <li>
              <button
                class="afar"
                onclick={() => bringIn(row)}
                title={filed
                  ? 'This reading does not draw it. My work does.'
                  : 'Not drawn. Bring it in with what touches it.'}
              >
                <Icon name={entityIcon(row)} size={13} />
                <span>{shortLabel(row.label, 30)}</span>
                <em>{filed ? 'in My work' : 'bring in'}</em>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <AnalysisViews
      surface="graph"
      capture={captureAnalysisView}
      onopen={openAnalysisView}
      onleave={leaveAnalysisReading}
    />

    <span class="spacer"></span>

    {#if payload}
      <!-- What is **drawn**, which the folds change and the case does not hear about.
           Counting what the case sent would leave the number arguing with the picture
           the moment anything was folded. -->
      <span class="count">
        {#if root}
          {nodes.length} around this{#if payload.truncated}<em>, partial</em>{/if}
        {:else}
          {nodes.length} of {payload.total}
          {#if payload.truncated}
            <em title="Narrow with a lens, or open one node">
              , most connected
            </em>
          {/if}
        {/if}
      </span>
      {#if !root && payload.isolated > 0}
        <!-- Counted across the case like the total beside it, never over what was
             drawn: a node with no edge is the first thing a cut discards, so on the
             cases where this number matters it would always have read zero. -->
        <span
          class="count isolated"
          title="Nothing in this lens connects to them, counted across the case"
        >
          {payload.isolated} unconnected
        </span>
      {/if}
      <!-- The independence number, and it reads off the collapsed edges rather than
           being computed: three citations are not three sources when one account
           published all three. Counted over the drawing, like the match count, because
           those are the edges that were resolved. It concludes nothing — a source's
           independence is a measurement, and what it means here is the analyst's.

           Pressable, because a number that names a set the analyst cannot reach sends
           them opening statements one at a time to find out which ones it meant. -->
      {#if !root && payload.single_account > 0}
        <button
          class="count resting"
          class:on={singling}
          aria-pressed={singling}
          onclick={showResting}
          title={singling
            ? 'Click again to bring the rest of the case back.'
            : 'These cite several sources, but one account published every one of them. Click to light just those statements.'}
        >
          {payload.single_account} on one account
        </button>
      {/if}
      <!-- What a drawing this size costs, said where the counts are. Nothing is
           refused: the picture is the analyst's, and this is the price of the next
           change rather than a wall in front of it. -->
      {#if weight}
        <span
          class="count weight"
          class:full={weight === 'freezing'}
          title={weight === 'freezing'
            ? 'Every change now freezes the tab for a few seconds. Hide what the picture is not about.'
            : 'Placing this many nodes costs about a second on every change.'}
        >
          {weight === 'freezing' ? 'very heavy' : 'heavy'} drawing
        </span>
      {/if}
    {/if}

    <!-- What the typing lit, counted over the **drawing**. "No match drawn" is a
         different answer from "no such entity", and the list under the field is
         where the case's own answer to the same name lives. -->
    {#if find.trim()}
      <span class="count isolated" title="Counted over the drawing, not the case">
        {#if found.size}
          {found.size} match{found.size === 1 ? '' : 'es'}
        {:else}
          no match drawn
        {/if}
      </span>
    {/if}

    <!-- What the folds are holding, and the way to have it all back. A chip rather
         than a button in the row below, because it belongs with the counts: it says
         how much of the case is currently put away.

         Its own control rather than part of the reset, since giving the folds back
         costs no read and undoes nothing that was asked of the case. -->
    {#if foldedCount}
      <button
        class="count folded"
        onclick={unfoldAll}
        title="Give back everything the folds are holding"
      >
        {foldedCount} folded
      </button>
    {/if}

    <!-- The way back, one act at a time. Said in the toolbar as well as bound to the
         chord, because a canvas teaches no gesture: a shortcut nothing announces is a
         shortcut nobody uses. Absent rather than greyed while there is nothing to
         undo, like every other control here. -->
    {#if canUndo}
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={undo}
        title="Undo the last change to the drawing (Ctrl+Z)"
      >
        <Icon name="undo" size={14} stroke={1.7} />
        Undo
      </button>
    {/if}
    {#if canRedo}
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={redo}
        title="Do it again (Ctrl+Shift+Z)"
      >
        <Icon name="redo" size={14} stroke={1.7} />
        Redo
      </button>
    {/if}

    <!-- One way back for the whole picture, whichever of the four lists is in the
         way, and a different act from the undo beside it: this is back to the
         beginning in one press. The arrangement is deliberately not part of it:
         **Reset pins** undoes work done by hand, and this undoes a reading. -->
    {#if edited}
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={resetDrawing}
        title="Draw the case the way it opened"
      >
        Reset view
      </button>
    {/if}

    <!-- Armed, waiting for its other end. Said in the toolbar rather than only on
         the canvas: a mode with no words is a mode nobody can get out of. -->
    {#if drawing}
      <span class="count connecting">
        Connecting from {shortLabel(byId.get(drawing.from)?.label ?? '', 18)} — click the
        other end
        <button
          class="as-link"
          onclick={() => {
            drawing = null;
            restyle();
          }}
        >
          cancel
        </button>
      </span>
    {/if}

    <!-- Only while a handful is gathered, and it is how the handful is let go: a
         group that can be built with no visible way to unbuild it is a trap. -->
    {#if held.length}
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={() => (held = [])}
        title="Let go of the handful (Escape)"
      >
        {held.length} held
      </button>
      <!-- Growth and removal over a list, which is what a gathered handful is for
           besides moving: one question about five nodes is one read, where five clicks
           are five reads landing in five places. -->
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={expandGathered}
        title="Bring in what touches all of them, in one read"
      >
        Expand {held.length}
      </button>
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={() => takeOut(held)}
        title="Out of the drawing, not out of the case"
      >
        Hide {held.length}
      </button>
    {/if}

    <!-- Only once something has been moved, because that is the only time it does
         anything. The verb is in the label rather than the tooltip: a count on its
         own reads as a status, and this one is the way back out of an arrangement.
         Outside a named reading it counts the whole case, so that way back remains
         available when pinned nodes are filtered out. Inside one it counts that
         view's local arrangement. -->
    {#if pinCount > 0}
      <button
        class="btn btn-ghost btn-sm placed"
        onclick={resetLayout}
        title={ownsViewArrangement()
          ? 'Let the layout place this saved view again.'
          : 'Let the layout place these again. Each lens keeps its own arrangement.'}
      >
        <Icon name="pushpin" size={14} stroke={1.7} />
        Reset {pinCount} pin{pinCount === 1 ? '' : 's'}
      </button>
    {/if}

    <span class="zoom">
      <button class="icon-btn" onclick={() => zoomBy(1 / 1.2)} title="Zoom out (-)">
        <Icon name="minus" size={15} />
      </button>
      <span class="level" title="Scroll to zoom, drag to pan">{Math.round(zoom * 100)}%</span>
      <button class="icon-btn" onclick={() => zoomBy(1.2)} title="Zoom in (+)">
        <Icon name="plus" size={15} />
      </button>
      <button class="icon-btn apart" onclick={fitView} title="Fit everything on screen (0)">
        <Icon name="reset" size={14} />
      </button>
    </span>

    <!-- Last in the row, and always there: a big case is read by giving it the whole
         screen, and a control that moves as chips appear is a control you hunt for. -->
    <button
      class="btn btn-ghost btn-sm placed"
      aria-pressed={fullscreen}
      onclick={toggleFullscreen}
      title={fullscreen ? 'Back to the window (Esc)' : 'Draw the case on the whole screen'}
    >
      <Icon name={fullscreen ? 'minimize' : 'maximize'} size={14} stroke={1.7} />
      {fullscreen ? 'Exit full screen' : 'Full screen'}
    </button>
  </div>

  {#if !root}
    <FilterBar
      bind:filter={searchFilter}
      {summary}
      {facets}
      {facetState}
      families={searchFamilies}
      caseFolders={caseState.current?.folders ?? []}
      types={searchTypeOptions}
      familyName={familyTitle}
      typeName={entityLabel}
      familyHint={familyReads}
      disabled={snapshotReading}
      onfields={() => (fieldsWanted = true)}
    />
    {#if activePeriod}
      <AnalysisPeriodBar
        period={analysisSearch.period}
        ontimeline={openPeriodInTimeline}
        onmap={openPeriodOnMap}
        onclear={clearPeriod}
      />
    {/if}
  {/if}

  {#if fromBoard}
    <!-- What the drawing is narrowed to, and where it came from. A picture that
         silently answers somebody else's question is a picture that looks broken: the
         sentence the Board asked is written out, and one press gives the case back.
         In the flow rather than over the canvas, because it describes the whole
         drawing where the strips below describe one node in it. -->
    <div class="from-board">
      <Icon name="sliders" size={13} />
      <span>{fromBoard.label || 'A question from the Board'}</span>
      <button
        class="as-link"
        onclick={() => {
          fromBoard = null;
          searchFilter = emptyFilter();
        }}
      >Show the whole case</button>
    </div>
  {/if}

  <div class="canvas-row">
    <!-- Konva owns the pointer here; the wheel is intercepted so the page does not
         scroll while zooming, and the drag is handled above so that the empty
         space pans. Keyboard reaches the same actions through the toolbar buttons,
         which is what keeps the canvas from being the only way in. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="canvas"
      class:panning
      class:on-node={Boolean(hovered)}
      class:arrangeable={canArrange}
      bind:this={host}
      bind:clientWidth={width}
      bind:clientHeight={height}
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      ondragover={(event) => {
        if (!caseState.current) return;
        event.preventDefault();
        dropOver = true;
      }}
      ondragleave={(event) => {
        // Guarded on the container itself: the event fires for every child the
        // pointer crosses, and an unguarded handler flickers the overlay off.
        if (event.target === event.currentTarget) dropOver = false;
      }}
      ondrop={(event) => {
        event.preventDefault();
        dropOver = false;
        const at = stage?.getPointerPosition();
        importDropped(event.dataTransfer?.files, at ? toCanvas(at) : null);
      }}
    ></div>

    {#if tip}
      <!-- The full label, which a card truncates, and the preview at any zoom: the
           picture is often the fastest answer to "which one is this". -->
      <div class="tip" style="left:{tip.x}px; top:{tip.y}px">
        {#if showPreviews && tip.thumb && caseState.current}
          <img src={tip.thumb.startsWith('data:')
            ? tip.thumb
            : fileUrl(caseState.current.id, tip.thumb)} alt="" />
        {/if}
        <strong>{tip.label}</strong>
        <span>
          {madeHereLabel(tip) ?? entityKindLabel(tip, entityLabel(tip.type))}
          · {tip.degree} connection{tip.degree === 1 ? '' : 's'}
        </span>
        {#if tip.folder}<span class="in-folder">{tip.folder}</span>{/if}
        {#if switchFor && switchFor.id === hovered}
          <!-- What the pill on the node means, in words, the first time it is seen.
               A number in a circle is a number until something says what it counts. -->
          <span class="how">
            {#if switchFor.act === 'expand'}
              {switchFor.count} connection{switchFor.count === 1 ? '' : 's'} not drawn. Double-click
              to bring them in.
            {:else if switchFor.act === 'fold'}
              {switchFor.count} hang{switchFor.count === 1 ? 's' : ''} off this one alone.
              Double-click to fold them away.
            {:else}
              Holding {switchFor.count} folded. Double-click to give them back.
            {/if}
          </span>
        {/if}
        {#if canArrange}
          <!-- Where a node's gestures are learned. A canvas teaches nothing on its
               own, and none of this is guessable. -->
          <span class="how">Right-click for what you can do with it</span>
        {/if}
      </div>
    {/if}

    {#if loading}
      <p class="overlay">Reading the case…</p>
    {:else if failed}
      <p class="overlay">{failed}</p>
    {:else if payload && !nodes.length}
      <p class="overlay">Nothing here yet. The Board files the first entity.</p>
    {/if}

    <!-- The focus, and the only place it can be read or changed. Over the drawing
         rather than in the toolbar: everything here is about the one node in hand,
         and it appears and leaves with it, where a toolbar control would sit there
         greyed out most of the time. Never on the root of a neighbourhood, which is
         what `focused` already decides. -->
    {#if asking}
      <!-- Armed and waiting, worded like the connection gesture because it is the
           same shape of act: named first, then the click that follows means the one
           thing the naming said it would. -->
      <div class="focus walk">
        <span class="on">
          <Icon name="arrowRight" size={13} />
          Path from {shortLabel(byId.get(asking.from)?.label ?? '', 22)} — click the other
          end, or find it by name
        </span>
        <button class="icon-btn" onclick={() => (asking = null)} title="Give it up (Esc)">
          <Icon name="x" size={13} />
        </button>
      </div>
    {:else if tracing}
      <!-- The walk, read as the sentence it is building. It takes the focus strip's
           place rather than sitting beside it: while a path is being walked the hops
           and the hiding answer a question nobody is asking. -->
      <div class="focus walk">
        <span class="on">
          <Icon name="arrowRight" size={13} />
          {path.length === 1
            ? 'Click a lit node'
            : `${path.length - 1} hop${path.length === 2 ? '' : 's'}`}
        </span>
        <!-- Every tied route is lit on the drawing; the sentence takes one at a time,
             because a sentence cannot be read three times over. The count is the
             number that says "this is a hub". -->
        {#if routes.length > 1}
          <span class="reach ties">
            <button
              class="step"
              aria-label="The route before this one"
              onclick={() => readRoute((routeAt + routes.length - 1) % routes.length)}
              title="The route before this one"
            >
              ‹
            </button>
            <span class="of">{routeAt + 1} / {routes.length}</span>
            <button
              class="step"
              aria-label="The next equally short route"
              onclick={() => readRoute((routeAt + 1) % routes.length)}
              title="The next equally short route"
            >
              ›
            </button>
          </span>
        {/if}
        <p class="said-path">
          {#each sentence as step, index (step.id)}
            {#if index > 0}<span class="verb">{step.verb}</span>{/if}
            <button class="node" onclick={() => stepTo(step.id)} title="Go back to this step">
              {#if step.node}<Icon name={entityIcon(step.node)} size={12} />{/if}
              {shortLabel(step.label, 24)}
            </button>
          {/each}
        </p>
        <button class="icon-btn" onclick={traceStop} title="Give the walk up (Esc)">
          <Icon name="x" size={13} />
        </button>
      </div>
    {:else if focused && chosen}
      <div class="focus">
        <span class="on" title="What the picture is narrowed around">
          <Icon name={entityIcon(chosen)} size={13} />
          {shortLabel(chosen.label, 20)}
        </span>
        <span class="reach">
          {#each [1, 2, 3] as step (step)}
            <button
              class="step"
              class:set={focusHops === step}
              aria-pressed={focusHops === step}
              onclick={() => setFocusHops(step)}
              title="Reach {step} hop{step === 1 ? '' : 's'} from this node ({step})"
            >
              {step}
            </button>
          {/each}
        </span>
        <button
          class="step wide"
          class:set={onlyThis}
          aria-pressed={onlyThis}
          onclick={toggleOnly}
          title="Take the rest of the case off the screen and frame what is left"
        >
          Only this
        </button>
        <button
          class="step wide"
          onclick={() => askWayFrom(chosen.id)}
          title="Find how this reaches another entity: click the other end, or name it"
        >
          Path to…
        </button>
        <button class="icon-btn" onclick={() => (selected = null)} title="Let the focus go (Esc)">
          <Icon name="x" size={13} />
        </button>
      </div>
    {/if}

    {#if legend.length}
      <div class="legend">
        <!-- The legend is the control. A lens decides the reading and takes a whole
             role out of it; switching a family off is the budget decision, which on a
             case larger than the budget is the difference between spending it on media
             and spending it on the case. It sits here rather than in the toolbar
             because this is already where the eye goes to learn what a colour means. -->
        <div class="row families">
          {#each legend as row (row.family)}
            <button
              class="swatch-row"
              class:off={!row.on}
              aria-pressed={row.on}
              onclick={() => toggleFamily(row.family)}
              title={familyReads(row.family) || 'Draw this family, or leave it out'}
            >
              <i class="swatch" style="background: var(--graph-{row.family}, var(--text-3))"></i>
              {row.family}
              <em>{row.on ? row.count : 'off'}</em>
            </button>
          {/each}
        </div>
        {#if strokes.length}
          <div class="row strokes">
            {#each strokes as entry (entry.kind)}
              <span class="swatch-row">
                <svg width="26" height="9" aria-hidden="true">
                  <line
                    x1="0"
                    y1="4.5"
                    x2="18"
                    y2="4.5"
                    stroke="var(--text-3)"
                    stroke-width={entry.width}
                    stroke-dasharray={entry.dash.join(' ')}
                  />
                  <polygon points="18,1 25,4.5 18,8" fill="var(--text-3)" />
                </svg>
                {entry.label}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if chosen}
      {@const away = offScreen(chosen.id)}
      <aside class="panel">
        <header>
          <Icon name={entityIcon(chosen)} size={16} />
          <strong>{chosen.label}</strong>
          <button class="icon-btn" onclick={() => (selected = null)} title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>
        <p class="meta">
          {madeHereLabel(chosen) ?? entityKindLabel(chosen, entityLabel(chosen.type))}
          · {entityFamily(chosen.type)}
          {#if chosen.status === 'suggested'}<em class="proposed">proposed</em>{/if}
        </p>
        {#if chosen.matches?.[0]}
          <p class="meta match-reason">
            Matched {chosen.matches[0].label}: {shortLabel(chosen.matches[0].value, 72)}
          </p>
        {/if}
        {#if madeHereBy(chosen)}
          <!-- Where the file came from, said once. A frame and a photograph somebody
               handed over are the same node otherwise, and the difference decides
               whether it is evidence or something the case built. -->
          <p class="meta made-here">
            <Icon name="layers" size={13} stroke={1.7} />
            Made in {madeHereBy(chosen)} out of material the case already holds.
          </p>
        {/if}
        <div class="actions">
          {#if snapshotReading}
            <button
              class="btn btn-ghost"
              onclick={() => (snapshotOpen = catalogViews.activeView?.spec?.snapshot?.entities
                ?.find((entity) => entity.id === chosen.id) ?? null)}
            >Captured details</button>
          {:else}
            <button class="btn btn-ghost" onclick={() => (openId = chosen.id)}>Details</button>
          {/if}
          <!-- The same switch as the one on the node, in words and reachable from the
               keyboard: the canvas answers a pointer, and the pill it draws is a few
               pixels across at the zoom a case is read at. Absent when there is
               nothing to do, like the pill. -->
          {#if switchFor?.id === chosen.id}
            <button
              class="btn btn-ghost"
              onclick={() => toggleAround(chosen.id)}
              title={switchFor.act === 'expand'
                ? 'Bring in the connections this one has that the drawing does not'
                : switchFor.act === 'fold'
                  ? 'Put away what hangs off this one and nothing else'
                  : 'Put back what this one is holding'}
            >
              {switchFor.act === 'expand'
                ? `Expand (${switchFor.count})`
                : switchFor.act === 'fold'
                  ? `Collapse (${switchFor.count})`
                  : `Unfold (${switchFor.count})`}
            </button>
          {/if}
          <!-- "Around this" replaces the case with this node and its hops, where
               expanding adds its missing neighbours to the case already drawn. Both
               used to be called expanding, which made the panel and the menu look
               like two ways to the same place. -->
          <button
            class="btn btn-ghost"
            onclick={() => focusOn(chosen.id)}
            title="Draw this one and what reaches it, in place of the case"
          >
            Around this ({chosen.degree})
          </button>
          <!-- The way back to the table, which is the half the hand-over was missing:
               a row could reach its node and a node could not reach its row. -->
          {#if !snapshotReading}<button
            class="btn btn-ghost"
            onclick={() => {
              uiState.openBoardEntity = chosen.id;
              uiState.tool = 'board';
            }}
            title="Read this one in the Board, with its own row"
          >
            In the Board
          </button>{/if}
          <!-- Offered here as well as in the menu, because the menu is a right-click
               and the drawing has to be editable from the keyboard too. Not on a
               neighbourhood: that read is one node and its hops, and taking the root
               out of it would leave the view answering nothing.
               *Hide* rather than "Remove", which on the edge panel beside it means
               deleting the statement from the case. -->
          {#if !root}
            <button
              class="btn btn-ghost"
              onclick={() => takeOut([chosen.id])}
              title="Out of the drawing, not out of the case"
            >
              Hide
            </button>
          {/if}
        </div>
        {#if chosen.rests}
          <!-- What this statement rests on. The number the case could not state before:
               three citations are not three sources when one account published all
               three, and counting them by eye is what nobody does on the two hundredth
               claim. It says what it measured and concludes nothing. -->
          <p class="meta" class:resting={chosen.rests.one}>
            Rests on {chosen.rests.sources} source{chosen.rests.sources === 1 ? '' : 's'}
            {#if chosen.rests.accounts}
              · {chosen.rests.accounts} account{chosen.rests.accounts === 1 ? '' : 's'}
            {/if}
            {#if chosen.rests.one}<em>all one account</em>{/if}
          </p>
        {/if}
        {#if canArrange && pinnedIds.includes(chosen.id)}
          <!-- Where the mark on the node is explained, and the one place a single
               node can be handed back without dropping the whole arrangement. -->
          <p class="meta placed-here">
            <Icon name="pushpin" size={13} stroke={1.7} />
            You placed this one.
            <button class="as-link" onclick={() => unpinNode(chosen.id)}>Let it go</button>
          </p>
        {/if}
        <!-- Said, not offered: the act is the switch in the row above, and a second
             control for it here is what left the analyst deciding whether two labels
             meant two things. -->
        {#if chosen.rolled}
          <!-- What came out of this one and was used by nothing. Twelve frames saved
               off a video are twelve pictures of that video, so the video says it
               instead. The act is the switch in the row above. -->
          <p class="meta placed-here">
            <Icon name="layers" size={13} stroke={1.7} />
            {rolledReads(chosen.rolled)} made from it, used by nothing.
          </p>
        {/if}
        {#if collapsed.includes(chosen.id)}
          <p class="meta placed-here">
            <Icon name="layers" size={13} stroke={1.7} />
            Holding {folds.by.get(chosen.id) ?? 0} folded under it.
          </p>
        {:else if expanded.includes(chosen.id)}
          <p class="meta placed-here">
            <Icon name="plus" size={13} stroke={1.7} />
            You expanded this one.
          </p>
        {/if}
        <!-- Grouped by what the connection says, and counted: reading a node is
             reading what it mostly is, which a flat list of edges never states. The
             registry already carries the inverse wording, so an incoming edge heads
             its group as a sentence rather than as an arrow. -->
        {#each neighbourGroups as group (group.key)}
          {@const all = allOf.includes(group.key)}
          <p class="group">
            <span class="verb">{group.reading}</span>
            <em>{group.rows.length}</em>
          </p>
          <ul class="neighbours">
            {#each all ? group.rows : group.rows.slice(0, GROUP_ROWS) as row (row.link.id)}
              <li>
                <!-- Hovering a row lights its edge on the canvas, verb written on it:
                     the same answer as hovering the edge itself, since the row and
                     the line are the same connection. -->
                <button
                  class="link-row"
                  onclick={() =>
                asking
                  ? wayTo(row.entity.id)
                  : tracing
                    ? stepTo(row.entity.id)
                    : followTo(row.entity.id)}
                  onmouseenter={() => (hoveredLink = row.link.id)}
                  onmouseleave={() => (hoveredLink = null)}
                  onfocus={() => (hoveredLink = row.link.id)}
                  onblur={() => (hoveredLink = null)}
                >
                  <Icon name={entityIcon(row.entity)} size={13} />
                  <span>{shortLabel(row.entity.label, 28)}</span>
                </button>
              </li>
            {/each}
            {#if !all && group.rows.length > GROUP_ROWS}
              <li>
                <button class="link-row rest" onclick={() => (allOf = [...allOf, group.key])}>
                  Show all {group.rows.length}
                </button>
              </li>
            {/if}
          </ul>
        {/each}
        <!-- The hole this closes: the list above is drawn from the edges on screen,
             so a node with forty connections and three of them drawn read as a node
             with three. The count is the node's own, and the act that answers it is
             the switch in the row above. -->
        {#if away > 0}
          <!-- In a neighbourhood the way further out is Hops, not an expansion: that
               read takes no `expand`, so the switch is not offered there. The count is
               still true, so it is still said. -->
          <p class="meta more">
            {#if root}
              {away} more, further than {hops} hop{hops === 1 ? '' : 's'}
            {:else}
              {away} more not drawn
            {/if}
          </p>
        {:else if !neighbours.length}
          <p class="meta">Nothing connects to this in the chosen lens.</p>
        {/if}
      </aside>
    {:else if chosenEdge}
      <!-- An edge is a statement, and on a worked case it is more often the finding
           than either node it joins. It is read here, and ruled on here. -->
      <aside class="panel">
        <header>
          <Icon name="link" size={16} />
          <strong>{relationVerb(chosenEdge.type)}</strong>
          <button class="icon-btn" onclick={() => (chosenLink = null)} title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>
        <p class="meta">
          {byId.get(chosenEdge.from)?.label ?? chosenEdge.from}
          → {byId.get(chosenEdge.to)?.label ?? chosenEdge.to}
          {#if chosenEdge.provenance?.status === 'suggested'}<em class="proposed">proposed</em>{/if}
        </p>
        {#if chosenEdge.folded}
          <!-- What the edge stands for, said in the words the finding is in: three
               citations that are one source is the reading, not the count of rows. A
               proposal anywhere along the path makes the whole path proposed, which the
               dash above already says. -->
          <p class="meta">
            {standsFor(chosenEdge)}, drawn as one edge
          </p>
          {#if chosenEdge.folded.open?.length}
            <div class="actions">
              <button class="btn btn-ghost" onclick={() => unfold(chosenEdge)}>
                Show the {chosenEdge.folded.open.length === 1
                  ? 'source'
                  : `${chosenEdge.folded.open.length} sources`}
              </button>
            </div>
          {:else}
            <!-- Nothing to hand back: this reading does not draw that type at all, so
                 the panel says where it lives instead of offering an act it would
                 refuse. -->
            <p class="meta">My work draws {chosenEdge.folded.via.join(', ')}.</p>
          {/if}
        {:else}
          {#if chosenEdge.merged}
            <!-- The case's own row, and it also carries what said the same thing off
                 the same material. Named here rather than folded away with the
                 statement, because withdrawing this one has to stay possible. -->
            <p class="meta">
              Stands for {chosenEdge.merged.sources} more, all the same material.
            </p>
            <div class="actions">
              <button class="btn btn-ghost" onclick={() => unfold(chosenEdge)}>
                Show the {chosenEdge.merged.open.length}
              </button>
            </div>
          {/if}
          {#if chosenEdge.provenance?.by}
            <p class="meta">Filed by {chosenEdge.provenance.by}</p>
          {/if}
          <!-- How sure of this, and what kind of tie it is: the two values an edge
               carries besides its verb, offered where the edge is read rather than a
               panel away. Each is drawn because the **registry** declares it — a
               ratable verb, a verb that takes a qualifier — never because this edge
               happens to hold a value. Same rule as Details, and it is what keeps a
               free note off the rest of the vocabulary. -->
          {#if !snapshotReading && chosenEdge.provenance?.status !== 'suggested'}
            {@const rating = chosenEdge.confidence ?? null}
            {@const qualifier = relationQualifier(chosenEdge.type)}
            {@const gradable = isRatable(chosenEdge.type) && confidenceLevels().length}
            {#if gradable || qualifier}
              <div class="says">
                {#if gradable}
                  <select
                    class="select pick rate"
                    class:set={rating !== null}
                    class:out={rating === -1}
                    value={rating ?? ''}
                    title={rating === null
                      ? 'How sure of this'
                      : confidenceHint(rating) || confidenceLabel(rating)}
                    onchange={(event) => rateEdge(chosenEdge.id, event.currentTarget.value)}
                  >
                    <!-- clearing, not a fifth level: this is the absence of a rating -->
                    <option value="">Not assessed</option>
                    {#each confidenceLevels() as level (level.value)}
                      <option value={level.value}>{level.label}</option>
                    {/each}
                  </select>
                {/if}
                {#if qualifier}
                  <input
                    class="input pick nature"
                    class:set={Boolean(chosenEdge.nature)}
                    value={chosenEdge.nature ?? ''}
                    placeholder={qualifier}
                    title={qualifier}
                    maxlength="120"
                    onchange={(event) => qualifyEdge(chosenEdge, event.currentTarget.value)}
                  />
                {/if}
              </div>
            {/if}
          {/if}
          {#if !snapshotReading}<div class="actions">
            {#if chosenEdge.provenance?.status === 'suggested'}
              <button class="btn btn-ghost" onclick={() => ruleOn(chosenEdge.id, 'confirmed')}>
                Confirm
              </button>
            {/if}
            <button class="btn btn-ghost" onclick={() => dropLink(chosenEdge.id)}>Remove</button>
          </div>{/if}
        {/if}
        <ul class="neighbours">
          {#each [chosenEdge.from, chosenEdge.to] as end (end)}
            {@const entity = byId.get(end)}
            {#if entity}
              <li>
                <button class="link-row" onclick={() => ((chosenLink = null), (selected = end))}>
                  <span class="verb">{entityKindLabel(entity, entityLabel(entity.type))}</span>
                  <span>{shortLabel(entity.label, 28)}</span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
      </aside>
    {/if}

    {#if menu}
      <!-- Guarded rather than `byId.get(menu.id)`: `{@const}` re-runs the moment the
           menu closes, so an item that cleared it before acting read `menu.id` off
           null and threw — which is how every item in this menu did nothing. -->
      {@const at = menu && byId.get(menu.id)}
      {#if at}
        {@const away = offScreen(at.id)}
        {@const takes = root ? 0 : foldableCount(at.id, nodes, links, new Set(pinnedIds))}
        <!-- Where a node says what can be done with it, and the one place all three
             acts on the drawing are named at once: a canvas teaches no gesture on its
             own, and the switch on the node only ever offers one of them at a time. -->
        <div class="menu" style="left:{menu.x}px; top:{menu.y}px">
          <p class="meta">{shortLabel(at.label, 24)}</p>
          <ul>
            <li>
              <!-- The count is what is *missing*, not the degree: a node whose
                   neighbours are all drawn has nothing to bring in, and saying so beats
                   an act that appears to do nothing. -->
              <button
                onclick={() => chose(expandNode)}
                disabled={!away || Boolean(root)}
              >
                {#if away && root}
                  <!-- A neighbourhood is read one hop further, not expanded: that
                       read takes no `expand`, so this act is not this view's. -->
                  {away} more, further than {hops} hop{hops === 1 ? '' : 's'}
                {:else if away}
                  Expand {away} more connection{away === 1 ? '' : 's'}
                {:else}
                  All its connections are drawn
                {/if}
              </button>
            </li>
            <!-- The fold, and the way back out of it. Offered here in words as well as
                 on the node, because the pill states one act at a time and this is
                 where a node says everything it can do. -->
            {#if collapsed.includes(at.id)}
              <li>
                <button onclick={() => chose(unfoldNode)}>
                  Unfold {folds.by.get(at.id) ?? 0}
                </button>
              </li>
            {:else if takes}
              <li>
                <button
                  onclick={() => chose(foldNode)}
                  title="Put away what hangs off this one and nothing else"
                >
                  Collapse {takes}
                </button>
              </li>
            {/if}
            <li><button onclick={() => chose(startDrawing)}>Connect to…</button></li>
            <!-- Both ways to fill a path, in the one place a node's acts are named.
                 Asking is the common question, so it comes first; choosing the route
                 by hand is the rarer one and lives only here, which keeps the strip
                 over the drawing to a single line. -->
            <li><button onclick={() => chose(askWayFrom)}>Path to…</button></li>
            <li><button onclick={() => chose(traceFrom)}>Walk by hand</button></li>
            <li><button onclick={() => chose((id) => (openId = id))}>Details</button></li>
            {#if pinnedIds.includes(at.id)}
              <li><button onclick={() => chose(unpinNode)}>Let it go</button></li>
            {/if}
            <!-- The drawing is a set, and this is how a node leaves it. Never on a
                 neighbourhood, whose root is the question being asked. The wording
                 keeps well clear of the edge panel's *Remove*, which deletes a
                 statement from the case: nothing here touches what the case holds. -->
            {#if !root}
              <li>
                <button
                  onclick={() => chose((id) => takeOut([id]))}
                  title="Out of the drawing, not out of the case"
                >
                  Hide it
                </button>
              </li>
              <!-- The same acts over the gathered handful, offered where the handful is
                   under the pointer: growth and removal by the group are what make a
                   drawing you own workable at more than one node at a time. -->
              {#if held.length > 1 && held.includes(at.id)}
                <li>
                  <button onclick={() => ((menu = null), expandGathered())}>
                    Expand these {held.length}
                  </button>
                </li>
                <li>
                  <button onclick={() => takeOut(held)}>
                    Hide these {held.length}
                  </button>
                </li>
              {/if}
            {/if}
          </ul>
        </div>
      {/if}
    {/if}

    {#if blank}
      <!-- What can be done where nothing is. The empty space used to answer a
           right-click with nothing at all, which made the drawing a thing to read
           rather than a place to work. -->
      <div class="menu" style="left:{blank.x}px; top:{blank.y}px">
        <ul>
          {#if !snapshotReading}<li>
            <button
              onclick={() => {
                creating = { at: blank.at, caseId: caseState.current?.id };
                blank = null;
              }}
            >
              New entity here
            </button>
          </li>{/if}
          <li>
            <button onclick={() => ((blank = null), fitView())}>Fit everything on screen</button>
          </li>
        </ul>
        <p class="meta">Or drop a file anywhere on the drawing.</p>
      </div>
    {/if}

    {#if dropOver}
      <div class="drop-over">
        <div class="drop-box">
          <Icon name="upload" size={26} />
          <span>{importing ? 'Adding…' : 'Drop to file it here'}</span>
        </div>
      </div>
    {/if}

    {#if offer}
      <!-- Where a drawn relation is named. Only the readings the vocabulary accepts
           between these two are here, so nothing offered can be refused, and a
           reading the registry heads sits under its heading rather than among the
           statements. -->
      <div class="offer" style="left:{offer.x}px; top:{offer.y}px">
        <p class="meta">
          {shortLabel(byId.get(offer.from)?.label ?? '', 20)} →
          {shortLabel(byId.get(offer.to)?.label ?? '', 20)}
        </p>
        {#each offerGroups as set (set.group)}
          {#if set.group}<p class="heading">{set.group}</p>{/if}
          <ul>
            {#each set.options as option (option.type + option.direction)}
              <li>
                <button onclick={() => stateRelation(option)}>{option.label}</button>
              </li>
            {/each}
          </ul>
        {/each}
        <button class="as-link" onclick={() => (offer = null)}>Cancel</button>
      </div>
    {/if}

    {#if saving}
      <p class="said">{saving}</p>
    {/if}
  </div>
</div>

{#if creating && !snapshotReading}
  <!-- The one create dialog, shared with the Board: a claim is filed with the same
       words and the same duplicate warning wherever the analyst is standing. What is
       said here and not there is the lens — filing something this reading does not
       draw looks exactly like filing nothing. -->
  <EntityCreate
    hidden={lensHides}
    hiddenNote="This reading does not draw that type. My work does."
    ontwin={(entity) => {
      creating = null;
      bringIn(entity);
    }}
    oncreated={(entity) => {
      const { at, caseId } = creating;
      creating = null;
      drewIn(entity, at, caseId);
    }}
    onclose={() => (creating = null)}
  />
{/if}

<!-- Ctrl+V: a screenshot or a link, drawn where the eye already is -->
{#if pasted && !snapshotReading}
  <PasteDialog
    resolved={pasted}
    busy={pasteBusy}
    onconfirm={confirmPaste}
    onclose={() => (pasted = null)}
  />
{/if}

{#if openId && !snapshotReading}
  <Modal title="Details" onclose={() => (openId = null)} width="640px">
    <EntityDetails
      entityId={openId}
      bind:dirty
      onclose={() => (openId = null)}
      ondeleted={() => {
        openId = null;
        selected = null;
        loadedFor = null;
        load();
      }}
    />
  </Modal>
{/if}

{#if snapshotOpen && snapshotReading}
  <Modal title="Snapshot details" onclose={() => (snapshotOpen = null)} width="640px">
    <SnapshotDetails
      entity={snapshotOpen}
      entities={catalogViews.activeView?.spec?.snapshot?.entities ?? []}
      links={catalogViews.activeView?.spec?.snapshot?.links ?? []}
    />
  </Modal>
{/if}

<style>
  .graph-tool {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  /* The fullscreen backdrop is black by default, and the toolbar draws no background
     of its own, so the page's is stated here. */
  .graph-tool:fullscreen {
    width: 100vw;
    height: 100vh;
    background: var(--bg-0);
    color: var(--text-1);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .control {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  /* The controls sit in one row, so they read at one size: the search field
     inheriting a browser default beside two small selects was the mismatch. */
  .pick {
    width: auto;
    padding: 3px 6px;
    font-size: var(--fs-xs);
  }
  .spacer {
    flex: 1;
  }
  .find {
    position: relative;
    display: flex;
    align-items: center;
    color: var(--text-3);
  }
  /* The field's own magnifier, and only it: as a descendant rule this also took every
     icon in the result list and stacked them all inside the input. */
  .find > :global(svg) {
    position: absolute;
    left: 7px;
    pointer-events: none;
  }
  .find input {
    width: 170px;
    padding: 3px 8px 3px 24px;
    font-size: var(--fs-xs);
  }
  .find input::-webkit-search-cancel-button {
    display: none;
  }
  .found {
    position: absolute;
    z-index: 3;
    top: calc(100% + 4px);
    left: 0;
    width: 240px;
    list-style: none;
    margin: 0;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: var(--shadow-2);
  }
  .found button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .found button:hover {
    background: var(--bg-3);
  }
  .found span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .found em {
    font-style: normal;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  /* A row that is not on the canvas yet. Its own hue on the word alone: the row has
     to read as a different act without becoming a second kind of list. */
  .found .afar em {
    color: var(--accent);
  }
  .count {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .count em {
    font-style: normal;
    color: var(--warn);
  }
  .isolated {
    padding-left: 10px;
  }
  /* A measurement, so it is marked rather than coloured as a fault: whether three
     citations on one account is a problem is the analyst's to say. */
  .resting {
    padding-left: 10px;
    color: var(--text-2);
  }
  .resting em {
    padding-left: 4px;
    color: var(--accent);
  }
  /* A count that is also a question, and it keeps the register of the numbers beside
     it rather than taking the look of a button: pressing it narrows the drawing, it
     does not change the case. Nothing is reset here on purpose — the global rule
     already strips a button back, and `font: inherit` written again would take the
     size from the toolbar and print this one larger than the counts it sits among. */
  button.resting:hover {
    color: var(--text-1);
  }
  button.resting.on {
    color: var(--accent);
  }
  /* What the folds are holding. A count in the register of the numbers beside it,
     pressable like the independence one: a number naming a set the analyst cannot
     reach is a number they have to work around. */
  .folded {
    padding-left: 10px;
    color: var(--accent);
  }
  button.folded:hover {
    color: var(--text-1);
  }
  .weight {
    padding-left: 10px;
  }
  .weight.full {
    color: var(--warn);
  }
  .check {
    gap: 4px;
    cursor: pointer;
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .placed {
    color: var(--text-2);
  }
  .placed-here,
  .made-here {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  /* A second action in a line of prose, so it reads as part of the sentence rather
     than competing with Details and Expand above it. */
  .as-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: inherit;
    cursor: pointer;
  }
  .as-link:hover {
    text-decoration: underline;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-left: 8px;
  }
  /* Fitting the case back is a different act from stepping the zoom, so it sits
     apart from the pair rather than crowded against the plus. */
  .zoom .apart {
    margin-left: 9px;
  }
  /* `icon-btn` was never a class this app defines: these four buttons fell back to
     the bare button reset, which is why they had no room and no hover. */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    transition: background 0.12s var(--ease);
  }
  .icon-btn:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .level {
    min-width: 42px;
    text-align: center;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .canvas-row {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg-0);
  }
  .canvas {
    position: absolute;
    inset: 0;
    cursor: grab;
    touch-action: none;
  }
  /* On the whole case a node can be picked up, so the pointer says so; in a
     neighbourhood it can only be chosen. */
  .canvas.on-node {
    cursor: pointer;
  }
  .canvas.on-node.arrangeable {
    cursor: grab;
  }
  .canvas.panning {
    cursor: grabbing;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    color: var(--text-3);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    z-index: 2;
    transform: translate(-50%, calc(-100% - 8px));
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-width: 240px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: var(--shadow-1);
    font-size: var(--fs-xs);
    pointer-events: none;
  }
  .tip span {
    color: var(--text-3);
  }
  .tip img {
    width: 100%;
    max-height: 120px;
    object-fit: contain;
    margin-bottom: 3px;
    border-radius: var(--r-sm);
    background: var(--bg-0);
  }
  .how {
    color: var(--accent) !important;
  }
  .in-folder {
    font-variant: small-caps;
  }
  /* Top left, the one corner the panel and the legend both leave alone. */
  .drop-over {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg-1) 78%, transparent);
    pointer-events: none;
  }
  .drop-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 28px;
    border: 1px dashed var(--accent);
    border-radius: var(--r);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  /* Under the toolbar rather than over the drawing's own strips: it says what the
     whole picture is, where the focus strip says what one node is. */
  .from-board {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--accent-soft);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .from-board span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-1);
  }
  .focus {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 300px);
    padding: 5px 6px 5px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .focus .on {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    white-space: nowrap;
    color: var(--text-1);
  }
  .focus .reach {
    display: flex;
    gap: 2px;
  }
  .step {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .step:hover {
    color: var(--text-1);
  }
  /* The set reach and the hiding read the same, because they are one answer: this
     is how much of the case is currently being looked at. */
  .step.set {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg-1);
  }
  .step.wide {
    white-space: nowrap;
  }
  /* The walk gets the width the sentence needs, and wraps rather than truncating:
     the sentence is the deliverable, and a truncated one states nothing. */
  .walk {
    max-width: calc(100% - 300px);
    align-items: flex-start;
  }
  .walk .on {
    padding-top: 3px;
    color: var(--text-3);
    white-space: nowrap;
  }
  .said-path {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 5px;
    margin: 0;
  }
  .said-path .node {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-1);
    font-size: inherit;
    cursor: pointer;
  }
  .said-path .node:hover {
    border-color: var(--accent);
  }
  /* One arrow, always forwards: an edge walked against its own direction is said in
     the registry's inverse wording instead, so the sentence never has to be read
     backwards. */
  .said-path .verb::after {
    content: ' →';
  }
  .said-path .verb {
    color: var(--accent);
    white-space: nowrap;
  }
  .ties {
    align-items: center;
    white-space: nowrap;
  }
  .ties .of {
    padding: 0 2px;
    color: var(--text-3);
  }
  .legend {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-width: calc(100% - 24px);
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .legend .row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  /* The stroke key explains, it does not act, so it lets clicks through to the
     canvas underneath the way the whole legend used to. */
  .strokes {
    padding-top: 5px;
    border-top: 1px solid var(--border);
    pointer-events: none;
  }
  .swatch-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .families button {
    padding: 1px 4px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
  }
  .families button:hover {
    background: var(--bg-3);
  }
  /* A family left out reads as left out: the row dims and its own colour goes with
     it, so the drawing and the legend cannot disagree about what is on screen. */
  .families .off {
    opacity: 0.45;
  }
  .families .off .swatch {
    background: var(--text-3) !important;
  }
  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .legend em {
    font-style: normal;
    color: var(--text-2);
  }
  .panel {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 264px;
    max-height: calc(100% - 24px);
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
  }
  .panel header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .panel header strong {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    margin: 0 0 8px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .proposed {
    margin-left: 6px;
    font-style: normal;
    color: var(--warn);
  }
  /* The two judgements an edge carries, on their own line above the acts: they are
     what the analyst *says* about the edge, where the buttons below are what happens
     to it. Wrapping, because a 264px panel does not hold a rating and a word side by
     side in every language. */
  .says {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .rate {
    color: var(--text-3);
  }
  .rate.set {
    color: var(--text-1);
  }
  /* Ruled out is the one rating the drawing marks, so the control marks it too: the
     line and the panel have to agree about which statements are dead. */
  .rate.out {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
    background-color: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  /* Sized to a word, because a word is what it holds: wide enough for "business
     partner", narrow enough that nobody mistakes it for a notes box. */
  .nature {
    width: 11ch;
    min-width: 0;
    color: var(--text-3);
  }
  .nature.set {
    color: var(--text-1);
  }
  /* Wrapping, because the row grew a fourth act and a fixed-width panel then squeezed
     the last one until *Collapse (35)* read as *Collapse*. A button clipped to its
     first word names a different act than the one it performs. */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .neighbours {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .neighbours li {
    border-bottom: 1px solid var(--border);
  }
  .link-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 2px;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .link-row:hover {
    background: var(--bg-3);
  }
  .link-row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The rest of a group is asked for from inside the group, in the accent every
     other "there is more" in this tool uses. */
  .rest {
    color: var(--accent);
    font-size: var(--fs-xs);
  }
  /* The heading a group of connections reads under: what they say, then how many. */
  .group {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin: 10px 0 0;
  }
  .group em {
    font-style: normal;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .verb {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  /* Said under the list it corrects, so the count and the list are read together. */
  .more {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 10px;
  }
  .connecting {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
  }
  /* Both float over the canvas and read the same way: a title, then what can be
     chosen. The menu opens from the pointer, the offer from the node it landed on. */
  .menu,
  .offer {
    position: absolute;
    z-index: 5;
    transform: translate(-50%, 8px);
    min-width: 180px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: var(--shadow-2);
  }
  .menu {
    min-width: 170px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: var(--shadow-2);
  }
  .menu ul,
  .offer ul {
    list-style: none;
    margin: 0 0 4px;
    padding: 0;
  }
  .menu .meta {
    margin: 2px 6px 5px;
  }
  /* The registry's heading over the readings it heads, so a pointer is not read as
     a statement. Set apart from the list above it rather than boxed. */
  .offer .heading {
    margin: 7px 6px 3px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .menu button,
  .offer button {
    display: block;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .menu li button:hover:not(:disabled),
  .offer li button:hover {
    background: var(--bg-3);
  }
  .menu li button:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .said {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    margin: 0;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
</style>
