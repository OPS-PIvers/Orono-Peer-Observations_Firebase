import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  aiUsageDayKey,
  type AiProvider,
  type AiUsageDaily,
  type AiUsageEvent,
  type AiUsageTotals,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';

/** Days of daily totals the page keeps live (covers "this month" and the 30-day chart). */
export const USAGE_WINDOW_DAYS = 31;
const RECENT_CALLS = 25;

export type UsageRange = 'today' | '7d' | 'month' | '30d';

export const USAGE_RANGES: { value: UsageRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
];

/** YYYY-MM-DD keys from `days - 1` days ago through today, oldest first. */
export function dayKeysBack(days: number, now = new Date()): [string, ...string[]] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(aiUsageDayKey(new Date(now.getTime() - i * 86_400_000)));
  }
  const [first = aiUsageDayKey(now), ...rest] = [...new Set(keys)];
  return [first, ...rest];
}

export function rangeStartKey(range: UsageRange, now = new Date()): string {
  const today = aiUsageDayKey(now);
  switch (range) {
    case 'today':
      return today;
    case 'month':
      return `${today.slice(0, 8)}01`;
    case '7d':
      return dayKeysBack(7, now)[0];
    case '30d':
      return dayKeysBack(30, now)[0];
  }
}

/** Live daily totals for the last {@link USAGE_WINDOW_DAYS} days, plus the newest calls. */
export function useAiUsage() {
  const fromKey = dayKeysBack(USAGE_WINDOW_DAYS)[0];
  const daily = useFirestoreCollection<AiUsageDaily>(
    COLLECTIONS.aiUsageDaily,
    [where('date', '>=', fromKey), orderBy('date', 'asc')],
    [fromKey],
  );
  const events = useFirestoreCollection<AiUsageEvent>(COLLECTIONS.aiUsageEvents, [
    orderBy('createdAt', 'desc'),
    limit(RECENT_CALLS),
  ]);
  return { daily, events };
}

/** One model's totals on one day, if it ran that day. */
export function dayModel(
  day: AiUsageDaily | undefined,
  modelId: string,
): AiUsageTotals | undefined {
  if (!day || !Object.hasOwn(day.byModel, modelId)) return undefined;
  return day.byModel[modelId];
}

export interface ModelUsageRow extends AiUsageTotals {
  modelId: string;
  provider: AiProvider;
}

const ZERO: AiUsageTotals = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

function add(a: AiUsageTotals, b: Partial<AiUsageTotals> | undefined): AiUsageTotals {
  return {
    calls: a.calls + (b?.calls ?? 0),
    errors: a.errors + (b?.errors ?? 0),
    inputTokens: a.inputTokens + (b?.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b?.outputTokens ?? 0),
    costUsd: a.costUsd + (b?.costUsd ?? 0),
  };
}

/** Totals, per-model and per-feature sums over the days on or after `fromKey`. */
export function useUsageSummary(days: readonly AiUsageDaily[] | null, fromKey: string) {
  return useMemo(() => {
    let totals = ZERO;
    const byModel = new Map<string, ModelUsageRow>();
    const byFeature = new Map<string, AiUsageTotals>();
    for (const day of days ?? []) {
      if (day.date < fromKey) continue;
      totals = add(totals, day.totals);
      for (const [modelId, t] of Object.entries(day.byModel)) {
        const prev = byModel.get(modelId) ?? { ...ZERO, modelId, provider: t.provider };
        byModel.set(modelId, { ...add(prev, t), modelId, provider: t.provider });
      }
      for (const [feature, t] of Object.entries(day.byFeature)) {
        byFeature.set(feature, add(byFeature.get(feature) ?? ZERO, t));
      }
    }
    const models = [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd);
    return { totals, models, byFeature };
  }, [days, fromKey]);
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Dollars, with enough decimals that a fraction of a cent still reads as spend. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return value.toLocaleString('en-US');
}

export function formatPrice(perMTok: number): string {
  return `$${perMTok.toFixed(2)}`;
}

/** Categorical series colors, in fixed order (validated for CVD separation). */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;
/** Anything past the fifth model folds into this. */
export const OTHER_COLOR = '#9a9a96';
