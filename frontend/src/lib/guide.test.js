import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_SITES,
  EXTENSION_TABS,
  FIXES,
  JOURNEYS,
  KEYMAP,
  MENU,
  MENU_ITEMS,
  PAGES,
  WORKSPACE_LEADS,
  allShots,
  journeysThrough,
  landingFor,
  pinSpots,
  shotOf,
  stepMarks,
  stepShot,
  tabLabel,
} from './guide.js';
import { CASE_WORKSPACE, TOOL_LABELS, WORKSPACES } from './workspaces.js';

const RAIL_AND_CASE = [...WORKSPACES, CASE_WORKSPACE];
const TOOLS = RAIL_AND_CASE.flatMap((ws) => ws.tools);

/**
 * Every component of the app, and the capture extension's pages and panel, as written:
 * where an anchor the guide frames must stand.
 */
const EXTENSION = fileURLToPath(new URL('../../../extension/', import.meta.url));
const COMPONENTS = [
  ...Object.values(import.meta.glob('../**/*.svelte', { query: '?raw', import: 'default', eager: true })),
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
      }
    }
  };
  for (const page of Object.values(PAGES)) {
    lines.push(page.lead);
    marks(page.marks);
    for (const tip of page.tips ?? []) lines.push(tip.title, tip.text);
  }
  for (const journey of JOURNEYS) lines.push(journey.title, journey.lead, ...journey.steps.map((step) => step.text));
  return lines;
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
    const own = new Set(['start', 'extension', 'extension-capture', 'extension-tools', 'settings']);
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

  it('ships no picture the guide no longer shows', () => {
    const dir = fileURLToPath(new URL('../assets/guide/', import.meta.url));
    const wanted = new Set(shots.map((one) => one.shot));
    for (const file of readdirSync(dir).filter((name) => !name.startsWith('.'))) {
      expect(wanted.has(file.replace(/\.(webp|json)$/, '')), `${file} is no longer shown`).toBe(true);
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
  it('walk through tools that exist, each step on a frame its tool’s page draws', () => {
    for (const journey of JOURNEYS) {
      expect(journey.steps.length, `${journey.title} is not a walk`).toBeGreaterThan(2);
      for (const step of journey.steps) {
        expect(TOOLS).toContain(step.tool);
        expect(TOOL_LABELS[step.tool]).toBeTruthy();
        expect(step.text.trim().endsWith('.')).toBe(true);
        expect(stepMarks(step).map((mark) => mark.anchor)).toEqual(step.marks);
      }
    }
  });

  it('name the journeys a tool takes part in, at their step', () => {
    expect(journeysThrough('media')).toEqual([{ id: 'geolocate-a-photo', title: 'Geolocate a photo', step: 1 }]);
    expect(journeysThrough('post')).toEqual([{ id: 'geolocate-a-photo', title: 'Geolocate a photo', step: 6 }]);
    expect(journeysThrough('settings')).toEqual([]);
  });

  it('measure a step taken on a picture of its own on that picture', () => {
    const shots = allShots();
    for (const journey of JOURNEYS) {
      for (const step of journey.steps.filter((one) => one.shot)) {
        const taken = shots.find((one) => one.shot === stepShot(step));
        expect(taken, step.shot).toBeTruthy();
        for (const anchor of step.marks) expect(taken.anchors).toContain(anchor);
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
    expect(build.steps.at(-1).marks).toEqual(['detect.builder-save']);
    expect(build.result.shot).toBeTruthy();
    expect(journeysThrough('detect')).toEqual([{ id: 'create-an-analyzer', title: 'Create your analyzer', step: 1 }]);
  });

  it('read a sequel of a sequel, as the analyzer builder opens from the library', () => {
    const marks = stepMarks({ tool: 'detect', marks: ['detect.rules', 'detect.reads'] });
    expect(marks.map((mark) => mark.title)).toEqual(['Rules', 'What it reads']);
    const shots = allShots().map((one) => one.shot);
    for (const shot of ['detect-library', 'detect-analyzer-new', 'detect-builder']) expect(shots).toContain(shot);
  });

  it('take a geolocation as far as the published thread', () => {
    const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate-a-photo');
    expect(geolocate.steps.at(-1)).toMatchObject({ tool: 'post', marks: ['post.first', 'post.publish'] });
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
    expect(landingFor('settings')).toEqual({ item: 'settings', tool: null });
    expect(landingFor('journey:geolocate-a-photo')).toEqual({ item: 'journey:geolocate-a-photo', tool: null });
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
