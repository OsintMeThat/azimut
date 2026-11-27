import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_SITES,
  EXTENSION_TABS,
  FIND_DOC,
  FIXES,
  SETTINGS_TABS,
  JOURNEYS,
  KEYMAP,
  MENU,
  MENU_ITEMS,
  PAGES,
  WORKSPACE_LEADS,
  allShots,
  journeyEdges,
  journeyNodes,
  journeyResult,
  journeysThrough,
  landingFor,
  markShot,
  opensFrom,
  pinSpots,
  shotOf,
  stepAs,
  stepMarks,
  stepShot,
  tabLabel,
} from './guide.js';
import { CASE_WORKSPACE, TOOL_LABELS, WORKSPACES } from './workspaces.js';
import { FIND_GUIDE } from './onboarding.js';

const RAIL_AND_CASE = [...WORKSPACES, CASE_WORKSPACE];
const TOOLS = RAIL_AND_CASE.flatMap((ws) => ws.tools);

/**
 * Every component of the app, and the capture extension's pages and panel, as written:
 * where an anchor the guide frames must stand.
 */
const EXTENSION = fileURLToPath(new URL('../../../extension/', import.meta.url));
const COMPONENTS = [
  ...Object.values(import.meta.glob('../**/*.svelte', { query: '?raw', import: 'default', eager: true })),
  // the note editor's blocks and menus are drawn by its own modules, not by components
  ...Object.values(import.meta.glob(['./notes/editor/*.js', '!./notes/editor/*.test.js'], { query: '?raw', import: 'default', eager: true })),
  ...readdirSync(EXTENSION)
    .filter((name) => /\.(js|html)$/.test(name))
    .map((name) => readFileSync(join(EXTENSION, name), 'utf8')),
].join('\n');

/** Every sentence the guide puts in front of a reader. */
function prose() {
  const lines = [...Object.values(WORKSPACE_LEADS)];
  const marks = (list) => {
    for (const mark of list ?? []) {
      lines.push(mark.title, mark.text);
      if (mark.opens) {
        lines.push(mark.opens.lead);
        marks(mark.opens.marks);
        for (const tip of mark.opens.tips ?? []) lines.push(tip.title, tip.text);
      }
    }
  };
  for (const page of Object.values(PAGES)) {
    lines.push(page.lead);
    marks(page.marks);
    for (const tip of page.tips ?? []) lines.push(tip.title, tip.text);
  }
  for (const journey of JOURNEYS) {
    lines.push(journey.title, journey.lead);
    for (const step of journey.steps) {
      for (const one of [step, stepAs(step, 'video')]) {
        lines.push(one.label, one.text, one.then, one.tip, ...Object.values(one.does ?? {}));
        for (const choice of one.choices ?? []) lines.push(choice.label, choice.text);
      }
    }
  }
  return lines.filter(Boolean);
}

