import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * /buildings/{buildingId} — building (location) definitions.
 *
 * Mirrors the Role doc shape: `buildingId` is a lower-kebab-case slug
 * that doubles as the doc id; `displayName` is the human-readable label
 * shown in the staff editor dropdown and on staff cards.
 *
 * Staff records reference buildings by displayName today (legacy free-text
 * data); the StaffDialog dropdown sources options from active buildings
 * here. Legacy values that don't match an entry are preserved on the
 * record and rendered with an "(unmapped)" tag so admins can clean them
 * up incrementally.
 */
export const building = z.object({
  buildingId: slugId,
  displayName: z.string().trim().min(1).max(80),
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Building = z.infer<typeof building>;

export const buildingInput = building.omit({ createdAt: true, updatedAt: true });
export type BuildingInput = z.infer<typeof buildingInput>;
