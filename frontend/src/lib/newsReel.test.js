import { describe, expect, it } from 'vitest';
import { shotOf } from './guide.js';
import { aim, beatOf, beatsOf, fitBox, moveCss, newsFilm, newsPicture } from './newsReel.js';

/** A move to the thousandth of a pixel, -0 read as 0. */
const near = ({ x, y, zoom }) => ({ x: Math.round(x * 1000) / 1000 + 0, y: Math.round(y * 1000) / 1000 + 0, zoom });

describe('a picture in the room', () => {
  it('fills the room, cut where it overflows, or stands whole inside it', () => {
    expect(fitBox(2000, 1000, 720, 420)).toEqual({ w: 840, h: 420, left: -60, top: 0 });
    expect(fitBox(1000, 1000, 720, 420)).toEqual({ w: 720, h: 720, left: 0, top: -150 });
    expect(fitBox(2000, 1000, 720, 420, true)).toEqual({ w: 720, h: 360, left: 0, top: 30 });
    expect(fitBox(1000, 1000, 720, 420, true)).toEqual({ w: 420, h: 420, left: 150, top: 0 });
  });

  it('brings the point asked to the centre', () => {
    const box = fitBox(2000, 1000, 720, 420);
    expect(near(aim(box, [0.5, 0.5, 1], 720, 420))).toEqual({ x: 0, y: 0, zoom: 1 });
    // nearer on the middle: the picture grows about it
    expect(near(aim(box, [0.5, 0.5, 2], 720, 420))).toEqual({ x: -420, y: -210, zoom: 2 });
  });

  it('never shows the room’s edge past a picture that fills it', () => {
    const box = fitBox(2000, 1000, 720, 420);
    // its top left corner asked for: the picture stops at the room's corner
    expect(near(aim(box, [0, 0, 2], 720, 420))).toEqual({ x: 60, y: 0, zoom: 2 });
    expect(near(aim(box, [1, 1, 2], 720, 420))).toEqual({ x: -900, y: -420, zoom: 2 });
  });

  it('grows a picture shown whole from its own centre', () => {
    const box = fitBox(2000, 1000, 720, 420, true);
    expect(near(aim(box, [0.1, 0.9, 1.1], 720, 420, true))).toEqual({ x: -36, y: -18, zoom: 1.1 });
  });

  it('writes a move as the CSS a box takes', () => {
    expect(moveCss({ x: 60, y: -0.04, zoom: 2 })).toBe('translate(60.0px, -0.0px) scale(2)');
  });
});

describe('a beat', () => {
  it('reads a guide picture: its size, its framings and the control it lights', () => {
    const shot = shotOf('inspect-scenes');
    const beat = beatOf({ shot: 'inspect-scenes', ring: 'geo.pill', label: 'Geolocating', light: 0.5, from: [0.5, 0.4, 1.1], seconds: 2, chip: 'Inspect' });
    expect(beat).toMatchObject({ kind: 'picture', src: shot.src, film: null, width: shot.width, height: shot.height, hold: 2000, chip: 'Inspect' });
    // with no last framing, it holds its first
    expect(beat.to).toEqual([0.5, 0.4, 1.1]);
    expect(beat.ring).toEqual({ ...shot.anchors['geo.pill'], label: 'Geolocating', above: false, light: 500 });
  });

  it('plays the film a guide picture has, at the rate asked', () => {
    const beat = beatOf({ shot: 'article-lead', film: true, rate: 1.6 });
    expect(beat.film).toBe(shotOf('article-lead').film);
    expect(beat.rate).toBe(1.6);
  });

  it('reads What’s new’s own films, deck and site page', () => {
    expect(beatOf({ film: 'web-map', browser: 'your-name.github.io/' })).toMatchObject({ kind: 'picture', film: newsFilm('web-map'), src: newsPicture('web-map'), browser: 'your-name.github.io/' });
    expect(beatOf({ deck: ['report-cover', 'report-wall'], pills: ['PDF'] })).toMatchObject({ kind: 'deck', pages: [newsPicture('report-cover'), newsPicture('report-wall')], pills: ['PDF'] });
    expect(beatOf({ page: 'site-home', scroll: 0.4, click: [0.7, 0.6] })).toMatchObject({ kind: 'site', src: newsPicture('site-home'), scroll: 0.4, click: [0.7, 0.6] });
  });

  it('is nothing when what it names was never made', () => {
    expect(beatOf({ shot: 'no-such-picture' })).toBeNull();
    expect(beatOf({ shot: 'inspect-scenes', ring: 'no.such.anchor' })).toBeNull();
    expect(beatOf({ shot: 'inspect-scenes', film: true })).toBeNull();
    expect(beatOf({ film: 'no-such-film' })).toBeNull();
    expect(beatOf({ deck: ['report-cover', 'no-such-page'] })).toBeNull();
    expect(beatOf({ page: 'no-such-page' })).toBeNull();
    expect(beatOf({ chip: 'Nothing to show' })).toBeNull();
  });

  it('makes a reel that plays whole or not at all', () => {
    expect(beatsOf([{ shot: 'inspect-scenes' }, { shot: 'post-video' }])).toHaveLength(2);
    expect(beatsOf([{ shot: 'inspect-scenes' }, { shot: 'no-such-picture' }])).toBeNull();
    expect(beatsOf([])).toBeNull();
    expect(beatsOf(undefined)).toBeNull();
  });
});
