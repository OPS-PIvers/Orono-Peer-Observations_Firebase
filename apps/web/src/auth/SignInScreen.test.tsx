import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted to the top of the file.
// ---------------------------------------------------------------------------

const { mockSignInWithPopup, mockSignOut, mockUserDelete, mockUseAuth } = vi.hoisted(() => {
  const mockUserDelete = vi.fn();
  const mockSignOut = vi.fn();

  return {
    mockSignInWithPopup: vi.fn(),
    mockSignOut,
    mockUserDelete,
    mockUseAuth: vi.fn(() => ({
      status: 'signed-out',
    })),
  };
});

vi.mock('firebase/auth', () => {
  class GoogleAuthProvider {
    setCustomParameters = vi.fn();
  }
  return {
    GoogleAuthProvider,
    signInWithPopup: mockSignInWithPopup,
  };
});

vi.mock('@/lib/firebase', () => ({
  auth: {
    signOut: mockSignOut,
  },
}));

vi.mock('react-router-dom', () => ({
  Navigate: () => <div data-testid="navigate">Navigate</div>,
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    onClick,
    children,
    disabled,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    disabled: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const { mockGetBrandingCache } = vi.hoisted(() => {
  const mockFn = vi.fn<
    () => {
      appName: string;
      primaryColor: string;
      logoUrl: string | null;
      iconUrl: string | null;
    }
  >(() => ({
    appName: 'Orono Peer Observations',
    primaryColor: '#2d3f89',
    logoUrl: null,
    iconUrl: null,
  }));
  return { mockGetBrandingCache: mockFn };
});

vi.mock('@/components/brandingCache', () => ({
  getBrandingCache: mockGetBrandingCache,
}));

// Import the component under test after mocks are in place.
import { SignInScreen } from './SignInScreen';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  mockUseAuth.mockReturnValue({
    status: 'signed-out',
  });
  mockGetBrandingCache.mockReturnValue({
    appName: 'Orono Peer Observations',
    primaryColor: '#2d3f89',
    logoUrl: null,
    iconUrl: null,
  });
});

describe('SignInScreen', () => {
  it('renders the sign-in button and branding', () => {
    render(<SignInScreen />);

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in with your/i)).toBeInTheDocument();
    expect(screen.getByText(/google account/i)).toBeInTheDocument();
  });

  it('shows a loading state while signing in', async () => {
    mockSignInWithPopup.mockImplementation(
      () =>
        new Promise(() => {
          // Never resolve; keep the promise pending
        }),
    );

    const user = userEvent.setup();
    render(<SignInScreen />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });
  });

  it('displays an error message when the user signs in with a non-domain email', async () => {
    const nonDomainEmail = 'user@gmail.com';
    mockSignInWithPopup.mockResolvedValue({
      user: {
        email: nonDomainEmail,
        delete: mockUserDelete,
      },
    });
    mockUserDelete.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInScreen />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(
            `Sign-in is restricted to @orono.k12.mn.us accounts — you signed in as ${nonDomainEmail}`,
          ),
        ),
      ).toBeInTheDocument();
    });
  });

  it('deletes the auth user when they sign in with a non-domain email', async () => {
    const nonDomainEmail = 'user@gmail.com';
    mockSignInWithPopup.mockResolvedValue({
      user: {
        email: nonDomainEmail,
        delete: mockUserDelete,
      },
    });
    mockUserDelete.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInScreen />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockUserDelete).toHaveBeenCalledTimes(1);
    });
  });

  it('falls back to signOut if user.delete() throws', async () => {
    const nonDomainEmail = 'user@gmail.com';
    mockSignInWithPopup.mockResolvedValue({
      user: {
        email: nonDomainEmail,
        delete: mockUserDelete,
      },
    });
    mockUserDelete.mockRejectedValue(new Error('Delete failed'));
    mockSignOut.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInScreen />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockUserDelete).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it('stores the rejected email in sessionStorage for redirect scenarios', async () => {
    const nonDomainEmail = 'user@gmail.com';
    mockSignInWithPopup.mockResolvedValue({
      user: {
        email: nonDomainEmail,
        delete: mockUserDelete,
      },
    });
    mockUserDelete.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInScreen />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(sessionStorage.getItem('signInError.rejectedEmail')).toBe(nonDomainEmail);
    });
  });

  it('displays a stored rejection message when the component mounts', () => {
    const rejectedEmail = 'user@gmail.com';
    sessionStorage.setItem('signInError.rejectedEmail', rejectedEmail);

    render(<SignInScreen />);

    expect(
      screen.getByText(
        new RegExp(
          `Sign-in is restricted to @orono.k12.mn.us accounts — you signed in as ${rejectedEmail}`,
        ),
      ),
    ).toBeInTheDocument();
  });

  it('clears the stored rejection message after displaying it', () => {
    const rejectedEmail = 'user@gmail.com';
    sessionStorage.setItem('signInError.rejectedEmail', rejectedEmail);

    render(<SignInScreen />);

    expect(sessionStorage.getItem('signInError.rejectedEmail')).toBeNull();
  });

  it('displays an error message when signInWithPopup rejects', async () => {
    mockSignInWithPopup.mockRejectedValue(new Error('Sign-in cancelled'));

    const user = userEvent.setup();
    render(<SignInScreen />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/sign-in cancelled/i)).toBeInTheDocument();
    });
  });

  it('redirects to home when the user is already signed in', () => {
    mockUseAuth.mockReturnValue({
      status: 'signed-in',
    });

    render(<SignInScreen />);

    expect(screen.getByTestId('navigate')).toBeInTheDocument();
  });

  it('uses cached app name from branding when available', () => {
    mockGetBrandingCache.mockReturnValue({
      appName: 'Custom School App',
      primaryColor: '#2d3f89',
      logoUrl: null,
      iconUrl: null,
    });

    render(<SignInScreen />);

    expect(screen.getByText('Custom School App')).toBeInTheDocument();
  });

  it('uses cached logo URL from branding when available', () => {
    mockGetBrandingCache.mockReturnValue({
      appName: 'Orono Peer Observations',
      primaryColor: '#2d3f89',
      logoUrl: 'https://example.com/custom-logo.png',
      iconUrl: null,
    });

    render(<SignInScreen />);

    const img = screen.getByAltText('Orono Technology');
    expect(img.getAttribute('src')).toBe('https://example.com/custom-logo.png');
  });

  it('falls back to default logo when cached logoUrl is null', () => {
    mockGetBrandingCache.mockReturnValue({
      appName: 'Orono Peer Observations',
      primaryColor: '#2d3f89',
      logoUrl: null,
      iconUrl: null,
    });

    render(<SignInScreen />);

    const img = screen.getByAltText('Orono Technology');
    // jsdom resolves img.src to an absolute URL; assert the raw attribute.
    expect(img.getAttribute('src')).toBe('/brand/primary-logo.png');
  });

  it('falls back to defaults when getBrandingCache returns incomplete data', () => {
    mockGetBrandingCache.mockReturnValue({
      appName: 'Orono Peer Observations',
      primaryColor: '#2d3f89',
      logoUrl: null,
      iconUrl: null,
    });

    render(<SignInScreen />);

    expect(screen.getByText('Orono Peer Observations')).toBeInTheDocument();
    const img = screen.getByAltText('Orono Technology');
    // jsdom resolves img.src to an absolute URL; assert the raw attribute.
    expect(img.getAttribute('src')).toBe('/brand/primary-logo.png');
  });
});
