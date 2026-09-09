import { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Eye, EyeOff } from 'lucide-react';
import { COLLECTIONS, DRAFT_VISIBILITY_HIDDEN, type DraftVisibility } from '@ops/shared';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

type VisibilityKey = keyof DraftVisibility;

const ROWS: { key: VisibilityKey; label: string; hint: string }[] = [
  { key: 'ratings', label: 'Proficiency selections', hint: 'Which level you picked per component' },
  { key: 'notes', label: 'Component notes', hint: 'Your manual notes under each component' },
  { key: 'evidence', label: 'Evidence links', hint: 'Drive files attached to components' },
  { key: 'script', label: 'Script', hint: 'The live observation script and its tags' },
  { key: 'meetingNotes', label: 'Meeting notes', hint: 'Your Planning / Reflection notes' },
];

export interface SharingPopoverProps {
  observationId: string;
  /** Live value from the observation doc; the switches reflect it. */
  value: DraftVisibility | undefined;
}

/**
 * Evaluator-only switchboard for what the observed staff member can see on
 * a Draft. All off by default, per observation, no saved preference —
 * a default configured once and forgotten would surprise someone months
 * later. Writes straight to the doc so the teacher's open tab updates live.
 *
 * Display control only: the teacher's browser already holds the whole doc
 * (rules gate documents, not fields), so this stops the data rendering,
 * not the data arriving. On finalize everything is visible regardless.
 */
export function SharingPopover({ observationId, value }: SharingPopoverProps) {
  const [pending, setPending] = useState<Partial<DraftVisibility>>({});
  const [error, setError] = useState<string | null>(null);
  const effective: DraftVisibility = { ...DRAFT_VISIBILITY_HIDDEN, ...value, ...pending };
  const sharedCount = ROWS.filter((r) => effective[r.key]).length;

  async function toggle(key: VisibilityKey, next: boolean) {
    setPending((p) => ({ ...p, [key]: next }));
    try {
      await updateDoc(doc(db, COLLECTIONS.observations, observationId), {
        draftVisibility: { ...effective, [key]: next },
        lastModifiedAt: serverTimestamp(),
      });
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)));
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="border-ops-blue-lighter text-ops-blue-dark hover:bg-ops-blue-lighter/40 h-9 px-3 font-semibold"
          aria-label={`Sharing: ${String(sharedCount)} of ${String(ROWS.length)} shared with the observed staff member`}
        >
          {sharedCount > 0 ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          Sharing
          <span className="text-muted-foreground font-normal">
            {sharedCount}/{ROWS.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-ops-blue-dark text-sm font-semibold">
            Shared with the observed staff member
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            They always see the rubric criteria and their own questions. Everything below becomes
            visible when you finalize.
          </p>
        </div>
        <ul className="space-y-2.5">
          {ROWS.map((row) => {
            const id = `sharing-${row.key}`;
            return (
              <li key={row.key} className="flex items-start justify-between gap-3">
                <label htmlFor={id} className="min-w-0 cursor-pointer">
                  <span className="block text-sm font-medium">{row.label}</span>
                  <span className="text-muted-foreground block text-xs">{row.hint}</span>
                </label>
                <Switch
                  id={id}
                  checked={effective[row.key]}
                  disabled={row.key in pending}
                  onCheckedChange={(next) => void toggle(row.key, next)}
                />
              </li>
            );
          })}
        </ul>
        {error ? (
          <p className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-xs">
            Could not update sharing: {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
