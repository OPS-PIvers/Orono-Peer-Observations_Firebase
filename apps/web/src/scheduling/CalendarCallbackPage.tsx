import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { CalendarConnectionStatusResult, ConnectGoogleCalendarInput } from '@ops/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { functions } from '@/lib/firebase';
import {
  CALENDAR_OAUTH_SCOPE,
  calendarRedirectUri,
  clearStashedOAuthState,
  readStashedOAuthState,
} from './connectCalendar';

const connectGoogleCalendarFn = httpsCallable<
  ConnectGoogleCalendarInput,
  CalendarConnectionStatusResult
>(functions, 'connectGoogleCalendar');

type Phase = 'working' | 'success' | 'error';

/**
 * OAuth redirect target for the Google Calendar connect flow. Google sends
 * the user here with `?code=...&state=...`. We verify the CSRF `state`
 * against the value we stashed before the redirect, exchange the code via the
 * `connectGoogleCalendar` callable, then return the user to where they
 * started (default /profile).
 */
export function CalendarCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('working');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [returnTo, setReturnTo] = useState<string>('/profile');
  // Guards against React 18 StrictMode double-invocation (which would fire
  // two code-exchange calls — the second fails since auth codes are single-use).
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const stashed = readStashedOAuthState();
    const target = stashed?.returnTo ?? '/profile';
    setReturnTo(target);

    const fail = (message: string) => {
      clearStashedOAuthState();
      setErrorMessage(message);
      setPhase('error');
    };

    // Google reports user-cancelled / denied consent via `?error=`.
    const oauthError = searchParams.get('error');
    if (oauthError) {
      fail(
        oauthError === 'access_denied'
          ? 'You declined access to Google Calendar.'
          : `Google returned an error: ${oauthError}.`,
      );
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!stashed) {
      fail('Your connection session expired. Please start again from your profile.');
      return;
    }
    if (!state || state !== stashed.state) {
      fail('Security check failed (state mismatch). Please try connecting again.');
      return;
    }
    if (!code) {
      fail('Google did not return an authorization code. Please try again.');
      return;
    }

    void (async () => {
      try {
        await connectGoogleCalendarFn({
          authorizationCode: code,
          redirectUri: calendarRedirectUri(),
          scopesGranted: [CALENDAR_OAUTH_SCOPE],
        });
        clearStashedOAuthState();
        setPhase('success');
        // Brief success flash, then return the user to where they started.
        window.setTimeout(() => {
          void navigate(target, { replace: true });
        }, 1200);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect Google Calendar.';
        fail(message);
      }
    })();
  }, [navigate, searchParams]);

  return (
    <PageHeader title="Connecting Google Calendar" subtitle="Finishing the secure handshake.">
      <div className="mx-auto max-w-lg">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {phase === 'working' ? (
            <div className="flex items-center gap-3">
              <Loader2 className="text-ops-blue h-5 w-5 animate-spin" />
              <p className="text-sm text-gray-700">Connecting your Google Calendar…</p>
            </div>
          ) : null}

          {phase === 'success' ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <p className="text-sm text-gray-700">
                Google Calendar connected. Returning you to your profile…
              </p>
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-ops-red mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Couldn&apos;t connect</p>
                  <p className="text-ops-gray mt-1 text-sm">{errorMessage}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => void navigate(returnTo, { replace: true })}>
                Back to profile
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </PageHeader>
  );
}
