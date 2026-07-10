import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  MODULE_SUBCOLLECTIONS,
  STAFF_SUBCOLLECTIONS,
  staffMatchesAutoEnable,
  type ModuleDoc,
  type ModuleItem,
  type ModuleProgress,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useEffectiveClaims } from '@/dev/DevModeContext';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/Skeleton';
import { MaterialsSection, ResourceListSection, RichTextSection } from './moduleSections';

export function ModulePage() {
  const { moduleId = '' } = useParams();
  const { user } = useAuth();
  const claims = useEffectiveClaims();
  const emailLower = user?.email?.toLowerCase() ?? '';

  const { data: module, loading: moduleLoading } = useFirestoreDoc<ModuleDoc>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}` : '',
  );
  const { data: myStaff, loading: staffLoading } = useFirestoreDoc<Staff>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '',
  );
  const { data: items } = useFirestoreCollection<ModuleItem>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}/${MODULE_SUBCOLLECTIONS.items}` : '',
  );
  const { data: progress } = useFirestoreCollection<ModuleProgress>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}/${STAFF_SUBCOLLECTIONS.moduleProgress}` : '',
  );

  const doneItemIds = useMemo(() => new Set((progress ?? []).map((p) => p.itemId)), [progress]);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Calculate module-level completion: count materials across all sections
  const { totalMaterials, doneMaterials } = useMemo(() => {
    if (!module || !items) return { totalMaterials: 0, doneMaterials: 0 };

    let total = 0;
    let done = 0;

    module.sections.forEach((section) => {
      items.forEach((item) => {
        if (item.sectionId === section.id && item.kind === 'material') {
          total += 1;
          if (doneItemIds.has(item.itemId)) {
            done += 1;
          }
        }
      });
    });

    return { totalMaterials: total, doneMaterials: done };
  }, [module, items, doneItemIds]);

  const isAssigned = useMemo(() => {
    if (claims.isAdmin) return true;
    if (!myStaff) return false;
    return (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
      (myStaff.modules ?? []).includes(moduleId) ||
      staffMatchesAutoEnable(myStaff, module?.autoEnable ?? null)
    );
  }, [claims.isAdmin, myStaff, moduleId, module]);

  function toggleDone(item: ModuleItem, done: boolean) {
    setToggleError(null);
    const ref = doc(
      db,
      COLLECTIONS.staff,
      emailLower,
      STAFF_SUBCOLLECTIONS.moduleProgress,
      item.itemId,
    );
    const write = done
      ? setDoc(ref, {
          itemId: item.itemId,
          moduleId: item.moduleId,
          status: 'done',
          completedAt: serverTimestamp(),
        })
      : deleteDoc(ref);
    write.catch((err: unknown) => {
      setToggleError(err instanceof Error ? err.message : 'Failed to save progress');
    });
  }

  if ((moduleLoading && !module) || (staffLoading && !myStaff && !claims.isAdmin)) {
    return (
      <PageHeader title="Loading…" variant="plain">
        <Skeleton className="h-40 w-full" />
      </PageHeader>
    );
  }

  if (!module || !module.hasPage || !isAssigned) {
    return (
      <PageHeader title="Module" variant="plain">
        <EmptyState title="This module isn't available to you." />
      </PageHeader>
    );
  }

  const sections = module.sections;

  return (
    <PageHeader
      title={module.displayName}
      variant="plain"
      subtitle={module.description || undefined}
    >
      {toggleError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          {toggleError}
        </div>
      ) : null}
      {totalMaterials > 0 ? (
        <div className="mb-6 rounded-md border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Module progress</span>
            <span className="text-sm font-semibold text-gray-900">
              {doneMaterials} of {totalMaterials} complete
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{
                width: `${totalMaterials > 0 ? (doneMaterials / totalMaterials) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-6">
        {sections.length === 0 ? (
          <EmptyState title="This module has no content yet." />
        ) : (
          sections.map((section) => {
            if (section.type === 'richtext') {
              return <RichTextSection key={section.id} section={section} />;
            }
            if (section.type === 'resources') {
              return <ResourceListSection key={section.id} section={section} items={items ?? []} />;
            }
            return (
              <MaterialsSection
                key={section.id}
                section={section}
                items={items ?? []}
                doneItemIds={doneItemIds}
                onToggleDone={toggleDone}
              />
            );
          })
        )}
      </div>
    </PageHeader>
  );
}
