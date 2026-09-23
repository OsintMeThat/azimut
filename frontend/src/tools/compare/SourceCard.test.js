import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SourceCard from './SourceCard.svelte';
import { paths } from '../../components/Icon.svelte';

const PROVIDERS = [
  { id: 'sentinel2', label: 'Sentinel-2 (Copernicus)' },
  { id: 'esri-wayback', label: 'Esri Wayback' },
  { id: 'esri-world-imagery', label: 'Esri World Imagery' },
];

const imagery = {
  providers: PROVIDERS,
  find: (id) => PROVIDERS.find((entry) => entry.id === id),
  pill: () => '',
};

const sentinel = (over = {}) => ({
  menuOpen: false,
  layer: 'TRUE_COLOR',
  layers: [],
  layerHint: '',
  layersSource: 'instance',
  date: '',
  latest: '',
  maxcc: 100,
  month: '2026-05',
  passes: {},
  passesBusy: false,
  passesNote: '',
  stale: false,
  verifyingDate: '',
  dateStatus: () => undefined,
  filtered: () => false,
  toggleMenu: vi.fn(),
  ...over,
});

const release = (over = {}) => ({
  menuOpen: false,
  date: '',
  position: -1,
  visible: [],
  releases: [],
  listNote: '',
  changesOnly: false,
  changesBusy: false,
  changesNote: '',
  stale: false,
  changes: null,
  picture: () => null,
  toggleMenu: vi.fn(),
  step: vi.fn(),
  pick: vi.fn(),
  setChangesOnly: vi.fn(),
  ...over,
});

function props(over = {}) {
  return {
    letter: 'A',
    imagery,
    providerId: 'sentinel2',
    s2: sentinel(),
    wayback: release(),
    shown: { fallenBack: false, blocked: false, provider: imagery.find('sentinel2') },
    ...over,
  };
}

const layerIcons = (body) => body.split(paths.layers).length - 1;

describe('SourceCard', () => {
  it('dates Sentinel-2 on its own chip, leaving one layers icon on the card', () => {
    const { body } = render(SourceCard, {
      props: props({ s2: sentinel({ date: '2025-04-11' }) }),
    });
    expect(body).toContain('2025-04-11');
    // The card's own Layers button is the only thing wearing that icon: a second
    // one on the date picker said nothing about which of the two held the date.
    expect(layerIcons(body)).toBe(1);
  });

  it('dates Wayback and Sentinel-2 the same way', () => {
    const { body } = render(SourceCard, {
      props: props({
        providerId: 'esri-wayback',
        wayback: release({ date: '2022-03-16' }),
        shown: { fallenBack: false, blocked: false, provider: imagery.find('esri-wayback') },
      }),
    });
    expect(body).toContain('2022-03-16');
    expect(layerIcons(body)).toBe(1);
  });

  it('dates a Wayback picture apart from the release that published it', () => {
    const { body } = render(SourceCard, {
      props: props({
        providerId: 'esri-wayback',
        wayback: release({ date: '2026-08-05' }),
        shown: { fallenBack: false, blocked: false, provider: imagery.find('esri-wayback') },
        dated: { date: '2015-05-10', source: 'Maxar' },
      }),
    });
    expect(body).toContain('2026-08-05');
    expect(body).toContain('2015-05-10');
    expect(body).toContain('Acquired around this date (Maxar)');
  });

  it('shows the acquisition date beside a provider that has no picker', () => {
    const { body } = render(SourceCard, {
      props: props({
        providerId: 'esri-world-imagery',
        shown: { fallenBack: false, blocked: false, provider: imagery.find('esri-world-imagery') },
        dated: { date: '2023-08-02', source: 'Maxar' },
      }),
    });
    expect(body).toContain('2023-08-02');
    expect(body).toContain('Acquired around this date (Maxar)');
  });
});
