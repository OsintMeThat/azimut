// @vitest-environment happy-dom
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WHATS_NEW from './whatsNew.json';
import { shotOf } from './guide.js';
import {
  FIND_BETA,
  FIND_GUIDE,
  TOUR,
  closeForThisStart,
  closedThisStart,
  findBetaDue,
  newsOf,
  newsSince,
  onStart,
  versionParts,
} from './onboarding.js';

/** The version the app is being made into, as the backend stamps it. */
const VERSION = /__version__ = "([^"]+)"/.exec(readFileSync(resolve('../src/azimut/__init__.py'), 'utf8'))[1];

const BOOK = {
  '0.3.3': { pages: [{ title: 'Three a' }, { title: 'Three b' }] },
  '0.3.4': { pages: [{ title: 'Four' }] },
  '0.4.0': { pages: [{ title: 'Next' }] },
};
const titles = (pages) => pages.map((page) => page.title);

afterEach(() => sessionStorage.clear());

describe('reading versions', () => {
  it('reads a release, a tag and a development build alike', () => {
    expect(versionParts('0.3.3')).toEqual([0, 3, 3]);
    expect(versionParts('v0.3.10')).toEqual([0, 3, 10]);
    expect(versionParts('0.3.3.dev12+g5674eef')).toEqual([0, 3, 3]);
    expect(versionParts('')).toBeNull();
    expect(versionParts('soon')).toBeNull();
  });
});

describe('what a version brings', () => {
  it('shows everything since the version last read, newest first', () => {
    expect(titles(newsSince('0.3.4', '0.3.2', BOOK))).toEqual(['Four', 'Three a', 'Three b']);
    expect(titles(newsSince('0.3.4', '0.3.3', BOOK))).toEqual(['Four']);
    expect(newsSince('0.3.4', '0.3.4', BOOK)).toEqual([]);
    // nothing from a version not reached yet, and a first reading starts from nothing
    expect(titles(newsSince('0.3.3', '', BOOK))).toEqual(['Three a', 'Three b']);
    expect(newsSince('', '', BOOK)).toEqual([]);
  });

  it('names each page’s version', () => {
    expect(newsSince('0.3.4', '0.3.2', BOOK).map((page) => page.version)).toEqual(['0.3.4', '0.3.3', '0.3.3']);
  });

  it('opens on the newest version’s pages when asked by hand', () => {
    expect(titles(newsOf('0.3.4', BOOK))).toEqual(['Four']);
    expect(titles(newsOf('0.3.3.dev2', BOOK))).toEqual(['Three a', 'Three b']);
    expect(newsOf('0.2.9', BOOK)).toEqual([]);
  });
});

describe('what the app opens with', () => {
  const start = (state) => onStart({ tour: '', seen: '', version: '0.3.4', hasCases: false, ...state }, BOOK);

  it('greets a workspace with nothing in it', () => {
    expect(start({})).toEqual({ kind: 'welcome' });
  });

  it('takes a tour back where it was left, even on a reload', () => {
    expect(start({ tour: '3' })).toEqual({ kind: 'tour', step: 2 });
    expect(start({ tour: '3', hasCases: true, closed: true })).toEqual({ kind: 'tour', step: 2 });
    // a tour kept by a longer version of it lands on its last page
    expect(start({ tour: '9' })).toEqual({ kind: 'tour', step: TOUR.length - 1 });
  });

  it('shows someone who already has cases what their version brings, and nothing once read', () => {
    expect(titles(start({ hasCases: true, seen: '0.3.3' }).pages)).toEqual(['Four']);
    expect(start({ hasCases: true, seen: '0.3.4' })).toBeNull();
    expect(start({ tour: 'done', seen: '0.3.4' })).toBeNull();
  });

  it('waits for the next start once put away without a choice', () => {
    expect(start({ closed: true })).toBeNull();
    expect(start({ hasCases: true, closed: true })).toBeNull();
  });

  it('remembers that in this start only', () => {
    expect(closedThisStart('0.3.4')).toBe(false);
    closeForThisStart('0.3.4');
    expect(closedThisStart('0.3.4')).toBe(true);
    // a new version is a new start for it
    expect(closedThisStart('0.3.5')).toBe(false);
  });
});

