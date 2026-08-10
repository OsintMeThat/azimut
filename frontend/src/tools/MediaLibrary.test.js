import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MediaLibrary.svelte', import.meta.url), 'utf8');

function cssBlock(selector) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n  }', start);
  return end < 0 ? '' : source.slice(start, end);
}

describe('Media Library thumbnail layout', () => {
  it('keeps every thumbnail in a fixed frame regardless of source dimensions', () => {
    const thumb = cssBlock('.thumb');

    expect(thumb).toContain('width: 100%;');
    expect(thumb).toContain('aspect-ratio: 16 / 10;');
    expect(thumb).toContain('min-height: 0;');
    expect(thumb).toContain('overflow: hidden;');
    expect(thumb).toContain('flex: 0 0 auto;');
  });

  it('prevents the thumbnail image from contributing intrinsic dimensions', () => {
    const image = cssBlock('.thumb img');

    expect(image).toContain('position: absolute;');
    expect(image).toContain('inset: 0;');
    expect(image).toContain('display: block;');
    expect(image).toContain('min-width: 0;');
    expect(image).toContain('min-height: 0;');
    expect(image).toContain('object-fit: cover;');
  });
});

describe('Media Library thumbnail states', () => {
  it('shows the image only when its thumbnail is ready and not broken', () => {
    // The ready branch and broken-thumb key include the case id: two cases may
    // legitimately use the same relative media path.
    expect(source).toContain("item.thumb_state === 'ready' && !brokenThumbs.has(mediaKey(item))");
    expect(source).toContain('data-media-key={mediaKey(item)}');
    expect(source).toContain('onerror={markBrokenThumb}');
    // lazy + async decode per the doc's UI failure behaviour
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('decoding="async"');
  });

  it('renders a generating placeholder and a retry affordance for failures', () => {
    expect(source).toContain("item.thumb_state === 'queued' || item.thumb_state === 'running'");
    expect(source).toContain('Generating…');
    expect(source).toContain("item.thumb_state === 'failed'");
    expect(source).toContain('regenerateThumbs(item.path)');
  });

  it('polls while thumbnails are pending and only while the tool is visible', () => {
    expect(source).toContain("(pl.facets?.thumbnail_pending ?? 0) > 0");
    expect(source).toContain("i.thumb_state === 'queued' || i.thumb_state === 'running'");
    expect(source).toContain("if (!thumbsPending || uiState.tool !== 'media' || !caseState.current) return;");
    expect(source).toContain('/media/thumbnails/regenerate');
  });

  it('keeps polling for jobs outside the loaded media page', () => {
    expect(source).toContain('pl.facets?.thumbnail_pending');
  });

  it('repeats the poll (not a one-shot timer that leaves a slow thumbnail stuck)', () => {
    // a self-repeating poll, so a thumbnail slower than one tick still resolves
    // without a page reload; the effect alone would not re-arm while pending
    expect(source).toContain('pollWhile(() => thumbsPending, () => refresh(), 1500)');
    expect(source).not.toContain('setTimeout(() => refresh()');
  });
});

describe('Media Library enrichment', () => {
  it('offers an explicit local backfill instead of running one on mount', () => {
    expect(source).toContain('async function enrichMedia()');
    expect(source).toContain('await api.post(`/api/cases/${id}/media/enrich`, {})');
    expect(source).toContain('title="Read image EXIF, hashes and video metadata locally"');
    expect(source).toContain('<Icon name="search" size={15} /> Enrich');
  });

  it('polls media and Suggestions while enrichment is running', () => {
    expect(source).toContain("i.enrich_state === 'queued' || i.enrich_state === 'running'");
    expect(source).toContain(
      "if (!enrichmentPending || uiState.tool !== 'media' || !caseState.current) return;"
    );
    expect(source).toContain('() => Promise.all([refresh(), reloadCase()])');
    expect(source).toContain('await refresh();');
  });
});

