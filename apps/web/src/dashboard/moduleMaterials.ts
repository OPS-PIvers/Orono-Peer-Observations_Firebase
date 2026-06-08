import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import type { ModuleItem } from '@ops/shared';
import { db } from '@/lib/firebase';

/**
 * One-shot collection-group read of the `material` items for the staff
 * member's assigned modules. Returns `[]` for an empty id list so we never
 * issue an invalid `in []` query (Firestore rejects an empty `in` array).
 *
 * Lives in its own module — and reads via `getDocs` rather than a live
 * `onSnapshot` — because module materials are effectively static reference
 * content; the dashboard fetches them once through TanStack Query.
 */
export async function fetchModuleMaterials(moduleIds: string[]): Promise<ModuleItem[]> {
  if (moduleIds.length === 0) return [];
  const snap = await getDocs(
    query(
      collectionGroup(db, 'items'),
      where('kind', '==', 'material'),
      where('moduleId', 'in', moduleIds),
    ),
  );
  return snap.docs.map((d) => d.data() as ModuleItem);
}
