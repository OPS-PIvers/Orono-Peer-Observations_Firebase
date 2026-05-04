import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, OPS_BRAND, type AppSettings } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

export function BrandingPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  const [appName, setAppName] = useState<string>(OPS_BRAND.defaultAppName);
  const [primaryColor, setPrimaryColor] = useState<string>(OPS_BRAND.defaultPrimaryColor);
  const [logoDriveFileId, setLogoDriveFileId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Hydrate once; later snapshots would clobber in-progress edits. Issue #3.
  useHydratedDraft(SETTINGS_PATH, data?.branding ?? null, (branding) => {
    setAppName(branding.appName);
    setPrimaryColor(branding.primaryColor);
    setLogoDriveFileId(branding.logoDriveFileId ?? '');
  });

  if (loading && !data) return <p className="text-muted-foreground">Loading branding…</p>;

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const trimmedLogo = logoDriveFileId.trim();
      await setDoc(
        doc(db, SETTINGS_PATH),
        {
          branding: {
            appName: appName.trim() || OPS_BRAND.defaultAppName,
            primaryColor: primaryColor || OPS_BRAND.defaultPrimaryColor,
            logoDriveFileId: trimmedLogo === '' ? null : trimmedLogo,
          },
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
        },
        { merge: true },
      );
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageHeader
      title="Branding"
      subtitle="Override the default OPS Tech branding. Defaults pull from DESIGN.md; admin overrides live in /appSettings/global."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load branding: {error.message}
        </div>
      ) : null}

      <div className="grid max-w-2xl gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="border-border bg-background space-y-6 rounded-lg border p-6">
          <div className="grid gap-2">
            <Label htmlFor="appName">App name</Label>
            <Input
              id="appName"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder={OPS_BRAND.defaultAppName}
            />
            <p className="text-muted-foreground text-xs">
              Shown in the top nav, sign-in screen, and email subject lines.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="primaryColor">Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                id="primaryColor"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="border-input h-10 w-14 cursor-pointer rounded-md border"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="font-mono"
                placeholder="#2d3f89"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Default is OPS Primary Blue. Changes apply on next page load.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="logoDriveFileId">Logo Drive file ID</Label>
            <Input
              id="logoDriveFileId"
              value={logoDriveFileId}
              onChange={(e) => setLogoDriveFileId(e.target.value)}
              placeholder="(use packaged OPS Primary Logo)"
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              Drive file ID of an alternative logo. Leave blank to use the packaged OPS Tech Primary
              Logo. Upload UI lands in Phase 7 polish.
            </p>
          </div>

          {saveError ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {saveError}
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            {savedAt ? (
              <p className="text-muted-foreground text-xs">
                Saved at {savedAt.toLocaleTimeString()}
              </p>
            ) : (
              <span />
            )}
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save branding'}
            </Button>
          </div>
        </div>

        <aside className="border-border bg-background rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium">Preview</h2>
          <div
            className="rounded-md p-4 text-white"
            style={{ backgroundColor: primaryColor || OPS_BRAND.defaultPrimaryColor }}
          >
            <span className="font-heading text-base font-semibold">{appName}</span>
          </div>
        </aside>
      </div>
    </PageHeader>
  );
}
