/**
 * Which capture extension this browser is running, and whether the app can
 * update it.
 *
 * The app owns a folder (`engine/extinstall.py`) and stamps an install id and a
 * payload digest into it. An extension loaded from that folder reports the stamp
 * it was loaded from, so three questions get separate answers: is anything
 * installed, is it the copy the app controls, and is it behind what the app
 * ships.
 *
 * A fourth answer sits beside them on Firefox, which refuses an unsigned
 * extension: the permanent install there is a signed XPI the browser manages and
 * updates itself, so the app can report it and must not offer to rewrite it.
 *
 * Two probes, and the split matters. `ping` has been answered by every version
 * of the extension ever shipped, so it is what counts live copies. `ext-state`
 * is newer, so only a copy that carries the update code answers it — an install
 * that predates this feature is loaded, visible, and silent there. Judging
 * "installed" by `ext-state` alone would report the extension the analyst is
 * plainly using as absent, which is the one thing this screen must never say.
 *
 * Pure on purpose — the probing and the writing live in Settings, and the rules
 * are the part worth testing on their own.
 *
 * The digest, not the version, decides "behind". The bundled version deliberately
 * stays put when a release leaves the extension alone, and within a development
 * cycle it is already the app's own version and cannot move at all — so a version
 * comparison is blind exactly when the bytes are changing. (The rail's dot still
 * compares versions, in `staleness.js`: across releases the two agree, and it
 * has no bridge to ask.)
 */

import { extensionOutdated } from './extBridge.js';

/**
 * @param {{path?: string, staged?: boolean, bundled?: {version?: string|null, payload?: string|null}, folder?: {install_id?: string, version?: string|null, payload?: string|null}|null}|null} server
 *   What `GET /api/settings/extension` reported.
 * @param {{bridges?: Array<{version: string|null}>|null, managed?: Array<{version: string|null, extensionId: string|null, loaded: object|null}>|null}} probes
 *   `bridges` = every copy that answered `ping`. `managed` = those that also
 *   answered `ext-state`.
 */
export function classify(server, { bridges, managed } = {}) {
  const folder = server?.folder ?? null;
  const bundledPayload = server?.bundled?.payload ?? null;
  const live = bridges ?? [];
  const answered = managed ?? [];
  // The app's folder is identified by the id it minted, so a copy loaded from
  // anywhere else cannot claim to be it.
  const owned = folder?.install_id
    ? answered.find((r) => r.loaded?.install_id === folder.install_id) ?? null
    : null;
  // Copies that named themselves and are not ours — we can say which id to
  // remove. Anything else loaded is counted but cannot be named: a copy too old
  // to answer `ext-state` has no way to report its id.
  const others = answered.filter((r) => r !== owned);
  const unnamed = Math.max(0, live.length - answered.length);
  // A copy the browser installed as a package rather than read out of a folder.
  // On Firefox that is the signed XPI, which is the only permanent install it
  // allows and which nothing here can rewrite — so it must not be mistaken for a
  // stale unzip and answered with "remove it and load the folder instead".
  const sealed = !owned && answered.some((r) => r.installType === 'normal');
  const bundledVersion = server?.bundled?.version ?? null;
  const detectedVersion = owned?.version ?? others[0]?.version ?? live[0]?.version ?? null;
  return {
    // absent: nothing is loaded. signed: a packaged copy, updated by the browser
    // from the app's own update manifest. foreign: something is loaded from a
    // folder that isn't ours — an old manual unzip, a dev checkout, or a copy
    // predating this feature. duplicate: ours is loaded and so is something
    // else, which is Chrome deriving the extension id from the folder path.
    status: !live.length
      ? 'absent'
      : owned
        ? others.length || unnamed
          ? 'duplicate'
          : 'owned'
        : sealed
          ? 'signed'
          : 'foreign',
    path: server?.path ?? '',
    staged: Boolean(server?.staged),
    bundledVersion,
    installed: owned,
    others,
    // How many loaded copies could not identify themselves. Non-zero means the
    // analyst has an extension the app cannot manage or name, so the copy has to
    // describe it rather than point at an id.
    unnamed,
    // The version to show when we have no stamp to read one from.
    detectedVersion,
    // The running copy leads what this build ships. Only Firefox can produce it:
    // it updates a signed add-on from the release manifest without knowing which
    // Azimut is installed, where every other road hands the extension out of the
    // app and so can never get ahead of it. Nothing here can refuse that update —
    // the browser owns it — so the app names it instead, and the analyst is told
    // to move the app rather than left with features reporting they could not run.
    ahead: extensionOutdated(bundledVersion, detectedVersion),
    // Installed from our folder, but from an older payload than the app ships.
    // Unknown (false) when nothing owned answered: there is nothing to update
    // yet, only something to install.
    updateAvailable: Boolean(owned && bundledPayload && owned.loaded?.payload !== bundledPayload),
    // The folder itself is current — so an update that reports `staged` is
    // distinguishable from one that never wrote anything.
    folderCurrent: Boolean(folder && bundledPayload && folder.payload === bundledPayload),
    installId: folder?.install_id ?? null,
  };
}

/**
 * Did the reload land? Compares the stamp the freshly probed copy was loaded
 * from against what the app ships.
 *
 * Separate from `classify` because it answers a narrower question at a specific
 * moment, and because the honest answer is often "no" for a boring reason: the
 * extension restarts asynchronously, so the first probe after a reload can still
 * be the old context. The caller retries.
 */
export function reloadLanded(server, probes) {
  const verdict = classify(server, probes);
  return Boolean(verdict.installed) && !verdict.updateAvailable;
}
