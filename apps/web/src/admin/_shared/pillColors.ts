import type { PillColorName } from '@ops/shared';
import type { CycleStatus } from '@/admin/staff/staffCycle';

/** A pill color = a Tailwind background + text class pair. */
export interface PillColor {
  bg: string;
  text: string;
}

/**
 * Concrete Tailwind classes for every name in the shared `PILL_COLORS` palette
 * (see packages/shared/src/schema/pillColor.ts). `ring` is used by the swatch
 * pickers to highlight the selected color. Classes are written as full literal
 * strings so Tailwind's scanner includes them.
 */
export const PILL_COLOR_CLASSES: Record<PillColorName, PillColor & { ring: string }> = {
  slate: { bg: 'bg-slate-100', text: 'text-slate-800', ring: 'ring-slate-500' },
  gray: { bg: 'bg-gray-100', text: 'text-gray-800', ring: 'ring-gray-500' },
  stone: { bg: 'bg-stone-100', text: 'text-stone-800', ring: 'ring-stone-500' },
  red: { bg: 'bg-red-100', text: 'text-red-800', ring: 'ring-red-500' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-800', ring: 'ring-orange-500' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-800', ring: 'ring-amber-500' },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800', ring: 'ring-yellow-500' },
  lime: { bg: 'bg-lime-100', text: 'text-lime-800', ring: 'ring-lime-500' },
  green: { bg: 'bg-green-100', text: 'text-green-800', ring: 'ring-green-500' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-800', ring: 'ring-emerald-500' },
  teal: { bg: 'bg-teal-100', text: 'text-teal-800', ring: 'ring-teal-500' },
  cyan: { bg: 'bg-cyan-100', text: 'text-cyan-800', ring: 'ring-cyan-500' },
  sky: { bg: 'bg-sky-100', text: 'text-sky-800', ring: 'ring-sky-500' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-800', ring: 'ring-blue-500' },
  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-800', ring: 'ring-indigo-500' },
  violet: { bg: 'bg-violet-100', text: 'text-violet-800', ring: 'ring-violet-500' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-800', ring: 'ring-purple-500' },
  fuchsia: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800', ring: 'ring-fuchsia-500' },
  pink: { bg: 'bg-pink-100', text: 'text-pink-800', ring: 'ring-pink-500' },
  rose: { bg: 'bg-rose-100', text: 'text-rose-800', ring: 'ring-rose-500' },
};

/** Resolve a palette name to a {bg,text} pair, or undefined when unset. */
export function colorClasses(name: PillColorName | undefined): PillColor | undefined {
  return name
    ? { bg: PILL_COLOR_CLASSES[name].bg, text: PILL_COLOR_CLASSES[name].text }
    : undefined;
}

/** Deterministic fallback color for a categorical key, so a role/building with
 *  no configured color still gets a stable, distinct chip. */
export function paletteFor(key: string): PillColor {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const names = Object.keys(PILL_COLOR_CLASSES) as PillColorName[];
  const name = names[Math.abs(hash) % names.length] ?? 'blue';
  return { bg: PILL_COLOR_CLASSES[name].bg, text: PILL_COLOR_CLASSES[name].text };
}

/** Semantic colors for the cycle Status pill (not user-configurable). */
export const STATUS_PILL_COLOR: Record<CycleStatus, PillColor> = {
  low: { bg: PILL_COLOR_CLASSES.green.bg, text: PILL_COLOR_CLASSES.green.text },
  high: { bg: PILL_COLOR_CLASSES.red.bg, text: PILL_COLOR_CLASSES.red.text },
  probationary: { bg: PILL_COLOR_CLASSES.purple.bg, text: PILL_COLOR_CLASSES.purple.text },
};

/** Built-in default colors for the three display years (overridable in
 *  appSettings.yearColors, set on the Role/Year page). */
export const YEAR_PILL_COLOR: Record<1 | 2 | 3, PillColor> = {
  1: { bg: PILL_COLOR_CLASSES.sky.bg, text: PILL_COLOR_CLASSES.sky.text },
  2: { bg: PILL_COLOR_CLASSES.teal.bg, text: PILL_COLOR_CLASSES.teal.text },
  3: { bg: PILL_COLOR_CLASSES.violet.bg, text: PILL_COLOR_CLASSES.violet.text },
};

/** Strong, distinct color for the "Admin Console Access" pill. */
export const ADMIN_PILL_COLOR: PillColor = { bg: 'bg-ops-blue', text: 'text-white' };
