import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import {
  PROFICIENCY_LEVELS,
  type ComponentColor,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
} from '@ops/shared';
import { colorFor } from '@/observations/component-colors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  PROFICIENCY_LABELS,
  RUBRIC_GRID_COLS,
  RUBRIC_GRID_MIN_W,
} from '@/components/rubric/RubricGrid';

const DOMAIN_ACCENTS: Record<string, string> = {
  '1': 'border-l-ops-blue',
  '2': 'border-l-ops-red',
  '3': 'border-l-ops-blue-light',
  '4': 'border-l-ops-red-light',
};

interface DraftRubric extends Rubric {
  domains: RubricDomain[];
}

export interface RubricGridEditorProps {
  draft: DraftRubric;
  onUpdateDomain: (domainId: string, patch: Partial<Omit<RubricDomain, 'components'>>) => void;
  onAddDomain: () => void;
  onAddComponent: (domainId: string) => void;
  onUpdateComponent: (componentId: string, patch: Partial<RubricComponent>) => void;
  onRemoveComponent: (componentId: string) => void;
  onAddLookFor: (componentId: string) => void;
  onUpdateLookFor: (componentId: string, lookForId: string, text: string) => void;
  onRemoveLookFor: (componentId: string, lookForId: string) => void;
}

export function RubricGridEditor({
  draft,
  onUpdateDomain,
  onAddDomain,
  onAddComponent,
  onUpdateComponent,
  onRemoveComponent,
  onAddLookFor,
  onUpdateLookFor,
  onRemoveLookFor,
}: RubricGridEditorProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(componentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {draft.domains.map((domain) => (
        <DomainEditorSection
          key={domain.id}
          domain={domain}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          onUpdateDomain={(patch) => onUpdateDomain(domain.id, patch)}
          onAddComponent={() => onAddComponent(domain.id)}
          onUpdateComponent={onUpdateComponent}
          onRemoveComponent={onRemoveComponent}
          onAddLookFor={onAddLookFor}
          onUpdateLookFor={onUpdateLookFor}
          onRemoveLookFor={onRemoveLookFor}
        />
      ))}

      <Button variant="outline" onClick={onAddDomain}>
        <Plus className="h-4 w-4" />
        Add domain
      </Button>
    </div>
  );
}

interface DomainEditorSectionProps {
  domain: RubricDomain;
  expanded: Set<string>;
  onToggleExpanded: (componentId: string) => void;
  onUpdateDomain: (patch: Partial<Omit<RubricDomain, 'components'>>) => void;
  onAddComponent: () => void;
  onUpdateComponent: (componentId: string, patch: Partial<RubricComponent>) => void;
  onRemoveComponent: (componentId: string) => void;
  onAddLookFor: (componentId: string) => void;
  onUpdateLookFor: (componentId: string, lookForId: string, text: string) => void;
  onRemoveLookFor: (componentId: string, lookForId: string) => void;
}

function DomainEditorSection({
  domain,
  expanded,
  onToggleExpanded,
  onUpdateDomain,
  onAddComponent,
  onUpdateComponent,
  onRemoveComponent,
  onAddLookFor,
  onUpdateLookFor,
  onRemoveLookFor,
}: DomainEditorSectionProps) {
  const accentClass = DOMAIN_ACCENTS[domain.id] ?? 'border-l-ops-blue';

  return (
    <section className={cn('overflow-hidden rounded-lg border border-gray-200 shadow-sm')}>
      {/* Domain header — mirrors consumer DomainSection styling but with
          an editable domain-name input. */}
      <div className={cn('bg-ops-blue-dark border-l-4', accentClass)}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
          >
            {domain.id}
          </span>
          <Label htmlFor={`domain-name-${domain.id}`} className="sr-only">
            Domain {domain.id} name
          </Label>
          <Input
            id={`domain-name-${domain.id}`}
            value={domain.name}
            onChange={(e) => onUpdateDomain({ name: e.target.value })}
            placeholder={`Domain ${domain.id} name`}
            className="font-heading h-9 border-white/20 bg-white/10 text-base font-semibold text-white placeholder:text-white/50 focus-visible:border-white/60 focus-visible:ring-white/40"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Column headers */}
        <div className={cn('bg-ops-blue grid', RUBRIC_GRID_MIN_W, RUBRIC_GRID_COLS)}>
          <div className="font-heading border-r border-white/20 px-3 py-2 text-[11px] font-semibold tracking-widest text-white/80 uppercase">
            Component
          </div>
          {PROFICIENCY_LEVELS.map((level) => (
            <div
              key={level}
              className={cn(
                'border-r border-white/20 px-3 py-2 last:border-r-0',
                'font-heading text-[11px] font-semibold tracking-widest uppercase',
                level === 'proficient' || level === 'distinguished'
                  ? 'text-white'
                  : 'text-white/80',
              )}
            >
              {PROFICIENCY_LABELS[level]}
            </div>
          ))}
        </div>

        {/* Component rows */}
        <div className={cn(RUBRIC_GRID_MIN_W, 'divide-y divide-gray-200 bg-white')}>
          {domain.components.map((component) => (
            <ComponentRow
              key={component.id}
              component={component}
              expanded={expanded.has(component.id)}
              onToggleExpanded={() => onToggleExpanded(component.id)}
              onPatch={(patch) => onUpdateComponent(component.id, patch)}
              onRemove={() => onRemoveComponent(component.id)}
              onAddLookFor={() => onAddLookFor(component.id)}
              onUpdateLookFor={(lookForId, text) => onUpdateLookFor(component.id, lookForId, text)}
              onRemoveLookFor={(lookForId) => onRemoveLookFor(component.id, lookForId)}
            />
          ))}
        </div>

        {/* Add-component footer (full grid width) */}
        <div className={cn(RUBRIC_GRID_MIN_W, 'border-t border-gray-200 bg-gray-50 px-3 py-2')}>
          <Button variant="ghost" size="sm" onClick={onAddComponent}>
            <Plus className="h-4 w-4" />
            Add component
          </Button>
        </div>
      </div>
    </section>
  );
}

