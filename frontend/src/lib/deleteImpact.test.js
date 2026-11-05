import { describe, expect, it, vi } from 'vitest';
import {
  fetchImpact,
  impactBlocked,
  impactBody,
  impactGroups,
  impactHow,
  impactKey,
  impactLead,
  impactTotal,
  impactUnknown,
  targetCount,
  touchesNothing,
} from './deleteImpact.js';

const ANSWER = {
  cascade: [{ id: 'w1', type: 'inspect-session', label: 'Clip work' }],
  tombstone: [{ id: 'p1', type: 'proof', label: 'Bridge strike' }],
  touched: [{ id: 'pl1', type: 'map-plate', label: 'Day 3', how: ['shows it', 'plays it'] }],
  counts: { cascade: 1, tombstone: 1, touched: 4 },
};

describe('the request', () => {
  it('sends only what was named, once each, and no tool the server does not know', () => {
    expect(
      impactBody({
        ids: ['e1', 'e1', ''],
        paths: ['media/a.png'],
        named: [{ tool: 'plate', name: 'Situation' }, { tool: 'nope', name: 'x' }, { tool: 'draft', name: '' }],
      })
    ).toEqual({ ids: ['e1'], paths: ['media/a.png'], named: [{ tool: 'plate', name: 'Situation' }] });
  });

  it('keys a target on what it names, so the same target is asked once', () => {
    const one = impactKey({ caseId: 'c1', ids: ['e1'] });
    expect(impactKey({ caseId: 'c1', ids: ['e1'], paths: [] })).toBe(one);
    expect(impactKey({ caseId: 'c1', ids: ['e2'] })).not.toBe(one);
    // nothing to ask about, or no case to ask: no question at all
    expect(impactKey({ caseId: 'c1', ids: [] })).toBe('');
    expect(impactKey({ ids: ['e1'] })).toBe('');
    expect(impactKey(null)).toBe('');
  });

  it('counts the targets, so the words say it or them', () => {
    expect(targetCount({ ids: ['e1'] })).toBe(1);
    expect(targetCount({ ids: ['e1'], paths: ['media/a.png'] })).toBe(2);
  });
});

describe('the answer', () => {
  it('counts every record the delete reaches, past the rows listed', () => {
    expect(impactTotal(ANSWER)).toBe(6);
    expect(impactLead(ANSWER)).toBe('Linked to 6 other items in the case.');
  });

  it('says plainly when nothing else uses the target', () => {
    const none = { cascade: [], tombstone: [], touched: [], counts: { cascade: 0, tombstone: 0, touched: 0 } };
    expect(impactLead(none)).toBe('Nothing else in the case uses it.');
    expect(impactLead(none, 'them')).toBe('Nothing else in the case uses them.');
    expect(impactGroups(none)).toEqual([]);
  });

  it('lists what goes, what is scarred and what loses a link, with what is left unlisted', () => {
    const groups = impactGroups(ANSWER);
    expect(groups.map((group) => group.key)).toEqual(['cascade', 'tombstone', 'touched']);
    expect(groups[0].heading).toBe('Deleted with it because they cannot stand alone');
    expect(groups[2].heading).toBe('Kept, losing their link to it');
    expect(groups[2].more).toBe(3);
    expect(impactGroups(ANSWER, 'them')[1].heading).toBe('Kept with a record of their missing source');
  });

  it('says how a touched record uses the target', () => {
    expect(impactHow(ANSWER.touched[0])).toBe('shows it, plays it');
    expect(impactHow({})).toBe('');
  });
});

describe('a delete the server would refuse', () => {
  const HELD = {
    blocking: [{ id: 'r1', type: 'analysis-follow-up', label: 'Weekly', how: ['watches it'] }],
    cascade: [], tombstone: [], touched: [],
    counts: { blocking: 1, cascade: 0, tombstone: 0, touched: 0 },
  };

  it('lists what holds it first, as a warning, and counts it', () => {
    const [first] = impactGroups(HELD);
    expect(first.key).toBe('blocking');
    expect(first.tone).toBe('danger');
    expect(first.heading).toBe('Take it out of these first');
    expect(impactTotal(HELD)).toBe(1);
  });

  it('says the delete is blocked, and only then', () => {
    expect(impactBlocked(HELD)).toBe(true);
    expect(impactBlocked(ANSWER)).toBe(false);
    expect(impactBlocked(null)).toBe(false);
  });
});

describe('a check that does not come back', () => {
  it('gives up after its wait, so the dialog can say so', async () => {
    vi.useFakeTimers();
    try {
      const asked = fetchImpact({ caseId: 'c1', ids: ['e1'] }, { post: () => new Promise(() => {}), wait: 50 });
      const settled = asked.then(() => 'answered', (error) => error.message);
      await vi.advanceTimersByTimeAsync(60);
      expect(await settled).toBe('the check did not come back');
    } finally {
      vi.useRealTimers();
    }
    expect(impactUnknown()).toBe('Could not check what else it touches.');
  });
});

describe('a delete that never asked', () => {
  const target = { caseId: 'c1', named: [{ tool: 'plate', name: 'Situation' }] };

  it('goes ahead without a dialog when nothing leans on it', async () => {
    const post = vi.fn(async () => ({ counts: { cascade: 0, tombstone: 0, touched: 0 } }));
    expect(await touchesNothing(target, { post })).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/cases/c1/delete-impact', {
      ids: [], paths: [], named: [{ tool: 'plate', name: 'Situation' }],
    });
  });

  it('asks when something does, or when the question went unanswered', async () => {
    expect(await touchesNothing(target, { post: async () => ANSWER })).toBe(false);
    expect(
      await touchesNothing(target, {
        post: async () => {
          throw new Error('offline');
        },
      })
    ).toBe(false);
  });
});
