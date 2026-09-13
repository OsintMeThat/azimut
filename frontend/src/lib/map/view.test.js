import { describe, expect, it } from 'vitest';
import { readView, readWindowLabel, viewParams } from './view.js';

describe('a view written into the address', () => {
  it('carries where the camera is, at a tenth of a metre', () => {
    expect(viewParams({ lat: 48.85661234, lon: 2.35222987, zoom: 17 })).toEqual({
      ll: '48.856612,2.35223',
      z: '17',
    });
  });

  it('leaves north-up out, because it is what every map opens on', () => {
    expect(viewParams({ lat: 1, lon: 1, zoom: 5, bearing: 0 }).b).toBeUndefined();
    expect(viewParams({ lat: 1, lon: 1, zoom: 5, bearing: 360 }).b).toBeUndefined();
    expect(viewParams({ lat: 1, lon: 1, zoom: 5, bearing: 215 }).b).toBe('215');
  });

  it('names the basemap, which is the surface\'s own and not the tool\'s', () => {
    expect(viewParams({ lat: 1, lon: 1, zoom: 5, provider: 'sentinel2' }).p).toBe('sentinel2');
  });

  it('writes nothing it cannot vouch for', () => {
    expect(viewParams({ lat: NaN, lon: 2, zoom: 4 }).ll).toBeUndefined();
    expect(viewParams({ lat: 91, lon: 2, zoom: 4 }).ll).toBeUndefined();
    expect(viewParams({ lat: 1, lon: 2, zoom: 99 }).z).toBeUndefined();
    expect(viewParams()).toEqual({});
  });
});

describe('a view read back out of it', () => {
  const read = (query) => readView(new URLSearchParams(query));

  it('reads a whole view', () => {
    expect(read('ll=48.8566,2.3522&z=17&b=215&p=esri')).toEqual({
      lat: 48.8566,
      lon: 2.3522,
      zoom: 17,
      bearing: 215,
      provider: 'esri',
    });
  });

  it('round-trips what was written', () => {
    const view = { lat: 48.8566, lon: 2.3522, zoom: 17, bearing: 90, provider: 'sentinel2' };
    expect(read(new URLSearchParams(viewParams(view)).toString())).toEqual(view);
  });

  it('honours a partial address as far as it goes', () => {
    expect(read('p=sentinel2')).toEqual({ provider: 'sentinel2' });
    expect(read('z=12')).toEqual({ zoom: 12 });
  });

  it('refuses what a hand-edited address can say', () => {
    // the map must stay where it is rather than fly to NaN
    expect(read('ll=nowhere')).toBe(null);
    expect(read('ll=91,2')).toBe(null);
    expect(read('ll=48.8,181')).toBe(null);
    expect(read('z=900')).toBe(null);
    expect(read('b=-4')).toBe(null);
    expect(read('')).toBe(null);
  });

  it('drops half a coordinate rather than guessing the other half', () => {
    expect(read('ll=48.8')).toBe(null);
  });
});

describe('which window this is', () => {
  const label = (query) => readWindowLabel(new URLSearchParams(query));

  it('numbers a detached window', () => {
    expect(label('w=2')).toBe(2);
  });

  it('says nothing about the first one', () => {
    expect(label('')).toBe(null);
    expect(label('w=1')).toBe(null);
  });

  it('refuses a number that would reach a title unread', () => {
    expect(label('w=0')).toBe(null);
    expect(label('w=-3')).toBe(null);
    expect(label('w=2.5')).toBe(null);
    expect(label('w=999')).toBe(null);
    expect(label('w=<script>')).toBe(null);
  });
});
