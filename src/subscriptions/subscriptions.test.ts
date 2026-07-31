import { parseClaudeUsage } from './claudeCode';
import { parseCodexRateLimits } from './codex';

describe('Claude Code usage parsing', () => {
  it('maps five-hour and weekly utilization to remaining quota', () => {
    const limits = parseClaudeUsage({
      five_hour: { utilization: 18.5, resets_at: '2026-08-01T05:00:00Z' },
      seven_day: { utilization: 42, resets_at: '2026-08-07T00:00:00Z' }
    });

    expect(limits).toHaveLength(2);
    expect(limits[0]).toMatchObject({
      id: 'five-hour',
      label: 'Five Hour Limit',
      resetTime: new Date('2026-08-01T05:00:00Z'),
      windowMinutes: 300
    });
    expect(limits[0].remainingFraction).toBeCloseTo(0.815);
    expect(limits[1]).toMatchObject({
      id: 'weekly',
      label: 'Weekly Limit',
      resetTime: new Date('2026-08-07T00:00:00Z'),
      windowMinutes: 10080
    });
    expect(limits[1].remainingFraction).toBeCloseTo(0.58);
  });

  it('uses model-specific weekly limits only when the general weekly limit is absent', () => {
    const limits = parseClaudeUsage({
      seven_day_sonnet: { utilization: 12, resets_at: '2026-08-07T00:00:00Z' }
    });
    expect(limits.map((limit) => limit.label)).toEqual(['Weekly Sonnet Limit']);
  });
});

describe('Codex usage parsing', () => {
  it('selects the weekly window and ignores the five-hour window', () => {
    const parsed = parseCodexRateLimits({
      rateLimits: {
        limitId: 'codex',
        planType: 'plus',
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1785550800 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1786118400 }
      }
    });

    expect(parsed.planType).toBe('plus');
    expect(parsed.limits).toEqual([{
      id: 'weekly',
      label: 'Weekly Limit',
      remainingFraction: 0.6,
      resetTime: new Date(1786118400 * 1000),
      windowMinutes: 10080
    }]);
  });

  it('does not mislabel a five-hour-only bucket as weekly', () => {
    const parsed = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1785550800 }
      }
    });
    expect(parsed.limits).toEqual([]);
  });
});
