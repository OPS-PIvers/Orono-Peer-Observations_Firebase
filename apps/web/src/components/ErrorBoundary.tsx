import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown above the retry button. Keep it plain — users see this. */
  title?: string;
  /** Identifies the boundary in the console when something is caught. */
  label?: string;
  /** Reload the tab instead of re-rendering — for boundaries above the router. */
  variant?: 'inline' | 'page';
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors from a subtree and offers a way back.
 *
 * Two of these are mounted. `PageErrorBoundary` sits inside the app shell
 * around the routed page, so a page that throws leaves the header and
 * sidebar on screen and the user can navigate away; it resets on every
 * navigation and offers a "Try again" that re-renders in place. `AppErrorBoundary`
 * wraps the whole tree as a last resort for a crash in the shell itself,
 * where the only honest recovery is a reload.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label ?? 'ErrorBoundary'}]`, error, info.componentStack);
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isPage = this.props.variant === 'page';
    const title = this.props.title ?? 'Something went wrong on this page.';

    return (
      <div
        role="alert"
        className={
          isPage
            ? 'bg-ops-gray-lightest flex h-svh flex-col items-center justify-center gap-4 px-6 text-center'
            : 'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center'
        }
      >
        <div>
          <p className="text-base font-semibold">{title}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {isPage
              ? 'Reloading usually clears it. If it keeps happening, let IT know.'
              : 'The rest of the app is still working — you can navigate elsewhere and come back.'}
          </p>
        </div>
        <div className="flex gap-2">
          {isPage ? (
            <Button onClick={() => window.location.reload()}>Reload</Button>
          ) : (
            <Button onClick={this.reset}>Try again</Button>
          )}
        </div>
        {import.meta.env.DEV ? (
          <pre className="text-muted-foreground max-w-full overflow-x-auto text-left text-xs">
            {error.stack ?? error.message}
          </pre>
        ) : null}
      </div>
    );
  }
}

/**
 * Wraps the routed page. Keyed on the pathname so navigating away from a
 * broken page clears the error instead of stranding the user on it.
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} label="PageErrorBoundary" variant="inline">
      {children}
    </ErrorBoundary>
  );
}

/** Last-resort boundary around the entire app, including the shell. */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary label="AppErrorBoundary" variant="page" title="The app hit an unexpected error.">
      {children}
    </ErrorBoundary>
  );
}
