/**
 * The view the proof picker has in hand: how its models are previewed, and how the
 * next model stamped is drawn. It stays for the session, since an angled photograph
 * takes six angled vehicles.
 */
import { MODEL_VIEWS } from './modelMeta.js';

let current = $state(MODEL_VIEWS[0].id);

export const stampViewId = () => current;

export function setStampView(id) {
  if (MODEL_VIEWS.some((v) => v.id === id)) current = id;
}

export const stampView = () => MODEL_VIEWS.find((v) => v.id === current) ?? MODEL_VIEWS[0];
