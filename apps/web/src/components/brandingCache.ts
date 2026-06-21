import { OPS_BRAND } from '@ops/shared';

/**
 * Pre-auth branding cache reader.
 *
 * Deliberately free of any Firebase import so the modules that need branding
 * *before* sign-in (e.g. SignInScreen) don't drag the Firestore SDK onto the
 * critical path. The signed-in {@link BrandingProvider} owns writing this cache
 * from `/appSettings/global`; this module only reads the localStorage snapshot.
 */

export const BRANDING_CACHE_KEY = 'ops-branding-cache';

export interface BrandingCache {
  appName: string;
  primaryColor: string;
  logoUrl: string | null;
  iconUrl: string | null;
}

export function isBrandingCache(value: unknown): value is BrandingCache {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['appName'] === 'string' &&
    typeof v['primaryColor'] === 'string' &&
    (v['logoUrl'] === null || typeof v['logoUrl'] === 'string') &&
    (v['iconUrl'] === null || typeof v['iconUrl'] === 'string')
  );
}

/**
 * Reads branding from localStorage with a fallback chain:
 * cached value → packaged OPS default. Safe to call on pre-auth screens.
 */
export function getBrandingCache(): BrandingCache {
  try {
    const cached = localStorage.getItem(BRANDING_CACHE_KEY);
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      if (isBrandingCache(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore JSON parse errors; fall back to defaults
  }
  return {
    appName: OPS_BRAND.defaultAppName,
    primaryColor: OPS_BRAND.defaultPrimaryColor,
    logoUrl: null,
    iconUrl: null,
  };
}
