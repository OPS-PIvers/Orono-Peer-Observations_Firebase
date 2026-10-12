import { useState } from 'react';
import { AudioLines, CheckCircle2, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  AI_MODEL_PRESETS,
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  aiModel,
  providerForModelId,
  type AiFeatureKey,
  type AiModel,
  type AiProvider,
} from '@ops/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AI_FEATURE_TITLES } from './aiFeatures';
import { formatPrice } from './aiUsage';

interface ModelsPanelProps {
  models: readonly AiModel[];
  onChange: (next: AiModel[]) => void;
  /** Model id each feature is routed to (after resolution). */
  routedModelByFeature: Record<AiFeatureKey, string>;
  claudeConfigured: boolean | null;
}

export function ModelsPanel({
  models,
  onChange,
  routedModelByFeature,
  claudeConfigured,
}: ModelsPanelProps) {
  const [editing, setEditing] = useState<AiModel | 'new' | null>(null);

  const usedBy = (id: string) =>
    (Object.keys(routedModelByFeature) as AiFeatureKey[]).filter(
      (k) => routedModelByFeature[k] === id,
    );

  function upsert(next: AiModel, originalId: string | null) {
    const rest = models.filter((m) => m.id !== (originalId ?? next.id));
    const index = originalId ? models.findIndex((m) => m.id === originalId) : models.length;
    const out = [...rest];
    out.splice(index < 0 ? out.length : index, 0, next);
    onChange(out);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        <ProviderCard
          provider="gemini"
          status="ok"
          detail="Runs through Vertex AI as the app's service account. Nothing to set up."
        />
        <ProviderCard
          provider="claude"
          status={claudeConfigured === null ? 'checking' : claudeConfigured ? 'ok' : 'missing'}
          detail={
            claudeConfigured
              ? 'Anthropic API key is set in Secret Manager.'
              : 'Needs the ANTHROPIC_API_KEY secret in Secret Manager before any Claude model can run.'
          }
        />
      </div>

      <Card className="p-0">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Available models</h2>
            <p className="text-muted-foreground text-xs">
              Features can only be routed to enabled models. Prices drive the spend estimates.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="mr-1 h-4 w-4" /> Add model
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 text-right font-medium">Input / 1M</th>
              <th className="px-4 py-2 text-right font-medium">Output / 1M</th>
              <th className="px-4 py-2 font-medium">Used by</th>
              <th className="px-4 py-2 font-medium">Enabled</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const features = usedBy(m.id);
              const inUse = features.length > 0;
              return (
                <tr key={m.id} className="border-border border-t align-top">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 font-medium">
                      {m.label}
                      {m.supportsAudio ? (
                        <AudioLines
                          className="text-muted-foreground h-3.5 w-3.5"
                          aria-label="Accepts audio"
                        />
                      ) : null}
                    </span>
                    <code className="text-muted-foreground block text-xs">{m.id}</code>
                    {m.note ? (
                      <span className="text-muted-foreground block text-xs">{m.note}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={m.provider === 'claude' ? 'warning' : 'info'}>
                      {m.provider === 'claude' ? 'Claude' : 'Gemini'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPrice(m.inputUsdPerMTok)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPrice(m.outputUsdPerMTok)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {inUse ? (
                      features.map((f) => (
                        <span key={f} className="block">
                          {AI_FEATURE_TITLES[f]}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">Not in use</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={m.enabled}
                      disabled={inUse && m.enabled}
                      title={
                        inUse && m.enabled ? 'Move its features to another model first' : undefined
                      }
                      aria-label={`${m.label} enabled`}
                      onCheckedChange={(enabled) => upsert({ ...m, enabled }, m.id)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${m.label}`}
                      onClick={() => setEditing(m)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${m.label}`}
                      disabled={inUse || models.length === 1}
                      title={inUse ? 'Move its features to another model first' : undefined}
                      onClick={() => onChange(models.filter((x) => x.id !== m.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <ModelDialog
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        existingIds={models.map((m) => m.id)}
        onClose={() => setEditing(null)}
        onSave={(next) => {
          upsert(next, editing && editing !== 'new' ? editing.id : null);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ProviderCard({
  provider,
  status,
  detail,
}: {
  provider: AiProvider;
  status: 'ok' | 'missing' | 'checking';
  detail: string;
}) {
  return (
    <Card className="flex items-start gap-3 p-4">
      {status === 'ok' ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden />
      ) : (
        <KeyRound className="text-ops-red mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      )}
      <div>
        <p className="text-sm font-semibold">
          {AI_PROVIDER_LABELS[provider]}{' '}
          <span
            className={`ml-1 text-xs font-medium ${status === 'ok' ? 'text-green-700' : 'text-ops-red-dark'}`}
          >
            {status === 'ok' ? 'Connected' : status === 'checking' ? 'Checking…' : 'Not set up'}
          </span>
        </p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
    </Card>
  );
}

interface Draft {
  id: string;
  provider: AiProvider;
  label: string;
  note: string;
  inputUsdPerMTok: string;
  outputUsdPerMTok: string;
  supportsAudio: boolean;
}

function toDraft(m: AiModel | null): Draft {
  return {
    id: m?.id ?? '',
    provider: m?.provider ?? 'claude',
    label: m?.label ?? '',
    note: m?.note ?? '',
    inputUsdPerMTok: m ? String(m.inputUsdPerMTok) : '',
    outputUsdPerMTok: m ? String(m.outputUsdPerMTok) : '',
    supportsAudio: m?.supportsAudio ?? false,
  };
}

function ModelDialog({
  open,
  initial,
  existingIds,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: AiModel | null;
  existingIds: readonly string[];
  onClose: () => void;
  onSave: (m: AiModel) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [lastInitial, setLastInitial] = useState<AiModel | null | undefined>(undefined);
  if (open && lastInitial !== initial) {
    setLastInitial(initial);
    setDraft(toDraft(initial));
    setError(null);
  }

  const presets = AI_MODEL_PRESETS.filter((p) => !existingIds.includes(p.id));

  function submit() {
    const parsed = aiModel.safeParse({
      ...draft,
      id: draft.id.trim(),
      inputUsdPerMTok: Number(draft.inputUsdPerMTok),
      outputUsdPerMTok: Number(draft.outputUsdPerMTok),
      enabled: initial?.enabled ?? true,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields');
      return;
    }
    if (parsed.data.id !== initial?.id && existingIds.includes(parsed.data.id)) {
      setError('That model is already in the list.');
      return;
    }
    onSave(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.label}` : 'Add a model'}</DialogTitle>
          <DialogDescription>
            The model id is sent to the provider exactly as typed. Check current prices on the
            provider&apos;s pricing page; they only affect the spend estimates.
          </DialogDescription>
        </DialogHeader>

        {!initial && presets.length > 0 ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Start from a known model</Label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDraft(toDraft(p))}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    draft.id === p.id
                      ? 'border-ops-blue bg-ops-blue-lighter text-ops-blue-dark'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="ai-model-provider" className="text-xs">
                Provider
              </Label>
              <select
                id="ai-model-provider"
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value as AiProvider;
                  setDraft((d) => ({
                    ...d,
                    provider,
                    supportsAudio: provider === 'claude' ? false : d.supportsAudio,
                  }));
                }}
                className="border-input h-9 rounded-md border bg-white px-2 text-sm"
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {AI_PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ai-model-id" className="text-xs">
                Model id
              </Label>
              <Input
                id="ai-model-id"
                value={draft.id}
                placeholder={draft.provider === 'claude' ? 'claude-sonnet-5-5' : 'gemini-3.5-flash'}
                onChange={(e) => {
                  const id = e.target.value;
                  const provider = providerForModelId(id.trim());
                  setDraft((d) => ({ ...d, id, provider: provider ?? d.provider }));
                }}
                className="font-mono"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ai-model-label" className="text-xs">
              Display name
            </Label>
            <Input
              id="ai-model-label"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ai-model-note" className="text-xs">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="ai-model-note"
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="ai-model-in" className="text-xs">
                Input price (USD per 1M tokens)
              </Label>
              <Input
                id="ai-model-in"
                type="number"
                min={0}
                step="0.01"
                value={draft.inputUsdPerMTok}
                onChange={(e) => setDraft((d) => ({ ...d, inputUsdPerMTok: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ai-model-out" className="text-xs">
                Output price (USD per 1M tokens)
              </Label>
              <Input
                id="ai-model-out"
                type="number"
                min={0}
                step="0.01"
                value={draft.outputUsdPerMTok}
                onChange={(e) => setDraft((d) => ({ ...d, outputUsdPerMTok: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.supportsAudio}
                disabled={draft.provider === 'claude'}
                onChange={(e) => setDraft((d) => ({ ...d, supportsAudio: e.target.checked }))}
                className="h-4 w-4"
              />
              Accepts audio (can run transcription)
            </label>
            {draft.provider === 'claude' ? (
              <p className="text-muted-foreground pl-6 text-xs">
                Claude models take text and images, not audio.
              </p>
            ) : null}
          </div>
        </div>

        {error ? <p className="text-ops-red-dark text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{initial ? 'Update model' : 'Add model'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
