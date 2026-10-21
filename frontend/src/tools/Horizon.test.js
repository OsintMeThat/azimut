import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The tab mounts a WebGL view and a MapLibre map, neither of which runs under a
// test DOM; its layout's own rules are read off the source, as Satellite's are.
const source = readFileSync(new URL('./Horizon.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'), source.indexOf('<style>'));
const style = source.slice(source.indexOf('<style>'));

describe('the Horizon layout', () => {
  it('heads the view with its name, offered from the photo or the place, where it stands in the tooltip', () => {
    const heading = markup.slice(markup.indexOf('<div class="hz-title">'), markup.indexOf('<span class="hz-status"'));
    expect(heading).toContain('bind:value={viewTitle}');
    expect(heading).toContain('placeholder={views.suggested}');
    expect(heading).toContain('aria-label="View name"');
    expect(heading).toContain('stands at {title}');
    // a changed saved view says so with a dot, not a word
    expect(heading).toContain('class="hz-unsaved"');
  });

  it('keeps the view\'s acts to three plain buttons, Open there as soon as a case is, eye or no eye', () => {
    const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
    expect(header.match(/<ViewsMenu/g)).toHaveLength(1);
    expect(header).toContain("{#if caseState.current && layout !== 'moving'}");
    expect(header).toContain('<ExportMenu');
    expect(header).toContain('aria-label="Save the view"');
    expect(header).toContain('onclick={saveView}');
  });

  it('closes the view back to the map, asking first when unsaved work would go', () => {
    expect(markup).toContain('onclick={closeView}');
    expect(source).toMatch(/function closeView\(\) \{\s*if \(keepsWork\(\)\) \{\s*discarding = \{ close: true \};/);
    expect(source).toMatch(/function leaveView\(\) \{[^}]*overlay\.remove\(\);[^}]*view\.leave\(\);/s);
  });

  it('offers to move where the other maps look, on the map, and never follows them by itself', () => {
    expect(markup).toContain('{#if away && layout === \'looking\'}');
    expect(markup).toContain('onclick={moveThere}');
    expect(source).toContain("share.stood({ lat: eye.lat, lon: eye.lon, heading }");
    // the map follows the others only while no eye stands
    expect(source).toMatch(/layout !== 'picking'\) return;\s*untrack\(\(\) => \{\s*const next = share\.pending/);
  });

  it('lays the whole-turn strip under the view, by its heading ruler', () => {
    expect(markup.indexOf('<HorizonStrip')).toBeGreaterThan(markup.indexOf('<HorizonView'));
    expect(markup.indexOf('<HorizonStrip')).toBeGreaterThan(markup.indexOf('<OverlayTransport'));
  });

  it('heads every mode with the one switch, Find over a tab that takes no focus meanwhile', () => {
    const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
    expect(header.indexOf('<ViewSwitch options={MODES} value={mode}')).toBeLessThan(header.indexOf('{#if layout'));
    expect(header).not.toContain('openFind');
    const find = readFileSync(new URL('./horizon/Find.svelte', import.meta.url), 'utf8');
    expect(find).toContain('<ViewSwitch options={modes} value="find"');
    expect(markup).toContain("<div class=\"hz-main\" inert={mode === 'find'}>");
    expect(markup).toContain("{#if mode === 'find'}");
    expect(markup).toContain('onsearch={searchFromFind}');
    expect(markup).toContain('onplace={lookFromPlace}');
    // the tab's own keys wait while Find is on screen
    expect(source).toMatch(/function onKey\(event\) \{\s*\/\/ Find has the keys while it is on screen\s*if \(mode === 'find'\) return;/);
    // a search made with no case open makes one first
    expect(source).toMatch(/async function searchFromFind\(\) \{\s*try \{\s*const owner = await ensureCase\(\);/);
  });

  it('lays the photo over the view in Overlay only, hidden and kept in the other two', () => {
    expect(markup).toContain('overlay={photoOn ? overlay : null}');
    expect(markup).toContain('{#if photoOn && overlay.source && layout === \'looking\' && !swapped}\n          <OverlayBar');
    expect(source).toContain("const photoOn = $derived(mode === 'overlay');");
    // a photo laid from the dialog or a drop, or handed over from Inspect, brings Overlay
    expect(source.match(/if \(mode === 'view'\) mode = 'overlay';/g)).toHaveLength(3);
    // the address says the mode, and a change of mode is a step Back returns from
    expect(source).toContain('...modeParams(mode)');
    expect(source).toContain('|| mode !== lastMode');
    expect(source).toContain('mode = modeOf(to);');
  });

  it('keeps how the ground is drawn on the view with a photo laid, out of the pen\'s way', () => {
    const view = readFileSync(new URL('./horizon/HorizonView.svelte', import.meta.url), 'utf8');
    expect(view).toContain(
      'Boolean(view.observer) && !(laid && (overlay.tracing || overlay.erasing || overlay.warping || overlay.linking || overlay.cutting || overlay.distancing))'
    );
    expect(view).toContain('{#if controlsShown}\n    <div class="controls">');
    // the names keep clear of the corner only while the controls are in it
    expect(view).toContain('controls.width && controlsShown');
    // the band has no ground of its own any more
    const band = readFileSync(new URL('./horizon/OverlayBar.svelte', import.meta.url), 'utf8');
    expect(band).not.toContain('PictureControls');
    expect(markup.slice(markup.indexOf('<OverlayBar'), markup.indexOf('/>', markup.indexOf('<OverlayBar')))).not.toContain('copernicus');
  });

  it('lets the inspector be dragged wider, and sizes every box beside it from that width', () => {
    expect(markup).toContain('onpointerdown={startSideResize}');
    expect(markup).toContain('ondblclick={resetSideWidth}');
    expect(markup).toContain('onkeydown={onSideResizeKey}');
    expect(markup).toContain('style:--hz-side="{sideW}px"');
    expect(markup).toContain('style:--hz-map-h="{mapH}px"');
    // the map, the corner view and the grid all follow it: a width left fixed would part them
    expect(style).not.toMatch(/\b340px\b/);
    expect(style).not.toMatch(/\b250px\b/);
  });
});

describe('the small map\'s layers', () => {
  it('offers every layer the other maps do, from the shared catalogue and store', () => {
    expect(source).toContain("const mapLayers = createLayerSet({");
    expect(source).toContain("const HORIZON_LAYERS = ['boundaries', 'placenames', 'saved'];");
    expect(source).toContain("createMapLayerMemory('horizon', HORIZON_LAYERS)");
    expect(source).toContain("const myLayers = addedLayers.scope('horizon');");
    expect(markup).toContain('<MapLayersPanel');
    expect(markup).toContain('bind:folded={layersFolded}');
    expect(markup).toContain('added={myLayers.rows}');
  });

  it('hands the same switches and case layers to Find\'s map', () => {
    const find = markup.slice(markup.indexOf('<Find\n'), markup.indexOf('/>', markup.indexOf('<Find\n')));
    expect(find).toContain('rows: layerRows');
    expect(find).toContain('added: myLayers.rows');
    expect(find).toContain("drawn: uiState.tool === 'horizon' ? myLayers.drawn : []");
    expect(find).toContain('toggle: (layer) => myLayers.toggle(caseState.current?.id, layer)');
    expect(find).toContain("saved: mapLayers.has('saved') && caseState.current ? savedItems : null");
  });

  it('draws case layers only on screen and allows their cards only while editing', () => {
    const overlay = markup.slice(markup.indexOf('<AddedLayersOverlay'), markup.indexOf('/>', markup.indexOf('<AddedLayersOverlay')));
    expect(overlay).toContain("layers={uiState.tool === 'horizon' ? myLayers.drawn : []}");
    expect(overlay).toContain('interactive={!!personalLayers.editor && !personalLayers.armed}');
    expect(source).toContain('if (personalLayers.editor) return;');
    expect(markup).toContain('<PersonalLayerPanel');
  });
});