describe('Media Library positions', () => {
  it('filters on the position server-side, so it holds over a paged case', () => {
    expect(source).toContain('gps: gpsOnly');
    expect(source).toContain('function toggleGpsOnly()');
    expect(source).toContain('reloadIfServerBacked();');
    // ...and client-side too, for the case that fits one page
    expect(source).toContain('gpsOnly,');
  });

  it('counts the located files from the server facet, not from the loaded page', () => {
    expect(source).toContain('pl.facets?.gps_count ?? items.filter((i) => mediaPoint(i)).length');
  });

  it('hides the filter entirely in a case where nothing carries a position', () => {
    expect(source).toContain('{#if gpsCount || gpsOnly}');
  });

  it('marks a located row with one glyph and keeps the coordinates in the tooltip', () => {
    // the row is read by its filename; coordinates belong in the tooltip and on
    // the map, not appended to every title
    expect(source).toContain('function pointLabel(item)');
    expect(source).toContain('title={`Metadata says ${pointLabel(item)} — show it on the map`}');
    expect(source).toContain('<Icon name="pin" size={11} />');
    expect(source).not.toContain('{pointLabel(item)}<');
  });

  it('sends a stated position to the map without disturbing the thumbnail', () => {
    expect(source).toContain('function showOnMap(item, event)');
    expect(source).toContain('event?.stopPropagation();');
    expect(source).toContain('gotoPoint(point.lat, point.lon)');
  });
});

describe('Media Library — what the case collected', () => {
  it('is a switch beside the chips, not another chip', () => {
    // The chips are single-select and each says "show me only X". This is the
    // other axis — get X out of my way — the way the position filter already is.
    expect(source).toContain('function toggleCollectedOnly()');
    expect(source).toContain('aria-pressed={!collectedOnly}');
  });

  it('opens on what the case collected, working files held back', () => {
    expect(source).toContain('let collectedOnly = $state(true)');
  });

  it('filters server-side, so the counts and the paging cannot disagree with it', () => {
    expect(source).toContain('collectedOnly,');
    // ...and through the same shared predicate client-side
    expect(source).toContain('isMadeHere');
  });

  it('refetches on every toggle, since the loaded page is already the subset', () => {
    // The other filters only narrow what was loaded; this one is on at load, so
    // turning it off has to go and get the working files.
    expect(source).toContain(
      'function toggleCollectedOnly() {\n    collectedOnly = !collectedOnly;'
    );
    expect(source).toContain('if (caseState.current) pl.reload();');
  });

  it('says how many it is holding back rather than hiding them quietly', () => {
    expect(source).toContain('pl.facets?.made_here_count ?? items.filter(isMadeHere).length');
    expect(source).toContain('`Show ${madeHereCount} working file${madeHereCount > 1 ? \'s\' : \'\'}`');
    expect(source).toContain(": 'Hide working files'");
  });

  it('does not appear in a case that made nothing', () => {
    expect(source).toContain('{#if madeHereCount || !collectedOnly}');
  });

  it('tells a case of nothing but working files that it holds some', () => {
    // Without this the default hides every file the case has and the grid says
    // "No media yet", which is false.
    expect(source).toContain(
      '{#if !items.length && !jobs.length && !browseFiltersActive && madeHereCount}'
    );
    expect(source).toContain('<h3>Nothing collected yet</h3>');
  });

  it('counts as a browse filter only once the working files are showing', () => {
    expect(source).toContain('|| gpsOnly || !collectedOnly');
  });
});

describe('Media Library names', () => {
  it('shows the canonical stem once and keeps the extension out of the title', () => {
    expect(source).toContain('<span class="list-name">{item.title ?? item.filename}</span>');
    expect(source).not.toContain('class="list-filename"');
  });
});

describe('Media Library bounded loading', () => {
  it('browses via the bounded /media/page endpoint, not the unbounded list', () => {
    expect(source).toContain('createPagedList');
    expect(source).toContain('buildMediaQuery(caseState.current?.id');
    // the browse view must not fetch the whole media list on mount
    expect(source).not.toMatch(/api\.get\(`\/api\/cases\/\$\{[^}]+\}\/media`\)/);
    expect(source).toContain('category: catFilter');
  });

  it('shares the SearchInput and pages the rest in with Show more', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('pl.setQuery(query)');
    expect(source).toContain('{#if pl.hasMore}');
    expect(source).toContain('pl.loadMore()');
  });

  it('clears the previous case before loading the next', () => {
    expect(source).toContain('pl.clear()');
  });

  it('resets broken-thumbnail flags on case change so they never leak across cases', () => {
    // During a case switch there is one render where the new case id is paired
    // with the old case's items, so each <img> 404s and reports into
    // brokenThumbs. Those flags must not survive into the next case or they hide
    // that case's ready thumbnails until a page reload.
    const effect = source.slice(
      source.indexOf('const id = caseState.current?.id;'),
      source.indexOf('if (id) pl.reload();')
    );
    expect(effect).toContain('pl.clear()');
    expect(effect).toContain('brokenThumbs = new Set()');
  });

  it('recreates media rows when the case changes even if relative paths match', () => {
    expect(source).toContain('{#each filteredItems as item (mediaKey(item))}');
    expect(source).toContain("const mediaKey = (item) => `${caseState.current?.id ?? ''}/${item.path}`");
  });
});

