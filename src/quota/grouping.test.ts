import { parseSnapshot, groupByFamily, ModelEntry } from './grouping';

const RESET_A = '2026-06-01T00:00:00.000Z';

function model(label: string, modelId: string, frac: number, reset = RESET_A): ModelEntry {
  return { label, modelId, remainingFraction: frac, resetTime: new Date(reset) };
}

describe('parseSnapshot', () => {
  it('returns empty result when models missing', () => {
    expect(parseSnapshot({})).toEqual({ groups: [], totalModelCount: 0 });
  });

  it('drops disabled / quota-less models', () => {
    const r = parseSnapshot({
      models: {
        a: { displayName: 'Claude Sonnet', model: 'A', quotaInfo: { remainingFraction: 0.5, resetTime: RESET_A } },
        b: { displayName: 'Claude Opus', model: 'B', disabled: true, quotaInfo: { remainingFraction: 0.5, resetTime: RESET_A } },
        c: { displayName: 'No Quota Model', model: 'C' }
      }
    });
    expect(r.totalModelCount).toBe(1);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.find(m => m.modelId === 'claude-gpt-weekly')?.remainingFraction).toBe(0.5);
  });

  it('separates Claude/GPT and Gemini into different family groups', () => {
    const r = parseSnapshot({
      models: {
        a: { displayName: 'Claude Sonnet 4.6', model: 'A', quotaInfo: { remainingFraction: 0.6, resetTime: RESET_A } },
        b: { displayName: 'Gemini 3.5 Flash', model: 'B', quotaInfo: { remainingFraction: 0.9, resetTime: RESET_A } }
      }
    });
    expect(r.groups).toHaveLength(2);
    const keys = r.groups.map((g) => g.key);
    expect(keys.sort()).toEqual(['claude-gpt', 'gemini']);
  });

  it('uses lowest member fraction as group min', () => {
    const r = parseSnapshot({
      models: {
        a: { displayName: 'Gemini 3.5 Flash (Medium)', model: 'A', quotaInfo: { remainingFraction: 0.4, resetTime: RESET_A } },
        b: { displayName: 'Gemini 3.1 Pro (Low)', model: 'B', quotaInfo: { remainingFraction: 0.9, resetTime: RESET_A } }
      }
    });
    expect(r.groups[0].minRemainingFraction).toBeCloseTo(0.4);
    // Weekly (Medium) is 0.4, 5-hour is 1.0 (since no 5-hour model was present in input)
    expect(r.groups[0].members.find(m => m.modelId === 'gemini-weekly')?.remainingFraction).toBe(0.4);
    expect(r.groups[0].members.find(m => m.modelId === 'gemini-5hour')?.remainingFraction).toBe(1.0);
  });

  it('groups unknown/other families under Claude/GPT models', () => {
    const r = parseSnapshot({
      models: {
        a: { displayName: 'chat_20706', model: 'A', quotaInfo: { remainingFraction: 0.5, resetTime: RESET_A } }
      }
    });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].key).toBe('claude-gpt');
  });
});

describe('groupByFamily ordering', () => {
  it('sorts lowest-remaining family first', () => {
    const groups = groupByFamily([
      model('Gemini Pro', 'gemini-pro', 0.8),
      model('Claude Sonnet', 'claude-sonnet', 0.2)
    ]);
    expect(groups.map((g) => g.key)).toEqual(['claude-gpt', 'gemini']);
  });

  it('groups all non-gemini together', () => {
    const groups = groupByFamily([
      model('chat_1', 'x_1', 1.0),
      model('Claude', 'claude', 1.0),
      model('Gemini', 'gemini', 1.0)
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.key).sort()).toEqual(['claude-gpt', 'gemini']);
  });
});
