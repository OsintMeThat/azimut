import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';

vi.mock('konva', () => ({ default: {} }));

import ProofComposer from './ProofComposer.svelte';

/**
 * The slides in the composer: where the strip stands, when it is read, and how moving
 * between slides goes through the save Save proof runs. What a browser does with it is
 * in `e2e/proof-slides.spec.js`; this holds the rules that keep an old proof as it was.
 */

const source = readFileSync(new URL('./ProofComposer.svelte', import.meta.url), 'utf8');
const bodyOfFn = (name) => {
  const at = source.indexOf(`function ${name}(`);
  return source.slice(at, source.indexOf('\n  }', at));
};
const keys = source.slice(source.indexOf('function onKeydown'), source.indexOf('function onKeyup'));

describe('the strip in the composer', () => {
  it('is absent from an empty composer', () => {
    const { body } = render(ProofComposer);
    expect(body).not.toContain('Slides of the video');
    expect(body).not.toContain('data-testid="draft-page"');
  });

  it('stands under the canvas, the toolbar and the side column keeping their full height', () => {
    const body = source.slice(source.indexOf('\n  <div class="body">'), source.indexOf('<aside class="side">'));
    const stage = body.slice(body.indexOf('<div class="stage">'));
    expect(body.indexOf('<ProofToolbar')).toBeLessThan(body.indexOf('<div class="stage">'));
    expect(stage.indexOf('<ProofCanvas')).toBeLessThan(stage.indexOf('<ProofSlides'));
    expect(stage).toContain('{#if stripShown}');
    expect(source).toMatch(/\.stage \{\s*position: relative;\s*flex: 1;\s*display: flex;\s*flex-direction: column;\s*min-width: 0;\s*min-height: 0;\s*\}/);
  });

  it('reads a video\'s scenes only while the proof open, or the scene shown, has one', () => {
    expect(source).toContain('slides.video = started ? star : (page?.video ?? null);');
    const read = source.slice(source.indexOf('const id = caseState.current?.id, video = slides.video;'), source.indexOf('/** Read the video\'s scenes.'));
    expect(read.indexOf('if (!id || !video) {')).toBeLessThan(read.indexOf('readSlides(id, video);'));
    expect(source).toContain('const stripShown = $derived(!!slides.video && (slides.gone || strip.length > 0));');
  });

  it('keeps the strip as it stands while a slide opens, so it never flickers away', () => {
    expect(source).toContain('if (openingSlide) return;');
    expect(bodyOfFn('openSlide')).toContain('openingSlide = true;');
    expect(bodyOfFn('openSlide')).toContain('openingSlide = false;');
  });
});

describe('moving between slides', () => {
  it('goes through Save proof\'s own save, its unchecked points kept off the map', () => {
    const slide = bodyOfFn('saveSlide');
    expect(slide).toContain('save({ checked: true, then: () => finish(true) })');
    expect(slide).toContain('if (!overwritePrompt) finish(false);');
    // the name question settles the switch either way
    expect(source).toContain('if ((await performSave(p.andPost)) && p.then) p.then();\n      settleSave?.(false);');
    expect(source).toContain('oncancel={() => { overwritePrompt = null; settleSave?.(false); }}');
  });

  it('says a refused save keeps the slide, and a landed one in a word', () => {
    const perform = bodyOfFn('performSave');
    expect(perform).toContain("toast(`Save failed: ${e.message}${slide ? '. Still on this slide' : ''}`, 'danger', 6000);");
    expect(perform).toContain("else toast(`Saved ${result.title}`, 'info', 1600);");
    expect(perform).toContain('still to check, kept off the map');
    expect(perform).toContain("if (!slide) toast(`Proof saved: ${result.png}`, 'ok');");
  });

  it('rewrites the step it is on, so Back leaves the series in one step', () => {
    expect(bodyOfFn('openSlide')).toContain('await openProof({ name: tile.name }, { navigate: false });');
    expect(source).toContain("settlePlace('proof', place(), { navigate });");
    expect(source).toContain('async function openProof(entry, { navigate = true } = {}) {');
  });

  it('takes Alt+←/→ after a dialog and a text field had their say, and keeps them from the browser', () => {
    const alt = keys.indexOf('e.altKey');
    expect(alt).toBeGreaterThan(keys.indexOf('if (modalOpen) return;'));
    expect(alt).toBeGreaterThan(keys.indexOf("if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;"));
    // before the arrows nudge a picked mark
    expect(alt).toBeLessThan(keys.indexOf('if (NUDGE[e.key] && editableShapes.length)'));
    const branch = keys.slice(alt, keys.indexOf('return;', alt));
    expect(branch).toContain('&& stripShown');
    expect(branch).toContain('e.preventDefault();');
    expect(branch).toContain("stepSlide(e.key === 'ArrowLeft' ? -1 : 1);");
  });

  it('saves a slide of the same video when Inspect hands a scene over, and asks about any other', () => {
    const make = bodyOfFn('makeSceneProof');
    expect(make).toContain('if (!(await (onSlides ? settleSlide() : mayLeave()))) return;');
    expect(make.indexOf('if (look) applyLook(look);')).toBeLessThan(make.indexOf('await addPanelsFromPaths(made.panels);'));
    // the pill's Make the proof on the same video keeps the open slide's look, read before it is reset
    expect(make.indexOf('look ??= onSlides ? slideStyle(proof) : null;')).toBeLessThan(make.indexOf('resetDoc();'));
  });

  it('files a frame Inspect never saved through the edits Inspect keeps for it', () => {
    expect(bodyOfFn('drawUnfiledFrames')).toContain('ops: await frameOps(frame.edits)');
    expect(bodyOfFn('confirmSlideFrames')).toContain('ops: await frameOps(f.edits)');
    expect(bodyOfFn('frameOps')).toContain('buildFrameOps(frameFilters, edits)');
  });

  it('shows a slide in Inspect on its own moment', () => {
    const action = bodyOfFn('slideAction');
    expect(action).toContain('uiState.inspectScene = { video, slide: tile.name };');
  });

  it('starts a new scene from the look alone, its time held for its first save', () => {
    const fresh = bodyOfFn('newSlide');
    expect(fresh.indexOf('const look = proofStarted ? slideStyle(proof) : lastLook;')).toBeLessThan(fresh.indexOf('resetDoc();'));
    expect(fresh).toContain('scene.hold({ video, moments: [], draft: null });');
    expect(fresh).toContain("pickSideTab('scene');");
  });

  it('counts the frame chooser among the dialogs that hold the keyboard', () => {
    const modal = source.slice(source.indexOf('const modalOpen = $derived('), source.indexOf('const editableShape = $derived'));
    expect(modal).toContain('slideChooser !== null');
  });

  it('names the slide a place question is about once the strip has moved on', () => {
    expect(source).toContain("const offersOver = $derived(offersOf && offersOf.name !== savedName ? `${offersOf.title}: ` : '');");
    expect(bodyOfFn('performSave')).toContain('offersOf = { name: result.name, title: result.title };');
    expect(source).toContain("title={`${offersOver}${placeOffer.points.length === 1 ? 'Save this point as a place?' : 'Save these points as places?'}`}");
    expect(source).toContain("title={`${offersOver}${orphanOffer.length === 1 ? 'Delete the old place?' : 'Delete the old places?'}`}");
  });
});
