import { parseSnapshot, groupByFamily, ModelEntry } from './grouping';

// Fixed reference time so reset-window classification is deterministic.
const NOW = new Date('2026-06-24T10:00:00.000Z').getTime();
const IN_2H = '2026-06-24T12:00:00.000Z'; // within the five-hour window
const IN_5H = '2026-06-24T15:00:00.000Z'; // still the five-hour window
const IN_3DAYS = '2026-06-27T10:00:00.000Z'; // weekly window

function model(label: string, modelId: string, frac: number, reset = IN_2H): ModelEntry {
  return { label, modelId, remainingFraction: frac, resetTime: new Date(reset) };
}

function member(result: ReturnType<typeof parseSnapshot>, groupKey: string) {
  return result.groups.find((g) => g.key === groupKey)?.members[0];
}

describe('parseSnapshot', () => {
  it('returns empty result when models missing', () => {
    expect(parseSnapshot({}, NOW)).toEqual({ groups: [], totalModelCount: 0 });
  });

  it('drops disabled / quota-less models', () => {
    const r = parseSnapshot(
      {
        models: {
          a: { displayName: 'Claude Sonnet', model: 'A', quotaInfo: { remainingFraction: 0.5, resetTime: IN_2H } },
          b: { displayName: 'Claude Opus', model: 'B', disabled: true, quotaInfo: { remainingFraction: 0.1, resetTime: IN_2H } },
          c: { displayName: 'No Quota Model', model: 'C' }
        }
      },
      NOW
    );

    expect(r.totalModelCount).toBe(1);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map((m) => m.modelId)).toEqual(['claude-gpt-limit']);
    expect(member(r, 'claude-gpt')?.remainingFraction).toBe(0.5);
  });

  it('produces one limit per family, labeled by its actual reset window', () => {
    const r = parseSnapshot(
      {
        models: {
          a: { displayName: 'Gemini 3.1 Pro (Low)', model: 'A', quotaInfo: { remainingFraction: 0.84, resetTime: IN_2H } },
          b: { displayName: 'Gemini 3.5 Flash', model: 'B', quotaInfo: { remainingFraction: 0.84, resetTime: IN_2H } },
          c: { displayName: 'Claude Sonnet 4.6', model: 'C', quotaInfo: { remainingFraction: 0.97, resetTime: IN_3DAYS } },
          d: { displayName: 'GPT-OSS 120B', model: 'D', quotaInfo: { remainingFraction: 0.97, resetTime: IN_3DAYS } }
        }
      },
      NOW
    );

    expect(r.groups.map((g) => g.key).sort()).toEqual(['claude-gpt', 'gemini']);

    const gemini = member(r, 'gemini');
    expect(gemini?.label).toBe('Five Hour Limit');
    expect(gemini?.remainingFraction).toBe(0.84);

    const claudeGpt = member(r, 'claude-gpt');
    expect(claudeGpt?.label).toBe('Weekly Limit');
    expect(claudeGpt?.remainingFraction).toBe(0.97);
  });

  it('does not duplicate the same value into two rows', () => {
    // The real bug: a single reported quota window must not appear as both weekly and five-hour.
    const r = parseSnapshot(
      {
        models: {
          a: { displayName: 'Gemini 3.1 Pro (Low)', model: 'A', quotaInfo: { remainingFraction: 0.8408795, resetTime: IN_2H } }
        }
      },
      NOW
    );

    expect(r.groups[0].members).toHaveLength(1);
    expect(member(r, 'gemini')?.remainingFraction).toBe(0.8408795);
  });

  it('labels a five-hour window when the reset is at most six hours out', () => {
    const r = parseSnapshot(
      { models: { a: { displayName: 'Gemini Pro', model: 'A', quotaInfo: { remainingFraction: 1, resetTime: IN_5H } } } },
      NOW
    );
    expect(member(r, 'gemini')?.label).toBe('Five Hour Limit');
  });

  it('labels a weekly window when the reset is days out', () => {
    const r = parseSnapshot(
      { models: { a: { displayName: 'Claude Sonnet', model: 'A', quotaInfo: { remainingFraction: 0.97, resetTime: IN_3DAYS } } } },
      NOW
    );
    expect(member(r, 'claude-gpt')?.label).toBe('Weekly Limit');
  });

  it('falls back to a neutral label when no reset time is available', () => {
    const r = parseSnapshot(
      { models: { a: { displayName: 'Gemini Pro', model: 'A', quotaInfo: { remainingFraction: 0.5 } } } },
      NOW
    );
    expect(member(r, 'gemini')?.label).toBe('Quota');
    expect(member(r, 'gemini')?.resetTime).toBeNull();
  });

  it('uses the lowest remaining fraction (and its window) inside each family', () => {
    const r = parseSnapshot(
      {
        models: {
          a: { displayName: 'Gemini 3 Flash', model: 'A', quotaInfo: { remainingFraction: 0.84, resetTime: IN_2H } },
          b: { displayName: 'Gemini 3 Flash Preview', model: 'B', quotaInfo: { remainingFraction: 1.0, resetTime: IN_2H } },
          c: { displayName: 'Gemini 3.1 Pro Low', model: 'C', quotaInfo: { remainingFraction: 0.95, resetTime: IN_2H } }
        }
      },
      NOW
    );

    const gemini = member(r, 'gemini');
    expect(gemini?.remainingFraction).toBe(0.84);
    expect(gemini?.label).toBe('Five Hour Limit');
    expect(gemini?.resetTime).toEqual(new Date(IN_2H));
  });

  it('groups unknown/other families under Claude/GPT models', () => {
    const r = parseSnapshot(
      { models: { a: { displayName: 'chat_20706', model: 'A', quotaInfo: { remainingFraction: 0.5, resetTime: IN_2H } } } },
      NOW
    );

    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].key).toBe('claude-gpt');
  });
});

describe('groupByFamily ordering', () => {
  it('sorts lowest-remaining family first', () => {
    const groups = groupByFamily(
      [model('Gemini Pro Low', 'gemini-pro-low', 0.8), model('Claude Sonnet', 'claude-sonnet', 0.2)],
      NOW
    );

    expect(groups.map((g) => g.key)).toEqual(['claude-gpt', 'gemini']);
  });

  it('groups all non-gemini together', () => {
    const groups = groupByFamily(
      [model('chat_1', 'x_1', 1.0), model('Claude', 'claude', 1.0), model('Gemini', 'gemini', 1.0)],
      NOW
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(['claude-gpt', 'gemini']);
  });

  it('emits exactly one member per family', () => {
    const groups = groupByFamily(
      [model('Gemini Pro', 'gemini-pro', 0.5), model('Claude', 'claude', 0.6)],
      NOW
    );

    for (const g of groups) {
      expect(g.members).toHaveLength(1);
    }
  });
});
