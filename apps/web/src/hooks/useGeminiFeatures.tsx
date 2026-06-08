import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DEFAULT_GEMINI_MODEL,
  type AppSettings,
  type GeminiFeatures,
} from '@ops/shared';
import { useFirestoreDoc } from './useFirestoreDoc';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

const DEFAULT_FEATURES: GeminiFeatures = {
  audioTranscription: { enabled: true, model: DEFAULT_GEMINI_MODEL },
  scriptAutoTag: { enabled: true, model: DEFAULT_GEMINI_MODEL },
};

/**
 * Normalises a raw `appSettings/global` doc into a complete `GeminiFeatures`.
 * Firestore reads bypass Zod defaults, so existing tenants may predate the
 * `gemini` field — treat any missing piece as the safe default (enabled).
 */
function resolveFeatures(data: AppSettings | null): GeminiFeatures {
  const features = data?.gemini as Partial<GeminiFeatures> | undefined;
  if (!features) return DEFAULT_FEATURES;
  return {
    audioTranscription: features.audioTranscription ?? DEFAULT_FEATURES.audioTranscription,
    scriptAutoTag: features.scriptAutoTag ?? DEFAULT_FEATURES.scriptAutoTag,
  };
}

const GeminiFeaturesContext = createContext<GeminiFeatures>(DEFAULT_FEATURES);

/**
 * Opens a single `/appSettings/global` listener and shares the resolved
 * Gemini feature config with every consumer below it. Previously each
 * consumer (ScriptEditor, AudioRecorder, …) called `useGeminiFeatures`
 * directly and opened its own duplicate snapshot listener; reading through
 * one provider collapses those into a single shared subscription.
 */
export function GeminiFeaturesProvider({ children }: { children: ReactNode }) {
  const { data } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  const value = useMemo(() => resolveFeatures(data), [data]);
  return <GeminiFeaturesContext value={value}>{children}</GeminiFeaturesContext>;
}

/**
 * Returns the Gemini feature config. Falls back to the safe defaults
 * (everything enabled, default model) when no provider is mounted or while
 * the settings doc is still loading — admins must explicitly opt in to
 * disabling a feature rather than the UI silently hiding things during a
 * brief snapshot gap.
 */
export function useGeminiFeatures(): GeminiFeatures {
  return useContext(GeminiFeaturesContext);
}
