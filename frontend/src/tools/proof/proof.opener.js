/**
 * A proof in a note opens in Geo Proof, as the case sidebar opens it.
 * Loaded with the note (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { registerOpener } from '../../lib/notes/openers.js';
import { openEntity } from '../../lib/navigate.js';

export const proofOpener = {
  accepts: (entity) => entity?.type === 'proof' && typeof entity.attrs?.spec === 'string' && Boolean(entity.attrs.spec),
  open: (entity) => openEntity(entity),
};

registerOpener('proof', proofOpener);
