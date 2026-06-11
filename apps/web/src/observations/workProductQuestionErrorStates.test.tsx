import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Observation,
  type WorkProductQuestion,
  observation as observationSchema,
} from '@ops/shared';

const { mockUseFirestoreCollection } = vi.hoisted(() => ({
  mockUseFirestoreCollection: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  doc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: mockUseFirestoreCollection,
}));

import { InstructionalRoundAnswerForm } from './InstructionalRoundAnswerForm';
import { InstructionalRoundResponseViewer } from './InstructionalRoundResponseViewer';
import { WorkProductAnswerForm } from './WorkProductAnswerForm';
import { WorkProductResponseViewer } from './WorkProductResponseViewer';

const testObservation: Observation & { id: string } = {
  ...observationSchema.parse({
    observationId: 'obs-1',
    observerEmail: 'pe@orono.k12.mn.us',
    observedEmail: 'staff@orono.k12.mn.us',
    observedName: 'Staff Member',
    observedRole: 'Teacher',
    observedYear: 1,
    observationDate: new Date('2026-01-15'),
    createdAt: new Date('2026-01-15'),
    lastModifiedAt: new Date('2026-01-15'),
  }),
  id: 'obs-1',
};

function question(): WorkProductQuestion & { id: string } {
  return {
    id: 'q1',
    questionId: 'q-one',
    text: 'Describe the work product.',
    order: 1,
    isActive: true,
    type: 'work-product',
    createdAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-15'),
  };
}

function hookResult(
  data: (WorkProductQuestion & { id: string })[] | null,
  error: Error | null = null,
) {
  return { data, loading: false, error };
}

afterEach(() => {
  vi.clearAllMocks();
});

const cases: { name: string; element: ReactElement }[] = [
  {
    name: 'WorkProductAnswerForm',
    element: <WorkProductAnswerForm observation={testObservation} />,
  },
  {
    name: 'InstructionalRoundAnswerForm',
    element: <InstructionalRoundAnswerForm observation={testObservation} />,
  },
  {
    name: 'WorkProductResponseViewer',
    element: <WorkProductResponseViewer observation={testObservation} />,
  },
  {
    name: 'InstructionalRoundResponseViewer',
    element: <InstructionalRoundResponseViewer observation={testObservation} />,
  },
];

describe.each(cases)('$name question loading', ({ element }) => {
  it('renders a visible error banner when the question query fails', () => {
    mockUseFirestoreCollection.mockReturnValue(
      hookResult(null, new Error('The query requires an index.')),
    );
    render(element);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/failed to load questions/i);
    expect(alert).toHaveTextContent('The query requires an index.');
    // The misleading empty state must not appear alongside an error.
    expect(screen.queryByText(/questions configured/i)).not.toBeInTheDocument();
  });

  it('renders the empty state only when the query succeeds with zero questions', () => {
    mockUseFirestoreCollection.mockReturnValue(hookResult([]));
    render(element);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/questions configured/i)).toBeInTheDocument();
  });

  it('renders the questions when the query succeeds', () => {
    mockUseFirestoreCollection.mockReturnValue(hookResult([question()]));
    render(element);

    expect(screen.getByText(/describe the work product/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
