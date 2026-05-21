import type { CycleStatus } from '@/admin/staff/staffCycle';

/** A pill color = a Tailwind background + text class pair. */
export interface PillColor {
  bg: string;
  text: string;
}

/** Soft, on-brand palette for categorical pills (roles, buildings). */
const PALETTE: readonly PillColor[] = [
  { bg: 'bg-blue-100', text: 'text-blue-800' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  { bg: 'bg-amber-100', text: 'text-amber-800' },
  { bg: 'bg-purple-100', text: 'text-purple-800' },
  { bg: 'bg-pink-100', text: 'text-pink-800' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  { bg: 'bg-cyan-100', text: 'text-cyan-800' },
  { bg: 'bg-rose-100', text: 'text-rose-800' },
];

/** Deterministic color for a categorical key, so the same role/building always
 *  gets the same pill color across rows. */
const NEUTRAL_PILL: PillColor = { bg: 'bg-accent', text: 'text-accent-foreground' };

export function paletteFor(key: string): PillColor {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? NEUTRAL_PILL;
}

/** Semantic colors for the cycle Status pill. */
export const STATUS_PILL_COLOR: Record<CycleStatus, PillColor> = {
  low: { bg: 'bg-slate-100', text: 'text-slate-700' },
  high: { bg: 'bg-amber-100', text: 'text-amber-800' },
  probationary: { bg: 'bg-purple-100', text: 'text-purple-800' },
};

/** Distinct light tones for the three display years. */
export const YEAR_PILL_COLOR: Record<1 | 2 | 3, PillColor> = {
  1: { bg: 'bg-sky-100', text: 'text-sky-800' },
  2: { bg: 'bg-teal-100', text: 'text-teal-800' },
  3: { bg: 'bg-violet-100', text: 'text-violet-800' },
};

/** Strong, distinct color for the "Admin Console Access" pill. */
export const ADMIN_PILL_COLOR: PillColor = { bg: 'bg-ops-blue', text: 'text-white' };
