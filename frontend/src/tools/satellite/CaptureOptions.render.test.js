// @vitest-environment happy-dom
/**
 * The capture menu, actually mounted.
 *
 * A figure is the one thing in here that is not a size or a ratio, and it was
 * buried under them: a row of its own at the bottom of the menu, below the
 * custom size inputs, which nobody scrolls to. It now sits where the menu is
 * read, beside Capture and Select area. So what is asserted is that it is
 * there, that it is pressable whatever the map is set to, since what a figure
 * still needs is the dialog's to say, and that pressing it opens that dialog
 * without arming a capture mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CaptureOptions from './CaptureOptions.svelte';

const RATIOS = [{ id: 'free', label: 'Free' }, { id: '16:9', label: '16:9' }];
const PRESETS = [{ id: 'md', label: '1200' }, { id: 'custom', label: 'Custom' }];

let held = null;

function show(props = {}) {
  held = mount(CaptureOptions, {
    target: document.body,
    props: {
      menuOpen: true,
      mode: 'center',
      hover: false,
      selectArmed: false,
      capturing: false,
      blocked: false,
      widgetBase: false,
      runCapture: vi.fn(),
      ratios: RATIOS,
      ratio: 'free',
      presets: PRESETS,
      preset: 'md',
      customWidth: 1200,
      customHeight: 1200,
      resolution: 1,
      scaleNorth: false,
      openScreenshot: vi.fn(),
      openExtensionGate: vi.fn(),
      ...props,
    },
  });
  flushSync();
  return document.body;
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

/** The chips of the first row, which is the one the menu opens on. */
const modeChips = () =>
  [...document.body.querySelectorAll('.menu-row')][0].querySelectorAll('.chip');
const labels = () => [...modeChips()].map((node) => node.textContent.trim());
const chip = (label) => [...modeChips()].find((node) => node.textContent.trim() === label);
const hints = () =>
  [...document.body.querySelectorAll('.menu-hint')].map((node) => node.textContent.trim());

function press(node) {
  node.click();
  flushSync();
}

describe('on Sentinel-2', () => {
  it('is a chip beside the two capture modes, pressable', () => {
    show({ openFigure: vi.fn() });

    expect(labels()).toEqual(['Capture', 'Select area', 'Figure…']);
    expect(chip('Figure…').disabled).toBe(false);
  });

  it('opens the dialog and closes the menu, leaving the mode alone', () => {
    const openFigure = vi.fn();
    show({ openFigure, mode: 'center' });

    press(chip('Figure…'));

    expect(openFigure).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.size-menu')).toBeNull();
    // The big button still does what it did: a figure is an act, not a mode.
    expect(document.body.querySelector('.capture-main').textContent.trim()).toBe('Capture');
  });
});

describe('on a basemap with no figure to build', () => {
  it('leaves the row at the two capture modes, and the menu unchanged', () => {
    show({ openFigure: null });

    expect(labels()).toEqual(['Capture', 'Select area']);
    expect(hints()).toEqual([
      'Captures the centred size below.',
      'Captures a deeper zoom for a sharper file.',
      'Drawn into the capture, in your units.',
    ]);
  });
});
