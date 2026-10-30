import { describe, expect, it, vi } from 'vitest';
import { fireControls, nightControls } from './eventControls.js';
import { DATED, PICTURE } from './firms.js';
import { COMPOSITE } from './nightlights.js';

const SENSORS = [
  { id: 'viirs', label: 'VIIRS (S-NPP, NOAA-20, NOAA-21)' },
  { id: 'modis', label: 'MODIS (Terra + Aqua)' },
];

describe('the fire layer’s questions', () => {
  it('names each instrument without its satellites, which do not fit', () => {
    const [sensor] = fireControls({ sensor: 'viirs', window: '24h' }, SENSORS, () => {});
    expect(sensor.options.map((option) => option.label)).toEqual(['VIIRS', 'MODIS']);
  });

  it('offers the picture’s day only to a map that has one to follow', () => {
    const plain = fireControls({ sensor: 'viirs', window: '24h' }, SENSORS, () => {})[1];
    expect(plain.options.some((option) => option.id === PICTURE)).toBe(false);
    const dated = fireControls({ sensor: 'viirs', window: PICTURE }, SENSORS, () => {}, { follow: "Picture's day" })[1];
    expect(dated.options[0]).toMatchObject({ id: PICTURE, label: "Picture's day" });
  });

  it('starts a picked range on the day that was showing, not on today', () => {
    const set = vi.fn();
    const showing = fireControls({ sensor: 'viirs', window: PICTURE, first: '' }, SENSORS, set, {
      follow: "Picture's day",
      pictureDay: '2024-03-12',
    })[1];
    showing.pick(DATED);
    expect(set).toHaveBeenCalledWith({ window: DATED, first: '2024-03-12', last: '' });
  });

  it('asks for the days only once Dates is picked', () => {
    const live = fireControls({ sensor: 'viirs', window: '24h' }, SENSORS, () => {})[1];
    expect(live.dates).toBeNull();
    const dated = fireControls({ sensor: 'viirs', window: DATED, first: '2024-03-01', last: '' }, SENSORS, () => {})[1];
    expect(dated.dates).toMatchObject({ first: '2024-03-01', max: '2024-03-31' });
  });
});

describe('the night layer’s questions', () => {
  it('asks for one night under the sensor, as the Map always did', () => {
    const controls = nightControls({ source: 'noaa20', day: '2025-01-01' }, () => {});
    expect(controls).toHaveLength(1);
    expect(controls[0].day).toMatchObject({ value: '2025-01-01', min: '2024-03-25' });
  });

  it('asks for no night at all for the composite', () => {
    const controls = nightControls({ source: COMPOSITE.id, day: '' }, () => {}, { follow: "Picture's night" });
    expect(controls).toHaveLength(1);
    expect(controls[0].day).toBeNull();
  });

  it('follows the picture until a night is picked, then starts on the night that was showing', () => {
    const set = vi.fn();
    const controls = nightControls({ source: 'noaa20', day: '2025-01-01', follow: true }, set, {
      follow: "Picture's night",
      pictureDay: '2025-06-02',
    });
    expect(controls[1].value).toBe(PICTURE);
    expect(controls[1].day).toBeNull();
    controls[1].pick('day');
    expect(set).toHaveBeenCalledWith({ follow: false, day: '2025-06-02' });
  });
});