describe('the guide tracks the app rather than falling behind it', () => {
  it('lists every workspace with its tools, in the order of the rail and the case after it', () => {
    const tools = MENU.find((group) => group.title === 'Tools').items;
    expect(tools.map((item) => item.id)).toEqual(RAIL_AND_CASE.map((ws) => ws.id));
    for (const item of tools) {
      expect(item.tools).toEqual(RAIL_AND_CASE.find((ws) => ws.id === item.id).tools);
      expect(item.lead, `${item.id} says nothing about itself`).toBeTruthy();
    }
  });

  it('has a page for every tool an analyst can stand in', () => {
    // a tool that joins a workspace and has no page opens the guide on an empty tab
    for (const tool of TOOLS) expect(PAGES[tool], `no guide page for ${tool}`).toBeTruthy();
  });

  it('pages nothing the app does not have', () => {
    const own = new Set(['start', 'extension', 'extension-capture', 'extension-tools', ...SETTINGS_TABS.map((tab) => tab.id)]);
    for (const id of Object.keys(PAGES)) expect(own.has(id) || TOOLS.includes(id), id).toBe(true);
  });

  it('opens on the start and the extension, before any journey or workspace', () => {
    expect(MENU_ITEMS.slice(0, 2).map((item) => item.id)).toEqual(['start', 'extension']);
    const ids = MENU_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads the extension in tabs, setting it up first, each tab a page or the table of sites', () => {
    const extension = MENU_ITEMS.find((item) => item.id === 'extension');
    expect(extension.kind).toBe('tabs');
    expect(extension.tools).toEqual(EXTENSION_TABS.map((tab) => tab.id));
    expect(extension.tools[0]).toBe('extension');
    for (const tab of EXTENSION_TABS) {
      expect(Boolean(PAGES[tab.id]) || tab.id === 'extension-sites', tab.id).toBe(true);
      expect(tabLabel(tab.id)).toBe(tab.label);
    }
    expect(landingFor('extension-tools')).toEqual({ item: 'extension', tool: 'extension-tools' });
  });

  it('explains Settings section by section, in the order of its own screen', () => {
    const settings = MENU_ITEMS.find((item) => item.id === 'settings');
    expect(settings.kind).toBe('tabs');
    expect(settings.tools).toEqual(SETTINGS_TABS.map((tab) => tab.id));
    // read off the Settings screen itself, so a section added there and missing here fails;
    // the extension's section is a page of its own in the guide
    const screen = readFileSync(fileURLToPath(new URL('../tools/Settings.svelte', import.meta.url)), 'utf8');
    const sections = [...screen.matchAll(/\{ id: '[a-z]+', label: '([^']+)', icon:/g)]
      .map((match) => match[1])
      .filter((label) => label !== 'Capture extension');
    expect(sections.length).toBeGreaterThan(5);
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual(sections);
    for (const tab of SETTINGS_TABS) {
      expect(PAGES[tab.id], tab.id).toBeTruthy();
      expect(tabLabel(tab.id)).toBe(tab.label);
    }
    expect(landingFor('settings')).toEqual({ item: 'settings', tool: 'settings' });
  });

  it('says where the extension works in a table as wide as its columns', () => {
    for (const row of EXTENSION_SITES.rows) expect(row.cells, row.view).toHaveLength(EXTENSION_SITES.columns.length);
    expect(EXTENSION_SITES.rows.map((row) => row.view)).toContain('Street View');
    // the nine sites engine/mapsites.py reads a map from
    expect(EXTENSION_SITES.sites).toHaveLength(9);
  });

  it('says to install the extension on the page somebody reads first', () => {
    expect(PAGES.start.tips.some((tip) => /extension/i.test(tip.title))).toBe(true);
  });

  it('names both hosts wherever it describes the update check', () => {
    const lines = prose().filter((line) => /new versions/i.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/GitHub[\s\S]*PyPI/);
  });
});

describe('a page and its pictures', () => {
  const shots = allShots();

  it('takes every picture it shows, and names each one once', () => {
    const names = shots.map((one) => one.shot);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { shot, anchors } of shots) {
    it(`${shot}: was made, and every frame has a rectangle inside it`, () => {
      const picture = shotOf(shot);
      expect(picture, `run npm run guide:shots to make ${shot}.webp`).not.toBeNull();
      for (const anchor of anchors) {
        const rect = picture.anchors[anchor];
        expect(rect, `${anchor} was not measured on ${shot}; run npm run guide:shots`).toBeTruthy();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(picture.width + 1);
        expect(rect.y + rect.h).toBeLessThanOrEqual(picture.height + 1);
      }
    });

    it(`${shot}: frames controls the app still has`, () => {
      // the control a frame points at went away or was renamed: the picture is stale
      // even if nobody has looked at it yet
      for (const anchor of anchors) {
        expect(COMPONENTS, `no component carries data-guide "${anchor}"`).toMatch(
          new RegExp(`["']${anchor.replace('.', '\\.')}["']`)
        );
      }
    });
  }

  it('keeps every picture landscape, so the guide shows it whole without scrolling', () => {
    for (const { shot } of shots) {
      const picture = shotOf(shot);
      if (!picture) continue;
      expect(picture.height / picture.width, `${shot} is ${picture.width}×${picture.height}, too tall`).toBeLessThanOrEqual(0.75);
    }
  });

  it('ships no picture the guide no longer shows', () => {
    const dir = fileURLToPath(new URL('../assets/guide/', import.meta.url));
    const wanted = new Set(shots.map((one) => one.shot));
    for (const file of readdirSync(dir).filter((name) => !name.startsWith('.'))) {
      expect(wanted.has(file.replace(/\.(webp|json|webm)$/, '')), `${file} is no longer shown`).toBe(true);
    }
  });

  it('keeps every page to a handful of frames, and a picture behind each number that leads on', () => {
    for (const [id, page] of Object.entries(PAGES)) {
      expect(page.marks.length, `${id} frames nothing`).toBeGreaterThan(0);
      expect(page.marks.length, `${id} frames too much to read`).toBeLessThanOrEqual(9);
      for (const mark of page.marks) if (mark.opens) expect(mark.opens.shot).toBeTruthy();
    }
  });
});

describe('journeys', () => {
  /** Every step as it reads, for a photo and, where it differs, for a video. */
  const readings = (journey) => journey.steps.flatMap((step) => [step, ...(step.video ? [stepAs(step, 'video')] : [])]);
  const anchors = (step) => (step.marks ?? []).map((mark) => (typeof mark === 'string' ? mark : mark.anchor));

  it('walk through tools that exist, each step on a frame its tool’s page draws', () => {
    for (const journey of JOURNEYS) {
      expect(journey.steps.length, `${journey.title} is not a walk`).toBeGreaterThan(2);
      for (const step of readings(journey)) {
        expect(TOOLS).toContain(step.tool);
        expect(TOOL_LABELS[step.tool]).toBeTruthy();
        // a question asks, and every other line states
        expect(step.text.trim().endsWith(step.ask ? '?' : '.'), step.text).toBe(true);
        if (step.then) expect(step.then.trim().endsWith('.')).toBe(true);
        expect(stepMarks(step).map((mark) => mark.anchor)).toEqual(step.marks ? anchors(step) : []);
        // what a step says to press is said of a control it frames
        for (const anchor of Object.keys(step.does ?? {})) expect(anchors(step)).toContain(anchor);
        // a press made on another tool's screen names a tool the app has
        // Settings is no workspace tool, yet a press made there opens it on its section
        for (const mark of step.marks ?? []) if (mark.tool) expect([...TOOLS, 'settings']).toContain(mark.tool);
        for (const mark of step.marks ?? []) if (mark.tool === 'settings') expect(mark.settings, mark.anchor).toBeTruthy();
      }
    }
  });

  it('draw every journey as a map whose every way leads to a step, and every step is reached', () => {
    for (const journey of JOURNEYS) {
      const nodes = journeyNodes(journey);
      const ids = nodes.map((node) => node.id);
      expect(new Set(ids).size, `${journey.title} names a step twice`).toBe(ids.length);
      const places = nodes.map((node) => node.at.join(','));
      expect(new Set(places).size, `${journey.title} stacks two steps`).toBe(places.length);
      const edges = journeyEdges(journey);
      for (const edge of edges) expect(ids, `${journey.title}: ${edge.from} leads nowhere`).toContain(edge.to);
      const starts = ids.filter((id) => !edges.some((edge) => edge.to === id));
      expect(starts.length).toBeGreaterThan(0);
      const reached = new Set(starts);
      for (let grew = true; grew; ) {
        grew = false;
        for (const edge of edges) if (reached.has(edge.from) && !reached.has(edge.to)) (reached.add(edge.to), (grew = true));
      }
      expect([...reached].sort()).toEqual([...ids].sort());
      for (const node of nodes) {
        // a question forks, and nothing else says where it goes; it is asked over its
        // screen, which it frames nothing on
        if (node.ask) {
          expect(node.choices.length).toBeGreaterThan(1);
          expect(node.next).toBeUndefined();
          expect(node.marks ?? []).toEqual([]);
          expect(stepShot(node)).toBeTruthy();
        }
        // a step that may be skipped leads back onto the way
        if (node.optional) expect(edges.some((edge) => edge.from === node.id)).toBe(true);
      }
    }
  });

  it('walk a straight journey on one row, a step leading to the next', () => {
    const straight = { steps: [{ tool: 'detect' }, { tool: 'detect' }, { tool: 'detect' }] };
    expect(journeyNodes(straight).map((node) => node.at)).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(journeyEdges(straight)).toEqual([
      { from: '0', to: '1' },
      { from: '1', to: '2' },
    ]);
  });

  it('start from a photo or a video, and read on as the start picked', () => {
    const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
    const starts = journeyNodes(geolocate).filter((node) => node.at[0] === 0);
    expect(starts.map((node) => [node.id, node.kind ?? 'photo'])).toEqual([
      ['photo', 'photo'],
      ['video', 'video'],
    ]);
    const mark = geolocate.steps.find((step) => step.id === 'mark');
    expect(stepAs(mark, 'photo')).toBe(mark);
    expect(stepAs(mark, null)).toBe(mark);
    expect(stepAs(mark, 'video')).toMatchObject({ tool: 'inspect', shot: 'inspect-video' });
    // opened from the video's own card in Media, marked whole in Inspect, then a frame
    // captured for the proof, each press on the screen it happens on
    expect(stepMarks(stepAs(mark, 'video')).map((one) => [one.anchor, markShot(stepAs(mark, 'video'), one)])).toEqual([
      ['media.open-in-video', 'media-rail'],
      ['media.open-inspect', 'media-rail-video-menu'],
      ['inspect.whole', 'inspect-video'],
      ['inspect.capture', 'inspect-video-scene'],
    ]);
    expect(stepMarks(stepAs(mark, 'video')).map((one) => one.text)).toEqual(Object.values(stepAs(mark, 'video').does));
    // a photo is marked from its card, the second press on the menu item itself
    expect(stepMarks(mark).map((one) => [one.anchor, markShot(mark, one)])).toEqual([
      ['media.open-in', 'media-rail'],
      ['media.mark', 'media-rail-menu'],
    ]);
  });

  it('ask where the picture may be, and whether it is sure, before it forks', () => {
    const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
    const step = (id) => geolocate.steps.find((one) => one.id === id);
    // the region is asked in Media, before anything is marked; a match is the first answer
    const order = geolocate.steps.map((one) => one.id);
    expect(order.indexOf('where')).toBeLessThan(order.indexOf('mark'));
    expect(step('where').choices.map((choice) => choice.to)).toEqual(['reverse', 'mark']);
    // whether the map matches is asked as soon as the search lands, a wrong place searched again
    expect(order.indexOf('sure')).toBeLessThan(order.indexOf('spot'));
    expect(step('sure').choices.map((choice) => choice.to)).toEqual(['spot', 'compare', 'horizon', 'satellite']);
    expect(geolocate.steps.filter((one) => one.optional).map((one) => one.id)).toEqual(['reverse', 'horizon', 'compare', 'elsewhere']);
    // Reverse Search is reached from the photo's own Open in… menu, and leads back to Media by its tab
    expect(stepMarks(step('reverse')).map((mark) => mark.anchor)).toEqual(['media.open-in', 'media.open-reverse', 'reverse.engines', 'tab.media']);
    // what helps before and while looking, said where it helps
    expect(stepMarks(step('reverse')).find((mark) => mark.anchor === 'reverse.engines').tip).toMatch(/No hit/);
    expect(step('satellite').does['sat.search']).toMatch(/Vincent Thomas Bridge/);
    expect(step('satellite').does['map.ground']).toMatch(/never moves/);
    // the To-do is reached by the notice's Show, the case panel's road told as the tip
    expect(stepMarks(step('geolocate')).map((mark) => mark.anchor)).toEqual(['toast.action', 'todo.go', 'geo.pill']);
    expect(step('geolocate').tip).toMatch(/case panel/);
    expect(step('mark').then).toMatch(/notice/);
    // the camera's spot is found, not guessed: a line through two things that line up
    expect(stepMarks(step('spot')).map((mark) => mark.anchor)).toEqual(['map.measure-from', 'map.ground', 'map.drop-lead']);
    expect(step('spot').does['map.measure-from']).toMatch(/east tower[\s\S]*Evergreen cranes/);
    expect(stepMarks(stepAs(step('spot'), 'video')).map((mark) => mark.anchor)).toEqual(['sat.place']);
  });

  it('name the journeys a tool takes part in, at their step', () => {
    expect(journeysThrough('media')).toEqual([{ id: 'geolocate', title: 'Geolocate a photo or a video', step: 1 }]);
    expect(journeysThrough('post')).toEqual([{ id: 'geolocate', title: 'Geolocate a photo or a video', step: 18 }]);
    expect(journeysThrough('settings')).toEqual([]);
  });

  it('show the Geolocating pill where Geolocate lands, and say what its counts and icons do', () => {
    const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate').steps.find((step) => step.id === 'geolocate');
    // read in place on the map Geolocate opens, nothing pressed: the last action of the step
    for (const [step, shot] of [[geolocate, 'satellite-landed'], [stepAs(geolocate, 'video'), 'satellite-video']]) {
      const pill = stepMarks(step).at(-1);
      expect(pill).toMatchObject({ anchor: 'geo.pill', look: true, tool: 'satellite' });
      expect(markShot(step, pill)).toBe(shot);
      expect(pill.text).toMatch(/map icon[\s\S]*pin[\s\S]*Inspect/);
    }
    expect(opensFrom('inspect', 'inspect.scene').marks.map((mark) => mark.anchor)).toContain('geo.pill');
  });

  it('ask where to capture before the proof: here, or on another map through the extension', () => {
    const steps = JOURNEYS.find((journey) => journey.id === 'geolocate').steps;
    const how = steps.find((step) => step.id === 'how');
    const capture = steps.find((step) => step.id === 'capture');
    const elsewhere = steps.find((step) => step.id === 'elsewhere');
    expect(how.choices.map((choice) => choice.to)).toEqual(['capture', 'elsewhere']);
    // the extension is named where the choice is made
    expect(how.choices[1].text).toMatch(/capture extension/);
    expect(capture.next).toEqual(['proof']);
    expect(elsewhere).toMatchObject({ optional: true, next: ['proof'] });
    expect(stepMarks(elsewhere).map((mark) => mark.title)).toEqual(['Open in…', 'Google Satellite', 'Capture an area', 'The pill’s count']);
    expect(elsewhere.does['map.google-satellite']).toMatch(/Apple Maps/);
    // the capture finished shows on the pill, with no capture counted before it
    expect(stepMarks(capture).map((mark) => [mark.anchor, markShot(capture, mark)])).toEqual([
      ['sat.capture', 'satellite-scene'],
      ['geo.counts', 'satellite-captured'],
    ]);
    // either way the proof step opens on Make the proof
    expect(stepMarks(steps.find((step) => step.id === 'proof'))[0]).toMatchObject({ anchor: 'geo.make', title: 'Make the proof' });
  });

  it('box what agrees one feature at a time, the colour changed between the two', () => {
    const proof = JOURNEYS.find((journey) => journey.id === 'geolocate').steps.find((step) => step.id === 'proof');
    const marks = stepMarks(proof);
    expect(marks.map((mark) => [mark.anchor, markShot(proof, mark)])).toEqual([
      ['geo.make', 'satellite-captured'],
      ['proof.box', 'proof-blank'],
      ['proof.canvas', 'proof-boxes'],
      ['proof.colour', 'proof-tower'],
      ['proof.canvas', 'proof-cranes'],
    ]);
    // the two boxing actions say each their own feature
    expect(marks[2].text).toMatch(/east tower/);
    expect(marks[4].text).toMatch(/Evergreen cranes/);
    expect(marks[3].text).toMatch(/blue/);
  });

  it('walk a photo and a video through the scene they are marked as, to the proof made from the pill', () => {
    const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
    for (const kind of ['photo', 'video']) {
      const steps = geolocate.steps.map((step) => stepAs(step, kind));
      const marks = steps.flatMap(anchors);
      // a photo is marked from its card in Media and found in the To-do, a video marked whole in Inspect
      expect(marks).toContain(kind === 'photo' ? 'media.mark' : 'inspect.whole');
      expect(marks).toContain(kind === 'photo' ? 'todo.go' : 'scene.geolocate');
      expect(marks).toContain('geo.make');
      // the proof is made from the pill, its two points named, then saved on what it shows
      const proof = steps.find((step) => step.id === 'proof');
      expect(stepMarks(proof)[0]).toMatchObject({ anchor: 'geo.make', title: 'Make the proof' });
      // the camera's point is stated before saving: once saved, the scene's leads are gone
      const order = steps.map((step) => step.id);
      expect(order.indexOf('camera')).toBeLessThan(order.indexOf('save'));
      // the first row is labelled too, so no post goes out with a bare coordinate
      expect(anchors(steps.find((step) => step.id === 'camera'))).toEqual([
        'proof.first-label', 'proof.add-point', 'proof.new-pin', 'point.lead', 'point.use', 'proof.new-label', 'proof.new-pov',
      ]);
      expect(anchors(steps.find((step) => step.id === 'save'))).toEqual(['proof.meta', 'proof.save', 'point.use', 'proof.to-post']);
      expect(steps.find((step) => step.id === 'save').does['proof.meta']).toMatch(/day first/);
      // a video's pictures are its own all the way, its result included: never the photo's
      const shotsOf = (step) => [stepShot(step), ...stepMarks(step).map((mark) => markShot(step, mark))];
      // the other kind's start is not walked
      const walked = steps.filter((step) => step.id !== (kind === 'video' ? 'photo' : 'video'));
      const seen = [...walked.flatMap(shotsOf), journeyResult(geolocate, kind).shot];
      const photoOnly = [
        'media-viewer', 'media-rail-menu', 'media-marked', 'todo-geolocate', 'reverse-photo', 'satellite-landed', 'satellite-search',
        'satellite-port', 'tower-menu', 'tower-line', 'lead-menu', 'satellite-scene', 'scene-menu', 'scene-open-in',
        'extension-scene', 'satellite-captured', 'proof-blank', 'proof-boxes', 'proof-tower', 'proof-cranes', 'proof-marked',
        'proof-labelled', 'proof-typed', 'proof-check', 'proof-camera-done', 'proof-row2', 'proof-camera-map', 'proof-camera-lead',
        'proof-camera', 'proof-camera-named', 'proof', 'proof-result', 'post', 'post-cleared',
      ];
      // the Horizon aside is the same Half Dome for both, away from the port
      if (kind === 'video') expect(seen.filter((shot) => photoOnly.includes(shot))).toEqual([]);
      else expect(journeyResult(geolocate, kind).shot).toBe('proof-result');
    }
  });

  it('measure a step taken on a picture of its own on that picture', () => {
    const shots = allShots();
    for (const journey of JOURNEYS) {
      for (const step of readings(journey)) {
        for (const mark of stepMarks(step)) {
          const shot = markShot(step, mark);
          const taken = shots.find((one) => one.shot === shot);
          expect(taken, shot).toBeTruthy();
          expect(taken.anchors, `${mark.anchor} on ${shot}`).toContain(mark.anchor);
        }
      }
      if (journey.result) expect(shots.map((one) => one.shot)).toContain(journey.result.shot);
    }
  });

  it('build an analyzer inside Detect, each step named for what it does, ending on the saved one', () => {
    const build = JOURNEYS.find((journey) => journey.id === 'create-an-analyzer');
    expect(build.steps.every((step) => step.tool === 'detect')).toBe(true);
    const labels = build.steps.map((step) => step.label);
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    expect(build.steps.find((step) => step.id === 'save').marks).toEqual(['detect.builder-save']);
    // run once or over time, either way it ends on the analyzer in the library
    const ends = journeyNodes(build).filter((node) => !journeyEdges(build).some((edge) => edge.from === node.id));
    expect(ends.map((node) => node.id).sort()).toEqual(['once', 'routine']);
    expect(build.result.shot).toBeTruthy();
    expect(journeysThrough('detect')).toEqual([{ id: 'create-an-analyzer', title: 'Create your analyzer', step: 1 }]);
  });

  it('read a sequel of a sequel, as the analyzer builder opens from the library', () => {
    const marks = stepMarks({ tool: 'detect', marks: ['detect.rules', 'detect.reads'] });
    expect(marks.map((mark) => mark.title)).toEqual(['Rules', 'What it reads']);
    const shots = allShots().map((one) => one.shot);
    for (const shot of ['detect-library', 'detect-analyzer-new', 'detect-builder']) expect(shots).toContain(shot);
  });

  it('search with Find inside Horizon, from the rail to the place checked and confirmed', () => {
    const search = JOURNEYS.find((journey) => journey.id === 'search-with-find');
    expect(search.steps.every((step) => step.tool === 'horizon' && step.shot)).toBe(true);
    const labels = search.steps.map((step) => step.label);
    expect(new Set(labels).size).toBe(labels.length);
    const step = (id) => search.steps.find((one) => one.id === id);
    // reached from the rail, the photo picked in Find itself
    expect(stepMarks(step('find')).map((mark) => mark.anchor)).toEqual(['rail.map', 'tab.horizon', 'horizon.find', 'picker.search', 'picker.first']);
    // the questions an analyst answers, each with a way round
    expect(search.steps.filter((one) => one.ask).map((one) => one.id)).toEqual(['clear', 'hazy', 'scale', 'clues', 'trust']);
    expect(search.steps.filter((one) => one.optional).map((one) => one.id)).toEqual(['by-eye', 'haze', 'know', 'again']);
    // one area drawn, named or not; only how it is searched differs after
    expect(step('scale').choices.map((choice) => choice.to)).toEqual(['grid', 'wide']);
    expect(stepMarks(step('wide')).map((mark) => mark.anchor)).toEqual(['find.quick']);
    // each tool is pressed on a picture of the one before it, then the photo is worked in a film
    for (const id of ['skyline', 'ridges', 'key', 'far', 'haze']) {
      const marks = stepMarks(step(id));
      expect(marks.at(-1).anchor).toBe('find.canvas');
      expect(shotOf(markShot(step(id), marks.at(-1))).film, id).toBeTruthy();
      expect(markShot(step(id), marks[0])).not.toBe(markShot(step(id), marks.at(-1)));
    }
    // the area drawn and the search run play on the map
    for (const shot of ['find-drawing', 'find-zoomed']) expect(shotOf(shot).film, shot).toBeTruthy();
    // the numbers are read before the question that weighs them
    expect(stepMarks(step('search')).at(-1)).toMatchObject({ anchor: 'find.trust', look: true });
    // a score, not a probability, said where the first place is pressed
    expect(stepMarks(step('places')).map((mark) => mark.anchor)).toEqual(['find.first']);
    expect(stepMarks(step('places'))[0].tip).toMatch(/score, not a probability/);
    // the place found plays, is checked, confirmed, and the search itself is a press away
    expect(stepMarks(search.steps.at(-1)).map((mark) => mark.anchor)).toEqual(['horizon.overlay', 'horizon.legend', 'horizon.satellite', 'find.confirm']);
    expect(shotOf('find-look').film).toBeTruthy();
    expect(search.result.shot).toBe('find-confirmed');
    expect(search.result.example).toBe(true);
    // the screen Find's notice opens on leads to it
    expect(opensFrom('horizon', FIND_GUIDE).walk).toBe('search-with-find');
    expect(journeysThrough('horizon')).toEqual([
      { id: 'geolocate', title: 'Geolocate a photo or a video', step: 9 },
      { id: 'search-with-find', title: 'Search with Find', step: 1 },
    ]);
  });

  it('end a video on its own result when the journey has one', () => {
    const journey = { result: { shot: 'proof-result', text: 'Photo.', video: { shot: 'proof-video-saved', text: 'Video.' } } };
    expect(journeyResult(journey, null)).toBe(journey.result);
    expect(journeyResult(journey, 'video')).toMatchObject({ shot: 'proof-video-saved', text: 'Video.' });
    expect(journeyResult({ result: { shot: 'x', text: 'X.' } }, 'video')).toEqual({ shot: 'x', text: 'X.' });
    // a journey that forks at its end ends on what the branch taken made
    const forked = { result: { shot: 'plate-result', text: 'A page.', after: { video: { shot: 'plate-video', text: 'A film.' } } } };
    expect(journeyResult(forked, null, 'video')).toMatchObject({ shot: 'plate-video', text: 'A film.' });
    expect(journeyResult(forked, null, 'export')).toMatchObject({ shot: 'plate-result', text: 'A page.' });
  });

  it('take a geolocation as far as the published thread', () => {
    const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
    // a practice post clears its mention and stops at the copied proof; a real one is marked posted in one action
    expect(anchors(geolocate.steps.at(-1))).toEqual(['post.mention', 'post.copy-image', 'post.publish', 'post.posted']);
    expect(stepMarks(geolocate.steps.at(-1)).find((mark) => mark.anchor === 'post.copy-image').tip).toMatch(/Practising/);
    expect(geolocate.steps.at(-1).tool).toBe('post');
    expect(journeyEdges(geolocate).filter((edge) => edge.from === 'post')).toEqual([]);
  });
});

describe('where the numbers sit', () => {
  const shot = { width: 1000, height: 600 };
  const far = (spots, apart) =>
    spots.every(({ pin }, i) => spots.slice(i + 1).every((other) => Math.hypot(other.pin.x - pin.x, other.pin.y - pin.y) >= apart));



  it('keeps every number inside the picture, and checks it where it is drawn', () => {
    // three controls in the top left corner: the numbers pushed in from the edge must
    // not land on each other there
    const frames = [
      { x: 0, y: 0, w: 70, h: 30 },
      { x: 0, y: 30, w: 30, h: 500 },
      { x: 25, y: 40, w: 180, h: 30 },
    ];
    const spots = pinSpots(frames, shot, 30);
    for (const { pin } of spots) {
      expect(pin.x).toBeGreaterThanOrEqual(15);
      expect(pin.y).toBeGreaterThanOrEqual(15);
      expect(pin.x).toBeLessThanOrEqual(985);
      expect(pin.y).toBeLessThanOrEqual(585);
    }
    expect(far(spots, 30)).toBe(true);
  });

  it('tries the middle of an edge once the corners are taken', () => {
    // four small controls at the corners of a panel, then the panel itself
    const frames = [
      { x: 100, y: 100, w: 10, h: 10 },
      { x: 300, y: 100, w: 10, h: 10 },
      { x: 100, y: 400, w: 10, h: 10 },
      { x: 300, y: 400, w: 10, h: 10 },
      { x: 100, y: 100, w: 200, h: 300 },
    ];
    const spots = pinSpots(frames, shot, 30);
    expect(far(spots, 30)).toBe(true);
    expect(spots[4].pin).toEqual({ x: 200, y: 100 });
  });

  it('puts the number of a frame covering most of the picture in its middle', () => {
    const [map] = pinSpots([{ x: 60, y: 40, w: 940, h: 560 }], shot);
    expect(map.pin).toEqual({ x: 530, y: 320 });
  });


  it('stands just off the corner of a small control, so it hides none of it', () => {
    const [button] = pinSpots([{ x: 200, y: 200, w: 60, h: 24 }], shot, 30);
    expect(button.pin).toEqual({ x: 194, y: 194 });
  });

  it('sits on the corner of a panel, which is padding', () => {
    const [panel] = pinSpots([{ x: 100, y: 100, w: 300, h: 200 }], shot, 30);
    expect(panel.pin).toEqual({ x: 100, y: 100 });
  });

  it('moves under its control rather than stacking on the number of the one beside it', () => {
    const [, second] = pinSpots([{ x: 100, y: 100, w: 40, h: 20 }, { x: 120, y: 100, w: 40, h: 20 }], shot, 30);
    expect(second.pin).toEqual({ x: 114, y: 126 });
  });

  it('keeps off another numbered control, though the seam between two is fine', () => {
    const frames = [
      { x: 0, y: 0, w: 400, h: 90 },
      { x: 200, y: 85, w: 40, h: 20 },
    ];
    expect(pinSpots(frames, shot, 30)[1].pin).toEqual({ x: 194, y: 111 });
  });

  it('never lets the picture’s edge push a small control’s number back onto it', () => {
    const [corner] = pinSpots([{ x: 0, y: 0, w: 40, h: 20 }], shot, 30);
    expect(corner.pin).toEqual({ x: 46, y: 26 });
  });

  it('asks for more room in the picture’s pixels when it is shown smaller', () => {
    // two buttons 40 pixels apart: clear at full size, too close once halved on screen
    const frames = [{ x: 100, y: 100, w: 40, h: 20 }, { x: 140, y: 100, w: 40, h: 20 }];
    expect(pinSpots(frames, shot, 30)[1].pin).toEqual({ x: 134, y: 94 });
    expect(pinSpots(frames, shot, 60)[1].pin).not.toEqual({ x: 128, y: 88 });
  });
});

describe('where the guide opens', () => {
  it('on the tab of the tool it was asked from', () => {
    expect(landingFor('media')).toEqual({ item: 'collect', tool: 'media' });
    expect(landingFor('timeline')).toEqual({ item: 'case', tool: 'timeline' });
  });

  it('on a page asked by its id, Settings included', () => {
    expect(landingFor('settings')).toEqual({ item: 'settings', tool: 'settings' });
    expect(landingFor('journey:geolocate')).toEqual({ item: 'journey:geolocate', tool: null });
  });

  it('on the screen a number opens, asked by its anchor', () => {
    expect(landingFor(FIND_GUIDE)).toEqual({ ...landingFor('horizon'), opens: 'horizon.find' });
    const find = opensFrom('horizon', FIND_GUIDE);
    expect(find.shot).toBe('horizon-find');
    expect(find.from).toBe('Find, in beta');
    expect(find.more.href).toBe(FIND_DOC);
    // an anchor that opens nothing is no landing
    expect(landingFor('horizon.picture')).toEqual({ item: 'start', tool: null });
    expect(opensFrom('horizon', 'horizon.picture')).toBeNull();
  });

  it('points the full Find guide at a page the repository holds', () => {
    const doc = FIND_DOC.replace('https://github.com/OsintMeThat/azimut/blob/main/', '../../../');
    expect(existsSync(fileURLToPath(new URL(doc, import.meta.url)))).toBe(true);
  });

  it('at the start for anything else', () => {
    expect(landingFor('overview')).toEqual({ item: 'start', tool: null });
    expect(landingFor(undefined)).toEqual({ item: 'start', tool: null });
  });
});

describe('the register the guide is written in', () => {
  it('leads with one sentence, or two at most', () => {
    for (const page of Object.values(PAGES)) expect(page.lead.split('. ').length, page.lead).toBeLessThan(3);
  });

  it('uses no em-dash appositive, which the house copy rules refuse', () => {
    for (const line of prose()) expect(line, 'em-dash in UI copy').not.toMatch(/—/);
  });

  it('ends every line of text with a full stop, and every title without one', () => {
    for (const page of Object.values(PAGES)) {
      for (const mark of page.marks) {
        expect(mark.text.trim().endsWith('.'), mark.text).toBe(true);
        expect(mark.title.trim().endsWith('.'), mark.title).toBe(false);
      }
      for (const tip of page.tips ?? []) expect(tip.text.trim().endsWith('.'), tip.text).toBe(true);
    }
  });

  it('quotes only words the app puts on screen', () => {
    // a quoted label is what the reader searches the screen for, so a renamed
    // dialog or button has to fail here rather than send them looking for nothing
    const root = fileURLToPath(new URL('../', import.meta.url));
    const sources = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'assets') walk(at);
        } else if (/\.(svelte|js)$/.test(entry.name) && !entry.name.endsWith('.test.js') && entry.name !== 'guide.js') {
          sources.push(readFileSync(at, 'utf8'));
        }
      }
    };
    walk(root);
    const app = sources.join('\n');
    const quoted = prose().flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    expect(quoted.length).toBeGreaterThan(0);
    for (const label of quoted) expect(app.includes(label), `the guide quotes "${label}", which no screen shows`).toBe(true);
  });

  it('says what a key does wherever it lists one, under a tool the app has', () => {
    const labels = new Set(Object.values(TOOL_LABELS));
    for (const group of KEYMAP) {
      expect(group.keys.length).toBeGreaterThan(0);
      const tools = group.where.split(', ');
      expect(group.where === 'Anywhere' || tools.every((tool) => labels.has(tool)), group.where).toBe(true);
      for (const key of group.keys) {
        expect(key.combo.trim()).toBeTruthy();
        expect(key.does.trim()).toBeTruthy();
      }
    }
  });

  it('answers every symptom it raises', () => {
    for (const fix of FIXES) {
      expect(fix.symptom.trim()).toBeTruthy();
      expect(fix.fix.trim().endsWith('.')).toBe(true);
    }
  });
});
