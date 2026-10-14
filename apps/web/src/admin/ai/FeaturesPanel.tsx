import { useState, type ReactNode } from 'react';
import {
  AI_FEATURE_REQUIREMENTS,
  modelFitsFeature,
  resolveFeatureModel,
  type AiFeatureKey,
  type AiModel,
  type AiUsageTotals,
  type ResolvedGeminiFeature,
  type ScriptAutoTagControls,
} from '@ops/shared';
import { Label } from '@/components/ui/label';
import { AI_ACCESS_OPTIONS, AI_FEATURE_META, parseEmailList } from './aiFeatures';
import { formatPrice, formatUsd } from './aiUsage';

interface FeaturesPanelProps {
  models: readonly AiModel[];
  features: Record<AiFeatureKey, ResolvedGeminiFeature>;
  onChange: (key: AiFeatureKey, next: ResolvedGeminiFeature) => void;
  /** Which auto-tag options observers may pick. */
  autoTagControls: ScriptAutoTagControls;
  onAutoTagControlsChange: (next: ScriptAutoTagControls) => void;
  /** This month's usage per feature. */
  monthByFeature: Map<string, AiUsageTotals>;
  claudeConfigured: boolean | null;
}

export function FeaturesPanel({
  models,
  features,
  onChange,
  autoTagControls,
  onAutoTagControlsChange,
  monthByFeature,
  claudeConfigured,
}: FeaturesPanelProps) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground max-w-3xl text-sm">
        Choose who gets each AI feature and which model runs it. Every call is billed, so a feature
        can be off, limited to a beta list, or on for everyone. Anyone without access sees no trace
        of the feature, and the server refuses their requests. A model switch applies to the next
        call, with no redeploy.
      </p>
      {AI_FEATURE_META.map((meta) => (
        <FeatureCard
          key={meta.key}
          featureKey={meta.key}
          title={meta.title}
          description={meta.description}
          hiddenWhenUnavailable={meta.hiddenWhenUnavailable}
          models={models}
          value={features[meta.key]}
          onChange={(next) => onChange(meta.key, next)}
          month={monthByFeature.get(meta.key)}
          claudeConfigured={claudeConfigured}
          extra={
            meta.key === 'scriptAutoTag' ? (
              <ScriptAutoTagControlsSection
                value={autoTagControls}
                onChange={onAutoTagControlsChange}
                disabled={features.scriptAutoTag.access === 'off'}
              />
            ) : null
          }
        />
      ))}
    </div>
  );
}

