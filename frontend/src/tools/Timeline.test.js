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
    // the whole-case strip sits under the axis, so the axis stays put when it arrives
    expect(source.indexOf('aria-label="Timeline overview"')).toBeGreaterThan(
      source.indexOf('aria-label="Timeline axis"')
    );
  });

  it('keeps the current workspace in native full screen', () => {
    expect(source).toContain('await toolElement.requestFullscreen()');
    expect(source).toContain('await document.exitFullscreen()');
    // entered from `⋯`, left from the bar, where it can be seen while it is on
    expect(source).toContain('{#if !fullscreen}<button class="more-act"');
    expect(source).toContain('{#if fullscreen}<button class="btn btn-sm" onclick={toggleFullscreen}>Exit full screen</button>{/if}');
  });

  it('only creates assessments from the statement track', () => {
    expect(source).toContain("!track?.categories.includes('statement')");
    expect(source).toContain("event.target.closest('button')");
    expect(source).toContain('class:createable={canCreate}');
    expect(source).toContain('Click or drag to date a new entry');
    expect(source).toContain('offerDate(draftWhen(from, to, draft.start, draft.end));');
  });

  it('writes a new entry on the line under the axis, and none over a snapshot', () => {
    expect(source).toContain("{#if caseState.current && !snapshotReading}");
    expect(source).toContain('<EntryLine');
    expect(source).toContain('announce={false}');
    expect(source).toContain('onsaved={lineAdded}');
    expect(source).toContain("'Added · not in the tracks shown'");
    expect(source).toContain("'Added · outside this window'");
  });

  it('shows uncertainty through patterns and a visible legend', () => {
    expect(source).toContain('class:approximate={item.approximate}');
    expect(source).toContain('class:uncertain={item.uncertain}');
    expect(source).toContain("class:suggested={item.status === 'suggested'}");
    expect(source).toContain('text-decoration: line-through');
    expect(source).toContain('<summary>Legend</summary>');
    expect(source).toContain('Confidence and date quality are independent.');
    expect(source).toContain('Date: approximate');
    // under `⋯`, where it closes with the menu that holds it
    expect(source).toContain('<details class="legend">');
  });

  it('supports adaptive ticks, exact range controls and direct navigation', () => {
    expect(source).toContain('type="datetime-local"');
    expect(source).toContain('axisMinorTicks');
    expect(source).toContain('axisBands');
    expect(source).toContain('nowPosition');
    expect(source).toContain('onpointerdown={panStart}');
    expect(source).toContain('onwheel={navigateWheel}');
    // said where the window is read, not as a line of mouse hints across the header
    expect(source).toContain(' · Scroll to zoom, Shift-scroll to pan`}');
    expect(source).not.toContain('Wheel zoom · Shift-wheel pan');
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
    expect(source).toContain('<strong dir="auto">{track.label}</strong>');
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
    expect(source).not.toContain('exact counts on hover');
    expect(source).toContain('class="overview-tick {slot.anchor}"');
    // only once the window leaves part of the case out, and named where names fit
    expect(source).toContain('const overviewShown = $derived(overviewNeeded(extent, axisWindow));');
    expect(source).toContain('{#if overviewShown}');
    expect(source).toContain('{#each overviewNames as slot (slot.key)}');
    // its height comes out of the list, not out of the lanes being read
    expect(source).toContain('const axisMax = $derived(Math.max(150, Math.round((chronologyHeight - 130) * axisShare)));');
    // The ink answers the pointer and the box around it does not, so a bar the brush
    // covers can still be clicked instead of the press landing on the brush.
    expect(source).toContain('.density-bucket { position: absolute; z-index: 6;');
    expect(source).toContain('pointer-events: none;');
    expect(source).toContain('.density-stack { width: 100%;');
    expect(source).toContain('pointer-events: auto;');
    // What the window leaves out is dimmed rather than merely un-brushed.
    expect(source).toContain('class="overview-shade"');
  });

  it('offers readable events, a list view and an inspector while an entry is picked', () => {
    expect(source).toContain("viewMode === 'list'");
    expect(source).toContain('formatTemporalValue(item.raw, item.tz).label');
    expect(source).toContain('class="timeline-tooltip"');
    // one shape per kind of date, decided by the layout rather than by the zone
    expect(source).toContain('class={`timeline-event ${item.category} ${item.mark}`}');
    expect(source).not.toContain('precision-span');
    expect(source).not.toContain('translateX(-8px)');
    expect(source).not.toContain('end-aligned');
    // the column is there only while an entry is picked: empty, it held a third of
    // the width for "Select an entry"
    expect(source).toContain('.timeline-grid.inspecting { grid-template-columns: minmax(0, 1fr) 330px; }');
    expect(source).toContain('class:inspecting={Boolean(selected)}');
    expect(source).toContain('{#if selected}\n    <aside class="inspector">');
    expect(source).not.toContain('Select an entry');
    expect(source).toContain('inspectorConnections.cites');
    // a file's date is corrected once, under the date, not a second time in the footer
    expect(source).not.toContain('>Add correction</button>');
    expect(source).toContain("openEditor(null, selected?.raw ?? '', {");
  });

  it('keeps date edits confirmable by pointer and keyboard', () => {
    expect(source).toContain('moveTemporalRaw(edit.item, delta)');
    expect(source).toContain('resizeTemporalRaw(edit.item, edit.mode');
    expect(source).toContain('nudgeTemporalRaw(item, mode');
    expect(source).toContain('aria-label="Resize start"');
    expect(source).toContain("['ArrowLeft', 'ArrowRight'");
    expect(source).toContain("title={!pendingEdit.item.raw ? 'Date this entry?' : pendingEdit.item.shape === 'interval' ? 'Change this period?' : 'Move this date?'}");
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
  it('opens on the zone of the case-s places and stores nothing else', () => {
    // presentation only: the case is stored in UTC, the queries ask in UTC, and the
    // switch moves where the ticks fall and what they are called
    expect(source).toContain("let zoneChoice = $state('case')");
    expect(source).toContain("if (zoneChoice === 'case') return caseClock && knownZone(caseClock.zone) ? caseClock.zone : UTC;");
    expect(source).toContain('caseZone(points)');
    // the clock picked is kept per case
    expect(source).toContain('zoneChoice = rememberedClock(caseId);');
    expect(source).toContain('onpick={(value) => rememberClock(caseState.current?.id, value)}');
    expect(source).toContain('home={caseClock}');
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
    expect(source).toContain("if (zoneChoice.startsWith('place:') && places.length && !sunPlace) zoneChoice = 'case'");
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
    expect(source).toContain("if (itemMenu) itemMenu = null;\n    else if (moreMenu) moreMenu = false;");
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

describe('one reading, the axis over the list', () => {
  it('draws both whatever the mode, which only says which one gets the room', () => {
    expect(source).not.toContain("{#if viewMode === 'plot'}");
    expect(source).toContain('const SHARES = { plot: 0.62, list: 0.28 };');
    expect(source).toContain('style:max-height={`${axisMax}px`}');
    expect(source).toContain('role="separator"');
    expect(source).toContain("onclick={() => setViewMode('list')}");
  });

  it('lists the window with what each entry is about, where, on what, and still waits for', () => {
    expect(source).toContain('<div class="list-grid" role="grid" aria-label="Chronology"');
    expect(source).toContain('<span role="columnheader">Statement</span>');
    // a link column only when some entry of the window fills it
    for (const [key, heading] of [['subjects', 'Subjects'], ['places', 'Places'], ['sources', 'Sources']]) {
      expect(source).toContain(`{#if listColumns.${key}}<span role="columnheader">${heading}</span>{/if}`);
    }
    expect(source).toContain('style:--list-columns={listTemplate}');
    expect(source).toContain('grid-template-columns: var(--list-columns');
    // an instant on the axis's clock, named in the heading, and a day as stated
    expect(source).toContain("{zone === UTC ? 'Date' : `Date · ${zoneWords(zone).place} time`}");
    expect(source).toContain('instantOnClock(item) ? clockReading(item.earliest, zone, { named: false }) : formatTemporalValue(item.raw, item.tz).label');
    expect(source).toContain("flags.push({ id: 'unsourced', label: 'no source' })");
    expect(source).toContain("flags.push({ id: 'unassessed', label: 'not assessed' })");
    // only a Claim is asked for a source and an assessment
    expect(source).toContain("if (item.kind === 'claim') {");
  });

  it('lights the mark and the row of the entry under the pointer, both ways', () => {
    expect(source).toContain('class:lit={hovered === item.id}');
    expect(source).toContain('onpointerenter={() => hoverRow(item)}');
    expect(source).toContain('selectItem(item, baseId, event); revealRow(item.id);');
  });

  it('copies the whole window, not the page, as Markdown or a spreadsheet block', () => {
    expect(source).toContain("copyChronology('markdown')");
    expect(source).toContain("copyChronology('block')");
    expect(source).toContain('await readChronology((url) => api.get(url)');
    // a frozen reading copies what it froze and asks nothing of the case
    expect(source).toContain('? { items: windowItems, truncated: false }');
  });

  it('draws the Media lane as the files its events date, and opens the event when one is picked', () => {
    expect(source).toContain('.map((item) => ({ ...(drawsFiles(track) ? asFile(item) : item), pinned:');
    expect(source).toContain('statement: item.label, asFile: true');
    // one item on two lanes is picked as its event, never as its file
    expect(source).toContain("const item = picked?.asFile ? pageItems.find((row) => row.id === picked.id) ?? picked : picked;");
    expect(source).toContain("detail: item.asFile ? item.statement :");
    // a file is dated from its proof or an event, not by clicking its lane
    expect(source).toContain("canCreate = track.categories.includes('statement') && !drawsFiles(track) && !snapshotReading");
    expect(source).toContain("!track?.categories.includes('statement') || drawsFiles(track) ||");
    expect(source).toContain("(item.category === 'media' || item.asFile) && item.thumb");
  });

  it('opens on the dated files over the events and says how many file dates an empty axis leaves out', () => {
    expect(source).toContain('let trackSpecs = $state(defaultTimelineTracks());');
    expect(source).toContain('/timeline?category=media&include_undated=false&limit=1');
    expect(source).toContain('>Show them</button>');
    // what was counted is what "Show them" puts on the axis
    expect(source).toContain("read from {workingFilesHeld ? 'working files' : 'files'}");
    expect(source).toContain('trackSpecs = workingFilesHeld');
    expect(source).toContain("mediaTrack(trackSpecs, { collectedOnly: false })");
  });

  it('adds the track a handed-over file date or filing lives on before looking for it', () => {
    expect(source).toContain("startsWith('temporal:media:') ? 'media'");
    expect(source).toContain('    ensureTrackFor(itemId, producedHere);');
    // a working file is let back onto the Media track that held it back
    expect(source).toContain("producedHere && holding.length && holding.every(holdsBackWorkingFiles)");
    expect(source).toContain("handOverSelection(focus.itemId, focus.producedHere === true);");
  });

  it('lands on the Undated queue when the Overview sent it there', () => {
    expect(source).toContain("if (queue === 'undated') {");
    expect(source).toContain('bind:open={undatedOpen} bind:this={undatedElement}');
  });
});

describe('reading a mark', () => {
  it('draws a line up to the ruler with the date as written, for one end or both', () => {
    expect(source).toContain("const lines = item.mark === 'point' ? [middle] : [mark.left, mark.right];");
    expect(source).toContain('class="time-guide" aria-hidden="true"');
    expect(source).toContain("label: formatTemporalValue(item.raw ?? '', item.tz).label");
    expect(source).toContain('showGuide(event.currentTarget, item)');
  });

  it('captions and cards belong to the mark, so reading one is clicking it', () => {
    const button = source.slice(source.indexOf('class="event-select"'), source.indexOf('class="move-grip"'));
    expect(button).toContain('class={`event-caption ${item.caption.side}`}');
    expect(button).toContain('class="event-card"');
    expect(button).toContain('loading="lazy"');
  });

  it('walks entries with Alt and an arrow, and keeps every other key for the canvas', () => {
    expect(source).toContain("if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;");
    expect(source).toContain("if (event.key === 'Enter' || event.key === ' ') {");
    expect(source).toContain('onkeydown={(event) => markKey(event, track, item)}');
  });

  it('explains the three shapes in the legend', () => {
    for (const shape of ['Instant', 'Reduced date, across what it covers', 'Period']) {
      expect(source).toContain(`></i>${shape}</span>`);
    }
  });

  it('asks the export for no selection, so a plate does not depend on a click', () => {
    expect(source).toContain('tracks: buildTracks(PLATE_PLOT)');
    expect(source).not.toContain('buildTracks(PLATE_PLOT, selected');
  });
});

describe('exporting the axis', () => {
  it('serialises the tracks the tool laid out, never a canvas', () => {
    expect(source).toContain('timelinePlate({');
    expect(source).toContain('const tracks = $derived(buildTracks(plotWidth, selected?.id ?? null));');
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

describe('the file an entry is about', () => {
  it('opens the inspector on it, the file an event is about, or the first it cites', () => {
    expect(source).toContain("const PREVIEWS = new Set(['media', 'capture']);");
    // a proof's date is stated about the footage and cites the proof: the video is shown
    expect(source).toContain(
      "const file = out.find((row) => row.link?.type === 'about') ?? out.find((row) => row.link?.type === 'cites');"
    );
    const body = source.indexOf('<div class="inspector-body">');
    expect(source.indexOf('<MediaPreview', body)).toBeLessThan(source.indexOf('<div class="item-kind">', body));
  });

  it('goes to its own line when the topbar asks for Add event, about the picked file', () => {
    expect(source).toContain('if (!snapshotReading) untrack(() => focusLine());');
    expect(source).toContain('lineFile = file ? { id: file.id, label: file.label, type: file.type, attrs: file.attrs ?? {} } : null;');
    expect(source).toContain('Add event from this file');
    // another entry picked lets go of the file
    expect(source).toContain('if (lineFile && lineFile.id !== picked) lineFile = null;');
  });
});

describe('changing a picked entry’s date', () => {
  it('is offered where the date is read, and confirmed like a drag', () => {
    expect(source).toContain("{selected.raw ? 'Change the date' : 'Give it a date'}");
    expect(source).toContain('pendingEdit = { item: selected, raw: dateEditing.value };');
    // a file keeps its own date and is corrected beside it
    expect(source).toContain('<Icon name="edit" size={12} /> Correct this date');
  });

  it('says both dates in words when it asks', () => {
    expect(source).toContain("detail={`${pendingEdit.item.raw ? formatTemporalValue(pendingEdit.item.raw).label : 'Undated'} → ${formatTemporalValue(pendingEdit.raw).label}`}");
  });
});

describe('one bar over the axis', () => {
  it('keeps the period, its clock and the split in the open, and the rest under ⋯', () => {
    expect(source).toContain('<header class="timeline-bar">');
    // no title repeating the tab, no Add beside the line that adds
    expect(source).not.toContain('class="title-block"');
    expect(source).not.toContain('class="btn btn-primary add-event"');
    expect(source).not.toContain('across tracks');
    // tracks, grouping and the period handed on wait under one button
    const menu = source.slice(source.indexOf('<div class="more-menu">'), source.indexOf('</header>'));
    expect(menu).toContain('trackPresets(entityTypes())');
    expect(menu).toContain('<select class="input input-sm" bind:value={groupBy}');
    expect(menu).toContain('Open this period in');
    expect(menu).toContain("openRangeIn('satellite')");
    expect(source).toContain('closeOnOutsidePointer(moreElement, () => (moreMenu = false))');
  });

  it('puts a lane-s own tools under the pointer, and a count only where there is one', () => {
    expect(source).toContain('.drag-track, .track-actions { opacity: 0;');
    expect(source).toContain('.track-row:hover .drag-track, .track-row:hover .track-actions');
    expect(source).toContain('@media (hover: none) { .drag-track, .track-actions { opacity: 1; } }');
    expect(source).toContain('{#if shown || track.total}');
  });

  it('prints only the ruler names that fit, and says its clock in words', () => {
    expect(source).toContain('const tickNames = $derived(fitTicks(ticks, plotWidth));');
    expect(source).toContain('const bandNames = $derived(fitBands(bands, plotWidth));');
    expect(source).toContain('{#each tickNames as tick (tick.at)}');
    expect(source).toContain("{#if zone !== UTC}<small>{zoneWords(zone).place} time</small>{/if}");
    // the window's boundaries in ISO no longer sit in the corner, only on hover
    expect(source).not.toContain("<small>{windowInputValue(from, zone).replace('T', ' ')}");
  });
});

describe('the picked entry', () => {
  it('is named the way its track is, once', () => {
    expect(source).toContain("const HEADINGS = { statement: 'Event', media: 'File date', case_activity: 'Case activity' };");
    expect(source).toContain("{#if selected.kind !== 'claim' || selected.time_role}");
  });

  it('reads an instant on the axis clock first, the stated value under it', () => {
    expect(source).toContain('<strong>{clockReading(selected.earliest, zone)}</strong>');
    expect(source).toContain('<small class="as-stated">{selectedReading.label}</small>');
  });

  it('folds how the date is held, keeping every word of it', () => {
    const fold = source.slice(source.indexOf('<details class="date-more">'), source.indexOf('</details>', source.indexOf('<details class="date-more">')));
    expect(fold).toContain('<summary>About this date</summary>');
    expect(fold).toContain('{#if selected.tz || selected.zone} · {selected.tz || selected.zone}{/if}');
    expect(fold).toContain('<dd>{temporalZoneWords(selected)}</dd>');
    expect(fold).toContain('Ctrl-click a second entry to measure between them.');
  });
});
