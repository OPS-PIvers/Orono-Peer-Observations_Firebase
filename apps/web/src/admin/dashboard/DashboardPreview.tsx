import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type DashboardQuickMaterial,
  type DashboardSectionsConfig,
  type DashboardStep,
} from '@ops/shared';
import { DashboardView } from '@/dashboard/DashboardView';
import { Eye } from 'lucide-react';
import {
  SAMPLE_BUILDING_NAMES,
  SAMPLE_FIRST_NAME,
  SAMPLE_MODULE_CHIPS,
  SAMPLE_PEER_EVALUATOR,
  SAMPLE_ROLE_DISPLAY_NAME,
  SAMPLE_STAFF,
  SAMPLE_YEAR_TIER_LABEL,
  buildSampleCheckpoints,
} from './previewSampleData';

/**
 * Right-column live preview. Renders <DashboardView> with the admin's
 * *draft* sections/checkpoints/quick-materials plus a synthesized sample
 * staff member so the preview always reflects what a typical user sees
 * throughout the year — independent of whether the current admin has any
 * active observations of their own.
 *
 * Read-only: no Acknowledge action, no outbound links.
 */

export interface DashboardPreviewProps {
  sections: DashboardSectionsConfig;
  steps: DashboardStep[];
  quickMaterials: DashboardQuickMaterial[];
  cycleCloseLabel: string;
}

export function DashboardPreview({
  sections,
  steps,
  quickMaterials,
  cycleCloseLabel,
}: DashboardPreviewProps) {
  const tasks = useMemo(() => buildSampleCheckpoints(steps), [steps]);

  return (
    <PreviewFrame>
      <DashboardView
        staff={SAMPLE_STAFF}
        firstName={SAMPLE_FIRST_NAME}
        yearTierLabel={SAMPLE_YEAR_TIER_LABEL}
        cycleYearLabel="2025 — 2026"
        cycleCloseLabel={cycleCloseLabel}
        sections={sections}
        tasks={tasks}
        quickMaterials={quickMaterials}
        peerEvaluator={SAMPLE_PEER_EVALUATOR}
        readOnly
        roleDisplayName={SAMPLE_ROLE_DISPLAY_NAME}
        buildingNames={SAMPLE_BUILDING_NAMES}
        moduleChips={SAMPLE_MODULE_CHIPS}
      />
    </PreviewFrame>
  );
}

/**
 * Chrome around the live preview: header banner + zoomable viewport.
 *
 * The inner dashboard is locked to its natural 1240px design width so the
 * staff layout doesn't trigger its single-column responsive media query
 * inside this small column. CSS `zoom` (rather than `transform: scale`)
 * shrinks both the visual and the box, so the wrapping container reports
 * the correct height to the scroll container and no horizontal ghost
 * area lingers.
 *
 * Scale is computed from the wrapper's actual rendered width via
 * ResizeObserver so the preview tracks the column as the viewport resizes.
 * `scrollbar-gutter: stable` reserves the scrollbar's column so toggling
 * sections doesn't change the wrapper width and trigger a zoom feedback
 * loop.
 */
const NATURAL_WIDTH = 1240;

function PreviewFrame({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const target = wrapperRef.current;
    const applyWidth = (w: number) => {
      if (w <= 0) return;
      setScale(Math.max(0.3, Math.min(1, w / NATURAL_WIDTH)));
    };
    applyWidth(target.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyWidth(entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="bg-ops-blue-lighter/50 border-border flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
        <Eye className="text-ops-blue h-4 w-4" />
        <span className="text-ops-blue-dark">Preview — what staff see</span>
        <span className="text-muted-foreground ml-auto font-normal">Sample data</span>
      </div>
      <div
        ref={wrapperRef}
        className="flex-1 overflow-x-hidden overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div style={{ zoom: scale, width: `${String(NATURAL_WIDTH)}px` }}>{children}</div>
      </div>
    </div>
  );
}
