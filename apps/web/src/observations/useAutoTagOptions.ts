import { useEffect, useState } from 'react';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DEFAULT_SCRIPT_AUTO_TAG_OPTIONS,
  clampScriptAutoTagOptions,
  parseScriptAutoTagOptions,
  resolveScriptAutoTagControls,
  type AppSettings,
  type AutoTagComponentFocus,
  type ScriptAutoTagControls,
  type ScriptAutoTagOptions,
} from '@ops/shared';
import type { AssignmentMode } from '@/components/rubric';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

/** Which auto-tag options the admin lets observers pick (all on until loaded). */
export function useScriptAutoTagControls(): ScriptAutoTagControls {
  const { data } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  return resolveScriptAutoTagControls(data?.scriptAutoTagControls);
}

const STORAGE_KEY = 'ops.scriptAutoTagOptions';

function readStored(): Partial<ScriptAutoTagOptions> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ScriptAutoTagOptions>) : null;
  } catch {
    return null;
  }
}

function writeStored(options: ScriptAutoTagOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Private windows and blocked storage: the options just aren't remembered.
  }
}

/** The component focus that matches the editor's Assigned / Full Rubric toggle. */
function focusForScope(
  scope: AssignmentMode,
  current: AutoTagComponentFocus,
): AutoTagComponentFocus {
  if (scope === 'assigned') return 'assigned';
  return current === 'assigned' ? 'full' : current;
}

/**
 * The observer's auto-tag options, remembered in this browser. The component
 * focus follows the editor's Assigned / Full Rubric toggle whenever that
 * changes, and can be overridden from the options menu in between. Anything
 * the admin has turned off reads as the nearest allowed choice (the server
 * applies the same clamp).
 */
export function useAutoTagOptions(
  tagScope: AssignmentMode,
  controls: ScriptAutoTagControls,
): [ScriptAutoTagOptions, (next: ScriptAutoTagOptions) => void] {
  const [options, setOptions] = useState<ScriptAutoTagOptions>(() => {
    const stored = parseScriptAutoTagOptions(readStored() ?? DEFAULT_SCRIPT_AUTO_TAG_OPTIONS);
    return { ...stored, components: focusForScope(tagScope, stored.components) };
  });

  useEffect(() => {
    setOptions((prev) => ({ ...prev, components: focusForScope(tagScope, prev.components) }));
  }, [tagScope]);

  function update(next: ScriptAutoTagOptions) {
    setOptions(next);
    writeStored(next);
  }

  return [clampScriptAutoTagOptions(options, controls), update];
}
