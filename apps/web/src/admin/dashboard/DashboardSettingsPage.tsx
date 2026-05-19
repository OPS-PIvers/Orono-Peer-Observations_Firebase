import { useState } from 'react';
import { AlertCircle, Check, Eye, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { CycleStepsEditor } from './CycleStepsEditor';
import { DashboardPreview } from './DashboardPreview';
import { QuickMaterialsEditor } from './QuickMaterialsEditor';
import { SectionTilesEditor } from './SectionTilesEditor';
import { useDashboardDraft } from './useDashboardDraft';
import {
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SAVE_BUTTON_DEFAULT,
  SAVE_BUTTON_DIRTY,
  SAVE_BUTTON_SAVING,
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
 *   - Two-column body: tab content (60%), live preview (40%).
 *   - Single source of draft state via useDashboardDraft; one Save
 *     action persists everything.
 *
 * Mobile (< lg): preview collapses behind a toggle so the editor gets
 * the full width.
 */

export function DashboardSettingsPage() {
  const draft = useDashboardDraft();
  const [tab, setTab] = useState<TabKey>('layout');
  const [showPreviewMobile, setShowPreviewMobile] = useState(false);

  const saveLabel = draft.saving
    ? SAVE_BUTTON_SAVING
    : draft.isDirty
      ? SAVE_BUTTON_DIRTY
      : SAVE_BUTTON_DEFAULT;

  return (
    <PageHeader title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
        <TabButton active={tab === 'layout'} onClick={() => setTab('layout')}>
          {TABS.layout}
        </TabButton>
        <TabButton active={tab === 'steps'} onClick={() => setTab('steps')}>
          {TABS.steps}
        </TabButton>
        <TabButton active={tab === 'materials'} onClick={() => setTab('materials')}>
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
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-2 text-sm">
          {draft.saveError}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className={cn(showPreviewMobile && 'hidden lg:block')}>
          {tab === 'layout' ? (
            <SectionTilesEditor value={draft.draft.sections} onChange={draft.setSections} />
          ) : null}
          {tab === 'steps' ? (
            <CycleStepsEditor value={draft.draft.checkpoints} onChange={draft.setCheckpoints} />
          ) : null}
          {tab === 'materials' ? (
            <QuickMaterialsEditor
              value={draft.draft.quickMaterials}
              onChange={draft.setQuickMaterials}
            />
          ) : null}
        </div>
        <div
          className={cn(
            !showPreviewMobile && 'hidden lg:block',
            'lg:sticky lg:top-24 lg:h-[calc(100vh-160px)]',
          )}
        >
          <DashboardPreview
            sections={draft.draft.sections}
            checkpoints={draft.draft.checkpoints}
            quickMaterials={draft.draft.quickMaterials}
          />
        </div>
      </div>
    </PageHeader>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-ops-blue text-white' : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
