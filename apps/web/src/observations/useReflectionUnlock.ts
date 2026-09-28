import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  resolveReflectionUnlock,
  type AppSettings,
  type ReflectionUnlockMode,
} from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';

/** The district's Reflection-question unlock mode from `/appSettings/global`. */
export function useReflectionUnlock(): ReflectionUnlockMode {
  const { data } = useFirestoreDoc<AppSettings>(
    `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
  );
  return resolveReflectionUnlock(data?.reflectionUnlock);
}
