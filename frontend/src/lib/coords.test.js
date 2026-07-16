import { describe, it, expect } from 'vitest';
import {
  formatCoords,
  formatDD,
  formatDMS,
  formatMGRS,
  latBand,
  parseHomeView,
  utmZone,
} from './coords.js';

describe('formatDD', () => {
  it('keeps the app native 6 decimals', () => {
    expect(formatDD(48.8583701, 2.2944813)).toBe('48.858370, 2.294481');
  });

  it('renders southern/western points with signs, not hemispheres', () => {
    expect(formatDD(-33.8568, 151.2153)).toBe('-33.856800, 151.215300');
  });
});

describe('formatDMS', () => {
  it('splits degrees, minutes and seconds with hemispheres', () => {
    expect(formatDMS(48.8583701, 2.2944813)).toBe('48°51\'30.13"N 2°17\'40.13"E');
  });

  it('marks south and west', () => {
    expect(formatDMS(-33.8568, -70.6693)).toBe('33°51\'24.48"S 70°40\'09.48"W');
  });

  it('handles the equator and prime meridian', () => {
    expect(formatDMS(0, 0)).toBe('0°00\'00.00"N 0°00\'00.00"E');
  });

  it('carries a second that rounds up to 60 into the minute', () => {
    // 1.0166666 = 1°00'59.9999" — the seconds must not print as 60
    expect(formatDMS(1.01666664, 0)).toBe('1°01\'00.00"N 0°00\'00.00"E');
  });
});

describe('utmZone', () => {
  it('is the plain 6° zone away from the exceptions', () => {
    expect(utmZone(48.8583701, 2.2944813)).toBe(31);
    expect(utmZone(40.6892, -74.0445)).toBe(18);
  });

  it('widens zone 32 over south-west Norway', () => {
    expect(utmZone(59.9, 4.9)).toBe(32); // plain formula would say 31
    expect(utmZone(60.5, 5.0)).toBe(32);
  });

  it('uses only odd zones over Svalbard', () => {
    expect(utmZone(72.5, 5.0)).toBe(31);
    expect(utmZone(75.0, 12.0)).toBe(33);
    expect(utmZone(78.0, 25.0)).toBe(35);
    expect(utmZone(80.0, 35.0)).toBe(37);
  });
});

describe('latBand', () => {
  it('skips I and O', () => {
    expect(latBand(48.86)).toBe('U');
    expect(latBand(40.69)).toBe('T');
    expect(latBand(-33.86)).toBe('H');
    expect(latBand(0)).toBe('N');
  });

  it('stretches band X to the 84°N limit', () => {
    expect(latBand(72.5)).toBe('X');
    expect(latBand(83.5)).toBe('X');
  });

  it('is null outside the UTM domain', () => {
    expect(latBand(85)).toBeNull();
    expect(latBand(-80.1)).toBeNull();
  });
});

describe('formatMGRS', () => {
  // Ground truth generated with the reference `mgrs` library (Python, NGA
  // GEOTRANS-derived) — not hand-computed.
  const cases = [
    [48.8583701, 2.2944813, '31U DQ 48250 11951'], // Eiffel Tower
    [40.6892, -74.0445, '18T WL 80735 04695'], // Statue of Liberty
    [38.8977, -77.0365, '18S UJ 23394 07395'], // White House
    [-33.8568, 151.2153, '56H LH 34900 52288'], // Sydney Opera House
    [64.1466, -21.9426, '27W VM 54138 13689'], // Reykjavík
    [-54.8019, -68.303, '19F EV 44805 27029'], // Ushuaia
    [1.3521, 103.8198, '48N UG 68700 49479'], // Singapore
    [78.2232, 15.6469, '33X WG 14738 83360'], // Longyearbyen (Svalbard)
    [0.0, 0.0, '31N AA 66021 00000'], // Null Island
    [-33.9249, 18.4241, '34H BH 61881 43182'], // Cape Town
    [60.5, 5.0, '32V KN 80356 13774'], // Bergen (Norway exception)
    [59.9, 4.9, '32V KM 70719 47376'], // North Sea (Norway exception)
    [72.5, 5.0, '31X EA 67115 45822'], // Svalbard exception
    [75.0, 12.0, '33X VD 13362 25798'],
    [78.0, 25.0, '35X MG 53588 59161'],
    [80.0, 35.0, '37X DJ 22516 84250'],
    [-79.9, 120.0, '51C VM 41292 28062'], // near the southern limit
    [83.5, -40.0, '24X VT 87362 72385'], // near the northern limit
  ];

  it.each(cases)('%s, %s → %s', (lat, lon, expected) => {
    expect(formatMGRS(lat, lon)).toBe(expected);
  });

  it('is null beyond the UTM limits (the poles use UPS)', () => {
    expect(formatMGRS(85, 10)).toBeNull();
    expect(formatMGRS(-85, 10)).toBeNull();
  });
});

