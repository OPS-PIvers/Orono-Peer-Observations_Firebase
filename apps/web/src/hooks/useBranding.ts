import { APP_SETTINGS_DOC_ID, COLLECTIONS, OPS_BRAND, type AppSettings } from '@ops/shared';
import { useFirestoreDoc } from './useFirestoreDoc';

export interface BrandingValues {
  appName: string;
  primaryColor: string;
  /** Uploaded horizontal logo URL, or null to fall back to the packaged logo. */
  logoUrl: string | null;
  /** Uploaded square icon URL, or null to fall back to the packaged icon. */
  iconUrl: string | null;
}

/**
 * Resolved app branding from /appSettings/global, with OPS defaults applied.
 * Requires an authenticated, Orono-domain user (the appSettings doc is not
 * publicly readable), so it is only safe to use inside the signed-in app
 * chrome — not on the pre-auth sign-in screen.
 */
export function useBranding(): BrandingValues {
  const { data } = useFirestoreDoc<AppSettings>(
    `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
  );
  const b = data?.branding;
  return {
    appName: b?.appName ?? OPS_BRAND.defaultAppName,
    primaryColor: b?.primaryColor ?? OPS_BRAND.defaultPrimaryColor,
    logoUrl: b?.logoUrl ?? null,
    iconUrl: b?.iconUrl ?? null,
  };
}
