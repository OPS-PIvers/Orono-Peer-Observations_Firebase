import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  CHECKPOINT_TYPE_KEYS,
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  MATERIAL_ICONS,
  type CheckpointTypeKey,
  type DashboardCheckpointConfig,
  type DashboardCheckpointsConfig,
  type DashboardConfig,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
  type MaterialIcon,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';

/**
 * Admin Console → Dashboard.
 *
 * Configures the staff dashboard for everyone:
 *   - which top-level sections render
 *   - which built-in checkpoints are enabled, in what order, with optional
 *     display-label overrides
 *   - the right-rail Quick Materials list (URL bookmarks)
 *
 * Nothing on this page sets dates, descriptions, or status — those are
 * derived from each staff member's real observation state at render time
 * by `deriveCheckpoints` in apps/web/src/dashboard.
 */

const SECTION_LABELS: Record<keyof DashboardSectionsConfig, string> = {
  hero: 'Hero (greeting, progress ring, year-tier meta)',
  timeline: 'Year-at-a-glance timeline',
  filterBar: 'Filter chips (All / Active / Upcoming / Completed)',
  quickMaterials: 'Right rail — Quick materials list',
  peerEvaluatorCard: 'Right rail — Peer evaluator contact card',
};

const CHECKPOINT_LABELS: Record<CheckpointTypeKey, { title: string; blurb: string }> = {
  signup: {
    title: 'Sign-up window',
    blurb: 'CTA to the scheduling link from app settings. Marks done once an observation exists.',
  },
  preObs: {
    title: 'Pre-observation conversation',
    blurb: 'Date from observation.preObsDate (visible post-finalize).',
  },
  observation: {
    title: 'Classroom observation',
    blurb: 'Date from observation.observationDate.',
  },
  reviewDraft: {
    title: 'Review draft observation',
    blurb: 'Appears while a Work Product / Instructional Round draft is open.',
  },
  postObs: {
    title: 'Post-observation conversation',
    blurb: 'Date from observation.postObsDate.',
  },
  acknowledge: {
    title: 'Acknowledge finalized observation',
    blurb: 'Writes acknowledgedAt on the observation when staff clicks Acknowledge.',
  },
  workProduct: {
    title: 'Work-product responses',
    blurb:
      'Shows only when this staff member has an active Work Product observation. Progress bar = answered / total questions.',
  },
  instructionalRound: {
    title: 'Instructional Round',
    blurb: 'Shows only when this staff member has an active Instructional Round.',
  },
};

const CONFIG_PATH = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
const QUICK_PATH = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;

