import { useEffect, useMemo, useState } from 'react';
import {
  AI_PROVIDER_LABELS,
  aiUsageDayKey,
  toDate,
  type AiFeatureKey,
  type AiModel,
  type AiUsageDaily,
  type AiUsageEvent,
} from '@ops/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  OTHER_COLOR,
  SERIES_COLORS,
  USAGE_RANGES,
  dayKeysBack,
  dayModel,
  formatTokens,
  formatUsd,
  rangeStartKey,
  useUsageSummary,
  type UsageRange,
} from './aiUsage';
import { AI_FEATURE_TITLES } from './aiFeatures';

interface SpendingPanelProps {
  models: readonly AiModel[];
  daily: (AiUsageDaily & { id: string })[] | null;
  events: (AiUsageEvent & { id: string })[] | null;
  loading: boolean;
  error: Error | null;
}

/** Stable color per model id: registry order first, then anything only seen in usage. */
function useModelColors(models: readonly AiModel[], seenIds: readonly string[]) {
  return useMemo(() => {
    const order = [
      ...models.map((m) => m.id),
      ...seenIds.filter((id) => !models.some((m) => m.id === id)),
    ];
    const map = new Map<string, string>();
    order.forEach((id, i) => map.set(id, SERIES_COLORS[i] ?? OTHER_COLOR));
    return map;
  }, [models, seenIds]);
}

