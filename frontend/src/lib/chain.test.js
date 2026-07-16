import { describe, it, expect } from 'vitest';
import {
  chainOf,
  deletePlan,
  dependentsOf,
  lostSourcesOf,
  sourcesOf,
  walkDown,
  walkUp,
} from './chain.js';

const ent = (id, type, attrs = {}) => ({ id, type, label: id, attrs });
const link = (from, to, type = 'derived-from') => ({ id: `l_${from}${to}`, from, to, type });

// The v1 workflow, filed: a download, a frame cut from it, a proof composed
// from that frame, the post announcing the proof, and a session over the video.
const entities = [
  ent('video', 'media', { path: 'media/v.mp4', sha256: 'abc', source_url: 'https://x/1' }),
  ent('frame', 'media', { path: 'media/f.png' }),
  ent('proof', 'proof', { spec: 'proofs/p.json', path: 'proofs/p.png' }),
  ent('post', 'post', { draft: 'exports/d.json' }),
  ent('session', 'inspect-session', { spec: 'inspect/s.json' }),
];
const links = [
  link('frame', 'video'),
  link('proof', 'frame'),
  link('post', 'proof'),
  link('session', 'video', 'depends-on'),
];

describe('sourcesOf / dependentsOf', () => {
  it('reads the two directions of an edge', () => {
    expect(sourcesOf(entities, links, 'frame').map((r) => r.entity.id)).toEqual(['video']);
    expect(dependentsOf(entities, links, 'video').map((r) => r.entity.id)).toEqual([
      'frame',
      'session',
    ]);
  });

  it('reports the link type so the UI can tell a derivation from a dependency', () => {
    expect(dependentsOf(entities, links, 'video').map((r) => r.type)).toEqual([
      'derived-from',
      'depends-on',
    ]);
  });

  it('ignores links to entities that are not in the case', () => {
    const dangling = [...links, link('proof', 'ghost')];
    expect(sourcesOf(entities, dangling, 'proof').map((r) => r.entity.id)).toEqual(['frame']);
  });

  it('ignores link types that are not part of the chain', () => {
    const withOther = [...links, link('proof', 'video', 'mentions')];
    expect(sourcesOf(entities, withOther, 'proof').map((r) => r.entity.id)).toEqual(['frame']);
  });
});

describe('walkUp', () => {
  it('climbs to the original, closest source first, with depth', () => {
    expect(walkUp(entities, links, 'post')).toEqual([
      { entity: entities[2], type: 'derived-from', depth: 1 },
      { entity: entities[1], type: 'derived-from', depth: 2 },
      { entity: entities[0], type: 'derived-from', depth: 3 },
    ]);
  });

  it('terminates on a cycle instead of hanging the sidebar', () => {
    const cyclic = [link('a', 'b'), link('b', 'a')];
    const pair = [ent('a', 'media'), ent('b', 'media')];
    expect(walkUp(pair, cyclic, 'a').map((r) => r.entity.id)).toEqual(['b']);
  });

  it('honours maxDepth', () => {
    expect(walkUp(entities, links, 'post', { maxDepth: 1 }).map((r) => r.entity.id)).toEqual([
      'proof',
    ]);
  });
});

describe('walkDown', () => {
  it('finds everything built on a source, however indirectly', () => {
    expect(walkDown(entities, links, 'video').map((r) => r.entity.id)).toEqual([
      'frame',
      'session',
      'proof',
      'post',
    ]);
  });
});

describe('lostSourcesOf', () => {
  it('reads the tombstones, missing → empty', () => {
    const scarred = ent('x', 'proof', { lost_sources: [{ path: 'media/gone.mp4', sha256: 'd' }] });
    expect(lostSourcesOf(scarred)).toHaveLength(1);
    expect(lostSourcesOf(ent('y', 'proof'))).toEqual([]);
    expect(lostSourcesOf(null)).toEqual([]);
  });
});

describe('chainOf', () => {
  it('gathers both directions plus tombstones for one entity', () => {
    const chain = chainOf(entities, links, 'proof');
    expect(chain.sources.map((r) => r.entity.id)).toEqual(['frame']);
    expect(chain.dependents.map((r) => r.entity.id)).toEqual(['post']);
    expect(chain.empty).toBe(false);
  });

  it('flags an entity with no chain at all so the panel can hide the section', () => {
    const lonely = [...entities, ent('place', 'place')];
    expect(chainOf(lonely, links, 'place').empty).toBe(true);
  });

  it('is not empty when the only trace left is a tombstone', () => {
    const scarred = [ent('p', 'proof', { lost_sources: [{ path: 'media/gone.mp4' }] })];
    expect(chainOf(scarred, [], 'p').empty).toBe(false);
  });
});

describe('deletePlan', () => {
  it('takes the session down with its subject and leaves the outputs standing', () => {
    const plan = deletePlan(entities, links, 'video');
    expect(plan.cascade.map((e) => e.id)).toEqual(['session']);
    expect(plan.tombstone.map((e) => e.id)).toEqual(['frame']);
  });

  it('never cascades through derived-from: deleting a proof spares its post', () => {
    const plan = deletePlan(entities, links, 'proof');
    expect(plan.cascade).toEqual([]);
    expect(plan.tombstone.map((e) => e.id)).toEqual(['post']);
  });

  it('cascades depends-on transitively', () => {
    const chained = [...entities, ent('sub', 'inspect-session', { spec: 'inspect/2.json' })];
    const deep = [...links, link('sub', 'session', 'depends-on')];
    expect(deletePlan(chained, deep, 'video').cascade.map((e) => e.id)).toEqual(['session', 'sub']);
  });

  it('spares a session whose own subject survives the delete', () => {
    // a session opened over the frame, not the video: deleting the video scars
    // the frame but leaves it in place, so the session over it still stands.
    const more = [...entities, ent('session2', 'inspect-session', { spec: 'inspect/2.json' })];
    const deep = [...links, link('session2', 'frame', 'depends-on')];
    const plan = deletePlan(more, deep, 'video');
    expect(plan.cascade.map((e) => e.id)).toEqual(['session']);
    expect(plan.tombstone.map((e) => e.id)).toEqual(['frame']);
  });

  it('does not tombstone an entity that is itself being deleted', () => {
    // a producer that files both edges onto the same target: the depends-on
    // dooms the session, so its derived-from must not also list it as a
    // survivor to scar — a doomed entity is never tombstoned.
    const deep = [...links, link('session', 'video')];
    const plan = deletePlan(entities, deep, 'video');
    expect(plan.cascade.map((e) => e.id)).toEqual(['session']);
    expect(plan.tombstone.map((e) => e.id)).toEqual(['frame']);
  });

  it('reports nothing for an entity nothing hangs off', () => {
    expect(deletePlan(entities, links, 'post')).toEqual({ cascade: [], tombstone: [] });
  });
});
