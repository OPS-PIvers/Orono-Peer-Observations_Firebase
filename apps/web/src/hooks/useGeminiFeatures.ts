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
 * Reads `/appSettings/global` and returns the Gemini feature config.
 *
 * Returns the safe defaults (everything enabled, default model) while the
 * doc is loading or if the field is missing — admins should explicitly opt
 * in to disabling a feature in the Settings page rather than the UI
 * silently hiding things during a brief snapshot gap.
 */
export function useGeminiFeatures(): GeminiFeatures {
  const { data } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  // Cast to Partial because Firestore docs predate the gemini field for
  // existing tenants — the Zod default fires only on parse, not on raw
  // Firestore reads. Treat any missing piece as "use the safe default".
  const features = data?.gemini as Partial<GeminiFeatures> | undefined;
  if (!features) return DEFAULT_FEATURES;
  return {
    audioTranscription: features.audioTranscription ?? DEFAULT_FEATURES.audioTranscription,
    scriptAutoTag: features.scriptAutoTag ?? DEFAULT_FEATURES.scriptAutoTag,
  };
}
