import { useEffect, type ReactNode } from 'react';
import { OPS_BRAND } from '@ops/shared';
import { useBranding } from '@/hooks/useBranding';
import { BRANDING_CACHE_KEY } from '@/components/brandingCache';

// The Firebase-free cache reader now lives in `./brandingCache` so pre-auth
// screens (SignInScreen) can read branding without pulling the Firestore SDK
// onto the critical path. Re-exported here to preserve existing import paths.
export { BRANDING_CACHE_KEY, getBrandingCache } from '@/components/brandingCache';
export type { BrandingCache } from '@/components/brandingCache';

/**
 * CSS custom properties this provider manages on `<html>`. The Tailwind
 * `@theme` block in index.css maps the ops-blue brand tokens onto these with
 * the DESIGN.md hex values as fallbacks, so removing them restores the stock
 * OPS Tech palette.
 */
export const BRAND_CSS_VARS = [
  '--ops-brand-primary',
  '--ops-brand-primary-dark',
  '--ops-brand-primary-light',
  '--ops-brand-primary-lighter',
] as const;

export interface PrimaryShades {
  /** The admin-chosen primary color, lowercased. */
  base: string;
  /** Strong chrome (AppHeader, h1) — mirrors ops-blue-dark. */
  dark: string;
  /** Hover/secondary emphasis — mirrors ops-blue-light. */
  light: string;
  /** Tinted surfaces (accent backgrounds) — mirrors ops-blue-lighter. */
  lighter: string;
}

function channelToHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/** Mix every channel of `hex` toward `target` (0 = black, 255 = white) by `amount` (0–1). */
function mixToward(hex: string, target: number, amount: number): string {
  const mixed = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) => {
    const value = parseInt(channel, 16);
    return channelToHex(Math.round(value + (target - value) * amount));
  });
  return `#${mixed.join('')}`;
}

/**
 * Derives the dark/light/lighter companions of a 6-digit hex primary color.
 * The mix ratios reproduce (within rounding) the relationships between the
 * DESIGN.md blue family (#2d3f89 → #1d2a5d / #4356a0 / #eaecf5), so a custom
 * primary keeps the same tonal contrast as the stock palette.
 */
export function derivePrimaryShades(primary: string): PrimaryShades {
  const base = primary.toLowerCase();
  return {
    base,
    dark: mixToward(base, 0, 0.34),
    light: mixToward(base, 255, 0.12),
    lighter: mixToward(base, 255, 0.9),
  };
}

/**
 * Applies the admin-configured branding (Admin → Branding, stored on
 * `/appSettings/global`) to the signed-in app chrome and document metadata:
 *
 * - Sets `document.title` to the configured appName so the browser tab
 *   reflects the school's branding.
 * - Updates the favicon (`<link rel="icon">`) to the iconUrl when present,
 *   reverting to the packaged default when null.
 * - Writes CSS custom properties on `document.documentElement` for the
 *   primary color. index.css maps the ops-blue Tailwind tokens — and through
 *   them the shadcn `primary`, `ring`, and `accent` semantic tokens — onto
 *   these variables, so the header, primary buttons, and accents re-theme
 *   without per-component wiring.
 *
 * `useBranding()` guarantees a valid hex (invalid stored values fall back to
 * the OPS default). When the color is the stock OPS blue the overrides are
 * removed entirely so the exact DESIGN.md token values apply.
 *
 * Also persists the resolved branding (appName, logoUrl, primaryColor, iconUrl)
 * to localStorage so that pre-auth screens like SignInScreen can access it.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const { appName, primaryColor, logoUrl, iconUrl } = useBranding();

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      for (const name of BRAND_CSS_VARS) root.style.removeProperty(name);
    };
    if (primaryColor.toLowerCase() === OPS_BRAND.defaultPrimaryColor) {
      clear();
    } else {
      const shades = derivePrimaryShades(primaryColor);
      root.style.setProperty('--ops-brand-primary', shades.base);
      root.style.setProperty('--ops-brand-primary-dark', shades.dark);
      root.style.setProperty('--ops-brand-primary-light', shades.light);
      root.style.setProperty('--ops-brand-primary-lighter', shades.lighter);
    }

    // Persist to localStorage for pre-auth access (SignInScreen, etc.)
    try {
      localStorage.setItem(
        BRANDING_CACHE_KEY,
        JSON.stringify({ appName, primaryColor, logoUrl, iconUrl }),
      );
    } catch {
      // Ignore localStorage errors (quota exceeded, private browsing, etc.)
    }

    return clear;
  }, [appName, primaryColor, logoUrl, iconUrl]);

  // Set document.title to the configured appName.
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  // Update the favicon to the configured iconUrl, or revert to the packaged default.
  useEffect(() => {
    let faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!faviconLink) {
      faviconLink = document.createElement('link');
      faviconLink.rel = 'icon';
      faviconLink.type = 'image/png';
      document.head.appendChild(faviconLink);
    }
    faviconLink.href = iconUrl ?? '/brand/torch-icon.png';
  }, [iconUrl]);

  return <>{children}</>;
}
