import { describe, expect, it } from 'vitest';
import { thisBrowser } from './thisBrowser.js';

const AGENTS = {
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  chrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  edge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
  opera:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 OPR/112.0',
  vivaldi:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Vivaldi/6.8',
  chromium:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/126.0 Chrome/126.0 Safari/537.36',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

describe('which browser is showing this page', () => {
  // Every Chromium browser claims to be Chrome and most claim to be Safari, so the
  // particular ones have to be tested before the general or they all read as Chrome.
  it('reads each browser off its own agent', () => {
    for (const [expected, agent] of Object.entries(AGENTS)) {
      expect(thisBrowser('firefox', agent, {})).toBe(expected);
    }
  });

  it('asks Brave directly, since it hides itself from the agent on purpose', () => {
    expect(thisBrowser('firefox', AGENTS.chrome, { brave: {} })).toBe('brave');
  });

  it('falls back rather than guessing at an agent it does not know', () => {
    expect(thisBrowser('firefox', 'SomeKiosk/1.0', {})).toBe('firefox');
    expect(thisBrowser('chrome', '', {})).toBe('chrome');
  });
});
