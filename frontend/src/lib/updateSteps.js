/**
 * How to update, said the same way wherever an update is offered: the startup
 * pop-up, the notice on Home and Settings → System. A binary is replaced by hand
 * after a download; a pip install updates from a terminal.
 *
 * The server knows the facts (GET /api/settings/update, `install`): which system
 * this is, the program file that runs, and the workspace that stays put. This
 * module only turns them into words, so it stays pure and testable.
 */

/** The command a pip install updates with, and the one for a plain pip install. */
export const PIP_COMMAND = 'pipx upgrade azimut';
export const PLAIN_PIP_COMMAND = 'pip install -U azimut';

// Where Azimut runs on each system, said the way that system says it.
const QUIT = {
  windows: 'Quit Azimut by closing its console window.',
  macos: 'Quit Azimut by closing its Terminal window.',
};
const QUIT_ELSEWHERE = 'Quit Azimut by closing its terminal window.';

const SYSTEM_LABELS = { linux: 'Linux', windows: 'Windows', macos: 'macOS' };

/**
 * Download a release file while the page stays where it is.
 *
 * The file sits on another site, so the `download` attribute is ignored. A new tab
 * stays open empty in Chrome. Following the link in this tab raises the "Leave
 * site?" guard whenever work is unsaved (lib/backButton.js), and refusing it cancels
 * the download. A hidden frame does neither, and a missing file fails inside it
 * instead of taking the page away. One frame is kept and reused.
 */
export function downloadInPlace(url, doc = document) {
  let frame = doc.getElementById('update-download');
  if (!frame) {
    frame = doc.createElement('iframe');
    frame.id = 'update-download';
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    doc.body.append(frame);
  }
  frame.src = url;
}

/** "Linux", "Windows" or "macOS", for the download button. */
export function systemLabel(system) {
  return SYSTEM_LABELS[system] ?? system ?? '';
}

/** A path a shell can take as one word. */
function shellWord(path) {
  return /^[\w./+-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * The steps to update, for this install and this system only: after a download for
 * the binary, from a terminal for a pip install. Commands carry the program's full
 * path, so they work from any folder.
 *
 * @param {{ kind?: string, system?: string, program?: string|null }} install
 * @returns {{ text: string, code?: string[], note?: string }[]}
 */
export function updateSteps(install) {
  const quit = { text: QUIT[install?.system] ?? QUIT_ELSEWHERE };
  if (install?.kind === 'package') {
    return [
      quit,
      { text: 'Update it, in a terminal:', code: [PIP_COMMAND], note: `Installed with plain pip? Run ${PLAIN_PIP_COMMAND}.` },
      { text: 'Start it again:', code: ['azimut'] },
    ];
  }
  const program = install?.program ?? '';
  const target = shellWord(program || 'azimut');
  const steps = [quit];
  steps.push(
    program
      ? { text: 'Put the downloaded file in place of the old program:', code: [program] }
      : { text: 'Put the downloaded file in place of the old program.' },
  );
  if (install?.system === 'linux') {
    steps.push({ text: 'Make it runnable, in a terminal:', code: [`chmod +x ${target}`] });
  } else if (install?.system === 'macos') {
    steps.push({
      text: 'Make it runnable, in Terminal:',
      code: [`chmod +x ${target}`, `xattr -d com.apple.quarantine ${target}`],
      note: 'Or open it once and allow it in System Settings → Privacy & Security.',
    });
  } else if (install?.system === 'windows') {
    steps.push({ text: 'If Windows warns about it, choose More info, then Run anyway.' });
  }
  steps.push({ text: 'Open it. Azimut comes back in your browser.' });
  return steps;
}
