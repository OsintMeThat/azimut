import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Timeline.svelte', import.meta.url), 'utf8');

describe('Timeline workspace', () => {
  it('loads a bounded visible window plus a separate overview', () => {
    expect(source).toContain('const PAGE = 200');
    expect(source).toContain("densityBucket = 'year'");
    // The first reading is by year and answers the extent; how finely the case can
    // then be cut is a question about the width it will be drawn at.
    expect(source).toContain('densityUnit(page.extent, overviewWidth)');
    expect(source).toContain("if (from) params.set('from', from)");
    expect(source).toContain("if (to) params.set('to', to)");
    expect(source).toContain('Load more · ${items.length} of ${total}');
  });

  it('samples a lane across the window instead of taking its first days', () => {
    expect(source).toContain("spread: 'true'");
    // The overview counts the whole case server-side and must stay a plain read,
    // or the two readings of the same window disagree.
    expect(source).not.toMatch(/bucket: densityBucket,\n\s*spread/);
    expect(source).toContain('A sample across the window. Load more fills it in.');
  });

  it('measures the axis and packs the rendered event width', () => {
    expect(source).toContain('new ResizeObserver');
    expect(source).toContain('layoutTimelineItems(');
    expect(source).toContain('from, to, plotWidth');
    expect(source).toContain('{#each track.layout.clusters as cluster');
    expect(source).toContain('onclick={() => expandTrack(baseId)}');
    expect(source).toContain('>Collapse</button>');
    expect(source.indexOf('aria-label="Timeline overview"')).toBeLessThan(
      source.indexOf('aria-label="Timeline axis"')
    );
  });

  it('keeps the current workspace in native full screen', () => {
    expect(source).toContain('await toolElement.requestFullscreen()');
    expect(source).toContain('await document.exitFullscreen()');
    expect(source).toContain("fullscreen ? 'Exit full screen' : 'Full screen'");
  });

  it('only creates assessments from the statement track', () => {
    expect(source).toContain("!track?.categories.includes('statement')");
    expect(source).toContain("event.target.closest('button')");
    expect(source).toContain('class:createable={canCreate}');
    expect(source).toContain('Click or drag to add an assessment');
    expect(source).toContain('Add assessment');
  });

  it('shows uncertainty through patterns and a visible legend', () => {
    expect(source).toContain('class:approximate={item.approximate}');
    expect(source).toContain('class:uncertain={item.uncertain}');
    expect(source).toContain("class:suggested={item.status === 'suggested'}");
    expect(source).toContain('text-decoration: line-through');
    expect(source).toContain('<summary>Legend</summary>');
    expect(source).toContain('Confidence and date quality are independent.');
    expect(source).toContain('Date: approximate');
    expect(source).toContain('closeOnOutsidePointer(legendElement, () => (legendOpen = false))');
    expect(source).toContain('bind:open={legendOpen}');
  });

  it('supports adaptive ticks, exact range controls and direct navigation', () => {
    expect(source).toContain('type="datetime-local"');
    expect(source).toContain('axisMinorTicks');
    expect(source).toContain('axisBands');
    expect(source).toContain('nowPosition');
    expect(source).toContain('onpointerdown={panStart}');
    expect(source).toContain('onwheel={navigateWheel}');
    expect(source).toContain('Wheel zoom · Shift-wheel pan');
    expect(source).toContain('if (!event.shiftKey && !horizontal)');
  });

  it('reads the window rather than spelling it out in seven controls', () => {
    // one face, two steps, and the boundaries under it
    expect(source).toContain('{windowWords(from, to, zone)}');
    expect(source).toContain('aria-expanded={rangeMenu}');
    expect(source).toContain('closeOnOutsidePointer(rangeElement, () => (rangeMenu = false))');
    expect(source).toContain('{#each WINDOW_SPANS as span (span.label)}');
    expect(source).toContain('onclick={() => setSpan(span.ms)}');
    expect(source).toContain('resizeWindow(from, to, span)');
    // the zoom pair and the loose All button are gone from the toolbar
    expect(source).not.toContain('class="zoom-controls"');
    expect(source).not.toContain('title="Zoom in"');
    expect(source).not.toContain('class="all-btn"');
  });

  it('makes a track readable in its gutter: the name, its hover, its colour', () => {
    expect(source).toContain('--gutter: 178px');
    expect(source).toContain('<strong>{track.label}</strong>');
    expect(source).toContain('title={trackTitle(track)}');
    expect(source).toContain('-webkit-line-clamp: 2');
    expect(source).not.toContain('track.short');
    // a colour the analyst chose wins for that track, and only there
    expect(source).toContain('style:--track-tint={trackTint(track.color)}');
    expect(source).toContain('--event-color: var(--track-tint, var(--track-media))');
    expect(source).toContain('background: var(--track-tint, var(--track-statement))');
  });

  it('makes the overview a category minimap with a movable window', () => {
    expect(source).toContain('bucket.categories?.[category.id]');
    expect(source).toContain('class="overview-drag"');
    expect(source).toContain('class="overview-handle start"');
    expect(source).toContain('overviewRecenter');
    expect(source).toContain('unplacedTotal} local');
    expect(source).toContain('exact counts on hover');
    expect(source).toContain('class="overview-tick {slot.anchor}"');
    // The ink answers the pointer and the box around it does not, so a bar the brush
    // covers can still be clicked instead of the press landing on the brush.
    expect(source).toContain('.density-bucket { position: absolute; z-index: 6;');
    expect(source).toContain('pointer-events: none;');
    expect(source).toContain('.density-stack { width: 100%;');
    expect(source).toContain('pointer-events: auto;');
    // What the window leaves out is dimmed rather than merely un-brushed.
    expect(source).toContain('class="overview-shade"');
  });

  it('offers readable events, a list view and a stable inspector column', () => {
    expect(source).toContain("viewMode === 'list'");
    expect(source).toContain('formatTemporalValue(item.raw).label');
    expect(source).toContain('class="timeline-tooltip"');
    expect(source).toContain("item.zone === 'date-only'");
    expect(source).toContain('class={`precision-span ${item.category}`}');
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) 330px');
    // the tool's own clock, not a target: nothing is being aimed at in an empty panel
    expect(source).toContain('<Icon name="clock" size={16} /><span>Select an entry</span>');
    expect(source).toContain('inspectorConnections.cites');
    expect(source).toContain('Add correction');
    expect(source).toContain("openEditor(null, selected?.raw ?? '', {");
  });

  it('keeps date edits confirmable by pointer and keyboard', () => {
    expect(source).toContain('moveTemporalRaw(edit.item, delta)');
    expect(source).toContain('resizeTemporalRaw(edit.item, edit.mode');
    expect(source).toContain('nudgeTemporalRaw(item, mode');
    expect(source).toContain('aria-label="Resize start"');
    expect(source).toContain("['ArrowLeft', 'ArrowRight'");
    expect(source).toContain("title={pendingEdit.item.shape === 'interval' ? 'Change this period?' : 'Move this date?'}");
  });

  it('separates local times from missing dates', () => {
    expect(source).toContain('!item.earliest && item.raw');
    expect(source).toContain('Not on UTC axis');
    expect(source).toContain('Timezone needed');
    expect(source).toContain('<Icon name="clock" size={14} />Undated');
  });

  it('builds case-owned tracks and saved Timeline readings', () => {
    expect(source).toContain('surface="timeline"');
    expect(source).toContain('capture={captureAnalysisView}');
    expect(source).toContain('groupedTimelineTracks(trackSpecs, baseTrackItems, groupBy, entityLabel)');
    expect(source).toContain('trackPresets(entityTypes())');
    expect(source).toContain('class="drag-track"');
    expect(source).toContain('draggable="true"');
    expect(source).toContain('Show hidden');
    expect(source).toContain('Pin in track');
    expect(source).toContain('Frozen view');
  });
});

