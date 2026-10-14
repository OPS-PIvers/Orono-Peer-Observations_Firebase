import type {
  AutoTagComponentFocus,
  AutoTagDetail,
  ScriptAutoTagControls,
  ScriptAutoTagOptions,
} from '@ops/shared';
import { Checkbox } from '@/components/ui/checkbox';

/** Whether the options menu has anything to choose at all. */
export function hasAutoTagChoices(controls: ScriptAutoTagControls): boolean {
  const count = (flags: Record<string, boolean>) => Object.values(flags).filter(Boolean).length;
  return count(controls.components) > 1 || count(controls.detail) > 1 || controls.rationale;
}

const COMPONENT_CHOICES: { value: AutoTagComponentFocus; label: string; hint: string }[] = [
  { value: 'assigned', label: 'Assigned only', hint: 'Tag only the assigned components.' },
  {
    value: 'preferAssigned',
    label: 'Full rubric, prefer assigned',
    hint: 'Tag anything, but when evidence fits several, pick the assigned one.',
  },
  { value: 'full', label: 'Full rubric', hint: 'Every component weighed equally.' },
];

const DETAIL_CHOICES: { value: AutoTagDetail; label: string; hint: string }[] = [
  { value: 'key', label: 'Key evidence only', hint: 'A few of the strongest moments.' },
  { value: 'balanced', label: 'Balanced', hint: 'Clear evidence, skipping anything ambiguous.' },
  { value: 'thorough', label: 'Thorough', hint: 'Smaller moments too. More to review.' },
];

export interface AutoTagOptionsFieldsProps {
  value: ScriptAutoTagOptions;
  onChange: (next: ScriptAutoTagOptions) => void;
  disabled?: boolean;
  /** Keeps radio names and ids unique when two copies are mounted. */
  idPrefix: string;
  /** Only the choices the admin allows are shown. */
  controls: ScriptAutoTagControls;
}

/** Radio groups for focus and detail, and the "explain each tag" checkbox. */
export function AutoTagOptionsFields({
  value,
  onChange,
  disabled = false,
  idPrefix,
  controls,
}: AutoTagOptionsFieldsProps) {
  const componentChoices = COMPONENT_CHOICES.filter((c) => controls.components[c.value]);
  const detailChoices = DETAIL_CHOICES.filter((d) => controls.detail[d.value]);
  return (
    <div className="space-y-3 text-sm">
      {componentChoices.length > 1 ? (
        <fieldset className="space-y-1" disabled={disabled}>
          <legend className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            Components
          </legend>
          {componentChoices.map((choice) => (
            <RadioRow
              key={choice.value}
              name={`${idPrefix}-components`}
              id={`${idPrefix}-components-${choice.value}`}
              checked={value.components === choice.value}
              onSelect={() => onChange({ ...value, components: choice.value })}
              label={choice.label}
              hint={choice.hint}
            />
          ))}
        </fieldset>
      ) : null}
      {detailChoices.length > 1 ? (
        <fieldset className="space-y-1" disabled={disabled}>
          <legend className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            Detail
          </legend>
          {detailChoices.map((choice) => (
            <RadioRow
              key={choice.value}
              name={`${idPrefix}-detail`}
              id={`${idPrefix}-detail-${choice.value}`}
              checked={value.detail === choice.value}
              onSelect={() => onChange({ ...value, detail: choice.value })}
              label={choice.label}
              hint={choice.hint}
            />
          ))}
        </fieldset>
      ) : null}
      {controls.rationale ? (
        <label
          htmlFor={`${idPrefix}-rationale`}
          className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5"
        >
          <Checkbox
            id={`${idPrefix}-rationale`}
            className="mt-0.5"
            checked={value.rationale}
            onChange={() => onChange({ ...value, rationale: !value.rationale })}
            disabled={disabled}
          />
          <span>
            <span className="block">Explain each tag</span>
            <span className="text-muted-foreground block text-xs">
              A one-line reason under each suggestion.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

function RadioRow({
  name,
  id,
  checked,
  onSelect,
  label,
  hint,
}: {
  name: string;
  id: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      htmlFor={id}
      className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5"
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onSelect}
        className="accent-ops-blue mt-1 h-4 w-4 shrink-0"
      />
      <span>
        {label}
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </label>
  );
}
