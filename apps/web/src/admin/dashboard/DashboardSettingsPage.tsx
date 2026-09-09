import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Eye, GripVertical, RotateCcw } from 'lucide-react';
import { where } from 'firebase/firestore';
import { COLLECTIONS, type Building, type ModuleDoc, type Role, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { CycleStepsEditor } from './CycleStepsEditor';
import { DashboardPreview } from './DashboardPreview';
import { QuickMaterialsEditor } from './QuickMaterialsEditor';
import { SectionTilesEditor } from './SectionTilesEditor';
import { useDashboardDraft } from './useDashboardDraft';
import { useSplitter } from './useSplitter';
import { type AudienceOptions } from './audienceOptions';
import {
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SAVE_BUTTON_DEFAULT,
  SAVE_BUTTON_DIRTY,
  SAVE_BUTTON_SAVING,
  SPLITTER_LABEL,
  TABS,
  UNSAVED_PILL,
  type TabKey,
} from './copyStrings';

/**
 * /admin/dashboard — the redesigned config surface.
 *
 * Layout:
 *   - Sticky chrome: tabs on the left, Save / Discard / unsaved-pill on
 *     the right.
 *   - Two-pane body with a draggable splitter. Default 60% editor /
 *     40% preview; the admin's last position is remembered per browser
 *     (see useSplitter). The splitter sets width only.
 *   - One scrollbar. The editor column scrolls with the page; the
 *     preview is sticky and scrolls inside its own frame. The editor
 *     deliberately has no nested `overflow-y-auto` — that second
 *     scroller is what made fields slide out from under the cursor.
 *   - Single source of draft state via useDashboardDraft; one Save
 *     action validates, then persists everything. A refused save jumps
 *     to the tab holding the first offending field.
 *
 * Mobile (< lg): preview collapses behind a toggle so the editor gets
 * the full width; the splitter is not rendered.
 */

// Equality-only filters (no orderBy) so these small admin collections
// don't need composite indexes; sorted client-side below.
const ACTIVE_ONLY = [where('isActive', '==', true)];

const byDisplayName = <T extends { displayName: string }>(a: T, b: T) =>
  a.displayName.localeCompare(b.displayName);

export function DashboardSettingsPage() {
  const draft = useDashboardDraft();

  // The audience picker offers the live roles/buildings/modules and counts
  // matches against the staff roster. Loaded here, once, rather than per
  // card. Active-only lists: a retired role is not something a new rule
  // should be able to target, and a chip already naming one is surfaced
  // as stale by the picker instead.
  const { data: rolesRaw } = useFirestoreCollection<Role>(COLLECTIONS.roles, ACTIVE_ONLY);
  const { data: buildingsRaw } = useFirestoreCollection<Building>(
    COLLECTIONS.buildings,
    ACTIVE_ONLY,
  );
  const { data: modulesRaw } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules, ACTIVE_ONLY);
  const { data: staffRoster } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const audienceOptions = useMemo<AudienceOptions>(
    () => ({
      roles: (rolesRaw ?? []).slice().sort(byDisplayName),
      buildings: (buildingsRaw ?? []).slice().sort(byDisplayName),
      modules: (modulesRaw ?? []).slice().sort(byDisplayName),
    }),
    [rolesRaw, buildingsRaw, modulesRaw],
  );

  const [tab, setTab] = useState<TabKey>('layout');
  const [showPreviewMobile, setShowPreviewMobile] = useState(false);
  // Destructured so the react-hooks/refs rule can see that only the ref
  // object itself (not `.current`) is touched during render.
  const {
    fraction: editorFraction,
    dragging: splitterDragging,
    containerRef: splitRowRef,
    handleProps: splitterHandleProps,
  } = useSplitter();

  const saveLabel = draft.saving
    ? SAVE_BUTTON_SAVING
    : draft.isDirty
      ? SAVE_BUTTON_DIRTY
      : SAVE_BUTTON_DEFAULT;

  const errorsByTab = {
    layout: draft.validationErrors.filter((e) => e.tab === 'layout'),
    steps: draft.validationErrors.filter((e) => e.tab === 'steps'),
    materials: draft.validationErrors.filter((e) => e.tab === 'materials'),
  };

  // A refused save lands the admin on the tab holding the first problem.
  // Keyed on the array identity: the hook replaces it on every refused save
  // and clears it on the next edit, so this fires once per refusal.
  const firstErrorTab = draft.validationErrors[0]?.tab;
  useEffect(() => {
    if (firstErrorTab) setTab(firstErrorTab);
  }, [firstErrorTab, draft.validationErrors]);

  return (
    <PageHeader
      title={PAGE_TITLE}
      subtitle={PAGE_SUBTITLE}
      variant="light"
      breadcrumb={['Admin', 'Dashboard']}
    >
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
        <TabButton
          active={tab === 'layout'}
          onClick={() => setTab('layout')}
          errorCount={errorsByTab.layout.length}
        >
          {TABS.layout}
        </TabButton>
        <TabButton
          active={tab === 'steps'}
          onClick={() => setTab('steps')}
          errorCount={errorsByTab.steps.length}
        >
          {TABS.steps}
        </TabButton>
        <TabButton
          active={tab === 'materials'}
          onClick={() => setTab('materials')}
          errorCount={errorsByTab.materials.length}
        >
          {TABS.materials}
        </TabButton>
        <div className="ml-auto flex items-center gap-3">
          {draft.isDirty ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              <AlertCircle className="h-3 w-3" />
              {UNSAVED_PILL}
            </span>
          ) : draft.savedAt ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Check className="h-3 w-3 text-green-600" />
              Saved at {draft.savedAt.toLocaleTimeString()}
            </span>
          ) : null}
          {draft.isDirty ? (
            <Button variant="ghost" size="sm" onClick={draft.reset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Discard
            </Button>
          ) : null}
          <Button
            onClick={() => void draft.save()}
            disabled={!draft.isDirty || draft.saving}
            size="sm"
          >
            {saveLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreviewMobile((v) => !v)}
            className="lg:hidden"
            aria-label="Toggle preview"
          >
            <Eye className="mr-1 h-3.5 w-3.5" />
            {showPreviewMobile ? 'Hide preview' : 'Show preview'}
          </Button>
        </div>
      </div>

      {draft.saveError ? (
        <div
          role="alert"
          className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-2 text-sm"
        >
          {draft.saveError}
        </div>
      ) : null}

      {/* Two-pane body. On lg+ the panes are sized by the splitter fraction;
          below lg they stack and the mobile toggle picks which one shows. */}
      <div
        ref={splitRowRef}
        className={cn(
          'flex flex-col gap-6 lg:flex-row lg:gap-0',
          splitterDragging && 'select-none',
        )}
      >
        <div
          className={cn(showPreviewMobile && 'hidden lg:block', 'min-w-0 lg:pr-3')}
          style={{ flexBasis: `${String(editorFraction * 100)}%` }}
          data-testid="dashboard-editor-pane"
        >
          {tab === 'layout' ? (
            <SectionTilesEditor
              value={draft.draft.sections}
              onChange={draft.setSections}
              cycleCloseLabel={draft.draft.cycleCloseLabel}
              onCycleCloseLabelChange={draft.setCycleCloseLabel}
              errors={errorsByTab.layout}
            />
          ) : null}
          {tab === 'steps' ? (
            <CycleStepsEditor
              value={draft.draft.steps}
              onChange={draft.setSteps}
              errors={errorsByTab.steps}
            />
          ) : null}
          {tab === 'materials' ? (
            <QuickMaterialsEditor
              value={draft.draft.quickMaterials}
              onChange={draft.setQuickMaterials}
              errors={errorsByTab.materials}
              audienceOptions={audienceOptions}
              staffRoster={staffRoster}
            />
          ) : null}
        </div>

        {/* Drag handle — desktop only. Keyboard: ← → nudge, Home/End
            snap to the clamps, double-click resets to the default. */}
        <div
          {...splitterHandleProps}
          aria-label={SPLITTER_LABEL}
          title={SPLITTER_LABEL}
          className={cn(
            'group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center lg:flex',
            'focus-visible:ring-ring rounded outline-none focus-visible:ring-2',
          )}
        >
          <div
            className={cn(
              'flex w-1 items-center justify-center rounded-full transition-colors',
              splitterDragging ? 'bg-ops-blue' : 'bg-border group-hover:bg-ops-blue/60',
            )}
          >
            <GripVertical
              className={cn(
                'text-muted-foreground h-4 w-4 shrink-0 rounded bg-white',
                'group-hover:text-ops-blue',
              )}
            />
          </div>
        </div>

        <div
          className={cn(
            !showPreviewMobile && 'hidden lg:block',
            'min-w-0 flex-1 lg:sticky lg:top-24 lg:h-[calc(100vh-180px)] lg:self-start',
          )}
          data-testid="dashboard-preview-pane"
        >
          <DashboardPreview
            sections={draft.draft.sections}
            steps={draft.draft.steps}
            quickMaterials={draft.draft.quickMaterials}
            cycleCloseLabel={draft.draft.cycleCloseLabel}
            audienceOptions={audienceOptions}
          />
        </div>
      </div>
    </PageHeader>
  );
}

function TabButton({
  active,
  onClick,
  errorCount = 0,
  children,
}: {
  active: boolean;
  onClick: () => void;
  errorCount?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-ops-blue text-white' : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
      {errorCount > 0 ? (
        <span
          aria-label={`${String(errorCount)} ${errorCount === 1 ? 'problem' : 'problems'}`}
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold',
            active ? 'text-ops-red-dark bg-white' : 'bg-ops-red-dark text-white',
          )}
        >
          {errorCount}
        </span>
      ) : null}
    </button>
  );
}