describe('which clock the axis is read on', () => {
  it('keeps UTC as the default and stores nothing else', () => {
    // presentation only: the case is stored in UTC, the queries ask in UTC, and the
    // switch moves where the ticks fall and what they are called
    expect(source).toContain("let zoneChoice = $state('utc')");
    expect(source).toContain('axisTicks(from, to, plotWidth, zone)');
    expect(source).toContain('axisBands(from, to, plotWidth, zone)');
    expect(source).toContain('windowInputValue(from, zone)');
    expect(source).toContain('inputWindowValue(value, zone)');
  });

  it('hands the choice to one searchable picker', () => {
    // UTC, this computer, any zone in the world and the case's own saved points are
    // one decision, so they are one list rather than a switch plus a menu
    expect(source).toContain('<ZonePicker');
    expect(source).toContain('bind:choice={zoneChoice}');
    expect(source).toContain('resolved={zone}');
    expect(source).toContain('at={axisWindow?.start ?? 0}');
    expect(source).toContain("buildCatalogQuery(caseId, { types: ['place'], limit: 50 })");
  });

  it('reads a zone named outright, which carries no daylight', () => {
    // the investigation is at the other end of the world and the case has no saved
    // point there yet; a band of day and night needs coordinates, a label does not
    expect(source).toContain("if (zoneChoice.startsWith('zone:')) {");
    expect(source).toContain('return knownZone(named) ? named : UTC;');
  });

  it('waits for a point-s own zone rather than guessing one', () => {
    // the zone arrives with the daylight, so until it lands the axis stays on UTC
    expect(source).toContain('const named = daylight?.zone?.name;');
    expect(source).toContain('return named && knownZone(named) ? named : UTC;');
    expect(source).toContain("if (zoneChoice.startsWith('place:') && places.length && !sunPlace) zoneChoice = 'utc'");
  });

  it('keeps a snapshot on the clock captured with it', () => {
    expect(source).toContain("snapshotReading ? timelineViews.activeView?.spec?.timeline?.timezone ?? null : null");
    expect(source).toContain('if (frozenZone && knownZone(frozenZone)) return frozenZone;');
    expect(source).toContain('if (!caseId || snapshotReading) {\n      places = [];');
    expect(source).toContain('disabled={snapshotReading}');
  });

  it('draws day and twilight at that point, and says what it is of', () => {
    expect(source).toContain('/api/geo/daylight?');
    expect(source).toContain("ribbonBands(daylight?.day ?? [], from, to)");
    expect(source).toContain("ribbonBands(daylight?.civil ?? [], from, to)");
    expect(source).toContain('Daylight at {sunPlace.label}');
    // and a window too wide to draw says so instead of drawing a moiré
    expect(source).toContain('Zoom in past a month to draw it.');
    expect(source).toContain('Dark for the whole window.');
  });
});

