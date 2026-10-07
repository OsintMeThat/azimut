/**
 * The bench an analyzer of your own is built on.
 *
 * A check is a pair of passes and the pins laid on them, and the map is where
 * it lives: one check is on the bench at a time, its passes are the imagery,
 * its pins are dropped by a click, and a press of Test runs the rules on the
 * ground under the pins and paints what they kept. The bench holds what the
 * map and the panel both need to agree on: which check, the pins being
 * dropped, the passes under them, the last test and whether it still holds.
 *
 * Nothing reaches Copernicus unasked. Finding passes, and testing with frames
 * the cache lacks, are presses; the cost of the next test is asked of the
 * engine beforehand (`/check/plan`, which fetches nothing) and said on the
 * button, and a test that changes a rule is never run by itself.
 *
 * The map shows what `imagery` asks for and draws `detail`, `pins` and
 * `probe`; the panel shows the rules and the list of checks. Both call the
 * methods here, so neither needs to know the other.
 */
import { untrack } from 'svelte';
import { acquisitionQuery, olderSpan, withOlder } from './acquisitions.js';
import { clone, viewZone } from './analyzers.js';
import { canPickPass } from './detectWhen.js';
import { isoDay } from '../sentinel.js';
import { availableDisplayLayer, displayLayers, DISPLAY_LAYERS } from '../sentinelLayers.js';
import { clearPreview, dataSources, isDraftLayer, preferredBase, previewLayer } from '../customLayers.js';
import { ruleLayerScript } from './ruleLayer.js';
import {
  RULE_COLOURS, checkDated, checkKey, datesOf, markOutcomes, marksBounds, newCheck, passSource, readingRecipe,
  readsOneDate, readsRadar, recipeBands, recipeProblem, sensorOf, signalOf, signature, suggestedLayer,
  linesOf, readingKey, suggestedWords, testedCheck, withFlippedMark, withMark, withoutMark,
} from './analyzerRules.js';

/** A lookup looks at the ground round the middle of the map, never a whole country. */
const LOOKUP_REACH = 0.15;

const lon = (value) => Math.max(-180, Math.min(180, value));
const lat = (value) => Math.max(-85, Math.min(85, value));

/** The ground a pass lookup covers: the view, held to a small box round its middle. */
export function lookupBounds(view) {
  if (!view) return null;
  const middle = [(view.west + view.east) / 2, (view.south + view.north) / 2];
  const half = [Math.min((view.east - view.west) / 2, LOOKUP_REACH), Math.min((view.north - view.south) / 2, LOOKUP_REACH)];
  return { west: lon(middle[0] - half[0]), south: lat(middle[1] - half[1]), east: lon(middle[0] + half[0]), north: lat(middle[1] + half[1]) };
}

export class Bench {
  #api;
  #recipe;
  #limits;
  #layers;
  #layerState;
  #radarLayer;
  #viewBounds;
  #fly;
  #say;
  #dispose;
  #gone = false;
  #returnTo = null;
  #lookups = 0;
  #probes = 0;
  #calendars = 0;
  #months = new Map();

  /** The id of the saved check on the bench, or null for the basemap alone. */
  selected = $state(null);
  /** A check being made: `{ step: 'passes' | 'pins', check }`. The panel waits for it. */
  draft = $state(null);
  /** The passes of a saved check are being changed. */
  editingPasses = $state(false);
  /** The pin a click on the map drops: 'found', 'empty' or null. */
  pinning = $state(null);
  /** The basemap instead of the passes, for a check that has them. */
  basemap = $state(false);
  layer = $state('TRUE_COLOR');
  displayNotice = $state('');
  /**
   * A rule drawn as imagery: `{ index, id, back }`, or null.
   *
   * `id` is a draft layer, which is deliberately never in `offered` — it is
   * scratch, kept out of every picker and out of the settings backup. So it is
   * held here rather than in `layer`, which stays the display the analyst chose
   * and comes back when the rule is let go of.
   */
  ruleLayer = $state(null);
  ruleLayerBusy = $state(false);
  /**
   * Per rule index, what that rule read over the whole ground, as the engine
   * sent it: `{ key, low, high, steps, size, tiles }`.
   *
   * A test sends a verdict, which answers whether the line is crossed and never
   * where it should be. With the reading in hand the browser applies the same
   * comparison itself, so the ground repaints as the slider moves and nothing
   * is asked again. One rule at a time, and only once its slider is touched:
   * every rule of every tile would be tens of megabytes on a press nobody made.
   */
  readings = $state({});
  readingBusy = $state(null);
  /** Where the split sits, as a percentage of the map from its left edge. */
  divider = $state(50);
  /** What the map paints: each rule's pixels, or the detections alone. */
  view = $state('rules');
  /** Display choices for this builder session, independent of the recipe and its tests. */
  hideOverlays = $state(false);
  markers = $state(true);
  outlines = $state(true);
  checkPins = $state(true);
  /** Per rule, whether its pixels are painted. One added since the last toggle is shown. */
  shown = $state([]);
  hover = $state(null);
  probe = $state(null);
  passes = $state({ list: [], lookback: 90, busy: false, error: '', searched: false, truncated: false });
  /** The calendar a day is picked from: which side it is for, and the passes of the month shown. */
  calendar = $state({ side: '', list: [], busy: false, error: '' });
  /** Per check id: what testing it costs, `{ key, tiles, missing, busy, error }`. */
  plans = $state({});
  /** Per check id: its last test, `{ busy, error, detail, signature, key }`. */
  tests = $state({});
  /** What Test all is doing, or ''. */
  running = $state('');
  /** How much of the map's bottom edge the console covers, in pixels, for a card to keep clear of it. */
  reach = $state(0);

