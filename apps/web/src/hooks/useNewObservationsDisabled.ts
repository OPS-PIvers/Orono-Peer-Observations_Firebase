import { APP_SETTINGS_DOC_ID, COLLECTIONS, type AppSettings } from '@ops/shared';
import { useFirestoreDoc } from './useFirestoreDoc';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

/**
 * Returns `true` when the admin has enabled the "Disable new observation
 * creation" cutover toggle on /appSettings/global.
 *
 * Defaults to `false` while loading (conservative: don't block the UI during
 * the brief snapshot gap) and when the field is absent (the flag must be
 * explicitly turned on to block creation).
 *
 * Only safe to use inside the signed-in app (the appSettings doc is not
 * publicly readable).
 */
export function useNewObservationsDisabled(): boolean {
  const { data } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  // Firestore reads bypass Zod defaults, so a doc predating this field
  // surfaces `undefined` — coalesce to false.
  return data?.newObservationsDisabled === true;
}
