<script>
  /**
   * The infographic builder, beside the note while the page is drawn in it: the title band,
   * the panels in reading order (drag to reorder, half or wide, add one, take one out), the
   * look, one legend for a colour column the charts share, its colours, Export as a picture
   * and To Post.
   *
   * Every press writes the block's own text through the editor as one change, so one Undo
   * (`lib/notes/editor/infographicText.js` says what each writes). The builder holds nothing
   * of its own: it reads the infographic again from the note each time, the `k`-th of the
   * note, so typing above it keeps it found.
   *
   * "Add a panel" shows each table of the note drawn as every kind it fits by the chart's own
   * kind picker (`POST /notes/figure/kinds`), from its real rows, and the note's maps; the
   * analyst picks one by its picture and it is written as a chart under its table would be
   * (`editor/infographicPanels.js`). Every kind from scratch follows, the picker's own cards:
   * the one picked is written with its columns and no row, and its form opens in its card
   * (`editor/chartForm.js`). Nothing is made of numbers the note does not hold.
   *
   * Pressing a chart's row opens its card under it: its Data line (Page data or Own rows, one
   * press apart, where the rows live and the press that edits them there), then Settings, the
   * chart's own card (`editor/chartCard.js`: title, what it counts, by what, coloured by what),
   * or The numbers, its rows in the grid a chart's numbers are (`editor/panelRows.js`), with
   * *As a form* where the kind's form fits; each choice writes that panel's lines inside the
   * infographic, one Undo each. The look is
   * the page's, set once below. A map's row opens the map's own card (`editor/infographicMap.js`):
   * the map drawn, to frame and draw on, and its five tabs, each choice one Undo inside the page,
   * Size left to the row's Half or Wide. A press on a panel of the page in the note opens the
   * builder with that panel's card open.
   *
   * On top, the **Data** bar, said as a chart's Data line is (`editor/dataLine.js`): what the
   * page's charts are drawn from (`data:`, a sheet of the case or a table of a note), the press
   * that edits it there, its rows and how many panels read it (`editor/infographicData.js`),
   * and *Change…* (the source picker, `components/DataPicker.svelte`), one change and one Undo.
   * The panels that read it follow it by themselves (`editor/follow.js`). With data, Add a
   * panel offers the data's rows first. A chart made from scratch, or whose rows its form
   * wrote, says `rows: own` and never takes it.
   *
   * **Start from a template…** lays the page out as a figure template of Settings › Templates ›
   * Figures, or a ready one (`components/FigureTemplatePicker.svelte`): its panels read the
   * page's data by its columns' names, a column the data does not name asked, and without
   * data, or for a column filled by hand, a panel opens its own form. One change, one Undo; the
   * band the page already says is kept.
   *
   * In the extension's panel it slides over the note (`components/NotePanel.svelte`): `back`
   * puts *Back to the note* first in its bar in place of Close, and `preview` draws the page at
   * its top, since the note it is drawn in is out of sight, each panel pressable to open its
   * card; beside the builder once the panel is wide. Without the app's `tools` around it, the
   * data's sheet is only named and To Post, which opens Post, is not offered.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { toast, uiState } from '../../lib/state.svelte.js';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import { noteToPost } from '../../lib/notes/toPost.js';
  import { drawingOf } from '../../lib/notes/editor/infographicBlock.js';
  import {
    EACH_PANEL, HALF, LOOKS, WIDE, WORDS_PANEL, addPanel, infographicsIn, movePanel, panelText, readInfographic,
    removePanel, withLegend, withPanelText, withSetting, withWidth,
  } from '../../lib/notes/editor/infographicText.js';
  import { chartPanel, noteMaps, noteTables } from '../../lib/notes/editor/infographicPanels.js';
  import { mapPanel } from '../../lib/notes/editor/infographicMap.js';
  import { chartKinds, drawChart } from '../../lib/notes/editor/chartFigure.js';
  import { chartForm, chartSettings, rowsSaid, scratchGallery, starterBlock } from '../../lib/notes/editor/chartCard.js';
  import { OWN_ROWS, compareRows, readChart, setting, withSettings, withTable } from '../../lib/notes/editor/chartText.js';
  import { ELSEWHERE, LOCAL, OWN, anchorName, dataWords, sourceOf } from '../../lib/notes/editor/dataLine.js';
  import { readForm } from '../../lib/notes/editor/chartFormText.js';
  import Icon from '../../components/Icon.svelte';
  import BackButton from '../../components/BackButton.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import DataPicker from '../../components/DataPicker.svelte';
  import FigureTemplatePicker from '../../components/FigureTemplatePicker.svelte';
  import { pageFromTemplate } from '../../lib/notes/figureTemplates.js';
  import { openEntity } from '../../lib/navigate.js';
  import { dataPanel, dataSaid, dataState, pageWords, readData } from '../../lib/notes/editor/infographicData.js';
  import { dataOf, withDataSource } from '../../lib/notes/editor/infographicText.js';
  import { chartSeed, infographicSeed } from '../../lib/notes/dataSeed.js';

  let {
    caseId,
    noteId = null,
    /** The note as it is now (its doc's text): the builder reads its infographic from it. */
    text = '',
    /** The note editor's handle: `text()` and `replace(from, to, insert, expected)`. */
    editor,
    /** Where the infographic asked for stands in the note (an offset in it), and the panel pressed. */
    from = 0,
    panel = null,
    onclose,
    /** Where the way out goes, said on a Back button first in the bar in place of Close: `Back to the note`. */
    back = '',
    /** Whether the page is drawn at the top, its panels pressable: where the note is out of sight. */
    preview = false,
    /** Whether the app's tools are around it: the data's sheet opens in Sheet, To Post opens Post. */
    tools = true,
    /** More of the bar, before Close: the panel's Undo and save state. */
    bar = undefined,
  } = $props();

  /** The looks, said as the export dialog says them. */
  const LOOK_WORDS = { report: 'Report', book: 'Book', dark: 'Dark' };
  const LOOK_HINTS = { report: 'Light paper, the reference', book: 'Beige paper, red and black, a printed book', dark: 'Dark, like the map plates' };
  /** The pictures Export makes: the destination the route draws, its name, its line. */
  const SIZES = [
    { size: 'x', label: 'X, 16:9', hint: 'A post on X, panels set side by side' },
    { size: 'portrait', label: '4:5', hint: 'Taller, for a feed' },
    { size: 'square', label: '1:1', hint: 'Square' },
    { size: 'page', label: 'PDF page', hint: 'The page as the PDF prints it' },
    { size: 'svg', label: 'SVG', hint: 'For a designer: shapes and words kept' },
  ];
  const KIND_WORDS = { chart: 'Chart', map: 'Map', words: 'Words' };
  const PANEL_ICONS = { chart: 'chart', map: 'mapArea', words: 'text' };

  // the k-th infographic of the note, k found once from where it was asked
  const k = (() => {
    const found = infographicsIn(text);
    const inside = found.findIndex((one) => from >= one.from && from <= one.to);
    if (inside >= 0) return inside;
    const after = found.findIndex((one) => one.from >= from);
    return after >= 0 ? after : Math.max(0, found.length - 1);
  })();
  const block = $derived(infographicsIn(text)[k] ?? null);
  const read = $derived(block ? readInfographic(block.source) : null);
  const noteKey = $derived(noteId && noteId !== 'case' ? noteId : '');

  let drawing = $state(null);
  $effect(() => {
    const source = block?.source;
    if (!source || !caseId) { drawing = null; return; }
    let live = true;
    drawingOf(caseId, noteKey, source).then((drawn) => { if (live) drawing = drawn?.error ? null : drawn; });
    return () => { live = false; };
  });

  /** Write the infographic again through the editor, as one change: one Undo. */
  function edit(transform) {
    const now = editor?.text?.() ?? '';
    const one = infographicsIn(now)[k];
    if (!one) return false;
    const next = transform(one.source);
    if (next === one.source) return false;
    return Boolean(editor.replace(one.from, one.to, next, one.source));
  }

  // -- the data ------------------------------------------------------------------------
  /** What `data:` names, read now, and what the panels make of it (`dataState`). */
  let data = $state({ data: null, panels: { inheriting: [], own: [], differs: [] } });
  let dataAsked = 0;
  let dataPick = $state(null);
  async function readDataNow({ fresh = false } = {}) {
    const now = editor?.text?.() ?? text;
    const one = infographicsIn(now)[k];
    if (!one || !caseId) return;
    const run = ++dataAsked;
    const answer = await dataState({ caseId, noteId: noteKey, noteText: now, source: one.source, fresh })
      .catch((error) => ({ data: { error: error?.message ?? String(error) }, panels: { inheriting: [], own: [], differs: [] } }));
    if (run !== dataAsked) return;
    data = answer;
    // the panels that read the data follow it by themselves, one step Undo takes back
    if (answer.data?.found && answer.panels.differs.length) editor?.follow?.(dataOf(one.source), answer.data.text);
  }
  // said again soon after the note changes, and when the window comes back (a sheet edited meanwhile)
  $effect(() => {
    void text;
    const timer = setTimeout(() => untrack(() => readDataNow()), 250);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    const back = () => readDataNow({ fresh: true });
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  });
  // the Notebook stays mounted while another tool is shown: shown again, the data is read afresh
  $effect(() => {
    if (uiState.tool === 'notebook') untrack(() => readDataNow({ fresh: true }));
  });
  const dataOrigin = $derived(block ? dataOf(block.source) : '');
  /** The Data bar's words, a chart's own: where the page's rows live and the press that edits them there. */
  const dataWordsNow = $derived(pageWords(dataOrigin, data.data, {
    noteId: noteKey,
    held: Boolean(data.data?.found && data.panels.differs.length && editor?.heldBack?.(dataOrigin, data.data.text)),
  }));
  const dataName = $derived(dataWordsNow.name);
  const dataLine = $derived(dataSaid(data.data, data.panels));
  /** Change…: the page's data set to the source picked, the panels that fit it taking it, as one change. */
  function chooseData({ origin, data: picked }) {
    dataPick = null;
    if (!origin || !picked?.text) return;
    closeCard();
    let made = null;
    if (edit((source) => { made = withDataSource(source, origin, picked.text); return made.text; })) {
      const count = made.panels.length;
      const name = pageWords(origin, picked, { noteId: noteKey }).name;
      toast(`Data: ${name}. ${count ? `${count} panel${count === 1 ? ' reads' : 's read'} it.` : 'No panel has its columns yet: Add a panel draws one from it.'}`, 'ok', 4000);
    }
    readDataNow();
  }
  /** Whether a Data line's press can act here: a sheet opens where the app's tools are around the builder. */
  function canAct(act, mode) {
    if (act === 'sheet') return tools;
    if (act === 'table') return mode === LOCAL || tools;
    return act === 'edit';
  }
  /** Open in Sheet, or Go to the table: where the rows `origin` names live. */
  function actOn(act, origin, found = null) {
    const { mode, id } = sourceOf(origin, noteKey);
    if (act === 'sheet') openEntity({ id, type: 'sheet' });
    else if (act === 'table' && mode === LOCAL) {
      if (Number.isInteger(found?.line)) editor?.jump?.(found.line);
    } else if (act === 'table' && mode === ELSEWHERE) openEntity({ id, type: 'note' });
  }

  // -- the title band ------------------------------------------------------------------
  function setBand(key, value) {
    edit((source) => withSetting(source, key, value));
  }
  function bandKey(event) {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
  }

  // -- the panels ----------------------------------------------------------------------
  let dragging = $state(-1);
  let over = $state(-1);
  // the panel pressed in the note, picked once when the builder opens, its card open
  let focused = $state((() => panel)());
  /** Whether a panel opens a card of its settings: a chart's or a map's. */
  const carding = (one) => one?.kind === 'chart' || one?.kind === 'map';
  function drop(target) {
    // a title typed in a card is written first, to the panel it is about
    if (dragging >= 0 && target >= 0 && dragging !== target) {
      closeCard();
      edit((source) => movePanel(source, dragging, target));
    }
    dragging = -1;
    over = -1;
  }
  function rowKey(event, index) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= (read?.panels.length ?? 0)) return;
    closeCard();
    if (edit((source) => movePanel(source, index, to))) focused = to;
  }
  function remove(index) {
    closeCard();
    edit((source) => removePanel(source, index));
  }

  // -- a chart panel's settings: the chart's own card, writing inside the page ---------
  /** The panel whose card is open, its index, or -1, and whether it shows its settings or its form. */
  let carded = $state((() => (panel !== null && carding(read?.panels[panel]) ? panel : -1))());
  /** The tab a map's card opens on: the one picked last. */
  let mapTab = $state('look');
  let cardForm = $state(false);
  /** What a chart's card shows under its Data line: its settings, or its rows in a grid. */
  let cardTab = $state('settings');
  let cardHost = $state(null);
  let rowsHost = $state(null);
  let cardDrawn = $state(null);
  let card = null;
  const cardText = $derived(carded >= 0 && block ? panelText(block.source, carded) : '');
  function closeCard() {
    card?.commit();
    card?.destroy();
    card = null;
    carded = -1;
    cardForm = false;
    cardTab = 'settings';
    cardDrawn = null;
  }
  function pressRow(index, one) {
    focused = index;
    if (!carding(one)) return;
    if (carded === index) { closeCard(); return; }
    closeCard();
    carded = index;
  }

  // -- the page drawn at the top, where the note is out of sight ---------------------
  let panelList = $state(null);
  /** Whether the page at the top is folded to its line, for more room below. */
  let folded = $state(false);
  /** A panel pressed on the page: its row picked, its card open, its row brought to the top. */
  function pickPanel(index) {
    const one = read?.panels[index];
    if (!one) return;
    if (carded === index) focused = index;
    else pressRow(index, one);
    requestAnimationFrame(() => panelList?.querySelectorAll(':scope > .ib-panel')[index]?.scrollIntoView({ block: 'start' }));
  }
  /** A panel's words on the page, as its box's title says them. */
  function hitWords(one) {
    const kind = one.chart ? one.chart[0].toUpperCase() + one.chart.slice(1) : KIND_WORDS[one.kind] ?? one.kind;
    return `${one.title ? `${one.title} · ` : ''}${kind} · press to edit`;
  }
  // the card is drawn once its place is, and drawn again as the panel's lines change
  $effect(() => {
    const host = cardHost;
    const index = carded;
    const form = cardForm;
    const tab = cardTab;
    if (!host || index < 0 || (tab === 'rows' && !form && read?.panels[index]?.kind === 'chart')) return;
    // made once per panel opened: what it reads later is read when it is drawn again, not here
    let made = null;
    untrack(() => {
      host.replaceChildren();
      host.classList.remove('cf-form');
      const isMap = read?.panels[index]?.kind === 'map';
      host.classList.toggle('ib-map-card', isMap);
      const write = (changes) => edit((source) => withPanelText(source, index, withSettings(panelText(source, index), changes)));
      made = card = isMap ? openMap(host, index) : form
        ? chartForm(host, {
          state: () => ({ source: block ? panelText(block.source, index) : '', drawn: cardDrawn }),
          // rows its form writes are the panel's own: the page's data never takes them over
          write: (next) => edit((source) => withPanelText(source, index, withSettings(next, { rows: OWN_ROWS }))),
          caseId,
          onClose: () => { card?.commit(); cardForm = false; },
        })
        : chartSettings(host, {
          state: () => {
            const now = block ? panelText(block.source, index) : '';
            return { chart: readChart(now), drawn: cardDrawn };
          },
          write,
          templates: true,
        });
      card.focus();
    });
    // its row and as much of it as fits, in sight
    const shown = requestAnimationFrame(() => reveal(host));
    // a picker the card opened goes with it, the builder closed included
    return () => {
      cancelAnimationFrame(shown);
      made?.destroy();
    };
  });
  /** A card just opened brought into the builder's sight: all of it, else its row at the top. */
  function reveal(host) {
    const scroller = host.closest('.ib-scroll');
    const row = host.closest('.ib-card-row')?.previousElementSibling;
    if (!scroller || !row) return;
    const view = scroller.getBoundingClientRect();
    const below = host.getBoundingClientRect().bottom - view.bottom;
    if (below > 0) scroller.scrollBy({ top: Math.min(below, row.getBoundingClientRect().top - view.top) });
  }
  $effect(() => {
    const now = cardText;
    if (!now || !caseId) return;
    // a map's card reads its lines again, and draws itself
    if (untrack(() => read?.panels[carded]?.kind) === 'map') {
      untrack(() => card?.update?.(now));
      return;
    }
    let live = true;
    drawChart({ caseId, noteId: noteKey, text: now }).then((answer) => {
      if (!live) return;
      cardDrawn = answer?.error ? null : answer;
      untrack(() => card?.refresh());
    });
    untrack(() => card?.refresh());
    return () => { live = false; };
  });
  /** A map panel's own card in `host`: each choice its lines written inside the page, one Undo. */
  function openMap(host, index) {
    const own = (source) => (readInfographic(source).panels[index]?.kind === 'map' ? panelText(source, index) : null);
    return mapPanel(host, {
      caseId,
      source: block ? panelText(block.source, index) : '',
      text: () => {
        const one = infographicsIn(editor?.text?.() ?? '')[k];
        return one ? own(one.source) : null;
      },
      edit: (change) => edit((source) => {
        const lines = own(source);
        return lines === null ? source : withPanelText(source, index, change(lines));
      }),
      say: (message, actions = [], kind = 'info') => toast(message, kind, actions.length ? 8000 : 4000, actions.length ? actions : null),
      sheetMap: editor?.sheetMap ?? null,
      themes: editor?.themeClasses?.() ?? '',
      tab: mapTab,
      onTab: (id) => (mapTab = id),
      // Escape: the card closes, the keyboard back on its row
      onclose: () => {
        const row = host.closest('.ib-card-row')?.previousElementSibling?.querySelector('.ib-panel-name');
        closeCard();
        row?.focus();
      },
    });
  }
  /** What a panel's row says of its rows: the page's data, its own rows, or a source of its own. */
  function panelFrom(index) {
    if (read?.panels[index]?.kind !== 'chart' || !data.data?.found) return data.panels.own.includes(index) ? 'its own source' : '';
    if (data.panels.inheriting.includes(index)) return 'page data';
    return data.panels.own.includes(index) ? 'its own source' : 'own rows';
  }

  /** A panel with its own `from:`: that source read when its card opens, for its Data line. */
  let ownSource = $state({ origin: '', data: null });
  $effect(() => {
    const origin = carded >= 0 ? read?.panels[carded]?.origin ?? '' : '';
    if (!origin || !caseId) return;
    let live = true;
    readData({ caseId, noteId: noteKey, noteText: untrack(() => editor?.text?.() ?? text), origin }).then((found) => {
      if (!live) return;
      ownSource = { origin, data: found };
      // a panel's own source is followed as the page's data is
      const now = carded >= 0 ? readChart(panelText(block?.source ?? '', carded)).table : null;
      if (found.found && now && compareRows(now, found.table) === 'differs') editor?.follow?.(origin, found.text);
    });
    return () => { live = false; };
  });
  /** Whether panel `index` reads the page's data rather than rows of its own. */
  const pageData = (index) => data.panels.inheriting.includes(index);
  /** The words of panel `index`'s Data line: the page's data, a source of its own, or its own rows. */
  function panelWords(index) {
    if (pageData(index)) return dataWordsNow;
    const origin = read?.panels[index]?.origin ?? '';
    if (!origin) return dataWords({ mode: OWN });
    const { mode, anchor } = sourceOf(origin, noteKey);
    const found = ownSource.origin === origin ? ownSource.data : null;
    if (!found) return dataWords({ mode, name: mode === ELSEWHERE ? anchorName(anchor) : '' });
    return pageWords(origin, found, { noteId: noteKey });
  }
  /** The origin panel `index`'s rows live at, for its Data line's press. */
  const panelOriginOf = (index) => (pageData(index) ? dataOrigin : read?.panels[index]?.origin ?? '');
  /** Its Data line's press: Edit opens its rows, Open in Sheet the sheet, Go to the table the table. */
  function panelAct(index, act) {
    if (act === 'edit') {
      card?.commit();
      cardForm = false;
      cardTab = 'rows';
      return;
    }
    const origin = panelOriginOf(index);
    actOn(act, origin, pageData(index) ? data.data : ownSource.origin === origin ? ownSource.data : null);
  }
  /** Page data or Own rows, one press: the page's rows copied in, or the panel's kept as its own. */
  function setPanelRows(index, page) {
    if (page === pageData(index)) return;
    if (page) choosePanelSource(index, { inherit: true });
    else edit((source) => withPanelText(source, index, withSettings(panelText(source, index), { from: '', rows: OWN_ROWS })));
  }

  // its rows in the grid a chart's numbers are, written through the note (`editor/panelRows.js`)
  let rowsGrid = null;
  $effect(() => {
    const host = rowsHost;
    const index = carded;
    if (!host || index < 0 || cardTab !== 'rows' || cardForm) return;
    untrack(() => {
      rowsGrid = editor?.panelGrid?.(host, {
        k,
        index,
        columns: () => (data.data?.found ? data.data.columns : null),
        kind: () => cardDrawn?.kind ?? null,
        tools: () => (readForm(panelText(block?.source ?? '', index), cardDrawn?.kind?.name ?? '').form
          ? [{ label: 'As a form', iconName: 'sliders', title: 'Its rows in a form made for its kind', run: () => { cardForm = true; } }] : []),
        say: (words) => toast(words, 'warn', 6000),
      }) ?? null;
    });
    return () => {
      rowsGrid?.destroy();
      rowsGrid = null;
    };
  });
  $effect(() => {
    void cardText;
    void cardDrawn;
    void data;
    untrack(() => rowsGrid?.refresh());
  });
  /** A panel's Change…: the infographic's data, or a source of its own, its rows read in, as one change. */
  function choosePanelSource(index, choice) {
    dataPick = null;
    if (choice.inherit) {
      const rows = data.data?.found ? data.data.text : '';
      edit((source) => {
        const own = withSettings(panelText(source, index), { from: '', rows: '' });
        return withPanelText(source, index, rows ? withTable(own, rows) : own);
      });
    } else if (choice.origin && choice.data?.text) {
      edit((source) => withPanelText(source, index, withTable(withSettings(panelText(source, index), { from: choice.origin }), choice.data.text)));
    }
    untrack(() => card?.refresh());
  }

  function panelName(one) {
    if (one.kind === 'chart' && one.chartKind) return one.chartKind[0].toUpperCase() + one.chartKind.slice(1);
    return KIND_WORDS[one.kind] ?? one.kind;
  }

  // -- add a panel ---------------------------------------------------------------------
  let adding = $state(false);
  /** Each table of the note with the kinds it fits, as the chart's kind picker draws them. */
  let galleries = $state([]);
  let maps = $state([]);
  async function openAdd() {
    adding = !adding;
    if (!adding) return;
    const now = editor?.text?.() ?? text;
    maps = noteMaps(now);
    // the page's data first: the gallery's default table, a panel made of it taking the data
    const own = data.data?.found ? [{ line: -1, heading: dataName, table: data.data.table, data: data.data.text }] : [];
    const tables = [...own, ...noteTables(now)];
    galleries = tables.map((found) => ({ found, answer: null }));
    tables.forEach((found, at) => {
      chartKinds({ caseId, noteId: noteKey, text: found.data ?? now.slice(found.from, found.to) }).then((answer) => {
        // the list is the state's own copy: a table is known again by its line
        if (galleries[at]?.found.line === found.line) galleries[at] = { found, answer };
      });
    });
  }
  function add(made, width = '') {
    if (edit((source) => addPanel(source, made, width))) {
      adding = false;
      focused = (read?.panels.length ?? 1) - 1;
    }
  }
  /** The chart a kind picked makes of its table, written as one under the table would be. */
  function addChart(found, kind) {
    add(found.data ? dataPanel(kind, found.data) : chartPanel(editor?.text?.() ?? text, found, kind, noteKey));
  }
  /** A chart of a kind from scratch: its columns, no row and its rows its own, its form open in its card. */
  function addScratch(kind) {
    const at = read?.panels.length ?? 0;
    closeCard();
    add(withSettings(starterBlock(kind), { rows: OWN_ROWS }));
    carded = at;
    cardForm = true;
  }
  /** The picker's own cards of every kind from scratch, in the offers. */
  function scratchKinds(node) {
    scratchGallery(node, addScratch);
  }

  // -- start from a template -----------------------------------------------------------
  let templateAnchor = $state(null);
  /** What the template meets: the page's data, read now, or none. */
  const templateData = $derived(data.data?.found ? { table: data.data.text, origin: data.data.origin, name: dataName } : null);
  const templateMaps = $derived(templateAnchor ? noteMaps(editor?.text?.() ?? text).map((map) => ({ label: map.title || 'A map', text: map.block })) : []);
  /** The page laid out as the template applied says, as one change; the first panel to fill opens its form. */
  function startFromTemplate(answer, record) {
    templateAnchor = null;
    if (!answer?.text) return;
    closeCard();
    if (!edit((source) => pageFromTemplate(source, answer.text))) return;
    const reading = answer.panels?.filter((one) => one.reads === 'data').length ?? 0;
    const own = answer.panels?.filter((one) => one.reads === 'own') ?? [];
    const said = [reading ? `${reading} read${reading === 1 ? 's' : ''} ${dataName}` : '', own.length ? `${own.length} to fill` : ''].filter(Boolean).join(', ');
    toast(`Started from “${record?.name ?? 'a template'}”${said ? `: ${said}` : ''}. Undo brings the page back.`, 'ok', 5000);
    const first = own[0];
    if (first) {
      focused = first.index;
      carded = first.index;
      cardForm = true;
    }
  }

  // -- look, legend, colours -----------------------------------------------------------
  const lookNow = $derived(read?.settings.look?.value?.toLowerCase() || drawing?.look || 'report');
  const sharing = $derived(String(read?.settings.legend?.value ?? '').toLowerCase() !== EACH_PANEL);
  const column = $derived(drawing?.legend?.column ?? '');
  const colours = $derived(drawing?.legend?.values ?? []);
  const ownColours = $derived(colours.filter((one) => one.origin === 'order'));
  $effect(() => { if (caseId) layerPalette.load(caseId); });
  async function keepColours() {
    try {
      await layerPalette.keep(caseId, ownColours);
      toast('Kept for the case: every chart, map and layer paints them the same', 'ok', 4000);
    } catch (error) {
      toast(`Colours not kept: ${error.message}`, 'warn');
    }
  }
  const ORIGIN_WORDS = { case: 'the case’s', grade: 'grade ramp', order: 'this page’s', chart: 'the chart’s', highlight: 'highlight' };

  // -- out of the note -----------------------------------------------------------------
  let exportAnchor = $state(null);
  async function exportPicture(size) {
    exportAnchor = null;
    if (!block) return;
    const format = size === 'svg' ? 'svg' : 'png';
    try {
      const { data } = await api.postBytes(`/api/cases/${encodeURIComponent(caseId)}/notes/infographic`,
        { text: block.source, note: noteKey, format, size: size === 'svg' ? 'page' : size });
      const blob = new Blob([data], { type: format === 'svg' ? 'image/svg+xml' : 'image/png' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const name = (read?.settings.title?.value || 'infographic').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'infographic';
      link.download = `${name}-${size}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    } catch (error) {
      toast(`Picture not made: ${error.message}`, 'warn');
    }
  }
  async function toPost() {
    const now = editor?.text?.() ?? text;
    const one = infographicsIn(now)[k];
    if (!one || !noteKey) return;
    try {
      await noteToPost(caseId, noteKey, now, { from: one.from, to: one.to });
    } catch (error) {
      toast(`Not sent to Post: ${error.message}`, 'warn');
    }
  }
</script>

<aside class="ib" class:ib-previews={preview} class:ib-folded={preview && folded} aria-label="Infographic builder">
  <header class="ib-bar" class:ib-backs={back}>
    {#if back}
      <BackButton label={back} title="Back to the note, every change already written" onclick={() => onclose?.()} />
      <h2 class="ib-name ib-name-after"><Icon name="grid" size={13} /><span>Infographic</span></h2>
      {@render bar?.()}
    {:else}
      <Icon name="grid" size={15} />
      <h2 class="ib-name">Infographic</h2>
      {@render bar?.()}
      <button type="button" class="btn btn-ghost btn-xs" title="Close the builder" aria-label="Close the builder" onclick={() => onclose?.()}>
        <Icon name="x" size={14} /></button>
    {/if}
  </header>
  {#if !read}
    <p class="ib-none">This infographic is no longer in the note.</p>
  {:else}
    {#if preview}
      <section class="ib-preview" aria-label="The page">
        <div class="ib-preview-head">
          <span class="ib-head">The page <span class="ib-aside">{folded ? '' : 'press a panel to edit it'}</span></span>
          <button type="button" class="ib-fold" aria-expanded={!folded} title={folded ? 'Show the page as it prints' : 'Fold the page, for more room below'}
            onclick={() => (folded = !folded)}><Icon name={folded ? 'chevronDown' : 'chevronUp'} size={13} /><span>{folded ? 'Show' : 'Fold'}</span></button>
        </div>
        {#if !folded}
          <div class="ib-preview-body">
            {#if drawing?.svg}
              <div class="ib-page" style:aspect-ratio={`${drawing.width} / ${drawing.height}`} style:--ib-ratio={drawing.width / drawing.height}>
                {@html drawing.svg}
                {#each drawing.panels ?? [] as one (one.index)}
                  <button type="button" class="ib-hit" class:ib-hit-on={carded === one.index || (carded < 0 && focused === one.index)}
                    style:left={`${(one.x / drawing.width) * 100}%`} style:top={`${(one.y / drawing.height) * 100}%`}
                    style:width={`${(one.w / drawing.width) * 100}%`} style:height={`${(one.h / drawing.height) * 100}%`}
                    title={hitWords(one)} aria-label={hitWords(one)} onclick={() => pickPanel(one.index)}></button>
                {/each}
              </div>
            {:else}
              <p class="ib-note ib-drawing">Drawing the page…</p>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
    <div class="ib-scroll">
      <section class="ib-part ib-data" aria-labelledby="ib-data">
        <h3 class="ib-head" id="ib-data">Data <span class="ib-aside">what its charts are drawn from</span></h3>
        <p class="ib-data-line">
          <Icon name={data.data?.kind === 'sheet' ? 'grid' : 'table'} size={14} />
          <span class="ib-data-name" class:ib-data-gone={data.data && !data.data.found}>{dataName}</span>
          {#if dataWordsNow.act && canAct(dataWordsNow.act.id, sourceOf(dataOrigin, noteKey).mode)}
            <span class="ib-dot">·</span>
            <button type="button" class="ib-link" title={dataWordsNow.act.title}
              onclick={() => actOn(dataWordsNow.act.id, dataOrigin, data.data)}>{dataWordsNow.act.label}</button>
          {/if}
        </p>
        {#if dataWordsNow.state || dataLine}
          <p class="ib-data-said" class:ib-data-changed={Boolean(dataWordsNow.state)}>{dataWordsNow.state || dataLine}</p>
        {/if}
        <div class="ib-data-acts">
          <button type="button" class="btn btn-sm" title="A sheet of the case, a table of this note, or new data"
            onclick={(event) => (dataPick = { anchor: event.currentTarget, panel: -1 })}>{data.data ? 'Change…' : 'Choose data…'}</button>
        </div>
      </section>

      <section class="ib-part" aria-labelledby="ib-band">
        <h3 class="ib-head" id="ib-band">Title band</h3>
        <label class="ib-field"><span class="ib-word">Kicker</span>
          <input class="input" value={read.settings.kicker?.value ?? ''} placeholder="Place · period" title="The small line above the title"
            onchange={(event) => setBand('kicker', event.currentTarget.value)} onkeydown={bandKey} /></label>
        <label class="ib-field"><span class="ib-word">Title</span>
          <input class="input" value={read.settings.title?.value ?? ''} placeholder="At least … : say what the page counts" title="What the page says, a count said as at least when it is a floor"
            onchange={(event) => setBand('title', event.currentTarget.value)} onkeydown={bandKey} /></label>
        <label class="ib-field"><span class="ib-word">Standfirst</span>
          <textarea class="textarea" rows="2" value={read.settings.standfirst?.value ?? ''} placeholder="Every figure is a minimum: …"
            title="One or two sentences under the title"
            onchange={(event) => setBand('standfirst', event.currentTarget.value)}></textarea></label>
      </section>

      <section class="ib-part" aria-labelledby="ib-panels">
        <h3 class="ib-head" id="ib-panels">Panels <span class="ib-aside">drag to reorder</span></h3>
        <ol class="ib-panels" bind:this={panelList}>
          {#each read.panels as one, index (`${index}:${one.kind}`)}
            <li class="ib-panel" class:ib-over={over === index && dragging !== index} class:ib-picked={focused === index}
              draggable="true"
              ondragstart={(event) => { dragging = index; event.dataTransfer?.setData('text/plain', String(index)); }}
              ondragover={(event) => { if (dragging >= 0) { event.preventDefault(); over = index; } }}
              ondragleave={() => { if (over === index) over = -1; }}
              ondrop={(event) => { event.preventDefault(); drop(index); }}
              ondragend={() => { dragging = -1; over = -1; }}>
              <span class="ib-grip" title="Drag to reorder, or Alt+↑ and Alt+↓"><Icon name="grip" size={13} /></span>
              <Icon name={PANEL_ICONS[one.kind] ?? 'chart'} size={13} />
              <button type="button" class="ib-panel-name" aria-expanded={carding(one) ? carded === index : undefined}
                title={carding(one) ? `${one.title || panelName(one)} · its settings · Alt+↑ and Alt+↓ move it`
                  : `${one.title || panelName(one)} · Alt+↑ and Alt+↓ move it`}
                onfocus={() => (focused = index)} onclick={() => pressRow(index, one)} onkeydown={(event) => rowKey(event, index)}>
                <span class="ib-panel-title">{one.title || panelName(one)}</span>
                {#if one.title || panelFrom(index)}
                  <span class="ib-panel-kind">{[one.title ? panelName(one) : '', panelFrom(index)].filter(Boolean).join(' · ')}</span>
                {/if}
              </button>
              <span class="ib-widths" role="group" aria-label="Width">
                <button type="button" class="ib-width" aria-pressed={one.width === HALF} title="Half the page: a column"
                  onclick={() => edit((source) => withWidth(source, index, HALF))}>Half</button>
                <button type="button" class="ib-width" aria-pressed={one.width === WIDE} title="Across the page"
                  onclick={() => edit((source) => withWidth(source, index, WIDE))}>Wide</button>
              </span>
              <button type="button" class="ib-remove" title="Take this panel out" aria-label={`Take out ${one.title || panelName(one)}`}
                onclick={() => remove(index)}><Icon name="x" size={12} /></button>
            </li>
            {#if carded === index}
              <li class="ib-card-row">
                {#if one.kind === 'chart' && !cardForm}
                  {@const words = panelWords(index)}
                  <div class="ib-rows-head">
                    {#if data.data?.found}
                      <span class="ib-seg" role="radiogroup" aria-label="Its rows">
                        <button type="button" class="ib-seg-btn" role="radio" aria-checked={pageData(index)}
                          title={`The page’s data, ${dataName}, as the other panels read it`} onclick={() => setPanelRows(index, true)}>Page data</button>
                        <button type="button" class="ib-seg-btn" role="radio" aria-checked={!pageData(index)}
                          title="Rows of its own, kept in this panel" onclick={() => setPanelRows(index, false)}>Own rows</button>
                      </span>
                    {/if}
                    <p class="ib-data-line ib-panel-data">
                      <span class="ib-word">Data</span>
                      <span class="ib-data-name" class:ib-data-gone={words.state && !words.act}>{words.name}</span>
                      {#if words.act && canAct(words.act.id, sourceOf(panelOriginOf(index), noteKey).mode)}
                        <span class="ib-dot">·</span>
                        <button type="button" class="ib-link" title={words.act.title} onclick={() => panelAct(index, words.act.id)}>{words.act.label}</button>
                      {/if}
                      {#if words.state}<span class="ib-data-state">{words.state}</span>{/if}
                      {#if caseId}
                        <button type="button" class="ib-link ib-change" title="Read its rows from a sheet, a table of this note, or the page’s data"
                          onclick={(event) => (dataPick = { anchor: event.currentTarget, panel: index })}>Change…</button>
                      {/if}
                    </p>
                    <span class="ib-tabs" role="tablist" aria-label="Its card">
                      <button type="button" class="ib-tab" role="tab" aria-selected={cardTab === 'settings'} onclick={() => (cardTab = 'settings')}>Settings</button>
                      <button type="button" class="ib-tab" role="tab" aria-selected={cardTab === 'rows'} onclick={() => { card?.commit(); cardTab = 'rows'; }}>The numbers</button>
                    </span>
                  </div>
                {/if}
                {#if one.kind === 'chart' && !cardForm && cardTab === 'rows'}
                  <div class={`ib-rows ${editor?.themeClasses?.() ?? ''}`} bind:this={rowsHost}></div>
                  {#if !readChart(panelText(block?.source ?? '', index)).table}<p class="ib-note">This panel holds no rows yet.</p>{/if}
                {:else}
                  <div class="ib-card" bind:this={cardHost}></div>
                  {#if !cardForm && one.kind === 'chart'}<p class="ib-note">The look is the page’s, set under Look.</p>{/if}
                {/if}
              </li>
            {/if}
          {/each}
        </ol>
        <div class="ib-adds">
          <button type="button" class="ib-add" aria-expanded={adding} onclick={openAdd}>
            <Icon name="plus" size={13} /> Add a panel: a chart, a map, words</button>
          <button type="button" class="ib-add" aria-haspopup="dialog" aria-expanded={Boolean(templateAnchor)}
            title="Lay the page out as a template of yours or a ready one, its panels reading this page’s data"
            onclick={(event) => (templateAnchor = templateAnchor ? null : event.currentTarget)}>
            <Icon name="layers" size={13} /> Start from a template…</button>
        </div>
        {#if adding}
          <div class="ib-offers" role="region" aria-label="Add a panel">
            {#each galleries as gallery (gallery.found.line)}
              <div class="ib-table">
                <p class="ib-table-name">{gallery.found.heading || 'A table'}
                  <span class="ib-aside">{rowsSaid(gallery.found.table.rows.length)}</span></p>
                {#if !gallery.answer}
                  <p class="ib-note">Drawing each kind from these rows…</p>
                {:else if gallery.answer.error}
                  <p class="ib-note">Not drawn: {gallery.answer.error}</p>
                {:else}
                  <div class="ib-kinds">
                    {#each gallery.answer.kinds as kind (kind.kind)}
                      <button type="button" class="ib-kind" title={kind.title ? `${kind.label}: ${kind.title}` : kind.label}
                        aria-label={kind.title ? `${kind.label}: ${kind.title}` : kind.label} onclick={() => addChart(gallery.found, kind)}>
                        <span class="ib-thumb" aria-hidden="true">{@html kind.svg}</span>
                        <span class="ib-kind-name">{kind.label}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
            <div class="ib-table">
              <p class="ib-table-name">From scratch <span class="ib-aside">a form for any kind</span></p>
              <div class="ib-scratch" use:scratchKinds></div>
            </div>
            <div class="ib-more">
                {#each maps as map, index (index)}
                  <button type="button" class="btn btn-sm" title="This map of the note, as a panel" onclick={() => add(map.block)}>
                    <Icon name="mapArea" size={13} /> {map.title || 'Map'}</button>
                {:else}
                  <span class="ib-note" title="/ › Interactive map puts one in the note">No map in this note yet</span>
                {/each}
                <button type="button" class="btn btn-sm" title="A heading and a few words" onclick={() => add(WORDS_PANEL)}>
                  <Icon name="text" size={13} /> Words</button>
            </div>
          </div>
        {/if}
      </section>

      <section class="ib-part" aria-labelledby="ib-look">
        <h3 class="ib-head" id="ib-look">Look</h3>
        <span class="ib-looks" role="group" aria-labelledby="ib-look">
          {#each LOOKS as name (name)}
            <button type="button" class="ib-look" aria-pressed={lookNow === name} title={LOOK_HINTS[name]}
              onclick={() => edit((source) => withSetting(source, 'look', name === 'report' ? '' : name))}>{LOOK_WORDS[name]}</button>
          {/each}
        </span>
      </section>

      <section class="ib-part" aria-labelledby="ib-colours">
        <h3 class="ib-head" id="ib-colours">Colours <span class="ib-aside">kept by the case</span></h3>
        <label class="ib-switch" title={column ? `Charts coloured by ${column} share one legend at the top, every value kept` : 'Charts that colour by the same column share one legend'}>
          <input type="checkbox" role="switch" checked={sharing} onchange={(event) => edit((source) => withLegend(source, event.currentTarget.checked))} />
          <span>One legend{column ? ` for ${column}` : ''}, at the top</span>
        </label>
        {#if colours.length}
          <ul class="ib-colours">
            {#each colours as one (one.value)}
              <li class="ib-colour">
                <span class="ib-swatch" class:ib-hatch={one.hatch} class:ib-outline={one.outline} style={`--swatch:${one.colour}`}></span>
                <span class="ib-colour-name">{one.value}</span>
                <span class="ib-colour-from" title="Where the colour comes from">{ORIGIN_WORDS[one.origin] ?? ''}</span>
                <code class="ib-hex">{one.colour}</code>
              </li>
            {/each}
          </ul>
          {#if ownColours.length}
            <button type="button" class="btn btn-sm" title="Name these colours in the case, so every chart, map and layer paints them the same"
              onclick={keepColours}>Keep these colours for the case</button>
          {/if}
        {:else}
          <p class="ib-note">No colour column shared by two charts yet.</p>
        {/if}
      </section>

      {#if drawing?.warnings?.length}
        <section class="ib-part" aria-labelledby="ib-check">
          <h3 class="ib-head" id="ib-check">The check says</h3>
          <ul class="ib-warnings">
            {#each drawing.warnings as warning, index (index)}
              <li class="ib-warning" data-kind={warning.kind}>{warning.message}</li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
    <footer class="ib-foot">
      <button type="button" class="btn btn-primary btn-sm" aria-haspopup="menu" title="One picture of the whole page"
        onclick={(event) => (exportAnchor = exportAnchor ? null : event.currentTarget)}>
        <Icon name="download" size={13} /> Export as a picture <Icon name="chevronDown" size={12} /></button>
      {#if tools}
        <button type="button" class="btn btn-sm" title="Open Post with the page as one picture, nothing posted" disabled={!noteKey} onclick={toPost}>
          <Icon name="post" size={13} /> To Post</button>
      {/if}
    </footer>
  {/if}
</aside>

{#if dataPick}
  <DataPicker {caseId} noteId={noteKey} noteText={editor?.text?.() ?? text} anchor={dataPick.anchor}
    seed={block ? (dataPick.panel >= 0 ? chartSeed(panelText(block.source, dataPick.panel)) : infographicSeed(block.source)) : null}
    current={dataPick.panel >= 0 ? read?.panels[dataPick.panel]?.origin ?? '' : (block ? dataOf(block.source) : '')}
    inherit={dataPick.panel >= 0 && data.data?.found ? { label: dataName } : null}
    onpick={(choice) => (dataPick.panel >= 0 ? choosePanelSource(dataPick.panel, choice) : chooseData(choice))}
    onclose={() => (dataPick = null)} />
{/if}

{#if templateAnchor}
  <FigureTemplatePicker anchor={templateAnchor} figure="infographic" data={templateData} maps={templateMaps}
    onapply={startFromTemplate} onclose={() => (templateAnchor = null)} />
{/if}

{#if exportAnchor}
  <FloatingMenu anchor={exportAnchor} width={250} label="Export as a picture" onclose={() => (exportAnchor = null)}>
    {#each SIZES as one (one.size)}
      <button type="button" class="fm-item" title={one.hint} onclick={() => exportPicture(one.size)}>
        <span class="fm-grow">{one.label}</span><span class="ib-aside">{one.hint}</span></button>
    {/each}
  </FloatingMenu>
{/if}

<style>
  .ib { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 1px solid var(--border); background: var(--bg-1); }
  .ib-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 14px; border-bottom: 1px solid var(--border); color: var(--text-2); }
  .ib-name { flex: 1; margin: 0; font-size: var(--fs-sm); font-weight: 650; color: var(--text-1); }
  .ib-scroll { flex: 1; min-height: 0; overflow: auto; }
  .ib-none { margin: 0; padding: 16px 14px; color: var(--text-3); font-size: var(--fs-sm); }
  .ib-part { padding: 12px 14px 14px; border-bottom: 1px solid var(--border); }
  .ib-head {
    display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 8px; color: var(--text-3);
    font-size: var(--fs-xs); font-weight: 650; letter-spacing: .06em; text-transform: uppercase;
  }
  .ib-aside { color: var(--text-3); font-size: var(--fs-xs); font-weight: 400; letter-spacing: 0; text-transform: none; }
  .ib-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
  .ib-word { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-field .textarea { resize: vertical; min-height: 44px; }
  .ib-panels { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .ib-panel {
    display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 2px; border-radius: var(--r-sm); color: var(--text-2);
    border: 1px solid transparent;
  }
  .ib-panel:hover { background: var(--bg-2); }
  .ib-panel.ib-picked { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .ib-panel.ib-over { box-shadow: inset 0 2px 0 var(--accent); }
  .ib-grip { display: inline-flex; color: var(--text-3); cursor: grab; }
  .ib-panel-name {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 1px 0; border: none; background: none;
    color: var(--text-1); font: inherit; font-size: var(--fs-sm); line-height: 1.25; text-align: left; cursor: pointer;
  }
  .ib-panel-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ib-panel-kind { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-widths, .ib-looks { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--r-sm); overflow: hidden; }
  .ib-width, .ib-look {
    padding: 2px 7px; border: none; background: transparent; color: var(--text-2); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .ib-look { padding: 4px 14px; font-size: var(--fs-sm); }
  .ib-width + .ib-width, .ib-look + .ib-look { border-left: 1px solid var(--border-strong); }
  .ib-width[aria-pressed='true'], .ib-look[aria-pressed='true'] { background: var(--bg-3); color: var(--text-1); font-weight: 650; }
  .ib-width:hover, .ib-look:hover { color: var(--text-1); }
  .ib-remove {
    display: inline-flex; padding: 3px; border: none; border-radius: var(--r-sm); background: none; color: var(--text-2); cursor: pointer;
  }
  .ib-remove:hover, .ib-remove:focus-visible { color: var(--danger); background: var(--bg-3); }
  .ib-add {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 2px; border: none; background: none; color: var(--accent);
    font: inherit; font-size: var(--fs-sm); cursor: pointer;
  }
  .ib-add:hover, .ib-add:focus-visible { text-decoration: underline; }
  .ib-adds { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 14px; }
  .ib-offers { margin-top: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-md, 6px); background: var(--bg-0); }
  .ib-table + .ib-table { margin-top: 12px; }
  .ib-table-name { margin: 0 0 6px; font-size: var(--fs-sm); color: var(--text-1); font-weight: 600; }
  .ib-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .ib-kind {
    display: flex; flex-direction: column; gap: 4px; padding: 5px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); color: var(--text-2); font: inherit; font-size: var(--fs-xs); cursor: pointer; text-align: center;
  }
  .ib-kind:hover, .ib-kind:focus-visible { border-color: var(--accent); color: var(--text-1); }
  .ib-thumb { display: block; height: 92px; overflow: hidden; border-radius: 3px; background: #fff; }
  .ib-thumb :global(svg) { display: block; width: 100%; height: 100%; }
  .ib-more { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
  .ib-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .ib-switch { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: var(--text-1); font-size: var(--fs-sm); cursor: pointer; }
  .ib-colours { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .ib-colour { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--text-1); }
  .ib-swatch { flex: none; width: 13px; height: 13px; border-radius: 3px; background: var(--swatch); }
  .ib-swatch.ib-hatch { background: repeating-linear-gradient(45deg, var(--swatch) 0 2px, color-mix(in srgb, var(--swatch) 40%, #fff) 2px 5px); }
  .ib-swatch.ib-outline { background: transparent; box-shadow: inset 0 0 0 1.5px var(--swatch); }
  .ib-colour-name { flex: 1; min-width: 0; }
  .ib-colour-from { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-hex { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-warnings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-xs); color: var(--text-1); }
  .ib-warning { display: flex; gap: 6px; line-height: 1.4; }
  .ib-warning::before { content: ''; flex: none; width: 5px; height: 5px; margin-top: .45em; border-radius: 50%; background: var(--warn); }
  .ib-warning[data-kind='missing']::before { background: var(--danger); }
  .ib-card-row { list-style: none; padding: 2px 0 8px 22px; }
  /* a chart panel's card: Page data or Own rows, where its rows live, then Settings or The numbers */
  .ib-rows-head { display: flex; flex-direction: column; gap: 7px; margin-bottom: 8px; }
  .ib-seg { display: inline-flex; align-self: flex-start; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
  .ib-seg-btn {
    height: 24px; padding: 0 11px; border: none; border-right: 1px solid var(--border); background: var(--bg-1); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .ib-seg-btn:last-child { border-right: none; }
  .ib-seg-btn:hover, .ib-seg-btn:focus-visible { color: var(--text-1); background: var(--bg-3); outline: none; }
  .ib-seg-btn[aria-checked='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .ib-panel-data { flex-wrap: wrap; gap: 2px 6px; font-size: var(--fs-xs); }
  .ib-panel-data .ib-data-name { font-size: var(--fs-xs); }
  .ib-dot { color: var(--text-3); }
  .ib-link {
    padding: 0; border: none; background: none; color: var(--info); font: inherit; font-size: var(--fs-xs); cursor: pointer;
    text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--info) 40%, transparent); text-underline-offset: 2px; white-space: nowrap;
  }
  .ib-link:hover, .ib-link:focus-visible { color: var(--text-1); outline: none; }
  .ib-data-line .ib-link { font-size: var(--fs-sm); }
  .ib-panel-data .ib-link { font-size: var(--fs-xs); }
  .ib-data-state { color: var(--warn); }
  .ib-change { margin-left: auto; }
  .ib-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); }
  .ib-tab {
    margin-bottom: -1px; padding: 4px 10px; border: none; border-bottom: 2px solid transparent; background: none; color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .ib-tab:hover, .ib-tab:focus-visible { color: var(--text-1); outline: none; }
  .ib-tab[aria-selected='true'] { color: var(--text-1); border-bottom-color: var(--accent); font-weight: 600; }
  /* its rows: the note tables' grid, at the builder's width, its rows scrolling under a fixed height */
  .ib-rows { font-size: var(--fs-sm); }
  .ib-rows :global(.cm-grid-frame) { border: 1px solid var(--border-strong); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-0);
    font-family: var(--font-sans); line-height: 1.45; }
  .ib-rows :global(.cm-grid-scroll) { max-height: 340px; overflow: auto; }
  .ib-rows :global(.cm-grid thead th) { position: sticky; top: 0; z-index: 1; }
  .ib-card { display: flex; flex-direction: column; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); }
  .ib-card :global(.cm-chart-field) { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .ib-card :global(.cm-chart-field-name) { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-card :global(.cm-chart-columns) { display: flex; flex-direction: column; gap: 8px; }
  .ib-card :global(.cm-chart-looks), .ib-card :global([hidden]) { display: none; }
  .ib-card :global(.cm-chart-select), .ib-card :global(.cm-chart-title) {
    box-sizing: border-box; width: 100%; min-height: 28px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 5px;
    background: var(--bg-1); color: var(--text-1); font: inherit; font-size: var(--fs-sm); outline: none;
  }
  .ib-card :global(.cm-chart-title) { resize: none; line-height: 1.4; font-weight: 600; overflow: hidden; }
  .ib-card :global(.cm-chart-select:focus), .ib-card :global(.cm-chart-title:focus) { border-color: var(--accent); }
  .ib-card :global(.cm-chart-proposed) { color: var(--text-3); font-size: var(--fs-xs); }
  .ib-card :global(.cm-chart-proposed em) { color: var(--text-2); }
  .ib-card :global(.cm-chart-use) {
    margin-left: 6px; padding: 0; border: none; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline;
  }
  .ib-card-row > .ib-note { margin-top: 4px; }
  .ib-data { background: color-mix(in srgb, var(--accent) 4%, var(--bg-1)); }
  .ib-data-line { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--text-2); }
  .ib-data-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .ib-data-open { padding: 0; border: none; background: none; font-family: inherit; text-align: left; cursor: pointer; }
  .ib-data-open:hover, .ib-data-open:focus-visible { color: var(--accent); text-decoration: underline; }
  .ib-data-gone { color: var(--danger); }
  .ib-data-said { margin: 3px 0 9px 21px; color: var(--text-3); font-size: var(--fs-xs); }
  .ib-data-changed { color: var(--warn); }
  .ib-data-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-left: 21px; }
  .ib-card :global(.cm-chart-data) { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
  .ib-card :global(.cm-chart-data-name) { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .ib-card :global(.cm-chart-data-state) { color: var(--warn); font-size: var(--fs-xs); }
  .ib-card :global(.cm-chart-data-change) { margin-left: 0; font-size: var(--fs-xs); }
  /* a kind from scratch: the picker's cards, two across; its form in the card, its rows wrapping */
  .ib-scratch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .ib-scratch :global(.cf-scratch) {
    display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); font: inherit; text-align: left; cursor: pointer;
  }
  .ib-scratch :global(.cf-scratch:hover), .ib-scratch :global(.cf-scratch:focus-visible) { border-color: var(--accent); outline: none; }
  .ib-scratch :global(.cf-sketch), .ib-scratch :global(.cf-sketch svg) { width: 40px; height: 25px; }
  .ib-scratch :global(.cf-scratch-needs) { font-size: 10.5px; }
  .ib-card:global(.cf-form) { padding: 10px; border-bottom: none; }
  .ib-card :global(.cm-chart-edit-data) { margin-left: 0; font-size: var(--fs-xs); font-weight: 600; }
  /* a map panel's card: the map, then its tabs (`editor/infographicMap.js`), each field over its choice at the builder's width */
  .ib-card:global(.ib-map-card) { padding: 0; gap: 0; overflow: hidden; }
  .ib-card :global(.ib-map) { height: auto; font-size: var(--fs-sm); }
  .ib-card :global(.ib-map .cm-map-holder) { padding: 8px; }
  .ib-card :global(.ib-map .cm-map-hint) { margin: 0 8px 8px; }
  .ib-card :global(.ib-map .cm-map-settings) { border-top: 1px solid var(--border); border-bottom: none; }
  .ib-card :global(.ib-map .cm-map-tabs) { gap: 0; padding: 4px 4px 0; }
  .ib-card :global(.ib-map .cm-map-tab) { padding: 0 9px; }
  .ib-card :global(.ib-map .cm-map-tab-body) { gap: 12px; padding: 10px 10px 12px; }
  .ib-card :global(.ib-map .cm-map-field), .ib-card :global(.ib-map .cm-map-grid .cm-map-field) { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .ib-card :global(.ib-map .cm-map-field > *), .ib-card :global(.ib-map .cm-map-steps > .cm-map-act) { grid-column: 1; }
  .ib-card :global(.ib-map .cm-map-field-name:empty) { display: none; }
  .ib-card :global(.ib-map .cm-map-grid) { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .ib-card :global(.ib-map .cm-chart-seg-btn) { padding: 3px 8px; }
  /* a layer: its switch, colours, name and count, then its colour under them */
  .ib-card :global(.ib-map .cm-map-list .cm-map-row:not(.cm-map-drawn-row)) { flex-wrap: wrap; row-gap: 5px; }
  .ib-card :global(.ib-map .cm-map-row:not(.cm-map-drawn-row) > .cm-map-row-name) { flex: 1 1 0; }
  .ib-card :global(.ib-map .cm-map-row:not(.cm-map-drawn-row) > .cm-map-colour) { flex: 1 0 calc(100% - 22px); margin-left: 22px; width: auto; }
  /* a drawing: its kind, name and ×, then its colour and On the map, then its days */
  .ib-card :global(.ib-map .cm-map-drawn-row > *) { order: 3; }
  .ib-card :global(.ib-map .cm-map-drawn-row > :is(.cm-map-kind, .cm-map-name, .cm-map-icon-btn)) { order: 1; }
  .ib-card :global(.ib-map .cm-map-drawn-row > :is(.cm-map-colour, .cm-map-check)) { order: 2; }
  .ib-card :global(.ib-map .cm-map-drawn-row > .cm-map-name) { flex: 1 1 calc(100% - 64px); }
  .ib-card :global(.ib-map .cm-map-drawn-row > .cm-map-colour) { flex: 1 1 100px; width: auto; }
  .ib-card :global(.ib-map .cm-map-drawn-row > .cm-map-date) { flex: 1 1 96px; width: auto; padding-inline: 5px; }
  /* a step: its number, day and arrows, then its name and its words */
  .ib-card :global(.ib-map .cm-map-step) { grid-template-columns: 26px minmax(0, 1fr) repeat(4, 26px); row-gap: 4px; }
  .ib-card :global(.ib-map .cm-map-step > :is(.cm-map-step-n, .cm-map-step-day, .cm-map-icon-btn)) { grid-row: 1; }
  .ib-card :global(.ib-map .cm-map-step > .cm-map-step-n) { grid-column: 1; }
  .ib-card :global(.ib-map .cm-map-step > .cm-map-step-day) { grid-column: 2; }
  .ib-card :global(.ib-map .cm-map-step > .cm-map-step-label) { grid-column: 2 / -1; grid-row: 2; }
  .ib-card :global(.ib-map .cm-map-step > .cm-map-step-words) { grid-column: 2 / -1; grid-row: 3; }
  .ib-foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--bg-1); }
  /* the way back first, then what this is, then what the panel adds to the bar */
  .ib-bar.ib-backs { gap: 6px; padding-left: 8px; }
  .ib-name-after { flex: 1; display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--text-2); font-weight: 600; }
  .ib-name-after span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* the page drawn at the top, held in a third of the height; its panels pressable */
  .ib-preview { flex: none; padding: 8px 14px 12px; border-bottom: 1px solid var(--border); background: var(--bg-0); }
  .ib-folded .ib-preview { padding-bottom: 8px; }
  .ib-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ib-preview-head .ib-head { margin: 0; gap: 8px; justify-content: flex-start; }
  .ib-fold {
    display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border: none; border-radius: var(--r-sm); background: none;
    color: var(--text-3); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .ib-fold:hover, .ib-fold:focus-visible { color: var(--text-1); background: var(--bg-3); }
  .ib-preview-body { display: flex; justify-content: center; margin-top: 8px; }
  .ib-page {
    position: relative; width: min(100%, calc(30vh * var(--ib-ratio))); border-radius: 3px; overflow: hidden; background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
  }
  .ib-page :global(svg) { display: block; width: 100%; height: 100%; }
  .ib-hit {
    position: absolute; padding: 0; border: 1.5px solid transparent; border-radius: 3px; background: transparent; cursor: pointer;
  }
  .ib-hit:hover, .ib-hit:focus-visible { border-color: color-mix(in srgb, var(--accent) 65%, transparent); background: color-mix(in srgb, var(--accent) 6%, transparent); outline: none; }
  .ib-hit.ib-hit-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .ib-drawing { padding: 18px 0; }
  /* a wide panel: the page beside the builder, as tall as the panel lets it */
  @container (min-width: 700px) {
    .ib.ib-previews:not(.ib-folded) { display: grid; grid-template-columns: minmax(0, 1fr) 360px; grid-template-rows: auto minmax(0, 1fr) auto; }
    .ib.ib-previews:not(.ib-folded) > .ib-bar { grid-column: 1 / -1; }
    .ib.ib-previews:not(.ib-folded) > .ib-preview {
      grid-column: 1; grid-row: 2 / 4; min-height: 0; overflow: auto; padding: 12px 18px 18px; border-bottom: none; border-right: 1px solid var(--border);
    }
    .ib.ib-previews:not(.ib-folded) > .ib-scroll { grid-column: 2; grid-row: 2; }
    .ib.ib-previews:not(.ib-folded) > .ib-foot { grid-column: 2; grid-row: 3; }
    .ib.ib-previews:not(.ib-folded) .ib-page { width: min(100%, calc((100vh - 110px) * var(--ib-ratio))); }
  }
  @container (min-width: 960px) { .ib.ib-previews:not(.ib-folded) { grid-template-columns: minmax(0, 1fr) 400px; } }
</style>