describe('Media Library search empty state', () => {
  it('keeps the search bar available when a search has no matches', () => {
    expect(source).toContain('const browseFiltersActive = $derived(');
    expect(source).toContain('query.length > 0 || catFilter !== null || folderFilter !== null');
    expect(source).toContain(
      'const showBrowseBar = $derived(items.length > 0 || browseFiltersActive || madeHereCount > 0)'
    );
    expect(source).toContain('{#if showBrowseBar}');
    expect(source).toContain('{:else if !items.length && !jobs.length && !browseFiltersActive}');
  });

  it('describes media fields without mentioning notes', () => {
    expect(source).toContain('placeholder="Search name, source…"');
    expect(source).not.toContain('placeholder="Search name, notes, source…"');
  });
});

describe('Media Library browse controls', () => {
  it('separates satellite captures from generic Images', () => {
    expect(source).toContain("match: isGenericImage");
    expect(source).toContain("match: isSatelliteMedia");
    expect(source).toContain('mediaDisplayKind(item)');
  });

  it('offers grids plus a plain, sortable details list', () => {
    expect(source).toContain("let sort = $state('name')");
    expect(source).toContain("let view = $state('large')");
    expect(source).toContain("{ id: 'small', label: 'Small'");
    expect(source).toContain("{ id: 'large', label: 'Large'");
    expect(source).toContain("{ id: 'list', label: 'List'");
    expect(source).toContain('onSortSelect');
    expect(source).toContain('class:compact={view === \'small\'}');
    expect(source).toContain("{#if view === 'list'}");
    expect(source).toContain('class="media-list"');
    expect(source).toContain('const LIST_SORTS = [');
    expect(source).toContain('function setHeaderSort(next)');
    expect(source).toContain('class="media-row media-head"');
    expect(source).toContain('class="media-row" class:focused={item.path === focusedPath}');
    expect(source).not.toContain('.list-view .media-card');
  });

  it('keeps the browse bar and list headers visible while the results scroll', () => {
    expect(source).toContain('.folder-bar {\n    position: sticky;\n    top: 0;');
    expect(source).toContain('.media-head {\n    position: sticky;\n    top: 0;');
    // The outer tool body owns vertical scrolling, so the header must not be
    // trapped in a nested scrolling container.
    expect(source).not.toContain('.media-list {\n    overflow-x: auto;');
  });

  it('uses one fixed grid definition for the header and each media row', () => {
    // still one fixed grid — an `auto` actions column is empty in the header and
    // wide in a data row, which shifts every sortable heading out of alignment.
    // The actions width is computed from the button metrics rather than typed;
    // the literal it replaced fitted exactly five buttons and clipped the sixth.
    expect(source).toContain(
      '--media-columns: 54px minmax(180px, 1fr) 90px 82px minmax(100px, 0.45fr) 132px'
    );
    expect(source).toContain('grid-template-columns: var(--media-columns);');
    expect(source).not.toContain('132px auto;');
    expect(source).not.toContain('132px 168px;');
  });

  it('uses one folder dropdown and keeps its default unfiltered', () => {
    expect(source).toContain('class="select folder-select"');
    expect(source).toContain("value={folderFilter ?? ''}");
    expect(source).toContain('<option value="">All folders</option>');
    expect(source).toContain('onFolderSelect');
    expect(source).toContain('folder: folderFilter');
    expect(source).toContain('pl.facets?.folder_counts');
  });

  it('uses one dropdown for type and source filters', () => {
    expect(source).toContain('class="select category-select"');
    expect(source).toContain("value={catFilter ?? ''}");
    expect(source).toContain('<option value="">All types</option>');
    expect(source).toContain('onCategorySelect');
    expect(source).toContain('{c.label} ({c.count})');
    expect(source).toContain('pl.facets?.category_counts?.[c.key]');
    expect(source).toContain('reloadIfServerBacked();');
    expect(source).not.toContain('class="folder-chip"');
  });

  it('resets the other facet when a folder/type combination is empty', () => {
    expect(source).toContain('hasMediaForFilters(items');
    expect(source).toContain('if (resetCategory) catFilter = null');
    expect(source).toContain('if (resetFolder) {');
    expect(source).toContain('folderFilter = null;');
  });

  it('offers a right-side reset button for all browse filters', () => {
    expect(source).toContain('function resetFilters()');
    expect(source).toContain("query = '';\n    catFilter = null;\n    folderFilter = null;\n    gpsOnly = false;\n    collectedOnly = true;\n    sort = 'name';\n    sortDirection = 'asc';");
    expect(source).toContain('class="btn btn-ghost btn-sm reset-filters"');
    expect(source).toContain('Reset filters');
    expect(source).toContain('<Icon name="reset" size={13} /> Reset filters');
    expect(source).toContain('disabled={!filtersActive}');
  });
});