interface ComponentRowProps {
  component: RubricComponent;
  expanded: boolean;
  onToggleExpanded: () => void;
  onPatch: (patch: Partial<RubricComponent>) => void;
  onRemove: () => void;
  onAddLookFor: () => void;
  onUpdateLookFor: (lookForId: string, text: string) => void;
  onRemoveLookFor: (lookForId: string) => void;
}

function ComponentRow({
  component,
  expanded,
  onToggleExpanded,
  onPatch,
  onRemove,
  onAddLookFor,
  onUpdateLookFor,
  onRemoveLookFor,
}: ComponentRowProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div>
      {/* Data row */}
      <div className={cn('grid', RUBRIC_GRID_COLS)}>
        {/* Component label cell */}
        <div className="flex flex-col gap-1.5 border-r border-gray-200 p-2">
          <span className="text-muted-foreground font-mono text-[11px] tracking-wide">
            Component {component.id}
          </span>
          <Input
            value={component.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder="Component title"
            className="h-8 text-sm font-medium"
          />
          <ColorSwatchRow
            component={component}
            onChange={(color) => onPatch({ color })}
            onReset={() => onPatch({ color: undefined })}
          />
          <div className="mt-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpanded}
              className="h-7 px-2 text-xs"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Details
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConfirmingDelete(true)}
              className="text-destructive h-7 w-7"
              aria-label={`Delete component ${component.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Proficiency descriptor cells */}
        {PROFICIENCY_LEVELS.map((level) => (
          <div key={level} className="border-r border-gray-200 p-2 last:border-r-0">
            <Label htmlFor={`prof-${component.id}-${level}`} className="sr-only">
              {PROFICIENCY_LABELS[level]} descriptor for component {component.id}
            </Label>
            <Textarea
              id={`prof-${component.id}-${level}`}
              value={component.proficiencyLevels[level]}
              onChange={(e) =>
                onPatch({
                  proficiencyLevels: {
                    ...component.proficiencyLevels,
                    [level]: e.target.value,
                  },
                })
              }
              rows={5}
              className="h-full min-h-[120px] resize-y text-sm"
              placeholder={`${PROFICIENCY_LABELS[level]} descriptor`}
            />
          </div>
        ))}
      </div>

      {/* Expandable detail strip — look-fors. Spans the full grid width
          via the parent's min-w. */}
      {expanded && (
        <div className="space-y-4 border-t border-gray-200 bg-gray-50 px-4 py-4">
          <fieldset className="space-y-2">
            <div className="flex items-center justify-between">
              <legend className="text-sm font-medium">Look-fors</legend>
              <Button variant="outline" size="sm" onClick={onAddLookFor} type="button">
                <Plus className="h-4 w-4" />
                Add look-for
              </Button>
            </div>
            {component.lookFors.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No look-fors yet. Click &ldquo;Add look-for&rdquo; to define observable behaviors
                evaluators can check during an observation.
              </p>
            ) : (
              <ul className="space-y-2">
                {component.lookFors.map((lf) => (
                  <li key={lf.id} className="flex items-start gap-2">
                    <Input
                      value={lf.text}
                      onChange={(e) => onUpdateLookFor(lf.id, e.target.value)}
                      placeholder="Look-for text"
                      className="bg-white"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveLookFor(lf.id)}
                      aria-label="Remove look-for"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </div>
      )}

      {/* Delete-confirmation row (full width) */}
      {confirmingDelete && (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark space-y-2 border-t border-l-4 px-4 py-3 text-sm">
          <p>
            Delete component <strong>{component.id}</strong>? Existing observations referencing it
            will keep the data but evaluators won&apos;t see it on the rubric anymore.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={onRemove}>
              Yes, delete
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Per-component color swatches. The script editor's tag mark and side-panel
 * buttons read this so each component has a distinct highlight color. When
 * `component.color` is unset, `colorFor()` returns a deterministic fallback
 * derived from the component id; the live preview chip below the inputs
 * shows whatever color the script editor will actually use.
 */
function ColorSwatchRow({
  component,
  onChange,
  onReset,
}: {
  component: RubricComponent;
  onChange: (color: ComponentColor) => void;
  onReset: () => void;
}) {
  const resolved = colorFor(component);
  const explicit = component.color;
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px]"
        style={{ backgroundColor: resolved.bg, color: resolved.fg }}
        aria-label="Tag color preview"
        title="Tag color preview"
      >
        {component.id}
      </span>
      <label className="flex items-center gap-1 text-[10px] text-gray-500">
        Bg
        <input
          type="color"
          value={resolved.bg}
          onChange={(e) => onChange({ bg: e.target.value, fg: resolved.fg })}
          className="h-5 w-6 cursor-pointer rounded border border-gray-300"
          aria-label="Background color"
        />
      </label>
      <label className="flex items-center gap-1 text-[10px] text-gray-500">
        Fg
        <input
          type="color"
          value={resolved.fg}
          onChange={(e) => onChange({ bg: resolved.bg, fg: e.target.value })}
          className="h-5 w-6 cursor-pointer rounded border border-gray-300"
          aria-label="Text color"
        />
      </label>
      {explicit ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="h-6 px-1.5 text-[10px] text-gray-500"
          type="button"
        >
          Reset
        </Button>
      ) : (
        <span className="text-[10px] text-gray-400">auto</span>
      )}
    </div>
  );
}
