import { describe, expect, it } from 'vitest';
import { SMALL_ZONE_PX, barPlace, pictureRect, zoneFileName, zonePixels, zoneRect } from './searchZone.js';

const VIEW = { width: 800, height: 500 };
const BAR = { width: 300, height: 34 };

describe('where the picture and its zone stand', () => {
  it('reads the picture in the overlay from both boxes on screen', () => {
    expect(pictureRect({ left: 150, top: 90, width: 640, height: 360 }, { left: 100, top: 60 }))
      .toEqual({ left: 50, top: 30, width: 640, height: 360 });
  });

  it('lays the zone on the picture by its fractions', () => {
    const picture = { left: 50, top: 30, width: 640, height: 360 };
    expect(zoneRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, picture))
      .toEqual({ left: 210, top: 210, width: 320, height: 90 });
  });
});

describe('where the bar goes', () => {
  it('stands at the top of the viewer, centred, while no zone is drawn', () => {
    expect(barPlace(null, BAR, VIEW)).toEqual({ left: 250, top: 8 });
  });

  it('sits under the zone, centred on it', () => {
    expect(barPlace({ left: 300, top: 100, width: 200, height: 100 }, BAR, VIEW)).toEqual({ left: 250, top: 208 });
  });

  it('goes over a zone that reaches the foot of the viewer', () => {
    expect(barPlace({ left: 300, top: 300, width: 200, height: 180 }, BAR, VIEW)).toEqual({ left: 250, top: 258 });
  });

  it('goes inside the foot of a zone that fills the viewer', () => {
    const place = barPlace({ left: 0, top: 0, width: 800, height: 500 }, BAR, VIEW);
    expect(place).toEqual({ left: 250, top: 458 });
  });

  it('never leaves the viewer at a side', () => {
    expect(barPlace({ left: -40, top: 100, width: 60, height: 60 }, BAR, VIEW).left).toBe(8);
    expect(barPlace({ left: 780, top: 100, width: 60, height: 60 }, BAR, VIEW).left).toBe(492);
  });
});

describe('what the engines get', () => {
  it('counts the zone in the picture own pixels', () => {
    expect(zonePixels({ x: 0.1, y: 0.1, w: 0.25, h: 0.1 }, 1920, 1080)).toEqual({ w: 480, h: 108 });
    expect(zonePixels(null, 1920, 1080)).toBeNull();
    expect(zonePixels({ x: 0, y: 0, w: 1, h: 1 }, 0, 0)).toBeNull();
  });

  it('calls a zone under a hundred pixels on a side small', () => {
    expect(SMALL_ZONE_PX).toBe(100);
  });

  it('names the file by the source, the moment and the zone', () => {
    expect(zoneFileName('Convoy clip', 75.4)).toBe('reverse-Convoy clip-00-01-15-zone.png');
    expect(zoneFileName('Quai', null)).toBe('reverse-Quai-zone.png');
    expect(zoneFileName('a/b: c?', null)).toBe('reverse-a_b_ c_-zone.png');
    expect(zoneFileName('', null)).toBe('reverse-picture-zone.png');
  });
});