function FeatureCard({
  featureKey,
  title,
  description,
  hiddenWhenUnavailable,
  models,
  value,
  onChange,
  month,
  claudeConfigured,
  extra,
}: {
  featureKey: AiFeatureKey;
  title: string;
  description: string;
  hiddenWhenUnavailable: string;
  models: readonly AiModel[];
  value: ResolvedGeminiFeature;
  onChange: (next: ResolvedGeminiFeature) => void;
  month: AiUsageTotals | undefined;
  claudeConfigured: boolean | null;
  /** Feature-specific settings shown under the access and model controls. */
  extra?: ReactNode;
}) {
  // Entries dropped on the last blur for not being addresses — shown so a
  // typo doesn't silently leave someone off the list.
  const [invalidEmails, setInvalidEmails] = useState<string[]>([]);
  const betaListId = `ai-beta-${featureKey}`;
  const modelId = `ai-model-${featureKey}`;
  const effective = resolveFeatureModel(models, featureKey, value.model);
  const needsAudio = AI_FEATURE_REQUIREMENTS[featureKey].audio;

  return (
    <div className="border-border space-y-4 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <div className="text-right text-xs">
          <p className="text-muted-foreground">This month</p>
          <p className="text-sm font-semibold tabular-nums">{formatUsd(month?.costUsd ?? 0)}</p>
          <p className="text-muted-foreground tabular-nums">
            {(month?.calls ?? 0).toLocaleString('en-US')} calls
            {month && month.calls > 0 ? ` · ${formatUsd(month.costUsd / month.calls)} each` : ''}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Label className="text-xs">Who can use it</Label>
          <div role="radiogroup" aria-label={`${title} access`} className="grid gap-2">
            {AI_ACCESS_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  value.access === opt.value
                    ? 'border-ops-blue bg-ops-blue-lighter/40'
                    : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name={`ai-access-${featureKey}`}
                  value={opt.value}
                  checked={value.access === opt.value}
                  onChange={() => onChange({ ...value, access: opt.value })}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="font-medium">
                  {opt.label}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {opt.help}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {value.access !== 'all' ? (
            <p className="text-muted-foreground text-xs italic">
              {value.access === 'off' ? 'Hidden from everyone' : 'Hidden from everyone not listed'}{' '}
              · {hiddenWhenUnavailable}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="grid gap-1">
            <Label htmlFor={modelId} className="text-xs">
              Model
            </Label>
            <select
              id={modelId}
              value={effective.id}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
              disabled={value.access === 'off'}
              className="border-input focus:border-ops-blue focus:ring-ops-blue h-9 rounded-md border bg-white px-2 text-sm outline-none focus:ring-1 disabled:opacity-50"
            >
              {models.map((m) => {
                const fits = modelFitsFeature(m, featureKey);
                const why = !m.enabled ? 'disabled' : 'text only';
                return (
                  <option key={m.id} value={m.id} disabled={!fits}>
                    {m.label} · {formatPrice(m.inputUsdPerMTok)} in /{' '}
                    {formatPrice(m.outputUsdPerMTok)} out{fits ? '' : ` (${why})`}
                  </option>
                );
              })}
            </select>
            <p className="text-muted-foreground text-xs">
              {needsAudio
                ? 'Needs a model that accepts audio, so Claude models are not offered here.'
                : 'Any enabled Gemini or Claude model can run this.'}{' '}
              Prices are per 1M tokens.
            </p>
            {effective.id !== value.model ? (
              <p className="text-ops-red-dark text-xs">
                The saved model <code>{value.model}</code> is unavailable, so calls use{' '}
                {effective.label}. Save to make that explicit.
              </p>
            ) : null}
            {effective.provider === 'claude' && claudeConfigured === false ? (
              <p className="border-ops-red-light bg-ops-red-lighter/50 text-ops-red-dark rounded-md border px-3 py-2 text-xs">
                The Claude API key isn&apos;t set on the server yet, so {title.toLowerCase()} calls
                will fail until it is.
              </p>
            ) : null}
          </div>

          {value.access === 'beta' ? (
            <div className="grid gap-1">
              <Label htmlFor={betaListId} className="text-xs">
                Beta users
              </Label>
              <textarea
                id={betaListId}
                // Remount when the saved list changes (hydration, or a blur that
                // normalized it) so the box shows the list exactly as it will save.
                key={value.betaEmails.join(',')}
                defaultValue={value.betaEmails.join('\n')}
                onBlur={(e) => {
                  const { valid, invalid } = parseEmailList(e.target.value);
                  setInvalidEmails(invalid);
                  onChange({ ...value, betaEmails: valid });
                }}
                rows={Math.min(Math.max(value.betaEmails.length + 1, 3), 8)}
                placeholder={'teacher@orono.k12.mn.us\nanother.teacher@orono.k12.mn.us'}
                className="border-input focus:border-ops-blue focus:ring-ops-blue rounded-md border bg-white px-2 py-1.5 font-mono text-sm outline-none focus:ring-1"
              />
              <p className="text-muted-foreground text-xs">
                One email address per line (commas also work). {value.betaEmails.length} listed.
              </p>
              {invalidEmails.length > 0 ? (
                <p className="text-ops-red-dark text-xs">
                  Not added — not valid email addresses: {invalidEmails.join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {extra}
    </div>
  );
}

const FOCUS_SWITCHES: { key: keyof ScriptAutoTagControls['components']; label: string }[] = [
  { key: 'assigned', label: 'Assigned only' },
  { key: 'preferAssigned', label: 'Full rubric, prefer assigned' },
  { key: 'full', label: 'Full rubric' },
];

const DETAIL_SWITCHES: { key: keyof ScriptAutoTagControls['detail']; label: string }[] = [
  { key: 'key', label: 'Key evidence only' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'thorough', label: 'Thorough' },
];

/**
 * Which auto-tag options observers may pick. Everything is on by default.
 * The server clamps each request to these, so a change applies to the next
 * run even on pages that were already open.
 */
function ScriptAutoTagControlsSection({
  value,
  onChange,
  disabled,
}: {
  value: ScriptAutoTagControls;
  onChange: (next: ScriptAutoTagControls) => void;
  disabled: boolean;
}) {
  const onCount = (flags: Record<string, boolean>) => Object.values(flags).filter(Boolean).length;
  return (
    <fieldset
      disabled={disabled}
      className="border-border space-y-3 border-t pt-4 disabled:opacity-50"
    >
      <legend className="sr-only">Auto-tag options observers can use</legend>
      <div>
        <p className="text-sm font-semibold">Options observers can use</p>
        <p className="text-muted-foreground text-xs">
          Turn off anything you don&apos;t want offered. Requests for a turned-off choice use the
          nearest allowed one instead. At least one choice in each group stays on.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <SwitchGroup
          title="Components"
          items={FOCUS_SWITCHES.map((s) => ({
            id: `autotag-ctl-focus-${s.key}`,
            label: s.label,
            checked: value.components[s.key],
            // Keep the last one on so observers always have a choice.
            locked: value.components[s.key] && onCount(value.components) === 1,
            onToggle: () =>
              onChange({
                ...value,
                components: { ...value.components, [s.key]: !value.components[s.key] },
              }),
          }))}
        />
        <SwitchGroup
          title="Detail"
          items={DETAIL_SWITCHES.map((s) => ({
            id: `autotag-ctl-detail-${s.key}`,
            label: s.label,
            checked: value.detail[s.key],
            locked: value.detail[s.key] && onCount(value.detail) === 1,
            onToggle: () =>
              onChange({ ...value, detail: { ...value.detail, [s.key]: !value.detail[s.key] } }),
          }))}
        />
        <SwitchGroup
          title="Extras"
          items={[
            {
              id: 'autotag-ctl-rationale',
              label: 'Explain each tag',
              hint: 'Observers can ask for a one-line reason per suggestion.',
              checked: value.rationale,
              onToggle: () => onChange({ ...value, rationale: !value.rationale }),
            },
            {
              id: 'autotag-ctl-confidence',
              label: 'Confidence levels',
              hint: 'High / Medium / Low on each suggestion.',
              checked: value.confidence,
              onToggle: () => onChange({ ...value, confidence: !value.confidence }),
            },
            {
              id: 'autotag-ctl-rerun',
              label: 'Run again with a reason',
              hint: 'Off means each observation gets one AI run.',
              checked: value.rerun,
              onToggle: () => onChange({ ...value, rerun: !value.rerun }),
            },
          ]}
        />
      </div>
    </fieldset>
  );
}

function SwitchGroup({
  title,
  items,
}: {
  title: string;
  items: {
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    locked?: boolean;
    onToggle: () => void;
  }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{title}</Label>
      {items.map((item) => (
        <label
          key={item.id}
          htmlFor={item.id}
          className="flex cursor-pointer items-start gap-2 text-sm"
        >
          <input
            id={item.id}
            type="checkbox"
            checked={item.checked}
            disabled={item.locked}
            onChange={item.onToggle}
            className="accent-ops-blue mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            {item.label}
            {item.hint ? (
              <span className="text-muted-foreground block text-xs">{item.hint}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}
