import { describe, it, expect } from 'vitest';
import { classify, reloadLanded } from './extInstall.js';

// Five states and one comparison, and every one of them has a wrong answer that
// looks plausible: reporting a foreign copy as updatable, missing that two are
// loaded, trusting the version where only the digest moves, or telling a Firefox
// analyst to remove the signed copy their browser will actually keep.

const server = ({ installId = 'mine', folderPayload = 'new', bundled = 'new', ...rest } = {}) => ({
  path: '/home/a/Azimut/.azimut/extension',
  staged: false,
  bundled: { version: '0.3.0', payload: bundled },
  folder: installId ? { install_id: installId, version: '0.3.0', payload: folderPayload } : null,
  ...rest,
});

const responder = (installId, payload, extensionId = 'ext-a', installType = null) => ({
  version: '0.3.0',
  extensionId,
  loaded: installId ? { install_id: installId, payload } : null,
  installType,
});

/** Both probes for a set of copies that can all identify themselves: each one
 *  answers `ping` and `ext-state`. */
const probes = (managed) => ({ bridges: managed.map((m) => ({ version: m.version })), managed });

describe('classify', () => {
  it('reads nothing answering as nothing installed', () => {
    const v = classify(server(), probes([]));
    expect(v.status).toBe('absent');
    expect(v.updateAvailable).toBe(false);
    expect(v.installed).toBe(null);
    // The path is still reported: it is what the analyst has to paste to install.
    expect(v.path).toContain('.azimut/extension');
  });

  it('recognises the copy loaded from the folder it stamped', () => {
    const v = classify(server(), probes([responder('mine', 'new')]));
    expect(v.status).toBe('owned');
    expect(v.updateAvailable).toBe(false);
    expect(v.installed.extensionId).toBe('ext-a');
    expect(v.installId).toBe('mine');
  });

  it('offers the update on the digest, not the version', () => {
    // Within a development cycle the bundled version is already the app's own and
    // cannot go up, so a version comparison is blind exactly when the bytes move.
    const v = classify(server({ bundled: 'new' }), probes([responder('mine', 'old')]));
    expect(v.status).toBe('owned');
    expect(v.updateAvailable).toBe(true);
  });

  it('reads a copy with no stamp as one the app does not own', () => {
    const v = classify(server(), probes([responder(null, null, 'ext-b')]));
    expect(v.status).toBe('foreign');
    // Nothing to update: there is something to install, which is a different
    // sentence and a different button.
    expect(v.updateAvailable).toBe(false);
    expect(v.installed).toBe(null);
    expect(v.others).toHaveLength(1);
  });

  it('reads a stamp from a different folder as foreign too', () => {
    // Two Azimut installs, or a folder restored from a backup: the id is what
    // decides, never the mere presence of a stamp.
    const v = classify(server({ installId: 'mine' }), probes([responder('someone-else', 'new', 'ext-b')]));
    expect(v.status).toBe('foreign');
  });

  it('reads a packaged copy as one the browser owns, not as a stale unzip', () => {
    // Firefox's permanent install is a signed XPI: no stamp to read, and nothing
    // the app could rewrite. Called foreign, the screen would tell the analyst to
    // remove the only install their browser keeps.
    const v = classify(server(), probes([responder(null, null, 'ext-b', 'normal')]));
    expect(v.status).toBe('signed');
    expect(v.updateAvailable).toBe(false);
    expect(v.installed).toBe(null);
  });

  it('keeps the folder it owns ahead of a packaged copy loaded beside it', () => {
    const v = classify(
      server(),
      probes([responder('mine', 'new'), responder(null, null, 'ext-b', 'normal')]),
    );
    expect(v.status).toBe('duplicate');
  });

  it('names a copy that leads the app, which only Firefox can produce', () => {
    // A signed add-on is updated by the browser from the release manifest, which
    // knows nothing about the Azimut installed beside it. Every other road hands
    // the extension out of the app, so this is the one state the app cannot cause
    // and cannot refuse — only report.
    const v = classify(
      { ...server(), bundled: { version: '0.3.0', payload: 'new' } },
      probes([{ ...responder(null, null, 'ext-b', 'normal'), version: '0.4.0' }]),
    );
    expect(v.status).toBe('signed');
    expect(v.ahead).toBe(true);
  });

  it('is not ahead when the running copy matches or trails what we ship', () => {
    expect(classify(server(), probes([responder('mine', 'new')])).ahead).toBe(false);
    const trailing = classify(
      { ...server(), bundled: { version: '0.4.0', payload: 'new' } },
      probes([{ ...responder(null, null, 'ext-b', 'normal'), version: '0.3.0' }]),
    );
    expect(trailing.ahead).toBe(false);
  });

  it('leaves a copy too old to say how it was installed as foreign', () => {
    // The field arrived with the signed road. Absent means "cannot tell", and the
    // unpacked folder is what every copy before it was.
    const v = classify(server(), probes([responder(null, null, 'ext-b', null)]));
    expect(v.status).toBe('foreign');
  });

  it('spots two copies loaded at once and keeps them apart', () => {
    const v = classify(server(), probes([
      responder('mine', 'old', 'ext-a'),
      responder(null, null, 'ext-b'),
    ]));
    expect(v.status).toBe('duplicate');
    // The owned one is still what the update targets — the point of naming it.
    expect(v.installed.extensionId).toBe('ext-a');
    expect(v.updateAvailable).toBe(true);
    expect(v.others.map((o) => o.extensionId)).toEqual(['ext-b']);
  });

  it('does not claim an update when the app ships no extension', () => {
    // An unusual build with no bundled payload has nothing to offer, so it says
    // nothing rather than offering an update to null.
    const v = classify(server({ bundled: null }), probes([responder('mine', 'old')]));
    expect(v.updateAvailable).toBe(false);
  });

  it('separates the folder being current from the running copy being current', () => {
    // This is what tells "written but the browser held the old files" apart from
    // "nothing was written".
    const v = classify(server({ folderPayload: 'new', bundled: 'new', staged: true }), probes([
      responder('mine', 'old'),
    ]));
    expect(v.folderCurrent).toBe(true);
    expect(v.updateAvailable).toBe(true);
    expect(v.staged).toBe(true);
  });

  // The regression that shipped: an extension installed before the update button
  // existed runs the old bridge, which has no `ext-state` route. It answers
  // `ping` and nothing else. Judged on `ext-state` alone it read as "not
  // detected" — on a browser visibly running it.
  it('recognises a copy too old to identify itself', () => {
    const v = classify(server({ installId: null }), {
      bridges: [{ version: '0.2.0' }],
      managed: [],
    });
    expect(v.status).toBe('foreign');
    expect(v.detectedVersion).toBe('0.2.0');
    // It cannot be named, only counted: an old bridge has no way to report an id.
    expect(v.unnamed).toBe(1);
    expect(v.others).toHaveLength(0);
    expect(v.updateAvailable).toBe(false);
  });

  it('still spots a duplicate when the second copy cannot name itself', () => {
    // Loading the app folder without removing the old install: ours answers both
    // probes, theirs only the first. The count is what catches it.
    const v = classify(server(), {
      bridges: [{ version: '0.3.0' }, { version: '0.2.0' }],
      managed: [responder('mine', 'new', 'ext-a')],
    });
    expect(v.status).toBe('duplicate');
    expect(v.installed.extensionId).toBe('ext-a');
    expect(v.unnamed).toBe(1);
  });

  it('survives a server read that failed and a probe that never ran', () => {
    expect(classify(null, {}).status).toBe('absent');
    expect(classify(null, {}).path).toBe('');
  });
});

describe('reloadLanded', () => {
  it('is true once the running copy reports the payload the app ships', () => {
    expect(reloadLanded(server({ bundled: 'new' }), probes([responder('mine', 'new')]))).toBe(true);
  });

  it('is false while the old context is still the one answering', () => {
    // The restart is asynchronous and re-injects the bridge when it lands, so the
    // first probe after a reload can still reach the context going away.
    expect(reloadLanded(server({ bundled: 'new' }), probes([responder('mine', 'old')]))).toBe(false);
  });

  it('is false when nothing answers, which is the reload not being back yet', () => {
    expect(reloadLanded(server(), probes([]))).toBe(false);
  });

  it('is false for a foreign copy, which no reload of ours could have changed', () => {
    expect(reloadLanded(server(), probes([responder(null, null, 'ext-b')]))).toBe(false);
  });
});