describe('the queues for what has no place on the axis', () => {
  it('reads them from the page, never through a track-s hidden list', () => {
    // hiding tidies a lane, and an entry with no position was never in one: applied to
    // these, hiding only emptied the queue that exists to say they need a date
    expect(source).toContain('const pageItems = $derived.by(() => {');
    expect(source).toContain('for (const item of page?.items ?? []) unique.set(item.id, item);');
    expect(source).toContain("const unplaced = $derived(pageItems.filter((item) => !item.earliest && item.raw));");
    expect(source).toContain("const undated = $derived(pageItems.filter((item) => !item.earliest && !item.raw));");
    // the lanes themselves still answer to hiding
    expect(source).toContain('const dated = $derived(visibleItems.filter((item) => item.earliest));');
  });

  it('lets tracks own categories without a second global switch', () => {
    expect(source).toContain('trackSpecs.flatMap((track) => track.categories)');
    expect(source).not.toContain('category-filters');
    expect(source).not.toContain('Timeline categories');
  });

  it('offers neither pinning nor hiding for an entry with no lane', () => {
    expect(source).toContain('{#if selectedTrack && selected.earliest && !snapshotReading}');
    expect(source).toContain('{#if track && item.earliest && !snapshotReading}');
  });
});

describe('what an entry can be asked on a right-click', () => {
  it('names the four acts where the pointer is, on the axis and in the list', () => {
    expect(source).toContain('oncontextmenu={(event) => openItemMenu(event, item, baseId)}');
    expect(source).toContain('oncontextmenu={(event) => openItemMenu(event, item)}');
    expect(source).toContain('class="item-menu"');
    expect(source).toContain("{track.pinned.includes(item.id) ? 'Unpin from' : 'Pin in'} {track.label}");
    expect(source).toContain('Hide from {track.label}');
    expect(source).toContain('fromItemMenu((entry) => (detailsId = entry.owner_id))');
    expect(source).toContain('fromItemMenu((entry) => openEditor(entry))');
  });

  it('leaves the selection alone, so a pair being measured survives it', () => {
    // the inspector reaches the same acts and costs a selection to get there
    expect(source).toContain('itemMenu = {\n      item,\n      track: trackHolding(item, trackId),');
    expect(source).not.toContain('openItemMenu(event, item); selectItem(');
  });

  it('is one press, one act on macOS, where ctrl-click already measures', () => {
    expect(source).toContain('if (event.ctrlKey && event.button === 0) return;');
  });

  it('reads the entry before closing, and closes on the axis moving under it', () => {
    expect(source).toContain('const held = itemMenu;\n    itemMenu = null;');
    expect(source).toContain('closeOnOutsidePointer(itemMenuElement, () => (itemMenu = null))');
    expect(source).toContain("if (event.key === 'Escape' && itemMenu) itemMenu = null;");
    // panning, zooming and the wheel all move the spot the menu was opened on
    expect(source).toContain('itemMenu = null;\n    ({ from, to } = shiftWindow(from, to, fraction));');
    expect(source).toContain('itemMenu = null;\n    ({ from, to } = zoomWindow(from, to, factor, anchor));');
  });

  it('acts on the lane the entry was clicked in, from either surface', () => {
    expect(source).toContain('function trackHolding(item, trackId = null)');
    expect(source).toContain('function togglePinned(item = selected, track = selectedTrack)');
    expect(source).toContain('function hideFromTrack(item = selected, track = selectedTrack)');
    // hiding an entry cannot leave the panel or the measurement pointing at it
    expect(source).toContain('if (against?.id === item.id) against = null;');
  });

  it('draws over the tooltip it replaces, inside the full-screen element', () => {
    expect(source).toContain('.item-menu { position: fixed; z-index: 110;');
    expect(source.indexOf('{#if itemMenu}')).toBeLessThan(source.indexOf('{#if tooltip}'));
  });
});