  constructor({ api, recipe, limits = {}, layers = () => [], layerState = () => null, radarLayer = () => '',
    viewBounds = () => null, fly = () => {}, say = () => {} }) {
    this.#api = api;
    this.#recipe = recipe;
    this.#limits = limits;
    this.#layers = layers;
    this.#layerState = layerState;
    this.#radarLayer = radarLayer;
    this.#viewBounds = viewBounds;
    this.#fly = fly;
    this.#say = say;
    this.layer = this.#suggested();
    // The cost of the next test follows what it would read, and nothing else:
    // a line moved on a slider costs no request and asks no question.
    this.#dispose = $effect.root(() => {
      $effect(() => {
        const offered = this.offered;
        const layer = this.layer;
        if (this.radar || !offered.some((entry) => entry.enabled !== false)) return;
        const next = availableDisplayLayer(layer, offered);
        if (next === layer) return;
        untrack(() => {
          this.layer = next;
          this.displayNotice = `${layer} is unavailable; showing ${next}.`;
        });
      });
      $effect(() => {
        const keys = this.planKeys;
        const timer = setTimeout(() => untrack(() => void this.#refreshPlans(keys)), 250);
        return () => clearTimeout(timer);
      });
    });
  }

  destroy() {
    this.#gone = true;
    this.#dispose?.();
    // The draft is this machine's scratch work and only one is kept, so leaving
    // it behind would have the next preview serve it from the tile cache.
    if (this.ruleLayer) void clearPreview(this.#api).catch(() => {});
  }

  // -- what is being built ---------------------------------------------------------

  get recipe() { return this.#recipe; }
  get radar() { return readsRadar(this.#recipe); }
  get single() { return readsOneDate(this.#recipe); }
  get problem() { return recipeProblem(this.#recipe, this.#limits); }
  get current() { return signature(this.#recipe); }
  get colours() { return RULE_COLOURS; }
  /** Available display layers, with missing standard products kept disabled. */
  get offered() {
    const state = this.#layerState();
    if (state) return displayLayers(state.layers, state.layersSource === 'instance', this.#radarLayer());
    const layers = this.#layers();
    return layers.length ? layers : DISPLAY_LAYERS;
  }
  get layersBusy() { return this.#layerState()?.layersBusy ?? false; }
  get layersNote() {
    const state = this.#layerState();
    if (!state || this.radar) return '';
    if (state.layersBusy) return 'Checking your Copernicus layers…';
    if (state.layersNote) return state.layersNote;
    if (state.layersSource !== 'instance') return 'Check your Copernicus layers to show a pass.';
    if (!this.offered.some((entry) => entry.enabled)) return 'No optical display layer is available; the basemap stays on.';
    return this.displayNotice;
  }
  get dataProblem() {
    const state = this.#layerState();
    if (!state || this.radar) return '';
    if (state.layersSource !== 'instance') return 'Check your Copernicus layers before testing.';
    // A rule reads band products, not the display layer, so what it needs is a
    // layer the *instance* serves to read them through. One written here is a
    // script over a base layer and cannot stand in for it.
    return state.layers.some((entry) => entry.id === 'TRUE_COLOR' && !entry.custom) ? ''
      : 'Optical rules need a Sentinel-2 L2A layer named TRUE_COLOR.';
  }
  checkLayers(force = false) {
    if (this.radar) return Promise.resolve(true);
    return this.#layerState()?.loadLayers(true, true, force) ?? Promise.resolve(true);
  }

  /** The panel waits while a check is being made: nothing else is touched until it is valid. */
  get locked() { return !!this.draft; }
  get checks() { return this.#recipe.checks; }
  get atMostChecks() { return this.#recipe.checks.length >= (this.#limits.max_checks ?? 12); }

  /** The check on the bench: the one being made, or the saved one picked. */
  get check() {
    if (this.draft) return this.draft.check;
    return this.#recipe.checks.find((check) => check.id === this.selected) ?? null;
  }
  get marks() { return this.check?.marks ?? []; }
  get dated() { return !!this.check && checkDated(this.#recipe, this.check); }
  get canFinish() { return !!this.draft && this.dated && this.marks.length > 0; }
  /** Whether the passes are being chosen, for a check being made or one already kept. */
  get choosingPasses() { return this.draft?.step === 'passes' || this.editingPasses; }

  // -- choosing a check ------------------------------------------------------------

  /** Put a saved check on the bench and go to its pins; null puts the basemap back alone. */
  select(id, { frame = true } = {}) {
    if (this.draft) return;
    this.editingPasses = false;
    this.selected = id;
    this.pinning = null;
    this.probe = null;
    this.basemap = false;
    const check = this.#recipe.checks.find((entry) => entry.id === id);
    if (!check) return;
    void this.checkLayers();
    this.#adoptLayer(check);
    if (frame) this.#frame(check);
  }

  /** A new check, where the map is: passes first, then the pins. */
  startDraft() {
    if (this.draft || this.atMostChecks) return;
    void this.checkLayers();
    this.#returnTo = this.selected;
    this.selected = null;
    this.pinning = null;
    this.probe = null;
    this.basemap = false;
    this.passes = { ...this.passes, list: [], searched: false, truncated: false, error: '' };
    this.draft = { step: 'passes', check: newCheck({ name: this.#freeName() }) };
  }

  /** From the passes to the pins. */
  continueDraft() {
    if (!this.draft || !this.dated) return;
    this.draft.step = 'pins';
    this.pinning = 'found';
  }

  finishDraft() {
    if (!this.canFinish) return;
    const { check } = this.draft;
    this.#recipe.checks = [...this.#recipe.checks, clone(check)];
    this.draft = null;
    this.pinning = null;
    this.selected = check.id;
  }

  cancelDraft() {
    if (!this.draft) return;
    this.draft = null;
    this.pinning = null;
    this.selected = this.#returnTo;
    this.#returnTo = null;
  }

  /** Open the passes of the check on the bench again, to change them. */
  changePasses() {
    if (this.draft) {
      this.draft.step = 'passes';
      this.pinning = null;
    } else if (this.check) {
      this.editingPasses = true;
      this.pinning = null;
    }
  }

  closePasses() {
    if (this.draft) {
      if (this.dated) this.continueDraft();
    } else {
      this.editingPasses = false;
    }
  }

  /** The name of the check being made, as it is typed. */
  nameDraft(name) {
    if (this.draft) this.draft.check.name = name;
  }

  rename(id, name) {
    const text = name.trim();
    if (!text) return;
    this.#recipe.checks = this.#recipe.checks.map((check) => (check.id === id ? { ...check, name: text } : check));
  }

  remove(id) {
    this.#recipe.checks = this.#recipe.checks.filter((check) => check.id !== id);
    if (this.selected === id) this.select(null);
    delete this.tests[id];
    delete this.plans[id];
  }

  // -- passes ----------------------------------------------------------------------

  /** Use a pass for one side of the check on the bench: 'a' is Before, 'b' After. */
  setPass(side, pass) {
    this.#patch((check) => ({ ...check, [side]: passSource(this.#recipe, pass, this.layer), result: null }));
    this.basemap = false;
  }

  /** The passes the ground round the middle of the map has, newest first. */
  lookUpPasses(lookback = this.passes.lookback) {
    this.passes = { ...this.passes, lookback };
    return typeof lookback === 'number' ? this.#search(lookback, false) : undefined;
  }

  lookOlder() {
    return this.#search(olderSpan(this.passes.lookback, this.passes.list), true);
  }

  async #search(span, more) {
    const region = lookupBounds(this.#viewBounds());
    if (!region || !span) return;
    const mine = ++this.#lookups;
    this.passes = { ...this.passes, busy: true, error: '' };
    try {
      const found = await this.#api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery([viewZone(region, 'Preview')], span, new Date(), this.radar ? 'sentinel1' : 'sentinel2'));
      if (mine !== this.#lookups || this.#gone) return;
      const list = more ? withOlder(this.passes.list, found.dates) : found.dates ?? [];
      this.passes = { ...this.passes, list, searched: true, truncated: !!found.truncated };
    } catch (error) {
      if (mine === this.#lookups) this.passes = { ...this.passes, error: error.message };
    } finally {
      if (mine === this.#lookups) this.passes = { ...this.passes, busy: false };
    }
  }

  // -- pins ------------------------------------------------------------------------

  /** Arm a pin so every click on the map drops it, or disarm the one armed. */
  arm(mode) {
    if (!this.check || this.choosingPasses) return;
    this.pinning = this.pinning === mode ? null : mode;
    if (this.pinning) this.probe = null;
  }

  dropPin({ lon: x, lat: y }) {
    if (!this.check || !this.pinning || this.choosingPasses) return;
    const most = this.#limits.max_marks ?? 60;
    if (this.marks.length >= most) {
      this.#say(`A check holds at most ${most} pins.`, 'warn');
      return;
    }
    const expect = this.pinning;
    this.#patch((check) => withMark(check, [x, y], expect));
    this.probe = null;
  }

  removePin(index) { this.#patch((check) => withoutMark(check, index)); }
  flipPin(index) { this.#patch((check) => withFlippedMark(check, index)); }

  // -- the imagery under the pins --------------------------------------------------

  /**
   * What the map should show: the basemap, the after pass alone, or the two
   * passes either side of a split. A pass not chosen yet is not shown, so a
   * check being made shows each pass as it is picked.
   */
  get imagery() {
    const check = this.check;
    const shown = this.shownLayer;
    if (!check || this.basemap || !check.b?.date) return { mode: 'basemap' };
    // A drawn rule is a draft, which is never offered: it is checked for by name.
    if (!this.radar && !isDraftLayer(shown)
      && !this.offered.some((entry) => entry.id === shown && entry.enabled !== false)) return { mode: 'basemap' };
    const after = { ...check.b, layer: shown };
    const before = this.single || !check.a?.date ? null : { ...check.a, layer: shown };
    const shape = (source) => (this.radar ? { provider: 'sentinel1', date: source.date, time: source.time ?? '' }
      : { provider: 'sentinel2', date: source.date, layer: shown });
    return before ? { mode: 'swipe', a: shape(before), b: shape(after) } : { mode: 'single', b: shape(after) };
  }

  /** The layer on the map: a rule being drawn, else the display that was chosen. */
  get shownLayer() { return this.ruleLayer?.id ?? this.layer; }

  /** Whether the map is split between the two passes. */
  get split() { return this.imagery.mode === 'swipe'; }

  setBasemap(on) { this.basemap = on; }

  setLayer(id) {
    if (!this.offered.some((entry) => entry.id === id && entry.enabled !== false)) return;
    // Choosing a display is choosing what the map draws, so it ends a drawn rule.
    this.hideRule();
    this.layer = id;
    this.displayNotice = '';
    this.basemap = false;
    if (this.radar) return;
    this.#patch((check) => ({ ...check, a: check.a?.date ? { ...check.a, layer: id } : check.a,
      b: check.b?.date ? { ...check.b, layer: id } : check.b }));
  }

  /**
   * Draw a rule's own arithmetic on the map, instead of a layer that merely
   * shows its bands well.
   *
   * It renders through the ordinary draft-preview path, so the tiles cache and
   * resolve exactly as a layer written by hand does. It costs what any unseen
   * display layer costs: the tiles the viewport asks for.
   */
  async showRule(index) {
    const script = ruleLayerScript(this.#recipe.rules[index]);
    if (!script || this.radar || this.ruleLayerBusy) return;
    if (this.ruleLayer?.index === index) return this.hideRule();
    this.ruleLayerBusy = true;
    try {
      const bases = dataSources(this.offered, this.#radarLayer());
      const id = await previewLayer(this.#api, {
        base: preferredBase(bases, this.#radarLayer()), script,
      });
      if (this.#gone) return;
      this.ruleLayer = { index, id, back: this.ruleLayer?.back ?? this.layer };
      this.basemap = false;
    } catch (error) {
      if (!this.#gone) this.#say(error.message || 'That rule could not be drawn', 'bad');
    } finally {
      this.ruleLayerBusy = false;
    }
  }

  /** Let the drawn rule go, and put the chosen display back. */
  hideRule() {
    if (!this.ruleLayer) return;
    this.ruleLayer = null;
    void clearPreview(this.#api).catch(() => {});
  }

  /** The layer that shows best what the ranking rule reads, among those offered. */
  #suggested() {
    return suggestedLayer(this.#recipe.rules[Math.max(0, signalOf(this.#recipe))], this.offered);
  }

  #adoptLayer(check) {
    // Another check, another ground: a rule drawn over the last one is let go of.
    this.ruleLayer = null;
    const own = check.b?.layer;
    this.layer = availableDisplayLayer(own || this.#suggested(), this.offered) || own || this.#suggested();
    this.displayNotice = own && own !== this.layer ? `${own} is unavailable; showing ${this.layer}.` : '';
  }

  get suggestion() { return this.#suggested(); }

  /** What that layer shows, said as the bands the ranking rule reads. */
  get suggestionWords() {
    return suggestedWords(this.#recipe.rules[Math.max(0, signalOf(this.#recipe))]);
  }

  // -- what each rule paints -------------------------------------------------------

  isShown(index) { return this.shown[index] ?? true; }

  /** Whether a rule's pixels are on the map now: the eye is open and the map shows rules. */
  painted(index) { return this.view === 'rules' && this.isShown(index); }

  /** What a reading answers for: the check it was read on, and what the rule
   *  reads — never where its line sits, which is the whole point. */
  #readingKey(index) {
    const rule = this.#recipe.rules[index];
    return rule ? `${checkKey(this.check)}|${readingKey(rule)}` : '';
  }

  /** Whether a rule's line can move without asking the engine again. */
  isLive(index) {
    return this.readings[index]?.key === this.#readingKey(index);
  }

  /**
   * Fetch one rule's reading, so its line can be moved live.
   *
   * Never fetches imagery: the engine reads the same cached frames the test
   * read and refuses otherwise, so this costs no Copernicus request.
   */
  async loadReading(index) {
    const key = this.#readingKey(index);
    if (!key || this.isLive(index) || this.readingBusy !== null) return;
    if (!this.detail || this.#recipe.rules[index]?.measure === 'class') return;
    this.readingBusy = index;
    try {
      const answer = await this.#api.post('/api/compare/analyzers/check/values',
        { recipe: readingRecipe(this.#recipe), check: this.check, rule: index });
      if (this.#gone) return;
      if (answer?.ready) this.readings = { ...this.readings, [index]: { ...answer, key } };
    } catch {
      // A reading is a convenience: without it the line still moves, it just
      // waits for Test. Nothing is said, because nothing was asked out loud.
    } finally {
      if (!this.#gone) this.readingBusy = null;
    }
  }

  /** The readings that still answer for the rules as they stand. */
  get live() {
    return Object.entries(this.readings)
      .filter(([index]) => this.isLive(Number(index)))
      .map(([index, reading]) => ({ index: Number(index), reading }));
  }

  /** A rule's eye; with the detections alone on the map every eye reads closed, so one pressed opens its rule. */
  toggleRule(index) {
    const opening = this.view === 'detections';
    this.view = 'rules';
    this.shown = this.#recipe.rules.map((_, i) => (i === index ? opening || !this.isShown(i) : this.isShown(i)));
  }

  /** A rule was removed: its eye goes with it, and so does what it was drawing. */
  ruleRemoved(index) {
    this.shown = this.#recipe.rules.map((_, i) => this.isShown(i)).filter((_, i) => i !== index);
    this.hover = null;
    if (this.ruleLayer) this.hideRule();
  }

  /** The ranking rule was moved to the top: the eyes follow it. */
  rulesReordered(order) {
    this.shown = order.map((i) => this.isShown(i));
    if (this.ruleLayer) this.ruleLayer = { ...this.ruleLayer, index: order.indexOf(this.ruleLayer.index) };
  }

  hoverRule(index) { this.hover = index; }

  /** The rule the pointer is on, shown alone on the map; a hidden one stays hidden. */
  get hovered() { return this.hover !== null && this.painted(this.hover) ? this.hover : null; }

  // -- testing ---------------------------------------------------------------------

  /** What each test would read, by check: the pins, the passes and the bands the rules need. */
  planKeys = $derived.by(() => {
    const list = this.draft ? [...this.#recipe.checks, this.draft.check] : this.#recipe.checks;
    return JSON.stringify(list.filter((check) => check.marks.length && checkDated(this.#recipe, check))
      .map((check) => [check.id, this.#planKeyOf(check)]));
  });

  /** The satellite, the dates and the bands: what the rules ask of a frame, and not where their lines sit. */
  #planKeyOf(check) {
    const reads = [sensorOf(this.#recipe), datesOf(this.#recipe), recipeBands(this.#recipe).join(',')].join('|');
    return `${checkKey(check)}|${reads}`;
  }

  async #refreshPlans(keys) {
    if (this.#gone) return;
    const wanted = JSON.parse(keys).map(([id]) => id);
    const list = [...this.#recipe.checks, ...(this.draft ? [this.draft.check] : [])].filter((check) => wanted.includes(check.id));
    for (const check of list) {
      const key = this.#planKeyOf(check);
      if (this.plans[check.id]?.key === key && !this.plans[check.id].busy) continue;
      this.plans[check.id] = { key, tiles: 0, missing: 0, busy: true, error: '' };
      try {
        const answer = await this.#api.post('/api/compare/analyzers/check/plan',
          { recipe: readingRecipe(this.#recipe), check: testedCheck(check) });
        if (this.#gone) return;
        this.plans[check.id] = { key, tiles: answer.tiles, missing: answer.missing, busy: false, error: '' };
      } catch (error) {
        if (this.#gone) return;
        this.plans[check.id] = { key, tiles: 0, missing: 0, busy: false, error: error.message };
      }
    }
  }

  /** What testing the check on the bench costs, once the engine has said; null while it is being asked. */
  get plan() {
    const check = this.check;
    const plan = check ? this.plans[check.id] : null;
    return plan && !plan.busy && plan.key === this.#planKeyOf(check) ? plan : null;
  }
  get planning() {
    const check = this.check;
    return !!check && check.marks.length > 0 && this.dated && !this.plan;
  }

  /** The last test of the check on the bench, if any. */
  get last() {
    const check = this.check;
    return check ? this.tests[check.id] ?? null : null;
  }
  get testing() { return !!this.last?.busy; }
  /** What the map draws of the last test, while it is still about the rules and pins on the bench. */
  get detail() { return this.last?.detail ?? null; }
  /** Whether what the map draws is older than the rules or the pins. */
  get stale() {
    const last = this.last;
    return !!last?.detail && (last.signature !== this.current || last.key !== checkKey(this.check));
  }

  /**
   * Whether the picture is older than the rules in a way a reading cannot cover.
   *
   * A line that moved on a rule whose reading is in hand is not stale at all:
   * the ground is redrawn from the very numbers the test measured, so dimming it
   * would call a live picture old. Anything else — another rule, the pins, the
   * passes, what a rule reads — still waits for Test.
   */
  get staleToDraw() {
    if (!this.stale) return false;
    const last = this.last;
    const live = new Set(this.live.map((row) => row.index));
    if (!live.size || !last?.lines || last.key !== checkKey(this.check)) return true;
    const now = linesOf(this.#recipe);
    if (now.length !== last.lines.length) return true;
    // every rule either reads what it read, or is one whose line can move live
    return !now.every((line, i) => line.key === last.lines[i].key
      && (line.line === last.lines[i].line || live.has(i)));
  }

  /** Why the check on the bench cannot be tested yet, or ''. */
  get blocked() {
    const check = this.check;
    if (!check) return 'Pick a check to try the rules on.';
    if (!this.dated) return this.single ? 'Pick the pass this check is read on.' : 'Pick the before and after passes.';
    if (!check.marks.length) return 'Drop a pin to choose what this check reads.';
    if (this.problem) return this.problem;
    if (this.dataProblem) return this.dataProblem;
    if (this.plan?.error) return this.plan.error;
    return '';
  }

  /** What each pin made of the last test, in pin order: true when it came out as it should. */
  get outcomes() {
    const check = this.check;
    return check?.result?.signature === this.current ? markOutcomes(check) : [];
  }
  /** The pins as the map draws them: where, what they should do, and whether they did. */
  get pins() {
    const outcomes = this.outcomes;
    return this.marks.map((mark, i) => ({ ...mark, ok: outcomes[i] ?? null }));
  }

  /** Whether what the map draws is the answer to the rules and pins as they stand. */
  get tested() { return !!this.detail && !this.stale && !this.testing; }

  /** Whether pressing Test now does anything: it can, and what the map draws is not already its answer. */
  get canTest() {
    return !!this.check && !this.blocked && !this.planning && !this.testing && !(this.detail && !this.stale);
  }

  /** What the Test button says: the cost of the next one when it reads frames, and that it is done when nothing changed. */
  get testLabel() {
    if (this.testing) return 'Testing…';
    if (this.detail && !this.stale) return 'Tested';
    const missing = this.plan?.missing ?? 0;
    return `${this.detail ? 'Test again' : 'Test'}${missing ? ` · ${missing} request${missing === 1 ? '' : 's'}` : ''}`;
  }

  /** Test the check on the bench with the rules as they stand. The one press that may fetch frames. */
  async test() {
    const check = this.check;
    if (!check || !this.canTest) return;
    await this.#run(check, { detail: true });
  }

  /** Test every check that has its passes and a pin, one after the other. */
  async testAll() {
    if (this.running || this.problem) return;
    this.running = 'Checking layers…';
    try {
      await this.checkLayers();
      if (this.#gone) return;
      if (this.dataProblem) { this.#say(this.dataProblem, 'warn'); return; }
      const list = this.#recipe.checks.filter((check) => check.marks.length && checkDated(this.#recipe, check));
      for (const [i, check] of list.entries()) {
        this.running = `Testing ${i + 1} of ${list.length}…`;
        await this.#run(check, { detail: check.id === this.check?.id });
        if (this.#gone) return;
      }
    } finally {
      this.running = '';
    }
  }

  /** What Test all would ask of Copernicus, at most: every check's missing frames. */
  get allMissing() {
    return this.#recipe.checks.reduce((sum, check) => sum + (this.plans[check.id]?.missing ?? 0), 0);
  }

  async #run(check, { detail }) {
    const id = check.id;
    const signed = this.current;
    const key = checkKey(check);
    const before = this.tests[id];
    this.tests[id] = { ...before, busy: true, error: '' };
    try {
      const answer = await this.#api.post('/api/compare/analyzers/check',
        { recipe: readingRecipe(this.#recipe), check: testedCheck(check), read: true, detail });
      if (this.#gone) return;
      if (!answer.ready) {
        this.tests[id] = { ...before, busy: false, error: 'Copernicus returned nothing for this check.' };
        return;
      }
      const next = { busy: false, error: '', detail: before?.detail ?? null, signature: before?.signature ?? '',
        key: before?.key ?? '', lines: before?.lines ?? [] };
      if (detail) Object.assign(next, { detail: answer, signature: signed, key, lines: linesOf(this.#recipe) });
      this.tests[id] = next;
      // The answer belongs to the rules and pins it was asked with; if either moved meanwhile it is only shown.
      const latest = this.#find(id);
      if (latest && checkKey(latest) === key && this.current === signed) {
        this.#setResult(id, { signature: signed, count: answer.count, covered: answer.covered });
      }
      if (this.plans[id]) this.plans[id] = { ...this.plans[id], missing: 0 };
    } catch (error) {
      if (this.#gone) return;
      this.tests[id] = { ...before, busy: false, error: error.message };
    }
  }

  // -- a point of the ground -------------------------------------------------------

  /**
   * Read every rule at a point of the map, tested ground or not: the answer
   * says which. `pin` is the index of the pin the point is, when it is one.
   */
  async probeAt(point, { pin = null } = {}) {
    const check = this.check;
    if (!check) return;
    const mine = ++this.#probes;
    const base = { point, pin, result: null, error: '' };
    if (!this.dated) { this.probe = { ...base, unread: 'passes' }; return; }
    if (!this.detail) { this.probe = { ...base, unread: 'frames' }; return; }
    this.probe = base;
    try {
      const result = await this.#api.post('/api/compare/analyzers/probe',
        { recipe: readingRecipe(this.#recipe), check: testedCheck(check), point: [point.lon, point.lat] });
      if (mine === this.#probes && !this.#gone) this.probe = { ...base, result };
    } catch (error) {
      if (mine === this.#probes) this.probe = { ...base, error: error.message };
    }
  }

  /** Read the ground under one of the pins. */
  probePin(index) {
    const mark = this.marks[index];
    if (mark) return this.probeAt({ lon: mark.point[0], lat: mark.point[1] }, { pin: index });
  }

  closeProbe() {
    this.#probes++;
    this.probe = null;
  }

  /** Escape: close the reading, else put the armed pin down. True when it did something. */
  escape() {
    if (this.probe) { this.closeProbe(); return true; }
    if (this.pinning) { this.pinning = null; return true; }
    return false;
  }

  /** Move the split between the two passes. */
  setDivider(percent) { this.divider = Math.max(0, Math.min(100, percent)); }

  setLookback(lookback) {
    this.passes = { ...this.passes, lookback };
    if (lookback !== 'dates') this.calendar = { ...this.calendar, side: '' };
  }

  // -- a day picked from the calendar ----------------------------------------------

  /** Open the calendar for one side of the check, 'a' (Before) or 'b' (After). */
  openCalendar(side) {
    this.calendar = { side, list: [], busy: false, error: '' };
  }

  closeCalendar() { this.calendar = { ...this.calendar, side: '' }; }

  /** Whether a pass can be that side of the check: in order, and on one radar track. */
  eligible(side) {
    return (pass) => canPickPass(side, pass, this.check?.a, this.check?.b, this.radar);
  }

  /** A pass picked from the calendar: it is the side's, and the calendar closes. */
  pickFromCalendar(side, pass) {
    this.setPass(side, { date: pass.date, time: pass.time ?? '' });
    this.closeCalendar();
  }

  /** A day typed in: it has no time yet, and the engine settles which pass of it. */
  typeDay(side, date) {
    if (date) this.setPass(side, { date, time: '' });
  }

  /**
   * The passes of one month over the middle of the map, for the calendar to colour
   * its days with. A month is a catalogue request, so each is asked once and kept.
   */
  async loadMonth(month) {
    const region = lookupBounds(this.#viewBounds());
    if (!region) return;
    const key = `${month}@${Math.round(region.west * 20)},${Math.round(region.south * 20)}|${this.radar ? 1 : 2}`;
    const cached = this.#months.get(key);
    const mine = ++this.#calendars;
    if (cached) {
      this.calendar = { ...this.calendar, list: cached, busy: false, error: '' };
      return;
    }
    this.calendar = { ...this.calendar, list: [], busy: true, error: '' };
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const today = isoDay(new Date());
    try {
      const found = await this.#api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery([viewZone(region, 'Preview')], { start: `${month}-01`, end: last < today ? last : today },
          new Date(), this.radar ? 'sentinel1' : 'sentinel2'));
      if (this.#gone) return;
      this.#months.set(key, found.dates ?? []);
      if (mine === this.#calendars) this.calendar = { ...this.calendar, list: found.dates ?? [], busy: false };
    } catch (error) {
      if (mine === this.#calendars) this.calendar = { ...this.calendar, busy: false, error: error.message };
    }
  }

  /** Drop a pin where the point was read. */
  markProbe(expect) {
    if (!this.probe || !this.check) return;
    const { point } = this.probe;
    if (this.marks.length >= (this.#limits.max_marks ?? 60)) {
      this.#say(`A check holds at most ${this.#limits.max_marks ?? 60} pins.`, 'warn');
      return;
    }
    this.#patch((check) => withMark(check, [point.lon, point.lat], expect));
    this.probe = null;
  }

  // -- internals -------------------------------------------------------------------

  #find(id) {
    if (this.draft?.check.id === id) return this.draft.check;
    return this.#recipe.checks.find((check) => check.id === id) ?? null;
  }

  #patch(change) {
    if (this.draft) {
      this.draft.check = change(this.draft.check);
      return;
    }
    const id = this.selected;
    if (!id) return;
    this.#recipe.checks = this.#recipe.checks.map((check) => (check.id === id ? change(check) : check));
  }

  #setResult(id, result) {
    if (this.draft?.check.id === id) {
      this.draft.check = { ...this.draft.check, result };
      return;
    }
    this.#recipe.checks = this.#recipe.checks.map((check) => (check.id === id ? { ...check, result } : check));
  }

  #freeName() {
    const taken = new Set(this.#recipe.checks.map((check) => check.name));
    let n = this.#recipe.checks.length + 1;
    while (taken.has(`Check ${n}`)) n++;
    return `Check ${n}`;
  }

  #frame(check) {
    if (!check.marks.length) return;
    this.#fly({ bounds: marksBounds(check.marks) });
  }
}