describe('Media Library gated-download cookie affordance', () => {
  it('keeps the first attempt cookie-less and only opts in on retry', () => {
    // default download path never asks for cookies (local-first)
    expect(source).toContain('async function startDownload(target, index = null, title = null, useCookies = false)');
    expect(source).toContain('use_cookies: useCookies');
  });

  it('surfaces a login wall as the cookie prompt, not a plain error', () => {
    expect(source).toContain("status.status === 'done' && status.result?.needs_auth");
    expect(source).toContain('authPrompt = {');
    expect(source).toContain('platform: status.result.platform');
    expect(source).toContain('guidance: status.result.guidance');
  });

  it('states plainly that it borrows an existing login and never a password', () => {
    expect(source).toContain("already signed in to this site");
    expect(source).toContain('it never asks for a password');
  });

  it('retries with a saved browser source and re-downloads signed in', () => {
    expect(source).toContain("download_cookies: { source: 'browser', browser: authPrompt.browser }");
    expect(source).toContain('startDownload(url, index, title, true)');
  });

  it('offers the cookies.txt file fallback', () => {
    expect(source).toContain("await api.post('/api/settings/cookies-file', form)");
    expect(source).toContain('Use a cookies.txt file');
  });

  it('blocks the browser read for Chromium on Windows and steers to the file', () => {
    expect(source).toContain("authPrompt.guidance === 'windows-chromium'");
    expect(source).toContain("authPrompt.platform === 'win32' && CHROMIUM_BROWSERS.has(authPrompt.browser)");
    expect(source).toContain('disabled={authPrompt.busy || chromiumBlocked}');
  });
});

describe('row and card actions fit', () => {
  const source = readFileSync(new URL('./MediaLibrary.svelte', import.meta.url), 'utf8');

  it('sizes the list actions cell from the widest row, not from a literal', () => {
    // six at its widest: GPS pin, info, open, inspect, proof, delete. A typed
    // width goes stale the next time a tool earns a row action, and the symptom
    // is Delete clipped off the end of the row.
    expect(source).toContain('--media-action: 32px');
    expect(source).toContain(
      '--media-actions: calc(6 * var(--media-action) + 5 * var(--media-action-gap) + 10px)'
    );
    // sized to the exact sum, the cell fits only until a sub-pixel of rounding
    // says otherwise, and then Delete wraps to a line of its own
    expect(source).toContain('flex-wrap: nowrap;');
    expect(source).toContain('var(--media-actions);');
    expect(source).toContain('min-width: calc(624px + var(--media-actions));');
    // and the cell's own gap is the one the width was computed from
    expect(source).toContain('gap: var(--media-action-gap);');
  });

  it('keeps export only in Details, directly below the preview', () => {
    expect(source).not.toContain('title="Export file"');
    expect(source).not.toContain('onclick={() => exportMedia(item)}');
    expect(source).not.toContain('Export folder');
    expect(source).toContain('async function exportMedia()');
    expect(source).toContain('{#snippet previewActions()}');
    expect(source).toContain("{exportBusy ? 'Exporting…' : 'Export'}");
    expect(source).toContain('aria-label="Change export folder"');
    expect(source).toContain('<Icon name="folder" size={14} />');
    expect(source).not.toContain('>Change folder</button>');
    expect(source).toContain('exportDir = (await readDestinations()).media;');
  });

  it('keeps every card action reachable in the 150px small view', () => {
    // the card clips its overflow, so a row that does not fit loses its last
    // button — Delete
    expect(source).toContain('.grid.compact .actions .btn {');
    expect(source).toContain('padding-inline: 4px;');
  });

  it('lets a card wrap without letting a list row wrap', () => {
    // both share the `actions` class; only the card may take a second line
    expect(source).toContain('.grid .actions {\n    flex-wrap: wrap;');
    expect(source).not.toMatch(/\n  \.actions \{[^}]*flex-wrap: wrap/);
  });
});

describe('a file the library cannot display', () => {
  it('opens the folder it sits in rather than downloading a copy', () => {
    expect(source).toContain("import { revealMediaFolder } from '../lib/reveal.js'");
    expect(source).toContain('async function revealFolder(item)');
    expect(source).toContain('title="Open the folder this file is in"');
    // and the images, video and audio it does display keep the direct link
    expect(source).toContain('title="Open file"');
  });
});
