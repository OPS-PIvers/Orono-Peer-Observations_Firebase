import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  canUseGeminiFeature,
  resolveGeminiFeature,
  type AppSettings,
  type GeminiFeatureKey,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from './useFirestoreDoc';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

export type GeminiAccessMap = Record<GeminiFeatureKey, boolean>;

/**
 * Whether the signed-in user may see and use each Gemini feature, per the
 * off / beta / all setting in `/appSettings/global`.
 *
 * Everything reads as unavailable until the settings doc has loaded. These
 * features cost money per call and an admin may have them off, so a control
 * appearing a beat late is the right failure — not one flashing up for
 * everyone and then vanishing.
 */
export function useGeminiAccess(): GeminiAccessMap {
  const { data } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  const { user } = useAuth();
  const email = user?.email ?? null;
  // Firestore docs predate the access field for existing tenants, so read
  // through resolveGeminiFeature rather than trusting the inferred type.
  const gemini = data?.gemini as Partial<Record<GeminiFeatureKey, unknown>> | undefined;
  if (!data) return { audioTranscription: false, scriptAutoTag: false };
  return {
    audioTranscription: canUseGeminiFeature(
      resolveGeminiFeature(gemini?.audioTranscription),
      email,
    ),
    scriptAutoTag: canUseGeminiFeature(resolveGeminiFeature(gemini?.scriptAutoTag), email),
  };
}
