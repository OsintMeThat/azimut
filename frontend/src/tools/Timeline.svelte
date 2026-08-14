<script>
  /** A windowed UTC axis over the case's derived temporal projection. */
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import {
    openAnalysisCase,
    setAnalysisPeriod,
    timelineViews,
  } from '../lib/analysisSearch.svelte.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { closeOnOutsidePointer } from '../lib/dismiss.js';
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { entityLabel, entityTypes, loadEntityTypes } from '../lib/entityTypes.svelte.js';
  import {
    TIMELINE_CATEGORIES,
    UTC,
    WINDOW_SPANS,
    axisBands,
    axisMinorTicks,
    axisScale,
    axisTicks,
    bucketWindow,
    canDragTemporal,
    dateAtRatio,
    describePair,
    draftWhen,
    formatTemporalValue,
    initialWindow,
    inputWindowValue,
    isoInstant,
    knownZone,
    densityScale,
    densityTicks,
    densityUnit,
    layoutDensityBuckets,
    layoutTimelineItems,
    machineZone,
    moveTemporalRaw,
    nowPosition,
    nudgeTemporalRaw,
    resizeTemporalRaw,
    resizeWindow,
    ribbonBands,
    shiftWindow,
    timeAtRatio,
    windowInputValue,
    windowMillis,
    windowWords,
    zoneAbbreviation,
    zonedFields,
    zonedStamp,
    zoomWindow,
  } from '../lib/timeline.js';
  import {
    copyTimelineTrack,
    defaultTimelineTracks,
    groupedTimelineTracks,
    moveTimelineTrack,
    normalizeTimelineTracks,
    timelineTrack,
    timelineTrackQuery,
    timelineViewState,
    trackPresets,
    trackTint,
  } from '../lib/timelineTracks.js';
  import { plateFilename } from '../lib/plate.js';
  import { PLATE_PLOT, timelinePlate } from '../lib/timelinePlate.js';
  import AnalysisViews from '../components/AnalysisViews.svelte';
  import PlateExport from '../components/PlateExport.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import TemporalClaimEditor from '../components/TemporalClaimEditor.svelte';
  import TimelineTrackEditor from '../components/TimelineTrackEditor.svelte';
  import ZonePicker from '../components/ZonePicker.svelte';

  const PAGE = 200;
  loadEntityTypes();
  let trackSpecs = $state(defaultTimelineTracks());
  let trackPages = $state({});
  let groupBy = $state('none');
  let trackEditor = $state(null);
  let trackMenu = $state(false);
  let trackMenuElement = $state(null);
  let draggedTrack = null;
  let selectedTrackId = $state(null);
  let from = $state('');
  let to = $state('');
  let items = $state([]);
  let total = $state(0);
  let undatedTotal = $state(0);
  let unplacedTotal = $state(0);
  let cursor = $state(null);
  let loading = $state(false);
  let extent = $state(null);
  let overview = $state([]);
  let overviewTruncated = $state(false);
  let selected = $state(null);
  /**
   * The second entry, held against the first (Ctrl-click).
   *
   * What a chronology is read for and never printed: an axis shows that two things
   * are near each other, and the finding is the figure between them. Kept beside
   * `selected` rather than replacing it, so the panel still says what the entry *is*
   * while it measures.
   */
  let against = $state(null);
  /**
   * Which clock the axis is *read* on: `utc`, `machine`, or `place:<id>` for the
   * local time at a point the case has saved.
   *
   * The case is stored in UTC and stays there (`lib/timeline.js`): this moves the
   * ticks and their words, nothing else. UTC is the default because it is the one
   * reading that means the same thing on every machine — and it is the wrong reading
   * for the work, because an investigator argues in the local time of the *event*,
   * and checking a 19:40 timestamp against a clock in the analyst's own country is
   * how an hour goes missing.
   *
   * A saved point is that reading, and it is the only one that can carry the daylight
   * ribbon with it: a band of day and night needs coordinates, so it arrives with the
   * zone rather than being a second control.
   */
  let zoneChoice = $state('utc');
  /** The case's saved points, for that menu. Bounded like every other list here. */
  let places = $state([]);
  /** `{ zone, day, civil, truncated }` for the chosen point over the visible window. */
  let daylight = $state(null);
  let daylightLoading = $state(false);
  let daylightSeq = 0;
  let editor = $state(null);
  let detailsId = $state(null);
  let entityFilter = $state(null);
  let viewMode = $state('plot');
  let expandedTracks = $state({});
  let toolElement = $state(null);
  let fullscreen = $state(false);
  let legendElement = $state(null);
  let legendOpen = $state(false);
  let rangeElement = $state(null);
  let rangeMenu = $state(false);
  let plotElement = $state(null);
  let plotWidth = $state(1000);
  let overviewWidth = $state(800);
  let tooltip = $state(null);
  /** `{ item, track, x, y }` while an entry is being asked what can be done with it. */
  let itemMenu = $state(null);
  let itemMenuElement = $state(null);
  let inspectorChain = $state(null);
  let inspectorLoading = $state(false);
  let seq = 0;
  let overviewSeq = 0;
  let inspectorSeq = 0;
  let loadedCase = null;
  let pendingSelection = null;
  let navigationBusy = $state(false);
  let navigationTimer = null;
  let panning = $state(null);
  let overviewGesture = $state(null);

  const activeCategories = $derived(
    [...new Set(trackSpecs.flatMap((track) => track.categories))]
  );
  // Only a Timeline view can land in this slot, so its surface no longer needs asking.
  const snapshotReading = $derived(timelineViews.activeView?.mode === 'snapshot');
  const axisWindow = $derived(windowMillis(from, to));
  const ticks = $derived(axisTicks(from, to, plotWidth, zone));
  const minorTicks = $derived(axisMinorTicks(from, to, plotWidth, zone));
  const bands = $derived(axisBands(from, to, plotWidth, zone));
  const nowLeft = $derived(nowPosition(from, to));
  const baseTrackItems = $derived(Object.fromEntries(
    trackSpecs.map((track) => [
      track.id,
      (trackPages[track.id]?.items ?? [])
        .filter((item) => !track.hidden.includes(item.id))
        .map((item) => ({ ...item, pinned: track.pinned.includes(item.id) })),
    ])
  ));
  const visibleItems = $derived.by(() => {
    const unique = new Map();
    for (const rows of Object.values(baseTrackItems)) {
      for (const item of rows) unique.set(item.id, item);
    }
    return [...unique.values()];
  });
  const dated = $derived(visibleItems.filter((item) => item.earliest));
  /**
   * Everything the loaded page holds, including entries hidden only from a track.
   *
   * What the two holding lists below are read from, and the reason they are read from
   * this rather than from `visibleItems`: hiding tidies a **lane**, and an entry with
   * no place on the axis was never in one. Applied to those entries, hiding had exactly
   * one visible effect — it emptied the queue whose whole job is to say *these still
   * need a date* — and the way back was a control on a track that also gave back
   * everything else that track was holding.
   *
   * An entry is in these lists because one of the current tracks asks for it, not
   * because of where it is drawn.
   */
  const pageItems = $derived.by(() => {
    const unique = new Map();
    for (const page of Object.values(trackPages)) {
      for (const item of page?.items ?? []) unique.set(item.id, item);
    }
    return [...unique.values()];
  });
  const unplaced = $derived(pageItems.filter((item) => !item.earliest && item.raw));
  const undated = $derived(pageItems.filter((item) => !item.earliest && !item.raw));
  /**
   * The tracks as they are drawn, laid out against a given axis width.
   *
   * The width is a parameter rather than the measured one, because `layoutTimelineItems`
   * packs lanes by the room a label takes in pixels: it is the width that decides which
   * entries collide, how many lanes a track needs and what ends up in a `+n`. The screen
   * asks at the width it measured, the export at the plate's own.
   */
  function buildTracks(axisWidth) {
    return groupedTimelineTracks(trackSpecs, baseTrackItems, groupBy, entityLabel).map((track) => {
      const baseId = track.parentId ?? track.id;
      const expanded = Boolean(expandedTracks[baseId]);
      return {
        ...track,
        expanded,
        total: groupBy === 'none' ? (trackPages[baseId]?.total ?? track.items.length) : track.items.length,
        layout: layoutTimelineItems(
          track.items.filter((item) => item.earliest), from, to, axisWidth,
          expanded ? PAGE : 6
        ),
      };
    });
  }
  const tracks = $derived(buildTracks(plotWidth));
  const density = $derived(layoutDensityBuckets(overview, extent));
  const overviewUnit = $derived(
    { 13: 'Hour', 10: 'Day', 7: 'Month' }[overview[0]?.start?.length] ?? 'Year'
  );
  /**
   * The date scale under the minimap: one slot per period, named under its own bar.
   *
   * Measured rather than assumed — a fixed 800 chose how many names to print for a
   * minimap that is as wide as the window, so it crowded on a narrow one and left the
   * wide one half empty.
   */
  const overviewTicks = $derived(densityTicks(overview, extent, overviewWidth));
  const selectedReading = $derived(formatTemporalValue(selected?.raw ?? ''));
  const selectedTrack = $derived(trackSpecs.find((track) => track.id === selectedTrackId) ?? null);
  const inspectorConnections = $derived.by(() => {
    const grouped = { about: [], at: [], cites: [] };
    if (snapshotReading && selected) {
      grouped.about = selected.subject_entities ?? [];
      grouped.at = selected.place_entities ?? [];
      grouped.cites = selected.source_entities ?? [];
      return grouped;
    }
    for (const row of inspectorChain?.relations ?? []) {
      if (row.direction === 'out' && grouped[row.link.type]) grouped[row.link.type].push(row.entity);
    }
    return grouped;
  });
  const listGroups = $derived.by(() => {
    const groups = new Map();
    for (const item of [...dated].sort((a, b) => String(a.earliest).localeCompare(String(b.earliest)))) {
      const date = new Date(item.earliest);
      // Grouped by the month the reading falls in, so the list and the axis agree
      // about which month an entry near a midnight belongs to.
      const at = zonedFields(date.getTime(), zone);
      const key = `${at.year}-${String(at.month).padStart(2, '0')}`;
      const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: zone });
      const group = groups.get(key) ?? { key, label, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  });
  const overviewWindow = $derived.by(() => {
    const scale = densityScale(overview, extent);
    if (!axisWindow || !scale) return { left: 0, width: 100 };
    const span = Math.max(1, scale.span);
    const left = Math.max(0, Math.min(1, (axisWindow.start - scale.first) / span));
    const right = Math.max(left, Math.min(1, (axisWindow.end - scale.first) / span));
    return { left: left * 100, width: Math.max(.35, (right - left) * 100) };
  });
  /**
   * The zone in force. A point's own zone arrives with its daylight, so until that
   * lands the axis stays on UTC rather than flickering through a guess.
   */
  const sunPlace = $derived(
    zoneChoice.startsWith('place:')
      ? places.find((place) => place.id === zoneChoice.slice(6)) ?? null
      : null
  );
  const frozenZone = $derived(
    snapshotReading ? timelineViews.activeView?.spec?.timeline?.timezone ?? null : null
  );
  const zone = $derived.by(() => {
    if (frozenZone && knownZone(frozenZone)) return frozenZone;
    if (zoneChoice === 'machine') return knownZone(localZone) ? localZone : UTC;
    // A zone named outright: the investigation is at the other end of the world and
    // the case has no saved point there yet. It carries no coordinates, so it labels
    // the axis and draws no daylight.
    if (zoneChoice.startsWith('zone:')) {
      const named = zoneChoice.slice(5);
      return knownZone(named) ? named : UTC;
    }
    if (!sunPlace) return UTC;
    const named = daylight?.zone?.name;
    return named && knownZone(named) ? named : UTC;
  });
  /** What one tick is worth, and which clock is being read. */
  const zoneWord = $derived(
    zone === UTC ? 'UTC' : zoneAbbreviation(zone, axisWindow?.start ?? 0)
  );
  /**
   * Day and civil twilight across the visible window, drawn only on a local reading.
   *
   * The point of pairing them: a photo stamped 19:40 is argued against the light at
   * the place it claims, and doing that against a UTC axis in another country is
   * where an hour goes missing. Two runs rather than one because dusk is not a line.
   */
  const daylightBands = $derived(
    sunPlace && !daylight?.truncated ? ribbonBands(daylight?.day ?? [], from, to) : []
  );
  const twilightBands = $derived(
    sunPlace && !daylight?.truncated ? ribbonBands(daylight?.civil ?? [], from, to) : []
  );
  const scaleLabel = $derived.by(() => {
    const unit = axisScale(from, to, plotWidth);
    return unit ? `${unit} · ${zoneWord}` : zoneWord;
  });
  /** The machine's own zone is offered rather than assumed: it is a legitimate
   *  reading of a working day and a poor default. */
  const localZone = machineZone();
  /** The pair reading, when a second entry is held against the first. */
  const pairReading = $derived(
    selected && against && selected.id !== against.id ? describePair(selected, against) : null
  );

  $effect(() => {
    if (!plotElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      plotWidth = Math.max(320, Math.round(entry.contentRect.width));
    });
    observer.observe(plotElement);
    return () => observer.disconnect();
  });

  $effect(() => trackMenu ? closeOnOutsidePointer(trackMenuElement, () => (trackMenu = false)) : undefined);
  $effect(() => rangeMenu ? closeOnOutsidePointer(rangeElement, () => (rangeMenu = false)) : undefined);

  $effect(() => {
    if (typeof document === 'undefined') return;
    const changed = () => (fullscreen = document.fullscreenElement === toolElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  });

  $effect(() => legendOpen ? closeOnOutsidePointer(legendElement, () => (legendOpen = false)) : undefined);
  $effect(() => itemMenu ? closeOnOutsidePointer(itemMenuElement, () => (itemMenu = null)) : undefined);

  function overviewQuery(track, { densityBucket = 'year' } = {}) {
    const params = new URLSearchParams({
      include_undated: 'false',
      limit: '1',
      bucket: densityBucket,
    });
    for (const category of track.categories) {
      params.append('category', category);
    }
    if (entityFilter?.id) params.set('entity', entityFilter.id);
    params.set('track', timelineTrackQuery(track));
    return params;
  }

  function mergeOverviewPages(pages) {
    const buckets = new Map();
    for (const page of pages) {
      for (const row of page.buckets ?? []) {
        const held = buckets.get(row.start)
          ?? { start: row.start, count: 0, categories: {}, first: null, last: null };
        held.count += row.count ?? 0;
        for (const [category, count] of Object.entries(row.categories ?? {})) {
          held.categories[category] = (held.categories[category] ?? 0) + count;
        }
        // One track's bucket and another's cover different days of the same month, and
        // the bar drawn for it has to reach across both.
        if (row.first && (!held.first || row.first < held.first)) held.first = row.first;
        if (row.last && (!held.last || row.last > held.last)) held.last = row.last;
        buckets.set(row.start, held);
      }
    }
    const extents = pages.map((page) => page.extent).filter((value) => value?.from);
    return {
      buckets: [...buckets.values()].sort((left, right) => left.start.localeCompare(right.start)),
      buckets_truncated: pages.some((page) => page.buckets_truncated),
      extent: extents.length ? {
        from: extents.map((value) => value.from).sort()[0],
        to: extents.map((value) => value.to).sort().at(-1),
      } : null,
    };
  }

  /**
   * One page of a lane. `spread` is what makes the page a reading of the window
   * rather than of its first days: a case whose media pile into January filled the
   * page before February, and the lanes then contradicted the overview above them
   * by drawing an empty spring. The server samples the same rows instead, and
   * "Load more" fills the sample in.
   */
  function trackQuery(track, { more = false } = {}) {
    const params = new URLSearchParams({
      include_undated: 'true', limit: String(PAGE), spread: 'true',
    });
    for (const category of track.categories) {
      params.append('category', category);
    }
    if (entityFilter?.id) params.set('entity', entityFilter.id);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (more && trackPages[track.id]?.cursor) params.set('cursor', trackPages[track.id].cursor);
    params.set('track', timelineTrackQuery(track));
    return params;
  }

  async function loadMain({ more = false } = {}) {
    const caseId = caseState.current?.id;
    if (!caseId || !activeCategories.length || snapshotReading) return;
    const targets = trackSpecs.filter((track) => !more || trackPages[track.id]?.cursor);
    if (!targets.length) return;
    const mine = ++seq;
    loading = true;
    try {
      const responses = await Promise.all(targets.map(async (track) => ({
        track,
        page: await api.get(`/api/cases/${caseId}/timeline?${trackQuery(track, { more })}`),
      })));
      if (mine !== seq) return;
      const nextPages = more ? { ...trackPages } : {};
      for (const { track, page } of responses) {
        nextPages[track.id] = {
          items: more
            ? [...(nextPages[track.id]?.items ?? []), ...(page.items ?? [])]
            : page.items ?? [],
          total: page.total ?? 0,
          undated: page.undated ?? 0,
          unplaced: page.unplaced ?? 0,
          cursor: page.next_cursor ?? null,
          extent: page.extent ?? null,
        };
      }
      trackPages = nextPages;
      const unique = new Map();
      for (const page of Object.values(nextPages)) {
        for (const item of page.items ?? []) unique.set(item.id, item);
      }
      items = [...unique.values()];
      total = Object.values(nextPages).reduce((sum, page) => sum + (page.total ?? 0), 0);
      undatedTotal = Object.values(nextPages).reduce((sum, page) => sum + (page.undated ?? 0), 0);
      unplacedTotal = Object.values(nextPages).reduce((sum, page) => sum + (page.unplaced ?? 0), 0);
      cursor = Object.values(nextPages).some((page) => page.cursor) ? 'more' : null;
      const extents = Object.values(nextPages).map((page) => page.extent).filter((value) => value?.from);
      extent = extents.length ? {
        from: extents.map((value) => value.from).sort()[0],
        to: extents.map((value) => value.to).sort().at(-1),
      } : extent;
      if (!from && !to && extent?.from) ({ from, to } = initialWindow(extent));
      if (pendingSelection) {
        selected = items.find((item) => item.id === pendingSelection.id)
          ?? pendingSelection.fallback
          ?? null;
        pendingSelection = null;
      } else if (selected) {
        selected = items.find((item) => item.id === selected.id) ?? null;
      }
    } catch (error) {
      if (mine === seq) toast(error.message, 'danger');
    } finally {
      if (mine === seq) loading = false;
    }
  }

  async function loadOverview() {
    const caseId = caseState.current?.id;
    if (!caseId || !activeCategories.length || snapshotReading) return;
    const targets = trackSpecs;
    if (!targets.length) return;
    const mine = ++overviewSeq;
    try {
      let pages = await Promise.all(targets.map((track) =>
        api.get(`/api/cases/${caseId}/timeline?${overviewQuery(track)}`)
      ));
      if (mine !== overviewSeq) return;
      let page = mergeOverviewPages(pages);
      // The first reading is by year, which is only ever asked to report the extent:
      // how finely the case can be cut is a question about the span, and the span is
      // what that reading answers.
      const finer = densityUnit(page.extent, overviewWidth);
      if (finer !== 'year') {
        pages = await Promise.all(targets.map((track) =>
          api.get(`/api/cases/${caseId}/timeline?${overviewQuery(track, { densityBucket: finer })}`)
        ));
        if (mine !== overviewSeq) return;
        page = mergeOverviewPages(pages);
      }
      overview = page.buckets ?? [];
      overviewTruncated = Boolean(page.buckets_truncated);
      extent = page.extent ?? null;
    } catch {
      if (mine === overviewSeq) overview = [];
    }
  }

  function snapshotBuckets(rows) {
    const datedRows = rows.filter((item) => item.earliest);
    if (!datedRows.length) return [];
    // Cut by the same rule the server is asked for, so a frozen reading and the live
    // one it was taken from draw the same histogram.
    const width = { hour: 13, day: 10, month: 7, year: 4 }[densityUnit({
      from: datedRows.map((item) => item.earliest).sort()[0],
      to: datedRows.map((item) => item.latest ?? item.earliest).sort().at(-1),
    }, overviewWidth)];
    const grouped = new Map();
    for (const item of datedRows) {
      const start = item.earliest.slice(0, width);
      const bucket = grouped.get(start)
        ?? { start, count: 0, categories: {}, first: item.earliest, last: item.latest ?? item.earliest };
      bucket.count += 1;
      bucket.categories[item.category] = (bucket.categories[item.category] ?? 0) + 1;
      // The same inner span the server reports beside its counts, so a frozen reading
      // draws its bars across the days its entries are on, exactly as a live one does.
      if (item.earliest < bucket.first) bucket.first = item.earliest;
      const reach = item.latest ?? item.earliest;
      if (reach > bucket.last) bucket.last = reach;
      grouped.set(start, bucket);
    }
    return [...grouped.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  function captureAnalysisView() {
    return {
      version: 1,
      query: { filter: {}, terms: {}, label: '' },
      timeline: {
        from: from || null,
        to: to || null,
        timezone: zone,
        zone_choice: zoneChoice,
        view_mode: viewMode,
        group_by: groupBy,
        visible_categories: activeCategories,
        tracks: trackSpecs,
        entity: entityFilter,
      },
    };
  }

  /**
   * The axis as a page, for the export dialog.
   *
   * The window, the tracks and the clock are the ones on screen — the plate reads what the
   * analyst is on, never a second answer about it. The *geometry* is the plate's own: the
   * ruler and the lanes are laid out at `PLATE_PLOT`, because both are packed in pixels
   * and reusing the browser's width would make the page depend on the size of the window
   * it was exported from.
   */
  function capturePlate() {
    if (!axisWindow) return null;
    const view = timelineViews.activeView?.name ?? '';
    const at = new Date().toISOString();
    const page = timelinePlate({
      meta: {
        caseName: caseState.current?.name ?? '',
        surface: 'Timeline',
        view,
        title: 'Timeline',
        question: entityFilter ? `Scoped to ${entityFilter.label}` : '',
        window: windowWords(from, to, zone),
        clock: zoneWord,
        // What the axis cannot hold is stated rather than left out silently.
        aside: undatedTotal
          ? `${undatedTotal} undated entr${undatedTotal === 1 ? 'y' : 'ies'} are not on this axis`
          : '',
        at,
      },
      tracks: buildTracks(PLATE_PLOT),
      ticks: axisTicks(from, to, PLATE_PLOT, zone),
      minorTicks: axisMinorTicks(from, to, PLATE_PLOT, zone),
      bands: axisBands(from, to, PLATE_PLOT, zone),
      nowLeft,
      scaleWord: axisScale(from, to, PLATE_PLOT),
      clock: zoneWord,
    });
    return {
      ...page,
      filename: plateFilename({ surface: 'timeline', view, lens: windowWords(from, to, 'UTC'), at }),
    };
  }

  function openRangeIn(tool) {
    if (!caseState.current?.id || !axisWindow) return;
    const period = { from, to, categories: activeCategories };
    if (tool === 'board' || tool === 'graph') {
      setAnalysisPeriod(caseState.current.id, period);
    }
    if (tool === 'graph') {
      uiState.drawInGraph = {
        label: `Fact time · ${windowWords(from, to, 'UTC')}`,
      };
    } else if (tool === 'satellite') {
      uiState.mapTimelineRange = { from, to, categories: activeCategories };
    }
    uiState.tool = tool;
    rangeMenu = false;
  }

  async function applyTimelineView(view) {
    if (!view) return;
    const state = timelineViewState(view.spec?.timeline);
    from = state.from;
    to = state.to;
    viewMode = state.viewMode;
    groupBy = state.groupBy;
    zoneChoice = state.zoneChoice;
    trackSpecs = state.tracks;
    entityFilter = state.entity;
    selected = null;
    selectedTrackId = null;
    expandedTracks = {};
    if (view.mode !== 'snapshot') {
      trackPages = {};
      items = [];
      return;
    }
    const captured = view.spec?.snapshot?.timeline_items ?? [];
    const byId = new Map(captured.map((item) => [item.id, item]));
    const assignments = view.spec?.snapshot?.timeline_tracks ?? {};
    trackPages = Object.fromEntries(state.tracks.map((track) => {
      const ids = assignments[track.id] ?? [];
      const rows = ids.map((id) => byId.get(id)).filter(Boolean);
      return [track.id, {
        items: rows,
        total: rows.length,
        undated: rows.filter((item) => !item.raw).length,
        unplaced: rows.filter((item) => item.raw && !item.earliest).length,
        cursor: null,
        extent: null,
      }];
    }));
    items = captured;
    total = Object.values(trackPages).reduce((sum, page) => sum + page.total, 0);
    undatedTotal = Object.values(trackPages).reduce((sum, page) => sum + page.undated, 0);
    unplacedTotal = Object.values(trackPages).reduce((sum, page) => sum + page.unplaced, 0);
    cursor = null;
    const datedRows = captured.filter((item) => item.earliest);
    extent = datedRows.length ? {
      from: datedRows.map((item) => item.earliest).sort()[0],
      to: datedRows.map((item) => item.latest).sort().at(-1),
    } : null;
    overview = snapshotBuckets(Object.values(trackPages).flatMap((page) => page.items));
    overviewTruncated = false;
  }

  async function openAnalysisView(view) {
    appliedViewId = view.id;
    await applyTimelineView(view);
  }

  async function leaveAnalysisReading() {
    selected = null;
    selectedTrackId = null;
    trackPages = {};
    items = [];
    trackSpecs = defaultTimelineTracks();
    groupBy = 'none';
    zoneChoice = 'utc';
    from = '';
    to = '';
    entityFilter = null;
  }

  let appliedViewId = null;
  $effect(() => {
    const view = timelineViews.activeView;
    if (!view) {
      appliedViewId = null;
      return;
    }
    if (view.id === appliedViewId) return;
    appliedViewId = view.id;
    untrack(() => void applyTimelineView(view));
  });

  let observedLiveView = null;
  let observedLiveState = '';
  $effect(() => {
    const view = timelineViews.activeView;
    const current = JSON.stringify(captureAnalysisView().timeline);
    if (!view || view.mode !== 'live') {
      observedLiveView = null;
      observedLiveState = '';
      return;
    }
    const saved = JSON.stringify(timelineViewState(view.spec?.timeline));
    const comparable = JSON.stringify({
      from, to, timezone: zone, zoneChoice, viewMode, groupBy,
      tracks: normalizeTimelineTracks(trackSpecs),
      categories: activeCategories,
      entity: entityFilter,
    });
    if (observedLiveView !== view.id) {
      observedLiveView = view.id;
      observedLiveState = current;
    } else if (current !== observedLiveState) {
      observedLiveState = current;
      timelineViews.changeVersion += 1;
    }
    timelineViews.modified = comparable !== saved;
  });

  $effect(() => {
    const caseId = caseState.current?.id;
    caseState.rev;
    const chosen = activeCategories.join(',');
    const scoped = entityFilter?.id ?? '';
    const first = from;
    const last = to;
    const navigating = navigationBusy;
    const recipe = JSON.stringify(trackSpecs.map((track) => ({
      id: track.id, categories: track.categories, query: track.query, hidden: track.hidden,
    })));
    if (caseId !== loadedCase) {
      loadedCase = caseId;
      openAnalysisCase(caseId);
      from = '';
      to = '';
      items = [];
      trackSpecs = defaultTimelineTracks();
      trackPages = {};
      groupBy = 'none';
      zoneChoice = 'utc';
      selected = null;
      pendingSelection = null;
      cursor = null;
      expandedTracks = {};
    }
    if (!caseId || !chosen || navigating || snapshotReading) return;
    untrack(() => void loadMain());
    void scoped; void first; void last; void recipe;
  });

  $effect(() => {
    const caseId = caseState.current?.id;
    caseState.rev;
    const chosen = activeCategories.join(',');
    const scoped = entityFilter?.id ?? '';
    if (!caseId || !chosen || snapshotReading) return;
    untrack(() => void loadOverview());
    void scoped;
  });

  /**
   * The case's saved points, for the local-time menu. One bounded page, and only
   * once per case: this is a menu of reference points, not a list of the case.
   */
  $effect(() => {
    const caseId = caseState.current?.id;
    if (!caseId || snapshotReading) {
      places = [];
      return;
    }
    let live = true;
    api
      .get(buildCatalogQuery(caseId, { types: ['place'], limit: 50 }))
      .then((page) => {
        if (!live || caseState.current?.id !== caseId) return;
        places = (page.items ?? [])
          .filter((entity) => Number.isFinite(Number(entity.attrs?.lat)))
          .map((entity) => ({
            id: entity.id,
            label: entity.label,
            lat: Number(entity.attrs.lat),
            lon: Number(entity.attrs.lon),
          }));
      })
      .catch(() => {
        if (live) places = [];
      });
    return () => {
      live = false;
    };
  });

  /** A point no longer in the case cannot go on labelling the axis. */
  $effect(() => {
    if (zoneChoice.startsWith('place:') && places.length && !sunPlace) zoneChoice = 'utc';
  });

  /**
   * When it was light at the chosen point, over the window on screen.
   *
   * Read on the window because that is what it draws, and the reply carries the
   * point's own civil zone — so picking a point answers both questions in one call.
   * A window wider than the server's bound comes back cut and says so, rather than
   * costing a second to draw a moiré of day and night stripes.
   */
  $effect(() => {
    const place = sunPlace;
    if (!place || !from || !to) {
      daylight = null;
      daylightLoading = false;
      return;
    }
    const mine = ++daylightSeq;
    daylightLoading = true;
    const params = new URLSearchParams({
      lat: String(place.lat), lon: String(place.lon), from, to,
    });
    const timer = setTimeout(() => {
      api
        .get(`/api/geo/daylight?${params}`)
        .then((body) => {
          if (mine === daylightSeq) daylight = body;
        })
        .catch(() => {
          if (mine === daylightSeq) daylight = null;
        })
        .finally(() => {
          if (mine === daylightSeq) daylightLoading = false;
        });
    }, 180);
    return () => clearTimeout(timer);
  });

  /**
   * Take the entry another surface asked to open.
   *
   * The load that a changed window or scope starts is what usually resolves it. When
   * nothing about the reading changed — the Map handing back the very window it was
   * given — no load follows, and a selection waiting for one would never arrive. What
   * is already drawn answers in that case.
   */
  function handOverSelection(itemId) {
    const held = itemId ? items.find((item) => item.id === itemId) : null;
    selected = held ?? selected;
    pendingSelection = itemId && !held ? { id: itemId } : null;
  }

  $effect(() => {
    const range = uiState.timelineRange;
    if (!range) return;
    uiState.timelineRange = null;
    if (!windowMillis(range.from, range.to)) return;
    from = range.from;
    to = range.to;
    handOverSelection(range.itemId);
  });

  $effect(() => {
    const focus = uiState.timelineFocus;
    if (!focus) return;
    entityFilter = { id: focus.entityId, label: focus.entityLabel || 'Selected entity' };
    selected = null;
    handOverSelection(focus.itemId);
    from = '';
    to = '';
    uiState.timelineFocus = null;
  });

  $effect(() => {
    const caseId = caseState.current?.id;
    const ownerId = selected?.owner_id;
    caseState.rev;
    if (!caseId || !ownerId || snapshotReading) {
      inspectorChain = null;
      inspectorLoading = false;
      return;
    }
    const mine = ++inspectorSeq;
    inspectorLoading = true;
    api.get(`/api/cases/${caseId}/entities/${ownerId}/chain`)
      .then((chain) => { if (mine === inspectorSeq) inspectorChain = chain; })
      .catch(() => { if (mine === inspectorSeq) inspectorChain = null; })
      .finally(() => { if (mine === inspectorSeq) inspectorLoading = false; });
  });

  function setBoundary(which, value) {
    // The control holds a wall clock, and which instant that names depends on the
    // zone the axis is being read in.
    const next = inputWindowValue(value, zone);
    if (!next) return;
    if (which === 'from') from = next;
    else to = next;
  }

  function pan(fraction) {
    // A menu opened on an entry names a spot the axis is about to move out from under.
    itemMenu = null;
    ({ from, to } = shiftWindow(from, to, fraction));
  }

  function zoom(factor, anchor = .5) {
    itemMenu = null;
    ({ from, to } = zoomWindow(from, to, factor, anchor));
  }

  function finishWheelNavigation() {
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => (navigationBusy = false), 140);
  }

  function navigateWheel(event) {
    if (!axisWindow) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * .35;
    event.preventDefault();
    navigationBusy = true;
    itemMenu = null;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!event.shiftKey && !horizontal) {
      const anchor = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const delta = Math.max(-120, Math.min(120, event.deltaY));
      ({ from, to } = zoomWindow(from, to, Math.exp(delta * .0025), anchor));
    } else {
      const delta = horizontal ? event.deltaX : event.deltaY;
      ({ from, to } = shiftWindow(from, to, delta / Math.max(1, rect.width)));
    }
    finishWheelNavigation();
  }

  function navigateKey(event) {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', '+', '=', '-', '_', 'Home'].includes(key)) return;
    event.preventDefault();
    if (key === 'ArrowLeft') pan(-.1);
    else if (key === 'ArrowRight') pan(.1);
    else if (key === 'PageUp') pan(-.7);
    else if (key === 'PageDown') pan(.7);
    else if (key === '+' || key === '=') zoom(.5);
    else if (key === '-' || key === '_') zoom(2);
    else showAll();
  }

  function panStart(event) {
    if (event.button !== 0 || !axisWindow) return;
    event.preventDefault();
    navigationBusy = true;
    const rect = event.currentTarget.getBoundingClientRect();
    panning = { pointer: event.pointerId, startX: event.clientX, from, to, width: rect.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function showAll() {
    ({ from, to } = initialWindow(extent));
  }

  /** What a track is a reading of, for its hover: the name, then the question that
   *  filled it, so a lane of eleven events can be told from the twelve beside it. */
  function trackTitle(track) {
    const words = track.categories
      .map((category) => TIMELINE_CATEGORIES.find((entry) => entry.id === category)?.short ?? category)
      .join(' · ');
    const asked = track.query?.label?.trim();
    return [track.label, [words, asked || 'the whole case'].join(' · ')].join('\n');
  }

  /** A span asked for by name. Absolute where a zoom step is relative: "Week" is the
   *  thing wanted, and pressing minus four times is counting. */
  function setSpan(span) {
    ({ from, to } = resizeWindow(from, to, span));
  }

  function expandTrack(id, expanded = true) {
    expandedTracks = { ...expandedTracks, [id]: expanded };
  }

  function addPreset(preset) {
    const duplicate = copyTimelineTrack(preset, trackSpecs);
    const used = trackSpecs.some((track) => track.label.toLocaleLowerCase() === preset.label.toLocaleLowerCase());
    trackSpecs = [...trackSpecs, { ...duplicate, label: used ? duplicate.label : preset.label }];
    trackMenu = false;
  }

  function saveTrack(track) {
    if (trackEditor?.mode === 'edit') {
      trackSpecs = trackSpecs.map((entry) => entry.id === trackEditor.track.id ? { ...track, id: entry.id } : entry);
    } else {
      const created = copyTimelineTrack(track, trackSpecs);
      trackSpecs = [...trackSpecs, { ...created, label: track.label }];
    }
    trackEditor = null;
  }

  function duplicateTrack(id) {
    const index = trackSpecs.findIndex((track) => track.id === id);
    if (index < 0) return;
    const next = copyTimelineTrack(trackSpecs[index], trackSpecs);
    trackSpecs = [...trackSpecs.slice(0, index + 1), next, ...trackSpecs.slice(index + 1)];
  }

  function removeTrack(id) {
    if (trackSpecs.length === 1) return;
    trackSpecs = trackSpecs.filter((track) => track.id !== id);
    if (selectedTrackId === id) {
      selectedTrackId = null;
      selected = null;
    }
  }

  function setTrackCollapsed(id, collapsed) {
    trackSpecs = trackSpecs.map((track) => track.id === id ? { ...track, collapsed } : track);
  }

  function dropTrack(targetId) {
    const fromIndex = trackSpecs.findIndex((track) => track.id === draggedTrack);
    const toIndex = trackSpecs.findIndex((track) => track.id === targetId);
    trackSpecs = moveTimelineTrack(trackSpecs, fromIndex, toIndex);
    draggedTrack = null;
  }

  /**
   * The track an entry is being read in: the lane it was clicked in, or failing that
   * the first lane that holds it.
   *
   * Both lane acts need it, and they are reached from three places — the inspector,
   * the entry menu, and the list view, where nothing says which lane a row came from.
   */
  function trackHolding(item, trackId = null) {
    const id = trackId ?? trackSpecs.find((track) =>
      (baseTrackItems[track.id] ?? []).some((entry) => entry.id === item.id)
    )?.id ?? null;
    return trackSpecs.find((track) => track.id === id) ?? null;
  }

  function togglePinned(item = selected, track = selectedTrack) {
    if (!track || !item) return;
    const pinned = track.pinned.includes(item.id)
      ? track.pinned.filter((id) => id !== item.id)
      : [...track.pinned, item.id];
    trackSpecs = trackSpecs.map((entry) => entry.id === track.id ? { ...entry, pinned } : entry);
  }

  function hideFromTrack(item = selected, track = selectedTrack) {
    if (!track || !item) return;
    const hidden = [...new Set([...track.hidden, item.id])];
    trackSpecs = trackSpecs.map((entry) => entry.id === track.id
      ? { ...entry, hidden, pinned: entry.pinned.filter((id) => id !== item.id) }
      : entry
    );
    // What is no longer drawn cannot go on being the entry the panel is about, nor
    // the second half of a measurement.
    if (selected?.id === item.id) {
      selected = null;
      selectedTrackId = null;
    }
    if (against?.id === item.id) against = null;
  }

  function restoreHidden(id) {
    trackSpecs = trackSpecs.map((track) => track.id === id ? { ...track, hidden: [] } : track);
  }

  /**
   * A click selects; **Ctrl-click holds a second entry against the first**, and the
   * panel measures between them.
   *
   * The modifier rather than a mode, because measuring is something an analyst does
   * *while* reading one entry — a "compare" button would be a state to enter, leave
   * and forget you were in. Ctrl-clicking the held entry again lets it go.
   */
  function selectItem(item, trackId = null, event = null) {
    if ((event?.ctrlKey || event?.metaKey) && selected && selected.id !== item.id) {
      against = against?.id === item.id ? null : item;
      return;
    }
    selected = item;
    against = null;
    selectedTrackId = trackHolding(item, trackId)?.id ?? null;
  }

  /**
   * What can be done with an entry, said where the pointer is.
   *
   * The inspector already names these four acts, and every one of them cost a
   * selection first: reading a lane meant clicking an entry, losing the entry the
   * panel was on and any pair being measured with it. The menu asks nothing of the
   * selection — right-clicking an entry is a question about it, not a choice of it.
   */
  function openItemMenu(event, item, trackId = null) {
    // On macOS this same press is the Ctrl-click that holds a second entry against
    // the first. One press, one act.
    if (event.ctrlKey && event.button === 0) return;
    event.preventDefault();
    event.stopPropagation();
    tooltip = null;
    itemMenu = {
      item,
      track: trackHolding(item, trackId),
      x: Math.min(window.innerWidth - 206, event.clientX),
      y: Math.min(window.innerHeight - 186, event.clientY),
    };
  }

  /**
   * Run a menu item against the entry the menu is about, then close it.
   *
   * The entry is read *before* the menu is cleared: closing it first destroys what
   * the markup read the entry from, and the act then runs on nothing.
   */
  function fromItemMenu(act) {
    const held = itemMenu;
    itemMenu = null;
    if (held) act(held.item, held.track);
  }

  async function toggleFullscreen() {
    if (!toolElement || typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await toolElement.requestFullscreen();
    } catch {
      toast('Full screen is not available', 'danger');
    }
  }

  function openBucket(bucket) {
    const range = bucketWindow(bucket);
    if (range) ({ from, to } = range);
  }

  function openEditor(item = null, when = '', options = {}) {
    if (snapshotReading) return;
    editor = { item, when, ...options };
  }

  function addMediaCorrection() {
    if (!inspectorChain?.entity) return;
    openEditor(null, selected?.raw ?? '', {
      subject: inspectorChain.entity,
      statement: 'This media was captured',
      role: 'observed',
    });
  }

  async function editorSaved(saved) {
    editor = null;
    pendingSelection = saved.temporal ? { id: saved.temporal.id, fallback: saved.temporal } : null;
    await reloadCase();
  }

  let drawing = $state(null);
  function drawStart(event, trackId) {
    const track = trackSpecs.find((entry) => entry.id === trackId);
    if (
      snapshotReading || !track?.categories.includes('statement') ||
      event.button !== 0 || event.target.closest('button')
    ) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    drawing = { pointer: event.pointerId, trackId, start: ratio, end: ratio, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function createFromKeyboard() {
    openEditor(null, draftWhen(from, to, .5, .5));
  }

  /** The instants the minimap spans — the bars', so a drag lands where it looks. */
  function overviewExtent() {
    return densityScale(overview, extent);
  }

  function applyOverviewWindow(left, right) {
    const full = overviewExtent();
    if (!full) return;
    const low = Math.max(0, Math.min(.999, left));
    const high = Math.min(1, Math.max(low + Math.max(.002, 2_000 / full.span), right));
    from = isoInstant(full.first + full.span * low);
    to = isoInstant(full.first + full.span * high);
  }

  function beginOverview(event, mode) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.closest('.density-bars').getBoundingClientRect();
    overviewGesture = {
      pointer: event.pointerId, mode, startX: event.clientX, rect,
      left: overviewWindow.left / 100, right: (overviewWindow.left + overviewWindow.width) / 100,
      moved: false,
    };
    navigationBusy = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function overviewRecenter(event) {
    if (event.target.closest('.overview-window') || !axisWindow) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const center = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const width = overviewWindow.width / 100;
    applyOverviewWindow(center - width / 2, center + width / 2);
  }

  function overviewKey(event, mode) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -.02 : .02;
    const left = overviewWindow.left / 100;
    const right = (overviewWindow.left + overviewWindow.width) / 100;
    if (mode === 'move') applyOverviewWindow(left + delta, right + delta);
    else if (mode === 'start') applyOverviewWindow(left + delta, right);
    else applyOverviewWindow(left, right + delta);
  }

  function pointerMove(event) {
    if (overviewGesture?.pointer === event.pointerId) {
      const gesture = overviewGesture;
      const delta = (event.clientX - gesture.startX) / Math.max(1, gesture.rect.width);
      gesture.moved ||= Math.abs(event.clientX - gesture.startX) > 2;
      if (gesture.mode === 'move') {
        const width = gesture.right - gesture.left;
        const left = Math.max(0, Math.min(1 - width, gesture.left + delta));
        applyOverviewWindow(left, left + width);
      } else if (gesture.mode === 'start') applyOverviewWindow(gesture.left + delta, gesture.right);
      else applyOverviewWindow(gesture.left, gesture.right + delta);
      return;
    }
    if (panning?.pointer === event.pointerId) {
      const fraction = -(event.clientX - panning.startX) / Math.max(1, panning.width);
      ({ from, to } = shiftWindow(panning.from, panning.to, fraction));
      return;
    }
    if (drawing?.pointer === event.pointerId) {
      drawing.end = Math.min(1, Math.max(0, (event.clientX - drawing.rect.left) / drawing.rect.width));
      return;
    }
    if (moving?.pointer === event.pointerId) moving.currentX = event.clientX;
  }

  function pointerUp(event) {
    if (overviewGesture?.pointer === event.pointerId) {
      overviewGesture = null;
      navigationBusy = false;
      return;
    }
    if (panning?.pointer === event.pointerId) {
      panning = null;
      navigationBusy = false;
      return;
    }
    if (drawing?.pointer === event.pointerId) {
      const draft = drawing;
      drawing = null;
      openEditor(null, draftWhen(from, to, draft.start, draft.end));
      return;
    }
    if (!moving || moving.pointer !== event.pointerId) return;
    const edit = moving;
    moving = null;
    const ratio = Math.min(1, Math.max(0, (event.clientX - edit.rect.left) / edit.rect.width));
    let raw = null;
    if (edit.mode === 'move') {
      const delta = ((event.clientX - edit.startX) / edit.rect.width) * axisWindow.span;
      raw = moveTemporalRaw(edit.item, delta);
    } else {
      const value = edit.item.raw.includes('T')
        ? timeAtRatio(from, to, ratio)
        : dateAtRatio(from, to, ratio);
      raw = resizeTemporalRaw(edit.item, edit.mode, value);
    }
    if (raw && raw !== edit.item.raw) pendingEdit = { item: edit.item, raw };
  }

  let moving = $state(null);
  let pendingEdit = $state(null);
  let directSaving = $state(false);
  function beginMove(event, item, mode = 'move') {
    // The right button asks what can be done with the entry. Without this, opening
    // that menu on the selected entry also armed a drag of its date.
    if (snapshotReading || event.button !== 0) return;
    event.stopPropagation();
    const rect = event.currentTarget.closest('.track-canvas').getBoundingClientRect();
    moving = { pointer: event.pointerId, item, mode, startX: event.clientX, currentX: event.clientX, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function keyboardEdit(event, item, mode) {
    if (snapshotReading) return;
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const raw = nudgeTemporalRaw(item, mode, event.key === 'ArrowLeft' ? -1 : 1);
    if (raw && raw !== item.raw) pendingEdit = { item, raw };
  }

  async function confirmDirectEdit() {
    if (!pendingEdit || directSaving) return;
    directSaving = true;
    try {
      await api.patch(
        `/api/cases/${caseState.current.id}/timeline/claims/${pendingEdit.item.owner_id}`,
        { when: pendingEdit.raw }
      );
      pendingEdit = null;
      await reloadCase();
      toast('Time assessment updated', 'ok', 1600);
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      directSaving = false;
    }
  }

  function categoryName(item) {
    return TIMELINE_CATEGORIES.find((entry) => entry.id === item.category)?.label ?? item.category;
  }

  function unplacedReason(item) {
    if (item.parse_error) return item.parse_error;
    if (item.zone === 'local') return 'Timezone needed';
    return 'Needs review';
  }

  function showItemTooltip(event, item) {
    const reading = formatTemporalValue(item.raw ?? '');
    tooltip = {
      x: Math.min(window.innerWidth - 286, event.clientX + 12),
      y: Math.min(window.innerHeight - 132, event.clientY + 12),
      title: item.label,
      date: reading.label,
      detail: [categoryName(item), item.time_role, item.confidence].filter(Boolean).join(' · '),
    };
  }

  function showFocusedTooltip(event, item) {
    const rect = event.currentTarget.getBoundingClientRect();
    showItemTooltip({ clientX: rect.right, clientY: rect.top }, item);
  }

  function showBucketTooltip(event, bucket) {
    const parts = TIMELINE_CATEGORIES
      .map((category) => bucket.categories?.[category.id] ? `${category.short} ${bucket.categories[category.id]}` : '')
      .filter(Boolean)
      .join(' · ');
    tooltip = {
      x: Math.min(window.innerWidth - 286, event.clientX + 12),
      y: Math.min(window.innerHeight - 110, event.clientY + 12),
      title: bucket.start,
      date: `${bucket.count} ${bucket.count === 1 ? 'entry' : 'entries'}`,
      detail: parts,
    };
  }

</script>

<svelte:window
  onpointermove={pointerMove}
  onpointerup={pointerUp}
  onkeydown={(event) => { if (event.key === 'Escape' && itemMenu) itemMenu = null; }}
/>

<div class="timeline-tool" class:fullscreen bind:this={toolElement}>
  <header class="timeline-head">
    <!-- Titled the way every other tool is (`app.css .tool-header`): the name, then
         one clause saying what is on screen. It used to carry a second title over the
         first in accent capitals, which said the same word twice. -->
    <div class="title-block">
      <h2>Timeline</h2>
      <span class="sub">{total} {total === 1 ? 'entry' : 'entries'} across tracks</span>
    </div>

    <!-- The window, read rather than spelled out in controls. Two date boxes, four
         icons and an All button were seven things on the toolbar for one fact; the
         boundaries are typed rarely and checked constantly, so the reading is what
         stays out and the rest opens under it. Panning keeps its arrows because
         stepping through a chronology is the frequent move. -->
    <div class="range" bind:this={rangeElement}>
      <button class="range-step" title="Earlier" aria-label="Earlier" onclick={() => pan(-.7)} disabled={!axisWindow}>
        <Icon name="chevronLeft" size={15} />
      </button>
      <button class="range-face" aria-expanded={rangeMenu} onclick={() => (rangeMenu = !rangeMenu)}>
        {windowWords(from, to, zone)}
      </button>
      <button class="range-step" title="Later" aria-label="Later" onclick={() => pan(.7)} disabled={!axisWindow}>
        <Icon name="chevronRight" size={15} />
      </button>
      {#if rangeMenu}
        <div class="range-menu">
          <label>
            From
            <input class="input input-sm mono" type="datetime-local" step="1" value={windowInputValue(from, zone)} onchange={(event) => setBoundary('from', event.currentTarget.value)} />
          </label>
          <label>
            To
            <input class="input input-sm mono" type="datetime-local" step="1" value={windowInputValue(to, zone)} onchange={(event) => setBoundary('to', event.currentTarget.value)} />
          </label>
          <div class="range-spans" role="group" aria-label="Window span">
            {#each WINDOW_SPANS as span (span.label)}
              <button onclick={() => setSpan(span.ms)} disabled={!axisWindow}>{span.label}</button>
            {/each}
            <button onclick={() => { showAll(); rangeMenu = false; }} disabled={!extent?.from}>All</button>
          </div>
        </div>
      {/if}
    </div>

    <div class="head-actions">
      <AnalysisViews
        surface="timeline"
        capture={captureAnalysisView}
        onopen={openAnalysisView}
        onleave={leaveAnalysisReading}
      />
      <PlateExport surface="timeline" plate={capturePlate} disabled={!caseState.current} />
      <button class="btn btn-ghost fullscreen-btn" aria-pressed={fullscreen} onclick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
      <button class="btn btn-primary add-event" disabled={snapshotReading} onclick={() => openEditor()}><Icon name="plus" size={13} />Add assessment</button>
    </div>
  </header>

  <div class="filter-row">
    {#if entityFilter}
      <button class="scope-chip" disabled={snapshotReading} title="Clear entity filter" onclick={() => { entityFilter = null; from = ''; to = ''; }}>
        <Icon name="crosshair" size={11} /><span>{entityFilter.label}</span><Icon name="x" size={10} />
      </button>
    {/if}
    <div class="view-switch" aria-label="Timeline display">
      <button class:active={viewMode === 'plot'} aria-pressed={viewMode === 'plot'} onclick={() => (viewMode = 'plot')}>Plot</button>
      <button class:active={viewMode === 'list'} aria-pressed={viewMode === 'list'} onclick={() => (viewMode = 'list')}>List</button>
    </div>
    <!-- Which clock the axis is read on. Presentation only: the case stores UTC, the
         queries ask in UTC, and this moves the ticks and their words. A saved point
         also brings its daylight with it, since a band of day and night needs
         coordinates and there is no sense in asking for them twice. -->
    <ZonePicker
      bind:choice={zoneChoice}
      {places}
      at={axisWindow?.start ?? 0}
      resolved={zone}
      disabled={snapshotReading}
    />
    <details class="legend" bind:this={legendElement} bind:open={legendOpen}>
      <summary>Legend</summary>
      <div class="legend-card">
        <strong>Date quality</strong>
        <span><i class="sample approximate"></i>Approximate date</span>
        <span><i class="sample uncertain"></i>Uncertain date</span>
        <strong>Assessment</strong>
        <span><i class="sample suggested"></i>Suggested status</span>
        <span><i class="sample refuted"></i>Refuted confidence</span>
        <p>Confidence and date quality are independent.</p>
      </div>
    </details>
    <span class="utc-readout">{scaleLabel} · Wheel zoom · Shift-wheel pan</span>
  </div>

  <div class="track-toolbar">
    <div class="track-add" bind:this={trackMenuElement}>
      <button class="btn btn-sm" aria-expanded={trackMenu} disabled={snapshotReading || trackSpecs.length >= 20} onclick={() => (trackMenu = !trackMenu)}>
        <Icon name="plus" size={12} /> Track
      </button>
      {#if trackMenu}
        <div class="track-menu">
          <strong>Add a track</strong>
          {#each trackPresets(entityTypes()) as preset (preset.id)}
            <button onclick={() => addPreset(preset)}><span>{preset.label}</span><small>{preset.categories.map((category) => category === 'case_activity' ? 'activity' : category).join(' · ')}</small></button>
          {/each}
          <button class="custom" onclick={() => { trackEditor = { mode: 'new' }; trackMenu = false; }}>
            <span>Custom</span><small>Build with Search+</small>
          </button>
        </div>
      {/if}
    </div>
    <label>Group by
      <select class="input input-sm" bind:value={groupBy} disabled={snapshotReading}>
        <option value="none">None</option>
        <option value="subject">Subject</option>
        <option value="type">Type</option>
        <option value="place">Place</option>
        <option value="source">Evidence</option>
        <option value="role">Time role</option>
      </select>
    </label>
    <span>{trackSpecs.length} {trackSpecs.length === 1 ? 'track' : 'tracks'}</span>
    {#if snapshotReading}<em>Frozen view</em>{/if}

    <!-- Asking the same period of the other three surfaces is the point of having a
         period, so the handoff stays in the open rather than under the window's
         boundaries: the window is set rarely and handed over often. It ends the track
         row instead of trailing the window, which left six controls fighting for the
         middle of the header for one fact. -->
    <div class="range-handoffs" role="group" aria-label="Open range">
      <span>Open in</span>
      <button onclick={() => openRangeIn('board')} disabled={!axisWindow}>Board</button>
      <button onclick={() => openRangeIn('graph')} disabled={!axisWindow}>Graph</button>
      <button onclick={() => openRangeIn('satellite')} disabled={!axisWindow}>Map</button>
    </div>
  </div>

  <div class="timeline-grid">
    <main class="chronology">
      {#if !caseState.current}
        <div class="blank-state"><Icon name="clock" size={24} /><h2>Open a case to build its timeline.</h2></div>
      {:else if !extent?.from && !loading}
        <div class="blank-state">
          <Icon name="clock" size={24} />
          <h2>No dated entries yet</h2>
          <p>Add a time assessment here or from an entity's Time tab.</p>
          <button class="btn btn-primary" disabled={snapshotReading} onclick={() => openEditor()}>Add first assessment</button>
        </div>
      {:else}
        <section class="overview-card" aria-label="Timeline overview">
          <div class="overview-title">
            <span>Overview</span>
            <!-- The extent in words rather than the first and last bucket keys, which
                 read as `2026-08-02T03` the moment the case is cut by the hour. -->
            <small>{extent?.from ? windowWords(extent.from, extent.to, 'UTC') : 'No dated entries'}</small>
            {#if overview.length}<small>{overviewUnit} buckets · exact counts on hover</small>{/if}
            <div class="overview-counts">
              {#if unplacedTotal}<span>{unplacedTotal} local</span>{/if}
              {#if undatedTotal}<span>{undatedTotal} undated</span>{/if}
            </div>
            {#if overviewTruncated}<small class="capped">Partial overview</small>{/if}
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="density-bars" role="application" tabindex="0" aria-label="Timeline minimap" bind:clientWidth={overviewWidth} onclick={overviewRecenter} onkeydown={navigateKey}>
            {#each overviewTicks as slot (slot.key)}
              {#if slot.label && slot.left > 0}
                <span class="overview-rule" style:left={`${slot.left}%`}></span>
              {/if}
            {/each}
            {#each density as bucket (bucket.start)}
              <button
                class="density-bucket"
                aria-label={`${bucket.start}, ${bucket.count} entries`}
                style:left={`${bucket.left}%`}
                style:width={`${bucket.width}%`}
                onclick={(event) => { event.stopPropagation(); openBucket(bucket); }}
                onpointerenter={(event) => showBucketTooltip(event, bucket)}
                onpointermove={(event) => showBucketTooltip(event, bucket)}
                onpointerleave={() => (tooltip = null)}
              >
                <span class="density-stack" style:height={`${bucket.height}%`}>
                  {#each TIMELINE_CATEGORIES as category (category.id)}
                    {#if bucket.categories?.[category.id]}
                      <i class={category.id} style:flex-grow={bucket.categories[category.id]}></i>
                    {/if}
                  {/each}
                </span>
              </button>
            {/each}
            <span class="density-baseline"></span>
            {#each overviewTicks as slot (slot.key)}
              {#if slot.label}
                <span
                  class="overview-tick {slot.anchor}"
                  style:left={`${slot.left}%`}
                  style:width={`${slot.width}%`}
                >{slot.label}</span>
              {/if}
            {/each}
            <!-- What the axis is not showing, dimmed: the brush says where the window
                 is, and these say what it left out. -->
            <span class="overview-shade" style:left="0" style:width={`${overviewWindow.left}%`}></span>
            <span class="overview-shade" style:left={`${overviewWindow.left + overviewWindow.width}%`} style:right="0"></span>
            <div class="overview-window" style:left={`${overviewWindow.left}%`} style:width={`${overviewWindow.width}%`}>
              <button class="overview-drag" aria-label="Move visible range" title="Move visible range" onpointerdown={(event) => beginOverview(event, 'move')} onkeydown={(event) => overviewKey(event, 'move')}></button>
              <button class="overview-handle start" aria-label="Change range start" title="Change range start" onpointerdown={(event) => beginOverview(event, 'start')} onkeydown={(event) => overviewKey(event, 'start')}></button>
              <button class="overview-handle end" aria-label="Change range end" title="Change range end" onpointerdown={(event) => beginOverview(event, 'end')} onkeydown={(event) => overviewKey(event, 'end')}></button>
            </div>
          </div>
        </section>

        {#if viewMode === 'plot'}
          <section class="axis-card" aria-label="Timeline axis">
            <div class="axis-row">
              <div class="axis-label">
                <span>{zoneWord}</span>
                <small>{windowInputValue(from, zone).replace('T', ' ')} to {windowInputValue(to, zone).replace('T', ' ')}</small>
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="axis-ruler"
                class:panning={Boolean(panning)}
                bind:this={plotElement}
                role="application"
                tabindex="0"
                aria-label="Timeline ruler"
                onpointerdown={panStart}
                onwheel={navigateWheel}
                onkeydown={navigateKey}
              >
                <div class="axis-bands">
                  {#each bands as band (band.label + band.left)}
                    <span style:left={`${band.left}%`} style:width={`${band.width}%`}>{band.label}</span>
                  {/each}
                </div>
                {#each minorTicks as tick (tick.at)}<span class="axis-minor" style:left={`${tick.left}%`}></span>{/each}
                {#each ticks as tick (tick.at)}
                  <div class="axis-tick" class:end={tick.left > 94} style:left={`${tick.left}%`}><span>{tick.label}</span></div>
                {/each}
                {#if nowLeft !== null}<span class="now-line" style:left={`${nowLeft}%`}><small>Now</small></span>{/if}
                <!-- Day and night at the chosen point, on the same scale as the
                     entries above it: a stamp of 19:40 is argued against the light,
                     and the ribbon is where that argument becomes visible. Night is
                     the strip itself, twilight and day are laid over it. -->
                {#if sunPlace}
                  <div class="daylight" aria-hidden="true">
                    {#each twilightBands as band (band.key)}
                      <span class="twilight" style:left={`${band.left}%`} style:width={`${band.width}%`}></span>
                    {/each}
                    {#each daylightBands as band (band.key)}
                      <span class="day" style:left={`${band.left}%`} style:width={`${band.width}%`}></span>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            {#if sunPlace}
              <!-- What the ribbon is of, said next to it: a band of day and night
                   nobody can attribute to a point is decoration. -->
              <p class="daylight-note">
                Daylight at {sunPlace.label}{#if daylight?.zone?.name}, {zoneWord}{/if}.
                {#if daylightLoading}
                  Reading…
                {:else if daylight?.truncated}
                  Zoom in past a month to draw it.
                {:else if !daylightBands.length && !twilightBands.length}
                  Dark for the whole window.
                {/if}
              </p>
            {/if}

            {#each tracks as track (track.id)}
              {@const baseId = track.parentId ?? track.id}
              {@const canCreate = track.categories.includes('statement') && !snapshotReading}
              <div
                class="track-row"
                class:folded={track.collapsed}
                role="listitem"
                style:--track-tint={trackTint(track.color)}
                style:min-height={track.collapsed ? '42px' : `${Math.max(78, track.layout.rows * 46 + 28)}px`}
                ondragover={(event) => { if (groupBy === 'none' && !snapshotReading) event.preventDefault(); }}
                ondrop={() => dropTrack(baseId)}
              >
                <div class="track-label" class:movable={groupBy === 'none' && !snapshotReading}>
                  {#if groupBy === 'none' && !snapshotReading}
                    <button
                      class="drag-track"
                      aria-label={`Move ${track.label} track`}
                      title="Drag or press Alt-arrow to reorder"
                      draggable="true"
                      ondragstart={() => (draggedTrack = baseId)}
                      onkeydown={(event) => {
                        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                        event.preventDefault();
                        const index = trackSpecs.findIndex((entry) => entry.id === baseId);
                        const next = event.key === 'ArrowUp' ? index - 1 : index + 1;
                        trackSpecs = moveTimelineTrack(trackSpecs, index, next);
                      }}
                    ><Icon name="grip" size={11} /></button>
                  {/if}
                  <button class="fold-track" aria-label={`${track.collapsed ? 'Expand' : 'Fold'} ${track.label}`} disabled={snapshotReading} onclick={() => setTrackCollapsed(baseId, !track.collapsed)}>
                    <Icon name={track.collapsed ? 'chevronRight' : 'chevronDown'} size={11} />
                  </button>
                  <span class={`category-dot ${track.categories[0]}`}></span>
                  <!-- The hover says what the lane below is a reading of: the whole
                       name, then the question that filled it. -->
                  <span class="track-name" title={trackTitle(track)}><strong>{track.label}</strong>{#if track.groupLabel}<em>{track.groupLabel}</em>{/if}</span>
                  <small title={track.total !== track.items.length ? 'A sample across the window. Load more fills it in.' : undefined}>{track.layout.items.length + track.layout.clusters.reduce((sum, cluster) => sum + cluster.count, 0)}{#if track.total !== track.items.length} / {track.total}{/if}</small>
                  {#if groupBy === 'none' && !snapshotReading}
                    <div class="track-actions">
                      <button aria-label={`Edit ${track.label}`} title="Edit track" onclick={() => (trackEditor = { mode: 'edit', track })}><Icon name="edit" size={11} /></button>
                      <button aria-label={`Duplicate ${track.label}`} title="Duplicate track" onclick={() => duplicateTrack(baseId)}><Icon name="copy" size={11} /></button>
                      <button aria-label={`Delete ${track.label}`} title="Delete track" disabled={trackSpecs.length === 1} onclick={() => removeTrack(baseId)}><Icon name="trash" size={11} /></button>
                    </div>
                  {/if}
                  {#if trackSpecs.find((entry) => entry.id === baseId)?.hidden.length}
                    <button class="restore-hidden" disabled={snapshotReading} onclick={() => restoreHidden(baseId)}>Show hidden</button>
                  {/if}
                  {#if track.expanded}<button class="collapse-track" onclick={() => expandTrack(baseId, false)}>Collapse</button>{/if}
                </div>
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="track-canvas"
                  class:createable={canCreate}
                  role="application"
                  tabindex="0"
                  aria-label={`${track.label} track`}
                  onpointerdown={(event) => drawStart(event, baseId)}
                  onwheel={navigateWheel}
                  onkeydown={(event) => {
                    if ((event.key === 'Enter' || event.key === ' ') && canCreate) {
                      event.preventDefault(); createFromKeyboard();
                    } else navigateKey(event);
                  }}
                >
                  {#if !track.collapsed}
                  {#each minorTicks as tick (tick.at)}<span class="gridline minor" style:left={`${tick.left}%`}></span>{/each}
                  {#each ticks as tick (tick.at)}<span class="gridline" style:left={`${tick.left}%`}></span>{/each}
                  {#if nowLeft !== null}<span class="track-now" style:left={`${nowLeft}%`}></span>{/if}
                  {#if drawing?.trackId === baseId}
                    <div class="draw-range" style:left={`${Math.min(drawing.start, drawing.end) * 100}%`} style:width={`${Math.max(.35, Math.abs(drawing.end - drawing.start) * 100)}%`}></div>
                  {/if}
                  {#each track.layout.items as item (item.id)}
                    {#if item.shape !== 'interval' && item.zone === 'date-only' && item.haloWidth > 0}
                      <span
                        class={`precision-span ${item.category}`}
                        class:chosen={selected?.id === item.id}
                        style:left={`${item.haloLeft}%`}
                        style:width={`${item.haloWidth}%`}
                        style:top={`${item.lane * 46 + 31}px`}
                        aria-hidden="true"
                      ></span>
                    {/if}
                    <div
                      class={`timeline-event ${item.category}`}
                      class:chosen={selected?.id === item.id}
                      class:against={against?.id === item.id}
                      class:period={item.shape === 'interval'}
                      class:approximate={item.approximate}
                      class:uncertain={item.uncertain}
                      class:suggested={item.status === 'suggested'}
                      class:refuted={item.confidence === 'refuted'}
                      class:pinned={item.pinned}
                      class:axis-editable={canDragTemporal(item) && !snapshotReading}
                      class:end-aligned={item.endAligned}
                      style:left={`${item.left}%`}
                      style:width={`${item.width}%`}
                      style:top={`${item.lane * 46 + 18}px`}
                    >
                      {#if item.shape === 'interval' && canDragTemporal(item) && !snapshotReading}
                        <button class="resize start" aria-label="Resize start" title="Resize start" onpointerdown={(event) => beginMove(event, item, 'start')} onkeydown={(event) => keyboardEdit(event, item, 'start')}></button>
                      {/if}
                      <button
                        class="event-select"
                        aria-label={`${item.label}, ${formatTemporalValue(item.raw).label}`}
                        onpointerdown={(event) => {
                          // Ctrl is the measure gesture, so it must not also start a drag
                          if (event.ctrlKey || event.metaKey) return;
                          if (selected?.id === item.id && canDragTemporal(item) && !snapshotReading) beginMove(event, item);
                        }}
                        onclick={(event) => { event.stopPropagation(); selectItem(item, baseId, event); }}
                        oncontextmenu={(event) => openItemMenu(event, item, baseId)}
                        onpointerenter={(event) => showItemTooltip(event, item)}
                        onpointermove={(event) => showItemTooltip(event, item)}
                        onpointerleave={() => (tooltip = null)}
                        onfocus={(event) => showFocusedTooltip(event, item)}
                        onblur={() => (tooltip = null)}
                      >
                        {#if item.shape !== 'interval'}<span class="event-point"></span>{/if}
                        <span class="event-text">
                          <strong class="event-label">{item.label}</strong>
                          <small class="event-date">{formatTemporalValue(item.raw).label}</small>
                        </span>
                      </button>
                      {#if canDragTemporal(item) && !snapshotReading}
                        <button class="move-grip" aria-label="Move selected date" title="Move date" onpointerdown={(event) => beginMove(event, item)} onkeydown={(event) => keyboardEdit(event, item, 'move')}><Icon name="grip" size={10} /></button>
                      {/if}
                      {#if item.shape === 'interval' && canDragTemporal(item) && !snapshotReading}
                        <button class="resize end" aria-label="Resize end" title="Resize end" onpointerdown={(event) => beginMove(event, item, 'end')} onkeydown={(event) => keyboardEdit(event, item, 'end')}></button>
                      {/if}
                    </div>
                  {/each}
                  {#each track.layout.clusters as cluster (cluster.id)}
                    <button
                      class="timeline-cluster"
                      style:left={`${cluster.left}%`}
                      style:top={`${cluster.lane * 46 + 22}px`}
                      aria-label={`${cluster.count} more events near ${formatTemporalValue(cluster.earliest).label}`}
                      onclick={() => expandTrack(baseId)}
                    >+{cluster.count}</button>
                  {/each}
                  {#if canCreate}<span class="track-hint">Click or drag to add an assessment</span>{/if}
                  {#if !track.layout.items.length && !track.layout.clusters.length && !canCreate}<span class="track-empty">No entries in this window</span>{/if}
                  {:else}<span class="folded-note">Track folded</span>{/if}
                </div>
              </div>
            {/each}
          </section>
        {:else}
          <section class="timeline-list" aria-label="Timeline list">
            {#each listGroups as group (group.key)}
              <h2>{group.label}<span>{group.items.length}</span></h2>
              {#each group.items as item (item.id)}
                <button
                  class:chosen={selected?.id === item.id}
                  class:against={against?.id === item.id}
                  onclick={(event) => selectItem(item, null, event)}
                  oncontextmenu={(event) => openItemMenu(event, item)}
                >
                  <span class={`category-dot ${item.category}`}></span>
                  <span class="list-copy"><strong>{item.label}</strong><small>{categoryName(item)}{#if item.time_role} · {item.time_role}{/if}{#if item.confidence} · {item.confidence}{/if}</small></span>
                  <span class="list-date"><strong>{formatTemporalValue(item.raw).label}</strong><code>{item.raw}</code></span>
                  <Icon name="arrowRight" size={12} />
                </button>
              {/each}
            {/each}
          </section>
        {/if}

        {#if unplaced.length || unplacedTotal}
          <details class="holding-card" open>
            <summary><span><Icon name="alert" size={14} />Not on UTC axis</span><strong>{unplacedTotal}</strong></summary>
            <p class="holding-note">Add a timezone or correct the value to place these entries.</p>
            <div class="holding-list">
              {#each unplaced as item (item.id)}
                <button onclick={() => selectItem(item)} oncontextmenu={(event) => openItemMenu(event, item)}>
                  <span class={`category-dot ${item.category}`}></span>
                  <span><strong>{item.label}</strong><small><span class="mono">{item.raw}</span> · {unplacedReason(item)}</small></span>
                  {#if item.category === 'statement'}<Icon name="edit" size={12} />{/if}
                </button>
              {/each}
              {#if unplacedTotal > unplaced.length}<p>Load more to see the remaining entries.</p>{/if}
            </div>
          </details>
        {/if}

        {#if undated.length || undatedTotal}
          <details class="holding-card undated-card" open>
            <summary><span><Icon name="clock" size={14} />Undated</span><strong>{undatedTotal}</strong></summary>
            <div class="holding-list">
              {#each undated as item (item.id)}
                <button onclick={() => selectItem(item)} oncontextmenu={(event) => openItemMenu(event, item)}>
                  <span class={`category-dot ${item.category}`}></span>
                  <span><strong>{item.label}</strong><small>{item.parse_error || categoryName(item)}</small></span>
                  {#if item.category === 'statement'}<Icon name="edit" size={12} />{/if}
                </button>
              {/each}
              {#if undatedTotal > undated.length}<p>Load more to see the remaining undated entries.</p>{/if}
            </div>
          </details>
        {/if}

        {#if cursor}
          <button class="btn btn-ghost load-more" disabled={loading} onclick={() => loadMain({ more: true })}>
            {loading ? 'Loading…' : `Load more · ${items.length} of ${total}`}
          </button>
        {/if}
      {/if}
      {#if loading}<div class="loading-line"></div>{/if}
    </main>

    <aside class="inspector" class:empty={!selected}>
      {#if selected}
        <header><span class={`category-dot ${selected.category}`}></span><span>{categoryName(selected)}</span><button title="Close inspector" onclick={() => (selected = null)}><Icon name="x" size={13} /></button></header>
        <div class="inspector-body">
          <div class="item-kind">{selected.kind}{#if selected.time_role} · {selected.time_role}{/if}</div>
          <h2>{selected.label}</h2>
          {#if inspectorLoading}<div class="inspector-loading">Loading details…</div>{/if}
          <div class="date-reading">
            <Icon name="clock" size={15} />
            <div>
              <strong>{selectedReading.label}</strong>{#if selected.raw}<code>{selected.raw}</code>{/if}<small>{selected.precision || 'No global position'}{#if selected.zone} · {selected.zone}{/if}</small>
              <!-- The same instant on the clock the axis is being read on. Only for a
                   value that names one: a date has no time of day, and printing 00:00
                   in another zone would invent an hour the source never gave. -->
              {#if zone !== UTC && selected.earliest && ['second', 'subsecond'].includes(selected.precision)}
                <small class="in-zone">{zonedStamp(selected.earliest, zone)} {zoneWord}</small>
              {/if}
            </div>
          </div>

          <!-- What the case knows about the time between two entries. The wording is
               `lib/timeline.js`: a gap printed as one number when the dates only allow
               a range is the invented precision this whole panel exists to avoid. -->
          {#if pairReading}
            <section class="pair" aria-label="Time between the two held entries">
              <header>
                <span>against {against.label}</span>
                <button title="Let the second entry go" onclick={() => (against = null)}>
                  <Icon name="x" size={11} />
                </button>
              </header>
              <strong>{pairReading.headline}</strong>
              <small>{pairReading.detail}</small>
              {#each pairReading.notes as note (note)}<small class="caveat">{note}</small>{/each}
            </section>
          {:else}
            <p class="measure-hint">Ctrl-click a second entry to measure between them.</p>
          {/if}
          <div class="badges">
            {#if selected.approximate}<span>Date: approximate</span>{/if}
            {#if selected.uncertain}<span>Date: uncertain</span>{/if}
            {#if selected.confidence}<span>Confidence: {selected.confidence}</span>{/if}
            {#if selected.status === 'suggested'}<span>Status: suggested</span>{/if}
          </div>
          {#if selected.parse_error}<p class="warning">{selected.parse_error}</p>{/if}
          {#if selected.raw && !selected.earliest && selected.zone === 'local'}<p class="warning">Add a timezone to place this time on the UTC axis.</p>{/if}
          {#if canDragTemporal(selected) && !snapshotReading}<p class="axis-edit-help">{selected.shape === 'interval' ? 'Drag to move. Use either edge to resize.' : 'Drag the event to move it.'}</p>{/if}
          <dl class="temporal-facts">
            <div><dt>Precision</dt><dd>{selected.precision || 'Not set'}</dd></div>
            <div><dt>Timezone</dt><dd>{selected.zone || 'Not set'}</dd></div>
            <div><dt>Authority</dt><dd>{selected.authority || selected.category}</dd></div>
            {#if selected.time_role}<div><dt>Time role</dt><dd>{selected.time_role}</dd></div>{/if}
            {#if selected.status}<div><dt>Status</dt><dd>{selected.status}</dd></div>{/if}
            {#if selected.confidence}<div><dt>Confidence</dt><dd>{selected.confidence}</dd></div>{/if}
          </dl>

          {#if inspectorChain?.entity?.attrs?.method}
            <section class="inspector-note"><h3>Method</h3><p>{inspectorChain.entity.attrs.method}</p></section>
          {/if}
          {#if inspectorChain?.entity?.attrs?.verbatim}
            <section class="inspector-note"><h3>Source wording</h3><blockquote>{inspectorChain.entity.attrs.verbatim}</blockquote></section>
          {/if}

          {#if inspectorConnections.about.length || inspectorConnections.at.length || inspectorConnections.cites.length}
            <section class="inspector-connections">
              {#if inspectorConnections.about.length}
                <h3>About</h3>
                {#each inspectorConnections.about as entry (entry.id)}<button disabled={snapshotReading} onclick={() => (detailsId = entry.id)}><span>{entry.label}</span><small>{entry.type}</small><Icon name="arrowRight" size={11} /></button>{/each}
              {/if}
              {#if inspectorConnections.at.length}
                <h3>Place</h3>
                {#each inspectorConnections.at as entry (entry.id)}<button disabled={snapshotReading} onclick={() => (detailsId = entry.id)}><span>{entry.label}</span><small>{entry.type}</small><Icon name="arrowRight" size={11} /></button>{/each}
              {/if}
              {#if inspectorConnections.cites.length}
                <h3>Evidence</h3>
                {#each inspectorConnections.cites as entry (entry.id)}<button disabled={snapshotReading} onclick={() => (detailsId = entry.id)}><span>{entry.label}</span><small>{entry.type}</small><Icon name="arrowRight" size={11} /></button>{/each}
              {/if}
            </section>
          {/if}
          <!-- Both acts are about a lane: pinning keeps an entry out of that lane's
               density overflow, hiding takes it out of that lane. An entry with no
               place on the axis is in neither, so it is offered neither — a control
               that can only take a row out of the Undated queue is a trapdoor. -->
          {#if selectedTrack && selected.earliest && !snapshotReading}
            <section class="track-item-actions">
              <h3>{selectedTrack.label}</h3>
              <button onclick={() => togglePinned()}><Icon name="pushpin" size={12} />{selectedTrack.pinned.includes(selected.id) ? 'Unpin from track' : 'Pin in track'}</button>
              <button onclick={() => hideFromTrack()}><Icon name="eyeOff" size={12} />Hide from track</button>
            </section>
          {/if}
        </div>
        <footer>
          <button class="btn btn-ghost" disabled={snapshotReading} onclick={() => (detailsId = selected.owner_id)}>Details</button>
          {#if selected.category === 'statement'}<button class="btn btn-primary" disabled={snapshotReading} onclick={() => openEditor(selected)}>Edit assessment</button>{/if}
          {#if selected.category === 'media'}<button class="btn btn-primary" disabled={snapshotReading || !inspectorChain?.entity} onclick={addMediaCorrection}>Add correction</button>{/if}
        </footer>
      {:else}
        <!-- The tool's own clock rather than a target: nothing is being aimed at here,
             and the panel is empty until an entry is chosen. -->
        <div class="inspector-empty"><Icon name="clock" size={16} /><span>Select an entry</span></div>
      {/if}
    </aside>
  </div>

  <!-- Inside the tool, not beside it: this screen goes to full screen, and nothing
       outside the element being shown is drawn there. -->
  {#if itemMenu}
    {@const item = itemMenu.item}
    {@const track = itemMenu.track}
    <div class="item-menu" bind:this={itemMenuElement} style:left={`${itemMenu.x}px`} style:top={`${itemMenu.y}px`}>
      <p class="meta">{item.label}</p>
      <ul>
        <!-- Both lane acts, on the same rule the inspector follows: an entry with no
             place on the axis is in no lane, so neither is offered for it. -->
        {#if track && item.earliest && !snapshotReading}
          <li>
            <button onclick={() => fromItemMenu(togglePinned)}>
              <Icon name="pushpin" size={12} />{track.pinned.includes(item.id) ? 'Unpin from' : 'Pin in'} {track.label}
            </button>
          </li>
          <li>
            <button onclick={() => fromItemMenu(hideFromTrack)}>
              <Icon name="eyeOff" size={12} />Hide from {track.label}
            </button>
          </li>
        {/if}
        <li>
          <button disabled={snapshotReading} onclick={() => fromItemMenu((entry) => (detailsId = entry.owner_id))}>
            <Icon name="inspect" size={12} />Details
          </button>
        </li>
        {#if item.category === 'statement'}
          <li>
            <button disabled={snapshotReading} onclick={() => fromItemMenu((entry) => openEditor(entry))}>
              <Icon name="edit" size={12} />Edit assessment
            </button>
          </li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

{#if tooltip}
  <div class="timeline-tooltip" style:left={`${tooltip.x}px`} style:top={`${tooltip.y}px`} role="tooltip">
    <strong>{tooltip.title}</strong><span>{tooltip.date}</span>{#if tooltip.detail}<small>{tooltip.detail}</small>{/if}
  </div>
{/if}

{#if editor}
  <Modal title={editor.item ? 'Edit time assessment' : 'Add assessment'} onclose={() => (editor = null)} width="660px">
    <TemporalClaimEditor
      caseId={caseState.current.id}
      item={editor.item}
      subject={editor.subject}
      initialWhen={editor.when}
      initialStatement={editor.statement ?? ''}
      initialRole={editor.role ?? ''}
      onsaved={editorSaved}
      oncancel={() => (editor = null)}
    />
  </Modal>
{/if}

{#if trackEditor}
  <Modal title={trackEditor.mode === 'edit' ? 'Edit track' : 'Add track'} onclose={() => (trackEditor = null)} width="720px">
    <TimelineTrackEditor
      caseId={caseState.current.id}
      caseFolders={caseState.current?.folders ?? []}
      track={trackEditor.mode === 'edit' ? trackEditor.track : null}
      onsave={saveTrack}
      oncancel={() => (trackEditor = null)}
    />
  </Modal>
{/if}

{#if detailsId}
  <Modal title="Details" onclose={() => (detailsId = null)} width="640px">
    <EntityDetails entityId={detailsId} onclose={() => (detailsId = null)} ondeleted={() => (detailsId = null)} />
  </Modal>
{/if}

{#if pendingEdit}
  <ConfirmDialog
    title={pendingEdit.item.shape === 'interval' ? 'Change this period?' : 'Move this date?'}
    message={pendingEdit.item.label}
    detail={`${pendingEdit.item.raw} → ${pendingEdit.raw}`}
    confirmLabel="Update date"
    icon="clock"
    busy={directSaving}
    onconfirm={confirmDirectEdit}
    oncancel={() => (pendingEdit = null)}
  />
{/if}

<style>
  /* Plain surface, like every other tool. The glow that used to sit behind the head
     was decoration this screen had no more claim to than the Board does. */
  .timeline-tool {
    height: 100%; min-height: 0; display: flex; flex-direction: column;
    --track-statement: var(--timeline-statement); --track-media: var(--timeline-media); --track-activity: var(--timeline-activity);
    background: var(--bg-0);
    color: var(--text-1);
  }
  .timeline-head { display: grid; grid-template-columns: minmax(160px, 1fr) auto minmax(160px, 1fr); align-items: center; gap: 18px; padding: 12px 24px 10px; }
  /* The house header: name, then one clause. `app.css .tool-header` spells the same
     two rules, and this screen keeps its own only because the head is a three-column
     grid with the range controls in the middle. */
  .title-block { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
  .title-block h2 { font-size: var(--fs-lg); font-weight: 600; letter-spacing: -0.01em; }
  .title-block .sub { overflow: hidden; color: var(--text-3); font-size: var(--fs-sm); text-overflow: ellipsis; white-space: nowrap; }
  /* The middle column carries the window and nothing else. One segmented group: step
     back, the window itself, step on. */
  .range { position: relative; display: flex; align-items: center; justify-self: center; }
  .range-step, .range-face {
    height: 30px; border: 1px solid var(--border); background: var(--bg-2);
    color: var(--text-2); cursor: pointer;
  }
  .range-step { width: 28px; display: grid; place-items: center; padding: 0; }
  .range-step:first-child { border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .range-step:last-of-type { border-radius: 0 var(--r-sm) var(--r-sm) 0; }
  .range-face { min-width: 190px; margin: 0 -1px; padding: 0 12px; color: var(--text-1); font-size: var(--fs-sm); }
  .range-step:hover, .range-face:hover, .range-face[aria-expanded='true'] { border-color: var(--border-strong); color: var(--text-1); }
  .range-step:disabled { opacity: .4; cursor: default; }
  .range-menu {
    position: absolute; z-index: 80; top: calc(100% + 6px); left: 50%; width: 244px;
    display: grid; gap: 9px; padding: 11px; border: 1px solid var(--border-strong);
    border-radius: var(--r-md); background: var(--bg-1); box-shadow: var(--shadow-2);
    transform: translateX(-50%);
  }
  .range-menu label { display: grid; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); }
  .range-spans { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 9px; border-top: 1px solid var(--border); }
  .range-spans button {
    flex: 1 1 30%; padding: 5px 0; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs); cursor: pointer;
  }
  /* Ends the track row: the label in the row's own small grey, the three surfaces
     welded into one segmented control so they read as one choice. */
  .range-handoffs { margin-left: auto; flex: 0 0 auto; display: flex; align-items: center; }
  .range-handoffs > span { margin-right: 8px; color: var(--text-3); font-size: 10px; }
  .range-handoffs button {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .range-handoffs button + button { margin-left: -1px; }
  .range-handoffs button:first-of-type { border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .range-handoffs button:last-of-type { border-radius: 0 var(--r-sm) var(--r-sm) 0; }
  .range-handoffs button:hover { position: relative; border-color: var(--border-strong); color: var(--text-1); }
  .range-handoffs button:disabled { opacity: .4; cursor: default; }
  .range-spans button:hover { border-color: var(--border-strong); color: var(--text-1); }
  .range-spans button:disabled { opacity: .4; cursor: default; }
  .head-actions { justify-self: end; display: flex; align-items: center; gap: 5px; }
  /* One height across the row. Views and Export come from shared components and are
     `btn-sm`, the tool's own two are not, and four buttons of two heights read as a
     mistake. Stated from the same tokens a plain `.btn` is built from — its text plus
     its padding and rule — rather than as a number that would drift from them. */
  .head-actions :global(.btn) { min-height: calc(var(--fs-sm) * 1.5 + 12px); }
  .add-event { justify-self: end; }
  .timeline-tool:fullscreen { width: 100vw; height: 100vh; }
  .filter-row { min-height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 24px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 75%, transparent); }
  .category-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--text-3); }
  /* `--track-tint` is the colour the analyst gave this track, set on its row. Unset
     everywhere else, so the category keeps its own colour and the legend stays true. */
  .category-dot.statement { background: var(--track-tint, var(--track-statement)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--track-tint, var(--track-statement)) 15%, transparent); }
  .category-dot.media { border-radius: 2px; background: var(--track-tint, var(--track-media)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--track-tint, var(--track-media)) 15%, transparent); }
  .category-dot.case_activity { background: var(--track-tint, var(--track-activity)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--track-tint, var(--track-activity)) 15%, transparent); }
  .scope-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 220px; padding: 5px 8px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 999px; background: color-mix(in srgb, var(--accent) 8%, var(--bg-2)); color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .scope-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .view-switch { display: flex; padding: 2px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); }
  .view-switch button { padding: 3px 7px; border: 0; border-radius: 2px; background: none; color: var(--text-3); font-size: 10px; cursor: pointer; }
  .view-switch button.active { background: var(--bg-3); color: var(--text-1); }
  .legend { position: relative; }
  .legend > summary { padding: 4px 6px; color: var(--text-3); font-size: 10px; cursor: pointer; list-style: none; }
  .legend > summary::-webkit-details-marker { display: none; }
  .legend-card { position: absolute; z-index: 45; top: calc(100% + 5px); left: 0; width: 210px; display: grid; gap: 7px; padding: 10px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--bg-1); box-shadow: var(--shadow-2); }
  .legend-card > strong { margin-top: 2px; color: var(--text-3); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
  .legend-card > span { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: var(--fs-xs); }
  .legend-card p { margin: 2px 0 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.35; }
  .legend-card small { margin-top: 2px; color: var(--text-3); line-height: 1.35; }
  .sample { position: relative; width: 28px; height: 11px; display: inline-block; border: 1px solid var(--track-statement); border-radius: 3px; background: color-mix(in srgb, var(--track-statement) 12%, var(--bg-1)); }
  .sample.approximate { border-style: dashed; }
  .sample.uncertain { background-image: repeating-linear-gradient(135deg, transparent, transparent 3px, color-mix(in srgb, var(--text-2) 18%, transparent) 3px, color-mix(in srgb, var(--text-2) 18%, transparent) 5px); }
  .sample.suggested::after { content: ''; position: absolute; top: 2px; right: 2px; width: 4px; height: 4px; border-radius: 50%; background: var(--track-statement); box-shadow: 0 0 0 1px var(--bg-1); }
  .sample.refuted { position: relative; opacity: .8; }
  .sample.refuted::after { content: ''; position: absolute; left: 2px; right: 2px; top: 4px; border-top: 1px solid var(--text-2); transform: rotate(-8deg); }
  .utc-readout { margin-left: auto; color: var(--text-3); font: 10px var(--mono); letter-spacing: .03em; }
  /* Wraps rather than scrolls: the Add-a-track menu hangs out of this row, and an
     overflow container would clip it. */
  .track-toolbar { min-height: 38px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 6px 24px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg-1) 82%, transparent); }
  .track-toolbar > label { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 10px; }
  .track-toolbar > label select { width: 118px; }
  .track-toolbar > span { color: var(--text-3); font-size: 10px; }
  .track-toolbar > em { color: var(--accent); font-size: 10px; font-style: normal; }
  .track-add { position: relative; }
  .track-menu { position: absolute; z-index: 70; top: calc(100% + 5px); left: 0; width: 250px; display: grid; padding: 7px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--bg-1); box-shadow: var(--shadow-2); }
  .track-menu > strong { padding: 5px 7px 7px; color: var(--text-3); font-size: 9px; letter-spacing: .07em; text-transform: uppercase; }
  .track-menu > button { display: flex; justify-content: space-between; gap: 8px; padding: 7px; border: 0; border-radius: var(--r-sm); background: none; color: var(--text-2); text-align: left; cursor: pointer; }
  .track-menu > button:hover { background: var(--bg-2); color: var(--text-1); }
  .track-menu > button small { color: var(--text-3); font-size: 9px; }
  .track-menu .custom { margin-top: 5px; border-top: 1px solid var(--border); border-radius: 0 0 var(--r-sm) var(--r-sm); }
  .timeline-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 330px; }
  .chronology { position: relative; min-width: 0; overflow: auto; padding: 18px 24px 28px; }
  /* A panel is a border and a fill. The 35px drop shadow under each one read as a
     floating card, which is a look rather than a reading of the case. */
  .axis-card, .overview-card, .holding-card, .timeline-list { border: 1px solid var(--border); border-radius: var(--r); background: var(--bg-1); overflow: hidden; }
  /* One width for the gutter, and wide enough for a name the analyst chose: at 132px
     "Events" arrived as "E." and a track nobody can read is a colour with a count. */
  .axis-card, .overview-card { --gutter: 178px; }
  .axis-row, .track-row { display: grid; grid-template-columns: var(--gutter) minmax(500px, 1fr); }
  .axis-row { min-height: 66px; border-bottom: 1px solid var(--border); }
  .axis-label, .track-label { padding: 12px 14px; border-right: 1px solid var(--border); }
  .axis-label { display: grid; align-content: center; }
  .axis-label span { color: var(--text-2); font: 600 var(--fs-xs) var(--mono); }
  .axis-label small { color: var(--text-3); font-size: 9px; overflow-wrap: anywhere; }
  .axis-ruler, .track-canvas { position: relative; min-width: 500px; }
  .axis-ruler { cursor: grab; touch-action: none; background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--bg-2) 70%, transparent)); }
  .axis-ruler.panning { cursor: grabbing; }
  .axis-bands { position: absolute; inset: 0 0 auto; height: 24px; overflow: hidden; border-bottom: 1px solid var(--border); }
  .axis-bands span { position: absolute; height: 24px; overflow: hidden; padding: 5px 7px; border-right: 1px solid var(--border); color: var(--text-2); font: 9px var(--mono); white-space: nowrap; }
  .axis-minor { position: absolute; bottom: 0; height: 11px; border-left: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
  /* The daylight ribbon: a strip at the foot of the ruler, on the ruler's own scale.
     The strip is the night, and the two runs of spans are laid over it — dusk is not
     a line, so twilight has to be a band of its own rather than an edge. */
  .daylight { position: absolute; inset: auto 0 0; height: 5px; background: color-mix(in srgb, var(--text-1) 22%, transparent); }
  .daylight span { position: absolute; inset: 0; }
  .daylight .twilight { background: color-mix(in srgb, var(--text-1) 45%, transparent); }
  .daylight .day { background: color-mix(in srgb, var(--warn) 70%, transparent); }
  .daylight-note { margin: 0; padding: 5px 14px; border-top: 1px solid var(--border); color: var(--text-3); font-size: 9px; }
  .axis-tick { position: absolute; top: 24px; bottom: 0; border-left: 1px solid var(--border-strong); }
  .axis-tick span { position: absolute; top: 14px; left: 5px; color: var(--text-3); font: 10px var(--mono); white-space: nowrap; }
  .axis-tick.end span { left: -5px; transform: translateX(-100%); }
  .now-line, .track-now { position: absolute; z-index: 1; inset-block: 24px 0; border-left: 1px solid var(--danger); pointer-events: none; }
  .now-line small { position: absolute; top: 2px; left: 4px; color: var(--danger); font: 8px var(--mono); text-transform: uppercase; }
  .track-row { border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent); transition: min-height .16s ease; }
  .track-row.folded { min-height: 42px; }
  .track-row:last-child { border-bottom: 0; }
  .track-label { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-content: start; align-items: center; gap: 7px; padding: 14px 10px; }
  .track-label.movable { grid-template-columns: auto auto auto minmax(0, 1fr) auto; }
  .drag-track, .fold-track { display: grid; place-items: center; padding: 2px; border: 0; background: none; color: var(--text-3); cursor: pointer; }
  .drag-track { cursor: grab; }
  .drag-track:active { cursor: grabbing; }
  .track-name { min-width: 0; display: grid; }
  /* Two lines before the ellipsis: "Case activity" and "Vessel movements" are the
     names people actually write, and one line of 60px cannot hold either. */
  .track-name strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .track-name em { overflow: hidden; color: var(--text-3); font-size: 8px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
  .track-label strong { font-size: var(--fs-xs); }
  .track-label small { padding: 1px 5px; border-radius: 999px; background: var(--bg-3); color: var(--text-3); font-size: 9px; }
  .track-actions { grid-column: 3 / -1; display: flex; gap: 2px; }
  .track-label.movable .track-actions { grid-column: 4 / -1; }
  .track-actions button { display: grid; place-items: center; padding: 3px; border: 0; background: none; color: var(--text-3); cursor: pointer; }
  .track-actions button:hover { color: var(--text-1); }
  .track-actions button:disabled { opacity: .35; cursor: default; }
  .collapse-track, .restore-hidden { grid-column: 3 / -1; justify-self: start; margin-top: 1px; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-2); color: var(--text-2); font-size: 9px; cursor: pointer; }
  .track-label.movable .collapse-track, .track-label.movable .restore-hidden { grid-column: 4 / -1; }
  .restore-hidden + .collapse-track { margin-left: 72px; }
  .collapse-track:hover { border-color: var(--border-strong); color: var(--accent); }
  .track-canvas { overflow: hidden; background: linear-gradient(90deg, transparent 49.9%, color-mix(in srgb, var(--accent) 3%, transparent) 50%, transparent 50.1%); cursor: default; }
  .track-canvas.createable { cursor: crosshair; }
  .gridline { position: absolute; inset-block: 0; border-left: 1px solid color-mix(in srgb, var(--border) 65%, transparent); pointer-events: none; }
  .gridline.minor { border-left-color: color-mix(in srgb, var(--border) 35%, transparent); }
  .track-now { inset-block: 0; opacity: .7; }
  .track-hint, .track-empty { position: absolute; right: 12px; top: 6px; color: color-mix(in srgb, var(--text-3) 65%, transparent); font-size: 9px; pointer-events: none; }
  .track-empty { left: 14px; right: auto; top: 26px; font-size: var(--fs-xs); }
  .folded-note { position: absolute; top: 13px; left: 14px; color: var(--text-3); font-size: 9px; }
  .draw-range { position: absolute; inset-block: 12px; z-index: 6; border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--accent) 14%, transparent); pointer-events: none; }
  .timeline-event { --event-color: var(--track-tint, var(--track-statement)); position: absolute; z-index: 2; height: 36px; display: flex; align-items: stretch; border: 1px solid color-mix(in srgb, var(--event-color) 65%, var(--border)); border-radius: 7px; background: color-mix(in srgb, var(--event-color) 11%, var(--bg-1)); color: var(--text-1); transform: translateX(-8px); box-shadow: 0 3px 10px color-mix(in srgb, var(--bg-0) 55%, transparent); }
  .timeline-event.media { --event-color: var(--track-tint, var(--track-media)); }
  .timeline-event.case_activity { --event-color: var(--track-tint, var(--track-activity)); }
  .timeline-event.period { min-width: 28px; transform: none; }
  .timeline-event.end-aligned { transform: translateX(calc(-100% + 8px)); }
  .timeline-event.chosen { z-index: 8; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), 0 5px 16px color-mix(in srgb, var(--bg-0) 70%, transparent); }
  /* The entry held against the selected one. Marked apart rather than as a second
     selection: only one of the two is the one being read. */
  .timeline-event.against { z-index: 8; border-color: var(--text-2); border-style: dashed; }
  .timeline-event.pinned { box-shadow: inset 0 2px 0 var(--accent), 0 3px 10px color-mix(in srgb, var(--bg-0) 55%, transparent); }
  .timeline-event.approximate { border-style: dashed; }
  .timeline-event.uncertain { background-image: repeating-linear-gradient(135deg, transparent, transparent 4px, color-mix(in srgb, var(--text-2) 12%, transparent) 4px, color-mix(in srgb, var(--text-2) 12%, transparent) 7px); }
  .timeline-event.suggested::after { content: ''; position: absolute; z-index: 5; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--event-color); box-shadow: 0 0 0 2px var(--bg-1); pointer-events: none; }
  .timeline-event.refuted { opacity: .8; }
  .timeline-event.refuted .event-label { text-decoration: line-through; text-decoration-thickness: 1px; }
  .event-select { min-width: 0; flex: 1; display: flex; align-items: center; gap: 6px; padding: 3px 7px; overflow: hidden; border: 0; background: none; color: inherit; text-align: left; cursor: pointer; }
  .event-point { width: 8px; height: 8px; flex: 0 0 auto; border: 2px solid var(--bg-1); border-radius: 50%; background: var(--event-color); box-shadow: 0 0 0 1px var(--event-color); }
  .event-text { min-width: 0; display: grid; line-height: 1.12; }
  .event-label, .event-date { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-label { font-size: 10px; font-weight: 650; }
  .event-date { margin-top: 2px; color: var(--text-3); font: 8px var(--mono); }
  .precision-span { --event-color: var(--track-tint, var(--track-statement)); position: absolute; z-index: 1; height: 10px; min-width: 1px; border-inline: 1px solid color-mix(in srgb, var(--event-color) 55%, transparent); background: linear-gradient(to bottom, transparent 4px, color-mix(in srgb, var(--event-color) 42%, transparent) 4px, color-mix(in srgb, var(--event-color) 42%, transparent) 6px, transparent 6px); pointer-events: none; }
  .precision-span.media { --event-color: var(--track-tint, var(--track-media)); }
  .precision-span.case_activity { --event-color: var(--track-tint, var(--track-activity)); }
  .precision-span.chosen { border-inline-color: var(--event-color); background: linear-gradient(to bottom, transparent 4px, color-mix(in srgb, var(--event-color) 72%, transparent) 4px, color-mix(in srgb, var(--event-color) 72%, transparent) 6px, transparent 6px); }
  .move-grip { display: none; width: 18px; place-items: center; padding: 0; border: 0; border-left: 1px solid var(--border); background: color-mix(in srgb, var(--bg-1) 90%, transparent); color: var(--text-3); cursor: ew-resize; }
  .timeline-event.chosen .move-grip { display: grid; }
  .resize { display: none; position: absolute; z-index: 3; top: 4px; bottom: 4px; width: 7px; padding: 0; border: 0; border-radius: 3px; background: var(--accent); cursor: ew-resize; }
  .timeline-event.chosen .resize { display: block; }
  .resize.start { left: -4px; } .resize.end { right: -4px; }
  .timeline-cluster { position: absolute; z-index: 7; min-width: 32px; height: 24px; padding: 0 7px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--bg-3); color: var(--text-2); font: 700 10px var(--mono); transform: translateX(-50%); cursor: pointer; }
  .timeline-list { display: grid; padding-bottom: 5px; }
  .timeline-list h2 { display: flex; justify-content: space-between; margin: 0; padding: 9px 12px; border-top: 1px solid var(--border); background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs); }
  .timeline-list h2:first-child { border-top: 0; }
  .timeline-list h2 span { color: var(--text-3); font-weight: 400; }
  .timeline-list > button { display: grid; grid-template-columns: auto minmax(180px, 1fr) minmax(190px, auto) auto; align-items: center; gap: 10px; margin: 5px 7px 0; padding: 8px; border: 1px solid transparent; border-radius: var(--r-sm); background: none; color: var(--text-2); text-align: left; cursor: pointer; }
  .timeline-list > button:hover { background: var(--bg-2); }
  .timeline-list > button.chosen { border-color: var(--accent); background: var(--accent-soft); }
  .timeline-list > button.against { border-color: var(--text-3); border-style: dashed; }
  .list-copy, .list-date { min-width: 0; display: grid; }
  .list-copy strong, .list-copy small, .list-date strong, .list-date code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list-copy strong { color: var(--text-1); font-size: var(--fs-sm); }
  .list-copy small { color: var(--text-3); font-size: 10px; text-transform: capitalize; }
  .list-date { justify-items: end; }
  .list-date strong { font-size: var(--fs-xs); font-weight: 500; }
  .list-date code { color: var(--text-3); font-size: 9px; }
  .overview-card { display: grid; grid-template-columns: var(--gutter) minmax(500px, 1fr); min-height: 92px; margin-bottom: 12px; }
  .overview-title { display: grid; align-content: center; gap: 2px; padding: 10px 12px; border-right: 1px solid var(--border); }
  .overview-title > span { font-size: var(--fs-xs); font-weight: 700; }
  .overview-title small { color: var(--text-3); font-size: 9px; }
  .overview-title .capped { color: var(--warn); }
  .overview-counts { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
  .overview-counts span { padding: 1px 4px; border-radius: 2px; background: var(--bg-3); color: var(--text-3); font-size: 8px; }
  .density-bars { position: relative; min-width: 500px; height: 68px; margin: 12px 10px; overflow: hidden; border-radius: 3px; background: color-mix(in srgb, var(--bg-2) 40%, transparent); cursor: crosshair; }
  /* One column per bin, as wide as the bin, stacked by category — a histogram, which
     is only readable because the bins are cut as fine as they can be drawn. The floor
     keeps a lone day visible and clickable at a scale where a day is under a pixel.

     Above the brush, and only the column answers the pointer. Underneath it, a column
     the window covered could not be clicked at all: the surface you drag the brush by
     took the press, so clicking a bar in view did nothing and nudging it moved the
     window instead. The empty height over a short column stays part of that surface. */
  .density-bucket { position: absolute; z-index: 6; bottom: 17px; height: 46px; min-width: 2px; display: flex; align-items: end; border: 0; background: none; pointer-events: none; }
  .density-stack { width: 100%; display: flex; flex-direction: column-reverse; overflow: hidden; border-radius: 1px 1px 0 0; opacity: .85; cursor: pointer; pointer-events: auto; }
  .density-stack i { display: block; min-height: 1px; }
  .density-stack i.statement { background: var(--track-statement); }
  .density-stack i.media { background: var(--track-media); }
  .density-stack i.case_activity { background: var(--track-activity); }
  .density-bucket:hover .density-stack { opacity: 1; box-shadow: 0 0 0 1px var(--accent); }
  .density-baseline { position: absolute; z-index: 3; right: 0; bottom: 16px; left: 0; border-top: 1px solid var(--border-strong); pointer-events: none; }
  .overview-rule { position: absolute; z-index: 1; top: 0; bottom: 16px; border-left: 1px solid var(--border); pointer-events: none; }
  /* Centred on the period it names, so the name sits under its own bar. The two
     outermost lean inward instead, or a name wider than its slot would be clipped by
     the edge of the minimap. */
  .overview-tick { position: absolute; z-index: 7; bottom: 2px; color: var(--text-3); font: 8px var(--mono); text-align: center; white-space: nowrap; pointer-events: none; }
  .overview-tick.start { text-align: left; }
  .overview-tick.end { text-align: right; }
  .overview-shade { position: absolute; z-index: 4; top: 0; bottom: 16px; background: color-mix(in srgb, var(--bg-1) 62%, transparent); pointer-events: none; }
  .overview-window { position: absolute; z-index: 5; inset: 3px auto 16px; min-width: 8px; border: 1px solid color-mix(in srgb, var(--accent) 74%, transparent); border-radius: 3px; background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .overview-drag { position: absolute; inset: 0 5px; padding: 0; border: 0; background: none; cursor: grab; }
  .overview-handle { position: absolute; z-index: 2; top: 5px; bottom: 5px; width: 5px; padding: 0; border: 0; border-radius: 2px; background: var(--accent); cursor: ew-resize; }
  .overview-handle.start { left: -3px; } .overview-handle.end { right: -3px; }
  .holding-card { margin-top: 12px; }
  .holding-card summary { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px; cursor: pointer; }
  .holding-card summary span { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-sm); font-weight: 700; }
  .holding-card summary strong { min-width: 24px; padding: 2px 6px; border-radius: 999px; background: var(--bg-3); color: var(--text-3); font-size: var(--fs-xs); text-align: center; }
  .holding-note { margin: -5px 14px 9px; color: var(--text-3); font-size: var(--fs-xs); }
  .holding-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 6px; padding: 0 12px 12px; }
  .holding-list button { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2); text-align: left; cursor: pointer; }
  .holding-list button > span:nth-child(2) { display: grid; min-width: 0; }
  .holding-list strong, .holding-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .holding-list strong { font-size: var(--fs-xs); }
  .holding-list small { color: var(--text-3); font-size: 9px; }
  .holding-list p { margin: 0; padding: 8px; color: var(--text-3); font-size: var(--fs-xs); }
  .load-more { display: flex; margin: 14px auto 0; }
  .loading-line { position: sticky; bottom: 0; height: 2px; margin-top: -2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .blank-state { height: 100%; min-height: 340px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-3); text-align: center; }
  .blank-state h2 { margin: 0; color: var(--text-1); font-size: var(--fs-md); font-weight: 600; }
  .blank-state p { max-width: 360px; margin: 0 0 6px; }
  .inspector { min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: color-mix(in srgb, var(--bg-1) 97%, transparent); }
  .inspector > header { display: flex; align-items: center; gap: 7px; min-height: 45px; padding: 0 13px; border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .inspector > header button { display: grid; margin-left: auto; padding: 4px; border: 0; background: none; color: var(--text-3); cursor: pointer; }
  .inspector-body { min-height: 0; overflow: auto; padding: 16px; }
  .inspector-loading { margin: -7px 0 9px; color: var(--text-3); font-size: 9px; }
  .item-kind { color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .inspector h2 { margin: 4px 0 16px; font-size: 17px; line-height: 1.3; }
  .date-reading { display: flex; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .date-reading :global(> svg) { color: var(--accent); }
  .date-reading div { min-width: 0; display: grid; }
  .date-reading strong, .date-reading code { overflow-wrap: anywhere; }
  .date-reading strong { font-size: var(--fs-xs); }
  .date-reading code { margin-top: 3px; color: var(--text-3); font-size: 9px; }
  .date-reading small { margin-top: 3px; color: var(--text-3); font-size: 9px; }
  .date-reading .in-zone { color: var(--text-2); }
  /* The measurement between two entries. The figure reads first, what it rests on
     under it, and every caveat the reading carries below that — a gap printed bare is
     true and misleading in the same breath. */
  .pair { display: grid; gap: 3px; margin-top: 10px; padding: 10px; border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-2); }
  .pair header { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 9px; }
  .pair header span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pair header button { display: grid; margin-left: auto; padding: 2px; border: 0; background: none; color: var(--text-3); cursor: pointer; }
  .pair header button:hover { color: var(--text-1); }
  .pair > strong { font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .pair > small { color: var(--text-2); font-size: var(--fs-xs); }
  .pair .caveat { color: var(--text-3); font-size: 9px; line-height: 1.4; }
  .measure-hint { margin: 8px 0 0; color: var(--text-3); font-size: 9px; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
  .badges span { padding: 3px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-3); font-size: 9px; text-transform: capitalize; }
  .warning { padding: 8px; border-radius: var(--r-sm); background: var(--danger-soft); color: var(--danger); font-size: var(--fs-xs); }
  .axis-edit-help { margin: 10px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  dl { display: grid; gap: 8px; margin: 16px 0 0; }
  dl div { display: flex; justify-content: space-between; gap: 8px; }
  dt { color: var(--text-3); font-size: var(--fs-xs); } dd { margin: 0; font-size: var(--fs-xs); }
  .temporal-facts { padding-bottom: 13px; border-bottom: 1px solid var(--border); }
  .temporal-facts dd { color: var(--text-2); text-transform: capitalize; }
  .inspector-note, .inspector-connections { display: grid; gap: 5px; margin-top: 14px; }
  .inspector-note h3, .inspector-connections h3 { margin: 0; color: var(--text-3); font-size: 9px; text-transform: uppercase; letter-spacing: .07em; }
  .inspector-note p, .inspector-note blockquote { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; overflow-wrap: anywhere; }
  .inspector-note blockquote { padding-left: 9px; border-left: 2px solid var(--border-strong); }
  .inspector-connections h3:not(:first-child) { margin-top: 7px; }
  .inspector-connections button { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 6px; padding: 7px 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2); text-align: left; cursor: pointer; }
  .inspector-connections button:hover { border-color: var(--border-strong); }
  .inspector-connections button span { overflow: hidden; color: var(--text-1); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .inspector-connections button small { color: var(--text-3); font-size: 9px; text-transform: capitalize; }
  .track-item-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
  .track-item-actions h3 { grid-column: 1 / -1; margin: 0 0 2px; color: var(--text-3); font-size: 9px; text-transform: uppercase; letter-spacing: .07em; }
  .track-item-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 7px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2); font-size: 10px; cursor: pointer; }
  .inspector footer { display: flex; justify-content: flex-end; gap: 5px; padding: 12px; border-top: 1px solid var(--border); }
  .inspector-empty { flex: 1; display: grid; place-content: center; justify-items: center; gap: 7px; color: var(--text-3); font-size: var(--fs-xs); }
  .timeline-tooltip { position: fixed; z-index: 100; width: 270px; display: grid; gap: 3px; padding: 9px 10px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--bg-1); box-shadow: var(--shadow-2); color: var(--text-2); pointer-events: none; }
  .timeline-tooltip strong { color: var(--text-1); font-size: var(--fs-xs); }
  .timeline-tooltip span { font: 10px var(--mono); }
  .timeline-tooltip small { color: var(--text-3); font-size: 9px; text-transform: capitalize; }
  /* Over the pointer, above the tooltip it replaces: a hover reading and a menu about
     the same entry cannot both be answered, so the menu is the one on top. */
  .item-menu { position: fixed; z-index: 110; width: 196px; padding: 6px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--bg-1); box-shadow: var(--shadow-2); }
  .item-menu .meta { margin: 2px 6px 5px; overflow: hidden; color: var(--text-3); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .item-menu ul { list-style: none; margin: 0; padding: 0; }
  .item-menu button { display: flex; width: 100%; align-items: center; gap: 7px; padding: 6px; border: 0; border-radius: var(--r-sm); background: none; color: var(--text-2); font-size: var(--fs-xs); text-align: left; cursor: pointer; }
  .item-menu button:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .item-menu button:disabled { color: var(--text-3); cursor: default; }
  :global(.timeline-tool button:focus-visible), .axis-ruler:focus-visible, .track-canvas:focus-visible, .density-bars:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 1160px) {
    .timeline-head { grid-template-columns: 1fr auto; }
    .range { grid-column: 1 / -1; grid-row: 2; }
    .head-actions { grid-column: 2; grid-row: 1; }
    .timeline-grid { grid-template-columns: minmax(0, 1fr) 250px; }
    .utc-readout { display: none; }
  }
  @media (max-width: 760px) {
    .timeline-head { padding-inline: 14px; }
    .range { width: 100%; justify-self: stretch; }
    .filter-row { padding-inline: 14px; overflow-x: auto; }
    .track-toolbar { padding-inline: 14px; }
    .chronology { padding: 12px 14px 22px; }
    .timeline-grid { position: relative; grid-template-columns: minmax(0, 1fr); }
    .inspector { position: absolute; z-index: 30; right: 0; bottom: 0; top: 0; width: min(310px, 88vw); box-shadow: -12px 0 32px color-mix(in srgb, var(--bg-0) 70%, transparent); }
    .inspector.empty { display: none; }
    .timeline-list > button { grid-template-columns: auto minmax(0, 1fr) auto; }
    .list-date { grid-column: 2; justify-items: start; }
  }
</style>