const DEFAULT_SECTIONS: DashboardSectionsConfig = {
  hero: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

interface CheckpointEntryDraft extends DashboardCheckpointConfig {
  key: CheckpointTypeKey;
}

function defaultCheckpoint(): DashboardCheckpointConfig {
  return {
    enabled: true,
    order: 0,
    typeLabelOverride: '',
    titleOverride: '',
    ctaLabelOverride: '',
  };
}

function checkpointsAsList(cfg: DashboardCheckpointsConfig): CheckpointEntryDraft[] {
  return CHECKPOINT_TYPE_KEYS.map((key, idx) => ({
    key,
    ...defaultCheckpoint(),
    order: idx,
    ...(cfg[key] ?? {}),
  })).sort((a, b) => a.order - b.order);
}

export function DashboardSettingsPage() {
  return (
    <PageHeader
      title="Dashboard"
      subtitle="Configure the staff dashboard: enable/disable sections and checkpoints, override built-in labels, and manage the Quick Materials sidebar. Per-staff dates and status are derived from observations."
    >
      <div className="space-y-10">
        <SectionsEditor />
        <CheckpointsEditor />
        <QuickMaterialsEditor />
      </div>
    </PageHeader>
  );
}

// ─── Sections editor ─────────────────────────────────────────────────────────

function SectionsEditor() {
  const { user } = useAuth();
  const { data } = useFirestoreDoc<DashboardConfig>(CONFIG_PATH);

  const [sections, setSections] = useState<DashboardSectionsConfig>(DEFAULT_SECTIONS);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useHydratedDraft(CONFIG_PATH, data ?? null, (config) => {
    setSections(config.sections);
  });

  function toggle(key: keyof DashboardSectionsConfig) {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await setDoc(
        doc(db, CONFIG_PATH),
        {
          sections,
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
      <h2 className="text-foreground mb-3 text-base font-semibold">Dashboard sections</h2>
      <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
        Toggle the top-level pieces of the dashboard. Off = the section doesn’t render for any staff
        member.
      </p>
      <div className="border-border bg-background divide-border divide-y rounded-lg border">
        {(Object.keys(SECTION_LABELS) as (keyof DashboardSectionsConfig)[]).map((k) => (
          <div key={k} className="flex items-center gap-3 px-4 py-3">
            <SwitchToggle on={sections[k]} onChange={() => toggle(k)} label={k} />
            <span className="text-sm">{SECTION_LABELS[k]}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {saveError ? <span className="text-destructive text-sm">{saveError}</span> : null}
        {savedAt ? (
          <span className="text-muted-foreground text-xs">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        ) : null}
        <Button onClick={() => void save()} disabled={saving} className="ml-auto">
          {saving ? 'Saving…' : 'Save sections'}
        </Button>
      </div>
    </section>
  );
}

// ─── Checkpoints editor ──────────────────────────────────────────────────────

function CheckpointsEditor() {
  const { user } = useAuth();
  const { data } = useFirestoreDoc<DashboardConfig>(CONFIG_PATH);

  const [rows, setRows] = useState<CheckpointEntryDraft[]>(() => checkpointsAsList({}));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useHydratedDraft(CONFIG_PATH, data ?? null, (config) => {
    setRows(checkpointsAsList(config.checkpoints));
  });

  function updateRow(idx: number, patch: Partial<CheckpointEntryDraft>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function move(idx: number, dir: -1 | 1) {
    setRows((rs) => {
      const next = idx + dir;
      if (next < 0 || next >= rs.length) return rs;
      const copy = rs.slice();
      const a = copy[idx];
      const b = copy[next];
      if (!a || !b) return rs;
      copy[idx] = b;
      copy[next] = a;
      return copy;
    });
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Renumber order from current list position so the saved doc reflects
      // the user's drag order exactly.
      const checkpoints: DashboardCheckpointsConfig = {};
      rows.forEach((r, idx) => {
        checkpoints[r.key] = {
          enabled: r.enabled,
          order: idx,
          typeLabelOverride: r.typeLabelOverride.trim(),
          titleOverride: r.titleOverride.trim(),
          ctaLabelOverride: r.ctaLabelOverride.trim(),
        };
      });
      await setDoc(
        doc(db, CONFIG_PATH),
        {
          checkpoints,
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
      <h2 className="text-foreground mb-3 text-base font-semibold">Checkpoints</h2>
      <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
        Each checkpoint renders only when it applies to the staff member (e.g. work-product appears
        only when they have an active Work Product observation). Toggle off to hide a type globally.
        Label overrides change just the visible text — the underlying logic is unchanged.
      </p>
      <div className="space-y-2">
        {rows.map((r, idx) => {
          const meta = CHECKPOINT_LABELS[r.key];
          return (
            <div key={r.key} className="border-border bg-background rounded-lg border">
              <div className="border-border flex items-center gap-3 border-b px-4 py-2">
                <SwitchToggle
                  on={r.enabled}
                  onChange={() => updateRow(idx, { enabled: !r.enabled })}
                  label={r.key}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{meta.title}</div>
                  <div className="text-muted-foreground text-xs">{meta.blurb}</div>
                </div>
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                  className="hover:bg-muted rounded p-1 disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={idx === rows.length - 1}
                  onClick={() => move(idx, 1)}
                  className="hover:bg-muted rounded p-1 disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
              {r.enabled ? (
                <div className="bg-muted/20 grid gap-3 px-4 py-3 md:grid-cols-3">
                  <div className="grid gap-1">
                    <Label className="text-xs">Chip label override</Label>
                    <Input
                      value={r.typeLabelOverride}
                      onChange={(e) => updateRow(idx, { typeLabelOverride: e.target.value })}
                      placeholder="(use default)"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Title override</Label>
                    <Input
                      value={r.titleOverride}
                      onChange={(e) => updateRow(idx, { titleOverride: e.target.value })}
                      placeholder="(use default)"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">CTA verb override</Label>
                    <Input
                      value={r.ctaLabelOverride}
                      onChange={(e) => updateRow(idx, { ctaLabelOverride: e.target.value })}
                      placeholder="(use default)"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {saveError ? <span className="text-destructive text-sm">{saveError}</span> : null}
        {savedAt ? (
          <span className="text-muted-foreground text-xs">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        ) : null}
        <Button onClick={() => void save()} disabled={saving} className="ml-auto">
          {saving ? 'Saving…' : 'Save checkpoints'}
        </Button>
      </div>
    </section>
  );
}

// ─── Quick materials editor ──────────────────────────────────────────────────

function QuickMaterialsEditor() {
  const { user } = useAuth();
  const { data } = useFirestoreDoc<DashboardQuickMaterialsDoc>(QUICK_PATH);

  const [items, setItems] = useState<DashboardQuickMaterial[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useHydratedDraft(QUICK_PATH, data ?? null, (doc) => {
    setItems(doc.items);
  });

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
        doc(db, QUICK_PATH),
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
      <h2 className="text-foreground mb-3 text-base font-semibold">Quick materials</h2>
      <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
        Evergreen links shown in every staff member’s right rail. Paste Drive share URLs or any
        HTTPS link. Leave URL blank to render an informational chip with no click target.
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
      <div className="mt-3 flex items-center gap-2">
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
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save materials'}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── Shared toggle ───────────────────────────────────────────────────────────

function SwitchToggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
        on ? 'bg-ops-blue' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