describe('Find’s beta notice', () => {
  it('is due until read, and waits for the next start when put away without a choice', () => {
    expect(findBetaDue({ seen: false, version: '0.3.3' })).toBe(true);
    expect(findBetaDue({ seen: true, version: '0.3.3' })).toBe(false);
    // never over another card
    expect(findBetaDue({ seen: false, version: '0.3.3', busy: true })).toBe(false);
    closeForThisStart('0.3.3', true);
    expect(findBetaDue({ seen: false, version: '0.3.3' })).toBe(false);
  });

  it('is put away apart from the welcome and What’s new', () => {
    closeForThisStart('0.3.3', true);
    expect(closedThisStart('0.3.3')).toBe(false);
    closeForThisStart('0.3.3');
    sessionStorage.removeItem('azimut:findBetaClosed');
    expect(findBetaDue({ seen: false, version: '0.3.3' })).toBe(true);
  });

  it('says what a beta means for a search, and leads to the guide on Find', () => {
    expect(FIND_BETA.badge).toBe('Beta');
    expect(FIND_BETA.text.length).toBeLessThanOrEqual(140);
    expect(FIND_BETA.items.length).toBeGreaterThan(0);
    expect(FIND_GUIDE).toBe('horizon.find');
  });
});

describe('the pages as written', () => {
  /** A picture the guide made, and the control a page lights on it. */
  function pictured(page, where) {
    if (!page.shot) return;
    const shot = shotOf(page.shot);
    expect(shot, `${where}: no picture ${page.shot}; run npm run guide:shots`).toBeTruthy();
    if (page.anchor) {
      expect(shot.anchors[page.anchor], `${where}: ${page.anchor} is not measured on ${page.shot}`).toBeTruthy();
      expect(page.label, `${where}: a lit control is named`).toBeTruthy();
    }
  }

  it('has a What’s new for the version being made', () => {
    expect(WHATS_NEW[VERSION], `whatsNew.json has no entry for ${VERSION}`).toBeTruthy();
  });

  it('keeps every What’s new short, pictured, and free of buttons that leave it', () => {
    for (const [version, entry] of Object.entries(WHATS_NEW)) {
      expect(versionParts(version), version).not.toBeNull();
      expect(entry.pages.length, version).toBeGreaterThan(0);
      expect(entry.pages.length, `${version}: five pages at most`).toBeLessThanOrEqual(5);
      for (const page of entry.pages) {
        const where = `${version} "${page.title}"`;
        expect(page.title, where).toBeTruthy();
        expect(Boolean(page.shot || page.film || page.items?.length), `${where}: a picture, the film or a list`).toBe(true);
        expect(`${page.text ?? ''}`.length, `${where}: one or two sentences`).toBeLessThanOrEqual(140);
        // opening a tool from here would end the reading on its first page
        expect(Object.keys(page).filter((key) => /try|tool|open/i.test(key)), where).toEqual([]);
        pictured(page, where);
      }
    }
  });

  it('keeps the welcome’s film light enough to ship in every download', () => {
    for (const [name, most] of [['hero.webm', 3.5e6], ['hero.webp', 3e5]]) {
      expect(statSync(resolve('src/assets/welcome', name)).size, `${name}: run npm run guide:hero`).toBeLessThan(most);
    }
  });

  it('pictures every page of the tour, the last one without a control to light', () => {
    expect(TOUR).toHaveLength(4);
    TOUR.forEach((page, at) => {
      expect(page.where?.label, page.title).toBeTruthy();
      expect(page.text.length, page.title).toBeLessThanOrEqual(140);
      pictured(page, `tour page ${at + 1}`);
    });
  });
});