export function SpendingPanel({ models, daily, events, loading, error }: SpendingPanelProps) {
  const [range, setRange] = useState<UsageRange>('month');
  const fromKey = rangeStartKey(range);
  const todayKey = aiUsageDayKey(new Date());
  const summary = useUsageSummary(daily, fromKey);
  const today = useUsageSummary(daily, todayKey);

  const seenIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of daily ?? []) for (const id of Object.keys(d.byModel)) ids.add(id);
    return [...ids];
  }, [daily]);
  const colors = useModelColors(models, seenIds);
  const labelFor = (id: string) => models.find((m) => m.id === id)?.label ?? id;

  if (error) {
    return (
      <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3 text-sm">
        Couldn&apos;t load AI usage: {error.message}
      </div>
    );
  }

  const lastUpdated = daily?.reduce<Date | null>((latest, d) => {
    const at = toDate(d.updatedAt);
    return at && (!latest || at > latest) ? at : latest;
  }, null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveIndicator lastUpdated={lastUpdated ?? null} loading={loading} />
        <div
          role="radiogroup"
          aria-label="Date range"
          className="bg-muted inline-flex rounded-md p-0.5"
        >
          {USAGE_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={range === r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                'rounded px-3 py-1 text-sm',
                range === r.value
                  ? 'text-ops-blue bg-white font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Estimated spend"
          value={formatUsd(summary.totals.costUsd)}
          detail={`Today ${formatUsd(today.totals.costUsd)}`}
        />
        <StatTile
          label="AI calls"
          value={summary.totals.calls.toLocaleString('en-US')}
          detail={
            summary.totals.errors > 0
              ? `${summary.totals.errors.toLocaleString('en-US')} failed`
              : 'No failures'
          }
          detailTone={summary.totals.errors > 0 ? 'warning' : undefined}
        />
        <StatTile
          label="Tokens in"
          value={formatTokens(summary.totals.inputTokens)}
          detail="Prompts, scripts and audio"
        />
        <StatTile
          label="Tokens out"
          value={formatTokens(summary.totals.outputTokens)}
          detail="Responses, including thinking"
        />
      </div>

      <DailySpendChart daily={daily ?? []} colors={colors} labelFor={labelFor} />

      <Card className="p-0">
        <div className="border-border flex items-baseline justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Spend by model</h2>
          <span className="text-muted-foreground text-xs">
            {USAGE_RANGES.find((r) => r.value === range)?.label}
          </span>
        </div>
        {summary.models.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">No AI calls in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 text-right font-medium">Calls</th>
                <th className="px-4 py-2 text-right font-medium">Tokens in</th>
                <th className="px-4 py-2 text-right font-medium">Tokens out</th>
                <th className="px-4 py-2 text-right font-medium">Avg / call</th>
                <th className="w-48 px-4 py-2 text-right font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {summary.models.map((row) => {
                const share = summary.totals.costUsd > 0 ? row.costUsd / summary.totals.costUsd : 0;
                return (
                  <tr key={row.modelId} className="border-border border-t">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: colors.get(row.modelId) ?? OTHER_COLOR }}
                          aria-hidden
                        />
                        <span className="font-medium">{labelFor(row.modelId)}</span>
                      </div>
                      <span className="text-muted-foreground block pl-[18px] text-xs">
                        {AI_PROVIDER_LABELS[row.provider]} · <code>{row.modelId}</code>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.calls.toLocaleString('en-US')}
                      {row.errors > 0 ? (
                        <span className="text-ops-red-dark block text-xs">{row.errors} failed</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatTokens(row.inputTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatTokens(row.outputTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatUsd(row.calls > 0 ? row.costUsd / row.calls : 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-medium tabular-nums">{formatUsd(row.costUsd)}</span>
                      <span className="bg-muted mt-1 ml-auto block h-1.5 w-32 overflow-hidden rounded-full">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(share * 100, 2)}%`,
                            background: colors.get(row.modelId) ?? OTHER_COLOR,
                          }}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="p-0">
          <div className="border-border border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Spend by feature</h2>
          </div>
          <ul className="divide-border divide-y text-sm">
            {(Object.keys(AI_FEATURE_TITLES) as AiFeatureKey[]).map((key) => {
              const t = summary.byFeature.get(key);
              return (
                <li key={key} className="flex items-baseline justify-between px-4 py-2.5">
                  <span>
                    {AI_FEATURE_TITLES[key]}
                    <span className="text-muted-foreground block text-xs">
                      {(t?.calls ?? 0).toLocaleString('en-US')} calls
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{formatUsd(t?.costUsd ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <RecentCalls events={events ?? []} labelFor={labelFor} colors={colors} />
      </div>

      <p className="text-muted-foreground text-xs">
        Spend is estimated from the token counts each provider returns and the prices on the Models
        tab, and is written the moment each call finishes. Google Cloud and Anthropic invoices are
        the final word.
      </p>
    </div>
  );
}

function LiveIndicator({ lastUpdated, loading }: { lastUpdated: Date | null; loading: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
      </span>
      <span className="font-medium">Live</span>
      <span className="text-muted-foreground">
        {loading
          ? 'Connecting…'
          : lastUpdated
            ? `Last call ${relativeTime(lastUpdated)}`
            : 'Waiting for the first AI call'}
      </span>
    </div>
  );
}

function relativeTime(at: Date): string {
  const s = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StatTile({
  label,
  value,
  detail,
  detailTone,
}: {
  label: string;
  value: string;
  detail: string;
  detailTone?: 'warning' | undefined;
}) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-ops-blue mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p
        className={cn(
          'mt-0.5 text-xs',
          detailTone === 'warning' ? 'text-ops-red-dark' : 'text-muted-foreground',
        )}
      >
        {detail}
      </p>
    </Card>
  );
}

const CHART_DAYS = 30;
const CHART_HEIGHT = 160;

function DailySpendChart({
  daily,
  colors,
  labelFor,
}: {
  daily: readonly AiUsageDaily[];
  colors: Map<string, string>;
  labelFor: (id: string) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const keys = dayKeysBack(CHART_DAYS);
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const max = Math.max(0.0001, ...keys.map((k) => byDate.get(k)?.totals.costUsd ?? 0));
  const modelIds = [...colors.keys()].filter((id) =>
    daily.some((d) => (dayModel(d, id)?.calls ?? 0) > 0),
  );
  const hovered = hover ? byDate.get(hover) : undefined;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Daily spend, last 30 days</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
          {modelIds.map((id) => (
            <li key={id} className="text-muted-foreground flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors.get(id) }} />
              {labelFor(id)}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative">
        <div className="text-muted-foreground absolute top-0 left-0 text-[10px] tabular-nums">
          {formatUsd(max)}
        </div>
        <div
          className="border-border flex items-end gap-[2px] border-b pt-4"
          style={{ height: CHART_HEIGHT }}
          onMouseLeave={() => setHover(null)}
        >
          {keys.map((key) => {
            const day = byDate.get(key);
            const total = day?.totals.costUsd ?? 0;
            return (
              <button
                key={key}
                type="button"
                aria-label={`${key}: ${formatUsd(total)}`}
                onMouseEnter={() => setHover(key)}
                onFocus={() => setHover(key)}
                className={cn(
                  'flex h-full flex-1 flex-col-reverse gap-[2px] rounded-t-sm outline-none',
                  hover === key ? 'bg-muted/60' : '',
                )}
              >
                {modelIds.map((id, i) => {
                  const cost = dayModel(day, id)?.costUsd ?? 0;
                  if (cost <= 0) return null;
                  const isTop = modelIds
                    .slice(i + 1)
                    .every((later) => !(dayModel(day, later)?.costUsd ?? 0));
                  return (
                    <span
                      key={id}
                      className={cn('block w-full', isTop ? 'rounded-t-[4px]' : '')}
                      style={{
                        height: `${(cost / max) * (CHART_HEIGHT - 20)}px`,
                        minHeight: 2,
                        background: colors.get(id),
                      }}
                    />
                  );
                })}
              </button>
            );
          })}
        </div>
        <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
          <span>{shortDate(keys[0])}</span>
          <span>{shortDate(keys[Math.floor(keys.length / 2)] ?? keys[0])}</span>
          <span>Today</span>
        </div>
        {hover ? (
          <div className="bg-popover border-border pointer-events-none absolute top-6 right-0 z-10 min-w-48 rounded-md border px-3 py-2 text-xs shadow-md">
            <p className="font-semibold">{shortDate(hover)}</p>
            {modelIds
              .filter((id) => (dayModel(hovered, id)?.calls ?? 0) > 0)
              .map((id) => (
                <p key={id} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: colors.get(id) }} />
                    {labelFor(id)}
                  </span>
                  <span className="tabular-nums">
                    {formatUsd(dayModel(hovered, id)?.costUsd ?? 0)}
                  </span>
                </p>
              ))}
            <p className="border-border mt-1 flex justify-between border-t pt-1 font-medium">
              <span>{(hovered?.totals.calls ?? 0).toLocaleString('en-US')} calls</span>
              <span className="tabular-nums">{formatUsd(hovered?.totals.costUsd ?? 0)}</span>
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function shortDate(key: string): string {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function RecentCalls({
  events,
  labelFor,
  colors,
}: {
  events: readonly (AiUsageEvent & { id: string })[];
  labelFor: (id: string) => string;
  colors: Map<string, string>;
}) {
  return (
    <Card className="p-0">
      <div className="border-border flex items-baseline justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Latest calls</h2>
        <span className="text-muted-foreground text-xs">Updates as calls finish</span>
      </div>
      {events.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">No AI calls yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {events.slice(0, 8).map((e) => {
              const at = toDate(e.createdAt);
              return (
                <tr key={e.id} className="border-border border-t first:border-t-0">
                  <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap tabular-nums">
                    {at?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) ?? '—'}
                  </td>
                  <td className="px-2 py-2">
                    <span className="block">{AI_FEATURE_TITLES[e.feature]}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {e.userEmail ?? 'system'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-sm"
                        style={{ background: colors.get(e.modelId) ?? OTHER_COLOR }}
                      />
                      {labelFor(e.modelId)}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-2 py-2 text-right text-xs whitespace-nowrap tabular-nums">
                    {formatTokens(e.inputTokens)} in · {formatTokens(e.outputTokens)} out
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {e.ok ? (
                      <span className="tabular-nums">{formatUsd(e.costUsd)}</span>
                    ) : (
                      <Badge tone="warning" title={e.error ?? undefined}>
                        Failed
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