describe('measuring between two entries', () => {
  it('holds a second entry on Ctrl-click, without starting a drag', () => {
    expect(source).toContain('if ((event?.ctrlKey || event?.metaKey) && selected && selected.id !== item.id)');
    expect(source).toContain('against = against?.id === item.id ? null : item;');
    expect(source).toContain('if (event.ctrlKey || event.metaKey) return;');
    expect(source).toContain('selectItem(item, baseId, event)');
  });

  it('reads the figure out in the inspector, with what it rests on', () => {
    expect(source).toContain('describePair(selected, against)');
    expect(source).toContain('{pairReading.headline}');
    expect(source).toContain('{pairReading.detail}');
    expect(source).toContain('{#each pairReading.notes as note (note)}');
  });

  it('teaches the gesture, since nothing else announces it', () => {
    expect(source).toContain('Ctrl-click a second entry to measure between them.');
    expect(source).toContain('class:against={against?.id === item.id}');
  });

  it('drops the pair when a different entry is selected outright', () => {
    expect(source).toContain('selected = item;\n    against = null;');
  });
});

describe('exporting the axis', () => {
  it('serialises the tracks the tool laid out, never a canvas', () => {
    expect(source).toContain('timelinePlate({');
    expect(source).toContain('const tracks = $derived(buildTracks(plotWidth));');
  });

  it('lays the page out at the plate’s width, not the browser’s', () => {
    // `layoutTimelineItems` packs lanes by the pixels a label takes, so the width it is
    // given decides what collides and what ends up in a `+n`. Replaying the screen's
    // answer on a fixed page would put the gaps in the wrong places, and the same saved
    // view would export differently from a laptop and from a wide monitor.
    expect(source).toContain('tracks: buildTracks(PLATE_PLOT)');
    expect(source).toContain('ticks: axisTicks(from, to, PLATE_PLOT, zone)');
    expect(source).toContain('minorTicks: axisMinorTicks(from, to, PLATE_PLOT, zone)');
    expect(source).toContain('bands: axisBands(from, to, PLATE_PLOT, zone)');
    expect(source).toContain('scaleWord: axisScale(from, to, PLATE_PLOT)');
  });

  it('exports the window and the clock the reading was made on', () => {
    expect(source).toContain('window: windowWords(from, to, zone)');
    expect(source).toContain('clock: zoneWord');
  });

  it('states the entries the axis cannot hold', () => {
    expect(source).toContain('undated entr${undatedTotal === 1');
  });

  it('offers the export beside the saved views', () => {
    expect(source).toContain('<PlateExport surface="timeline" plate={capturePlate}');
  });
});
