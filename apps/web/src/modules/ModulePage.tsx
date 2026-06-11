import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { deleteDoc, doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
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
  // The collection-group rule authorizes non-admin reads via
  // `resource.data.moduleId in staffDocData().modules` (or auto-enable).
  // Firestore proves list queries against the query, not the documents, so
  // the moduleId filter is required — an unfiltered list is denied for
  // every non-admin user.
  const itemConstraints = useMemo(
    () => (moduleId ? [where('moduleId', '==', moduleId)] : []),
    [moduleId],
  );
  const { data: items, error: itemsError } = useFirestoreCollection<ModuleItem>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}/${MODULE_SUBCOLLECTIONS.items}` : '',
    itemConstraints,
    [moduleId],
  );
  const { data: progress } = useFirestoreCollection<ModuleProgress>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}/${STAFF_SUBCOLLECTIONS.moduleProgress}` : '',
  );

  const doneItemIds = useMemo(() => new Set((progress ?? []).map((p) => p.itemId)), [progress]);

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
    const ref = doc(
      db,
      COLLECTIONS.staff,
      emailLower,
      STAFF_SUBCOLLECTIONS.moduleProgress,
      item.itemId,
    );
    if (done) {
      void setDoc(ref, {
        itemId: item.itemId,
        moduleId: item.moduleId,
        status: 'done',
        completedAt: serverTimestamp(),
      });
    } else {
      void deleteDoc(ref);
    }
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
      <div className="space-y-6">
        {itemsError ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
            Failed to load module content: {itemsError.message}
          </div>
        ) : null}
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
