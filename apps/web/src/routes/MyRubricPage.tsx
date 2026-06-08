import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  COLLECTIONS,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type Staff,
  roleYearMappingDocId,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { PageHeader } from '@/components/PageHeader';
import { AssignmentToggle, RubricGrid, type AssignmentMode } from '@/components/rubric';
import { RecentObservationsStrip } from '@/observations/RecentObservationsStrip';
import { WorkProductAnswerForm } from '@/observations/WorkProductAnswerForm';
import { InstructionalRoundAnswerForm } from '@/observations/InstructionalRoundAnswerForm';
import { roleDisplayName } from '@/utils/roleLookup';

const ASSIGNMENT_STORAGE_KEY = 'myRubric:assignmentMode';

/**
 * Teacher-facing rubric viewer. Single column:
 *  1. Header with role/year + Assigned-only / Full-Rubric toggle
 *  2. Recent finalized observations of this teacher (hidden if zero)
 *  3. The full rubric matrix grid in `view` mode
 *
 * Reads the teacher's own staff doc to derive role + year, then walks
 * roles → rubric → roleYearMappings to pin the assigned components. This
 * mirrors the lookup chain in `ObservationEditorPage`.
 */
export function MyRubricPage() {
  const { user } = useAuth();
  const location = useLocation();
  const lowerEmail = user?.email?.toLowerCase() ?? '';

  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(() => {
    if (typeof window === 'undefined') return 'assigned';
    const raw = window.sessionStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    return raw === 'full' ? 'full' : 'assigned';
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(ASSIGNMENT_STORAGE_KEY, assignmentMode);
    } catch {
      // sessionStorage may be unavailable; harmless.
    }
  }, [assignmentMode]);

  // Teacher's own staff record → carries role display name + year.
  const staffPath = lowerEmail ? `${COLLECTIONS.staff}/${lowerEmail}` : '';
  const {
    data: staff,
    loading: staffLoading,
    error: staffError,
  } = useFirestoreDoc<Staff>(staffPath);

  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: rubrics } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);

  const role = useMemo<Role | null>(() => {
    if (!staff || !roles) return null;
    return roles.find((r) => r.roleId === staff.role) ?? null;
  }, [staff, roles]);

  const roleLabel = roleDisplayName(roles, staff?.role);

  const rubric = useMemo<Rubric | null>(() => {
    if (!role || !rubrics) return null;
    return rubrics.find((rb) => rb.id === role.rubricId) ?? null;
  }, [role, rubrics]);

  const mappingPath =
    role && staff
      ? `${COLLECTIONS.roleYearMappings}/${roleYearMappingDocId(role.roleId, staff.year)}`
      : '';
  const { data: mapping } = useFirestoreDoc<RoleYearMapping>(mappingPath);

  const assignedComponentIds = useMemo(
    () => new Set(mapping?.assignedComponentIds ?? []),
    [mapping],
  );

  // When the user picks "Assigned only", filter the rubric here so that
  // <DomainNav> and <RubricGrid> render the same set of domains. Without
  // this, the nav would render pills for domains the grid hides — clicking
  // them would scroll nowhere and the IntersectionObserver scroll-spy
  // would never activate them.
  const displayedRubric = useMemo<Rubric | null>(() => {
    if (!rubric) return null;
    if (assignmentMode === 'full') return rubric;
    const filteredDomains = rubric.domains
      .map((d) => ({
        ...d,
        components: d.components.filter((c) => assignedComponentIds.has(c.id)),
      }))
      .filter((d) => d.components.length > 0);
    return { ...rubric, domains: filteredDomains };
  }, [rubric, assignmentMode, assignedComponentIds]);

  // Read the active WP/IR observations from the shared context (mounted by
  // Layout) instead of opening duplicate listeners here.
  const { workProduct: wpObservation, instructionalRound: irObservation } =
    useActiveObservationTypes();

  // Scroll to the targeted domain section when the URL hash changes.
  // React Router's <Link> updates the hash but does NOT trigger native
  // browser anchor-scroll, especially because the scrolling container is
  // <main> (overflow-y:auto) rather than the document. We re-run when
  // location.key changes too, so clicking the same domain link twice
  // still triggers a re-scroll. Depending on `displayedRubric` ensures we
  // wait until the targeted <section> has actually mounted.
  useEffect(() => {
    if (!location.hash) return;
    if (!displayedRubric) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, location.key, displayedRubric]);

  if (!user) {
    return <p className="text-muted-foreground py-8 text-center text-sm">Loading your account…</p>;
  }

  // The role/year string IS the title — there's no separate page name
  // ("My Rubric" was redundant with the sidebar entry it was launched
  // from). Dropping the subtitle saves a row of vertical space.
  const headerTitle = staff
    ? `${roleLabel} · Year ${String(staff.year)}`
    : staffLoading
      ? 'Loading your role…'
      : 'No staff record found for your account.';

  const visibleRubric =
    displayedRubric && displayedRubric.domains.length > 0 ? displayedRubric : null;

  return (
    <PageHeader
      title={headerTitle}
      variant="plain"
      actions={
        rubric ? <AssignmentToggle value={assignmentMode} onChange={setAssignmentMode} /> : null
      }
    >
      <div className="space-y-6">
        {staffError ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3 text-sm">
            Couldn&apos;t load your staff record: {staffError.message}
          </div>
        ) : null}

        <RecentObservationsStrip observedEmail={lowerEmail} />

        {wpObservation ? <WorkProductAnswerForm observation={wpObservation} /> : null}

        {irObservation ? <InstructionalRoundAnswerForm observation={irObservation} /> : null}

        {visibleRubric ? (
          <RubricGrid
            rubric={visibleRubric}
            mode={{
              kind: 'view',
              assignedComponentIds,
              showAssignedOnly: false,
            }}
            storageScope={`view-${visibleRubric.rubricId}`}
          />
        ) : rubric && assignmentMode === 'assigned' ? (
          <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
            No components are assigned for your role/year combination. Switch to{' '}
            <strong>Full Rubric</strong> to view the complete rubric.
          </div>
        ) : staff && roles && rubrics ? (
          <div className="border-primary bg-accent text-accent-foreground rounded-md border-l-4 px-4 py-3 text-sm">
            No rubric is set up for the role <strong>{roleLabel}</strong>. Ask an admin to verify
            the role mapping.
          </div>
        ) : !staffLoading ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Loading your rubric…</p>
        ) : null}
      </div>
    </PageHeader>
  );
}
