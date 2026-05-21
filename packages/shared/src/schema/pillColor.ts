import { z } from 'zod';

/**
 * The shared pill-color palette. One on-brand-friendly set of named Tailwind
 * hues used everywhere a colored chip appears — modules, roles, buildings,
 * year, etc. The web app maps each name to concrete Tailwind classes
 * (`PILL_COLOR_CLASSES`); keep the two in sync.
 */
export const PILL_COLORS = [
  'slate',
  'gray',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;
export type PillColorName = (typeof PILL_COLORS)[number];
export const pillColor = z.enum(PILL_COLORS);
