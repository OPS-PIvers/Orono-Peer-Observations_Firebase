/**
 * Write guard for dev "view as". While viewing as someone else the app
 * renders their reads, but every write would still run under the real
 * signed-in identity, so writes are refused here before they leave the
 * client. Module-level (not context) so plain helpers and module-scope
 * callables can check it too. DevModeProvider keeps it in sync.
 */
let viewingAsEmail: string | null = null;

export function setViewAsGuard(email: string | null): void {
  viewingAsEmail = email;
}

export function isViewAsActive(): boolean {
  return viewingAsEmail !== null;
}

export class ViewAsReadOnlyError extends Error {
  constructor(email: string) {
    super(`Read-only while viewing as ${email}. Exit view-as to make changes.`);
    this.name = 'ViewAsReadOnlyError';
  }
}

/** Throws while viewing as someone. Call at the top of every write path. */
export function assertWritable(): void {
  if (viewingAsEmail !== null) throw new ViewAsReadOnlyError(viewingAsEmail);
}

/** Wraps a mutating callable (or any async writer) so it rejects while
 *  viewing as someone. */
export function guardWrite<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) => {
    try {
      assertWritable();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return fn(...args);
  };
}
