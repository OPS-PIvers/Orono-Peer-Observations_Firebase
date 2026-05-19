import { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  CHECKPOINT_TYPES,
  COLLECTIONS,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  DASHBOARD_TIERS,
  MATERIAL_ICONS,
  TRIMESTERS,
  type CheckpointType,
  type DashboardCheckpoint,
  type DashboardMaterial,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardTemplate,
  type DashboardTier,
  type MaterialIcon,
  type Trimester,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/PageHeader';

/**
 * Dashboard configuration — peer-evaluator and admin facing.
 *
 * Two stacked editors:
 *   1. Checkpoint template per tier (continuing / probationary). Lets PEs
 *      define the ordered milestones a staff member sees on their dashboard,
 *      with per-checkpoint materials.
 *   2. Quick materials — the right-rail evergreen links (rubric, last
 *      year's observation PDF, district handbook, FAQ, etc.).
 *
 * Saves use setDoc with merge; on success the live Firestore subscription
 * inside StaffDashboardPage picks the change up immediately.
 */

const TYPE_LABELS: Record<CheckpointType, string> = {
  form: 'Form / reflection',
  meeting: 'Meeting / scheduling',
  observation: 'Observation',
  review: 'Review / sign-off',
};

const TIER_LABELS: Record<DashboardTier, string> = {
  continuing: 'Continuing (Years 1–3)',
  probationary: 'Probationary (Years 4–6 / P1–P3)',
};

export function DashboardConfigPage() {
  const [activeTier, setActiveTier] = useState<DashboardTier>('continuing');

  return (
    <PageHeader
      title="Dashboard Setup"
      subtitle="Configure the staff dashboard checkpoint timeline and the quick-materials sidebar. Peer evaluators and admins can edit these."
    >
      <div className="mb-4 flex gap-2">
        {DASHBOARD_TIERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTier(t)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTier === t
                ? 'border-ops-blue bg-ops-blue text-white'
                : 'border-border bg-background text-foreground hover:bg-muted'
            }`}
          >
            {TIER_LABELS[t]}
          </button>
        ))}
      </div>

      <TemplateEditor tier={activeTier} />

      <div className="mt-12">
        <QuickMaterialsEditor />
      </div>
    </PageHeader>
  );
}

// ─── Template editor ─────────────────────────────────────────────────────────

const TEMPLATE_DEFAULTS: Record<
  DashboardTier,
  Pick<
    DashboardTemplate,
    'cycleLabel' | 'yearTierLabel' | 'cycleCloseLabel' | 'summativeYear' | 'observationsPerYear'
  >
> = {
  continuing: {
    cycleLabel: 'Summative cycle · 2026–27',
    yearTierLabel: 'Year 3',
    cycleCloseLabel: 'May 15',
    summativeYear: true,
    observationsPerYear: 2,
  },
  probationary: {
    cycleLabel: 'Probationary cycle · 2026–27',
    yearTierLabel: 'Probationary',
    cycleCloseLabel: 'May 15',
    summativeYear: true,
    observationsPerYear: 3,
  },
};

function TemplateEditor({ tier }: { tier: DashboardTier }) {
  const { user } = useAuth();
  const path = `${COLLECTIONS.dashboardTemplates}/${tier}`;
  const { data } = useFirestoreDoc<DashboardTemplate>(path);

  const [cycleLabel, setCycleLabel] = useState('');
  const [yearTierLabel, setYearTierLabel] = useState('');
  const [cycleCloseLabel, setCycleCloseLabel] = useState('');
  const [observationsPerYear, setObservationsPerYear] = useState(2);
  const [summativeYear, setSummativeYear] = useState(true);
  const [checkpoints, setCheckpoints] = useState<DashboardCheckpoint[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Hydrate once per (path) — later snapshots would clobber edits in progress.
  useEffect(() => {
    setHydrated(false);
    setSavedAt(null);
    setSaveError(null);
  }, [path]);

  useEffect(() => {
    if (hydrated) return;
    if (!data) {
      const defaults = TEMPLATE_DEFAULTS[tier];
      setCycleLabel(defaults.cycleLabel);
      setYearTierLabel(defaults.yearTierLabel);
      setCycleCloseLabel(defaults.cycleCloseLabel);
      setObservationsPerYear(defaults.observationsPerYear);
      setSummativeYear(defaults.summativeYear);
      setCheckpoints([]);
      setHydrated(true);
      return;
    }
    setCycleLabel(data.cycleLabel);
    setYearTierLabel(data.yearTierLabel);
    setCycleCloseLabel(data.cycleCloseLabel);
    setObservationsPerYear(data.observationsPerYear);
    setSummativeYear(data.summativeYear);
    setCheckpoints(data.checkpoints);
    setHydrated(true);
  }, [data, hydrated, tier]);

  function updateCheckpoint(idx: number, patch: Partial<DashboardCheckpoint>) {
    setCheckpoints((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeCheckpoint(idx: number) {
    setCheckpoints((cs) => cs.filter((_, i) => i !== idx));
  }
  function moveCheckpoint(idx: number, dir: -1 | 1) {
    setCheckpoints((cs) => {
      const next = idx + dir;
      if (next < 0 || next >= cs.length) return cs;
      const copy = cs.slice();
      const a = copy[idx];
      const b = copy[next];
      if (!a || !b) return cs;
      copy[idx] = b;
      copy[next] = a;
      return copy;
    });
  }
  function addCheckpoint() {
    const id = `cp-${String(Date.now())}-${Math.random().toString(36).slice(2, 6)}`;
    const fresh: DashboardCheckpoint = {
      id,
      type: 'form',
      typeLabel: 'Self-reflection',
      title: 'New checkpoint',
      desc: '',
      trimester: 'fall',
      monthLabel: 'Sept',
      dateLabel: 'Sept 15',
      dueDate: null,
      cta: 'Open',
      ctaUrl: '',
      materials: [],
    };
    setCheckpoints((cs) => [...cs, fresh]);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Omit<DashboardTemplate, 'updatedAt'> = {
        tier,
        cycleLabel: cycleLabel.trim() || TEMPLATE_DEFAULTS[tier].cycleLabel,
        yearTierLabel: yearTierLabel.trim() || TEMPLATE_DEFAULTS[tier].yearTierLabel,
        cycleCloseLabel: cycleCloseLabel.trim() || TEMPLATE_DEFAULTS[tier].cycleCloseLabel,
        observationsPerYear,
        summativeYear,
        checkpoints: checkpoints.map(serializeCheckpoint),
      };
      await setDoc(
        doc(db, path),
        {
          ...payload,
          updatedAt: serverTimestamp(),
          ...(user?.email ? { updatedBy: user.email } : {}),
        },
        { merge: true },
      );
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="text-foreground mb-3 text-base font-semibold">
        Checkpoint template — {TIER_LABELS[tier]}
      </h2>
      <div className="border-border bg-background mb-4 grid gap-4 rounded-lg border p-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="cycleLabel">Cycle eyebrow</Label>
          <Input
            id="cycleLabel"
            value={cycleLabel}
            onChange={(e) => setCycleLabel(e.target.value)}
            placeholder="Summative cycle · 2026–27"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="yearTierLabel">Year/tier badge</Label>
          <Input
            id="yearTierLabel"
            value={yearTierLabel}
            onChange={(e) => setYearTierLabel(e.target.value)}
            placeholder="Year 3"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cycleCloseLabel">Cycle close date</Label>
          <Input
            id="cycleCloseLabel"
            value={cycleCloseLabel}
            onChange={(e) => setCycleCloseLabel(e.target.value)}
            placeholder="May 15"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="obsPerYear">Observations per year</Label>
          <Input
            id="obsPerYear"
            type="number"
            min={0}
            max={10}
            value={observationsPerYear}
            onChange={(e) => setObservationsPerYear(Number(e.target.value || 0))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={summativeYear}
            onChange={(e) => setSummativeYear(e.target.checked)}
            className="h-4 w-4"
          />
          Summative year (vs. formative)
        </label>
      </div>

      <div className="space-y-3">
        {checkpoints.map((cp, idx) => (
          <CheckpointEditor
            key={cp.id}
            checkpoint={cp}
            index={idx}
            total={checkpoints.length}
            onChange={(patch) => updateCheckpoint(idx, patch)}
            onMove={(dir) => moveCheckpoint(idx, dir)}
            onRemove={() => removeCheckpoint(idx)}
          />
        ))}
        {checkpoints.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-center text-sm">
            No checkpoints yet. Add the first one to get started.
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" variant="outline" onClick={addCheckpoint}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add checkpoint
        </Button>
        <div className="ml-auto flex items-center gap-3">
          {saveError ? <span className="text-destructive text-sm">{saveError}</span> : null}
          {savedAt ? (
            <span className="text-muted-foreground text-xs">
              Saved at {savedAt.toLocaleTimeString()}
            </span>
          ) : null}
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function serializeCheckpoint(c: DashboardCheckpoint): DashboardCheckpoint {
  return {
    ...c,
    title: c.title.trim(),
    typeLabel: c.typeLabel.trim(),
    desc: c.desc.trim(),
    monthLabel: c.monthLabel.trim(),
    dateLabel: c.dateLabel.trim(),
    cta: c.cta.trim() || 'Open',
    ctaUrl: c.ctaUrl.trim(),
    materials: c.materials.map((m) => ({
      ...m,
      label: m.label.trim(),
      url: m.url.trim(),
    })),
  };
}

// ─── CheckpointEditor ────────────────────────────────────────────────────────

function CheckpointEditor({
  checkpoint,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  checkpoint: DashboardCheckpoint;
  index: number;
  total: number;
  onChange: (patch: Partial<DashboardCheckpoint>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const c = checkpoint;
  const dueDateValue = useMemo(() => {
    if (!c.dueDate) return '';
    const d = c.dueDate instanceof Date ? c.dueDate : new Date(c.dueDate);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }, [c.dueDate]);

  return (
    <div className="border-border bg-background rounded-lg border">
      <div className="border-border flex items-center gap-2 border-b px-4 py-2">
        <span className="text-muted-foreground font-mono text-xs">#{index + 1}</span>
        <span className="text-foreground text-sm font-medium">{c.title || 'Untitled'}</span>
        <span className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="hover:bg-muted rounded p-1 disabled:opacity-30"
            aria-label="Move up"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="hover:bg-muted rounded p-1 disabled:opacity-30"
            aria-label="Move down"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="hover:bg-destructive/10 text-destructive rounded p-1"
            aria-label="Remove checkpoint"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </span>
      </div>

      <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
        <div className="grid gap-1.5 md:col-span-2">
          <Label>Title</Label>
          <Input value={c.title} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Type</Label>
          <select
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            value={c.type}
            onChange={(e) => onChange({ type: e.target.value as CheckpointType })}
          >
            {CHECKPOINT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label>Type label (chip)</Label>
          <Input value={c.typeLabel} onChange={(e) => onChange({ typeLabel: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Trimester</Label>
          <select
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            value={c.trimester}
            onChange={(e) => onChange({ trimester: e.target.value as Trimester })}
          >
            {TRIMESTERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label>Month label</Label>
            <Input
              value={c.monthLabel}
              onChange={(e) => onChange({ monthLabel: e.target.value })}
              placeholder="Sept"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Date label</Label>
            <Input
              value={c.dateLabel}
              onChange={(e) => onChange({ dateLabel: e.target.value })}
              placeholder="Sept 15"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Due date</Label>
          <Input
            type="date"
            value={dueDateValue}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ dueDate: v ? new Date(`${v}T00:00:00`) : null });
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>CTA label</Label>
          <Input value={c.cta} onChange={(e) => onChange({ cta: e.target.value })} />
        </div>
        <div className="grid gap-1.5 md:col-span-2">
          <Label>CTA URL</Label>
          <Input
            value={c.ctaUrl}
            onChange={(e) => onChange({ ctaUrl: e.target.value })}
            placeholder="https://… or /my-rubric"
          />
        </div>
        <div className="grid gap-1.5 md:col-span-2">
          <Label>Description</Label>
          <Textarea value={c.desc} onChange={(e) => onChange({ desc: e.target.value })} rows={2} />
        </div>
      </div>

      <MaterialList materials={c.materials} onChange={(next) => onChange({ materials: next })} />
    </div>
  );
}

// ─── Per-checkpoint material list ────────────────────────────────────────────

function MaterialList({
  materials,
  onChange,
}: {
  materials: DashboardMaterial[];
  onChange: (next: DashboardMaterial[]) => void;
}) {
  function update(i: number, patch: Partial<DashboardMaterial>) {
    onChange(materials.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function add() {
    onChange([...materials, { label: 'New material', icon: 'doc', url: '' }]);
  }
  function remove(i: number) {
    onChange(materials.filter((_, idx) => idx !== i));
  }

  return (
    <div className="bg-muted/30 border-border space-y-2 border-t px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Materials
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add material
        </Button>
      </div>
      {materials.length === 0 ? (
        <p className="text-muted-foreground text-xs">No materials attached.</p>
      ) : (
        <div className="space-y-2">
          {materials.map((m, i) => (
            <div
              key={`${m.label}-${String(i)}`}
              className="border-border bg-background grid items-center gap-2 rounded-md border p-2 md:grid-cols-[1.2fr_120px_1fr_auto]"
            >
              <Input
                value={m.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Label"
              />
              <select
                className="border-input bg-background rounded-md border px-2 py-2 text-sm"
                value={m.icon}
                onChange={(e) => update(i, { icon: e.target.value as MaterialIcon })}
              >
                {MATERIAL_ICONS.map((icn) => (
                  <option key={icn} value={icn}>
                    {icn}
                  </option>
                ))}
              </select>
              <Input
                value={m.url}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="https:// (Drive link, form URL, …)"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove material"
                onClick={() => remove(i)}
              >
                <Trash2 className="text-destructive h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quick materials editor ──────────────────────────────────────────────────

function QuickMaterialsEditor() {
  const { user } = useAuth();
  const path = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;
  const { data } = useFirestoreDoc<DashboardQuickMaterialsDoc>(path);

  const [items, setItems] = useState<DashboardQuickMaterial[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated) return;
    setItems(data?.items ?? []);
    setHydrated(true);
  }, [data, hydrated]);

  function update(i: number, patch: Partial<DashboardQuickMaterial>) {
    setItems((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function add() {
    setItems((xs) => [...xs, { label: 'New material', sub: '', icon: 'doc', url: '' }]);
  }
  function remove(i: number) {
    setItems((xs) => xs.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const normalized = items.map((m) => ({
        ...m,
        label: m.label.trim(),
        sub: m.sub.trim(),
        url: m.url.trim(),
      }));
      await setDoc(
        doc(db, path),
        {
          items: normalized,
          updatedAt: serverTimestamp(),
          ...(user?.email ? { updatedBy: user.email } : {}),
        },
        { merge: true },
      );
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="text-foreground mb-3 text-base font-semibold">Quick materials sidebar</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Evergreen links rendered in the right rail of every staff dashboard — rubric, last year’s
        observation PDF, district handbook, FAQ, etc.
      </p>

      <div className="space-y-2">
        {items.map((m, i) => (
          <div
            key={`${m.label}-${String(i)}`}
            className="border-border bg-background grid items-center gap-2 rounded-md border p-2 md:grid-cols-[1.1fr_1.4fr_120px_1fr_auto]"
          >
            <Input
              value={m.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label"
            />
            <Input
              value={m.sub}
              onChange={(e) => update(i, { sub: e.target.value })}
              placeholder="Sub-label (optional)"
            />
            <select
              className="border-input bg-background rounded-md border px-2 py-2 text-sm"
              value={m.icon}
              onChange={(e) => update(i, { icon: e.target.value as MaterialIcon })}
            >
              {MATERIAL_ICONS.map((icn) => (
                <option key={icn} value={icn}>
                  {icn}
                </option>
              ))}
            </select>
            <Input
              value={m.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove material"
              onClick={() => remove(i)}
            >
              <Trash2 className="text-destructive h-4 w-4" />
            </Button>
          </div>
        ))}
        {items.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-center text-sm">
            No quick materials yet.
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" variant="outline" onClick={add}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add material
        </Button>
        <div className="ml-auto flex items-center gap-3">
          {saveError ? <span className="text-destructive text-sm">{saveError}</span> : null}
          {savedAt ? (
            <span className="text-muted-foreground text-xs">
              Saved at {savedAt.toLocaleTimeString()}
            </span>
          ) : null}
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save materials'}
          </Button>
        </div>
      </div>
    </section>
  );
}
