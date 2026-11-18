/**
 * How to put a web folder on GitHub Pages, said the same way wherever it is needed.
 *
 * The folder carries these steps as `HOW-TO-PUBLISH.md`, written by the server from
 * its own copy (`engine/notes_web.py`, `PAGES_*`), and the export dialog shows them
 * under How to publish. A test holds the two copies to the same words, so a step
 * changed in one place is changed in both.
 */

/** Where a free account is opened. */
export const PAGES_SIGNUP = 'https://github.com/signup';

export const PAGES_INTRO = 'GitHub Pages puts this folder on the web for free, at an address you can share on X. It all happens on github.com in your browser, with no command line.';

export const PAGES_PUBLIC = 'A Pages site is public: anyone with the address can read it, and search engines can find it. The folder holds the public edition only.';

export const PAGES_STEPS = Object.freeze([
  'Sign up for a free account at github.com, unless you have one. Your username goes in every address.',
  'Press + at the top right, then New repository. Name it articles, keep it Public, switch on Add README, and press Create repository. You make it once: every article goes in it as a folder.',
  'Pick a short name for this article, such as port-strike. Its address will be https://your-name.github.io/articles/port-strike/, with your username in lower case.',
  'In Azimut, type that address under Address it will live at, and export the web folder. The folder takes the short name, and X gets its picture card.',
  'In the repository, press Add file › Upload files. Drag the folder itself onto the page, not the files inside it, then press Commit changes.',
  'The first time only: open Settings › Pages. Under Build and deployment, choose Deploy from a branch, then main and / (root), and press Save.',
  'Wait about a minute, then open the address. Share it on X like any link.',
]);

export const PAGES_UPDATE = 'Export the note again from Azimut and upload its folder the same way: the new files replace the old ones at the same address.';

export const PAGES_CARD = 'The address typed in Azimut is what gives X its picture card, share.jpg in the folder. Without it, X shows the link alone.';