describe('formatCoords', () => {
  it('dispatches on the chosen format', () => {
    expect(formatCoords(48.8583701, 2.2944813, 'dd')).toBe('48.858370, 2.294481');
    expect(formatCoords(48.8583701, 2.2944813, 'dms')).toBe('48°51\'30.13"N 2°17\'40.13"E');
    expect(formatCoords(48.8583701, 2.2944813, 'mgrs')).toBe('31U DQ 48250 11951');
  });

  it('defaults to decimal degrees', () => {
    expect(formatCoords(48.8583701, 2.2944813)).toBe('48.858370, 2.294481');
    expect(formatCoords(48.8583701, 2.2944813, 'nonsense')).toBe('48.858370, 2.294481');
  });

  it('falls back to decimal degrees where MGRS cannot reach', () => {
    expect(formatCoords(85, 10, 'mgrs')).toBe('85.000000, 10.000000');
  });

  it('is empty for a non-coordinate rather than printing NaN', () => {
    expect(formatCoords(null, undefined)).toBe('');
    expect(formatCoords(NaN, 5, 'dms')).toBe('');
  });
});

describe('parseHomeView', () => {
  it('reads the text fields the lat/lon inputs bind', () => {
    expect(parseHomeView({ lat: '48.8584', lon: '2.2945', zoom: '16' })).toEqual({
      lat: 48.8584,
      lon: 2.2945,
      zoom: 16,
    });
  });

  it('accepts the number the zoom input binds', () => {
    // <input type="number"> binds a number, not a string — the whole reason a
    // zoom change used to throw before it ever reached the server
    expect(parseHomeView({ lat: '48.8584', lon: '2.2945', zoom: 4 })).toEqual({
      lat: 48.8584,
      lon: 2.2945,
      zoom: 4,
    });
  });

  it('rounds a fractional zoom the server would refuse', () => {
    expect(parseHomeView({ lat: '0', lon: '0', zoom: 4.6 }).zoom).toBe(5);
  });

  it('keeps a zero coordinate, which is a real place', () => {
    expect(parseHomeView({ lat: '0', lon: 0, zoom: 3 })).toEqual({ lat: 0, lon: 0, zoom: 3 });
  });

  it('refuses a blank field, however it went blank', () => {
    expect(parseHomeView({ lat: '', lon: '2.2945', zoom: 16 })).toBeNull();
    expect(parseHomeView({ lat: '48.8584', lon: '   ', zoom: 16 })).toBeNull();
    expect(parseHomeView({ lat: '48.8584', lon: '2.2945', zoom: null })).toBeNull();
  });

  it('reads what it can and refuses the rest', () => {
    expect(parseHomeView({ lat: '48.', lon: '2.2945', zoom: 16 })).toEqual({
      lat: 48,
      lon: 2.2945,
      zoom: 16,
    });
    expect(parseHomeView({ lat: '-', lon: '2.2945', zoom: 16 })).toBeNull();
    expect(parseHomeView({ lat: 'north', lon: '2.2945', zoom: 16 })).toBeNull();
  });
});
