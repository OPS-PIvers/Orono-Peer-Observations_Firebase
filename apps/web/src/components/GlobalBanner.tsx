import { Megaphone } from 'lucide-react';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, type AppSettings } from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

/**
 * District-wide announcement strip driven by `globalBannerText` on
 * `/appSettings/global` (Admin → Settings). Rendered by `<Layout>` directly
 * under the AppHeader so it appears on every authenticated page while the
 * text is non-empty, and disappears on the next snapshot once an admin
 * clears the field.
 *
 * Deliberately has no dismiss affordance — admins use this for notices that
 * must stay visible (cutover windows, planned downtime, deadlines). The
 * outer live region stays mounted even when empty so screen readers
 * announce a banner that an admin sets mid-session.
 */
export function GlobalBanner() {
  const { data } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  // Firestore reads bypass Zod defaults, so docs written before the field
  // existed surface `undefined` despite the non-optional type — coalesce
  // before trimming.
  const text = (data?.globalBannerText ?? '').trim();

  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {text ? (
        <div className="bg-ops-blue-lighter text-ops-blue-dark flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium">
          <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{text}</span>
        </div>
      ) : null}
    </div>
  );
}
