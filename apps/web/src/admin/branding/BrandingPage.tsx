import { useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { Trash2, Upload } from 'lucide-react';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OPS_BRAND,
  PRIMARY_COLOR_HEX_PATTERN,
  branding,
  type AppSettings,
  type Branding,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db, storage } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Validate a branding draft before persisting.
 *
 * Returns an array of human-readable error messages, or an empty array when
 * the draft is valid.
 */
export function validateBrandingDraft(draft: Partial<Branding>): string[] {
  const result = branding.partial().safeParse(draft);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

export function BrandingPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  const [appName, setAppName] = useState<string>(OPS_BRAND.defaultAppName);
  const [primaryColor, setPrimaryColor] = useState<string>(OPS_BRAND.defaultPrimaryColor);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);

  // Hydrate once; later snapshots would clobber in-progress edits. Issue #3.
  useHydratedDraft(SETTINGS_PATH, data?.branding ?? null, (branding) => {
    setAppName(branding.appName);
    setPrimaryColor(branding.primaryColor);
    setLogoUrl(branding.logoUrl ?? null);
    setIconUrl(branding.iconUrl ?? null);
  });

  if (loading && !data) return <p className="text-muted-foreground">Loading branding…</p>;

  async function save() {
    // Empty input means "use the default"; anything else must be a 6-digit
    // hex color — the same shape the shared branding schema enforces.
    const nextColor = primaryColor.trim() || OPS_BRAND.defaultPrimaryColor;
    if (!PRIMARY_COLOR_HEX_PATTERN.test(nextColor)) {
      setColorError('Enter a 6-digit hex color like #2d3f89.');
      return;
    }
    setColorError(null);

    const candidate = {
      appName: appName.trim() || OPS_BRAND.defaultAppName,
      primaryColor: nextColor,
      logoUrl,
      iconUrl,
    };
    const validationErrors = validateBrandingDraft(candidate);
    if (validationErrors.length > 0) {
      setSaveError(validationErrors.join(' · '));
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await setDoc(
        doc(db, SETTINGS_PATH),
        {
          branding: candidate,
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
      variant="light"
      breadcrumb={['Admin', 'Branding']}
      title="Branding"
      subtitle="Override the default OPS Tech branding. Defaults pull from DESIGN.md; admin overrides live in /appSettings/global."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load branding: {error.message}
        </div>
      ) : null}

      <div className="grid max-w-2xl gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
        <Card className="space-y-6 p-6">
          <div className="grid gap-2">
            <Label htmlFor="appName">App name</Label>
            <Input
              id="appName"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder={OPS_BRAND.defaultAppName}
            />
            <p className="text-muted-foreground text-xs">
              Shown in the top nav, sign-in screen (after first sign-in on this device), and email
              subject lines.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="primaryColor">Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                id="primaryColor"
                type="color"
                value={PRIMARY_COLOR_HEX_PATTERN.test(primaryColor) ? primaryColor : '#000000'}
                onChange={(e) => {
                  setPrimaryColor(e.target.value);
                  setColorError(null);
                }}
                className="border-input h-10 w-14 cursor-pointer rounded-md border"
              />
              <Input
                value={primaryColor}
                onChange={(e) => {
                  setPrimaryColor(e.target.value);
                  setColorError(null);
                }}
                className="font-mono"
                placeholder="#2d3f89"
                aria-label="Primary color hex value"
                aria-invalid={colorError ? true : undefined}
                aria-describedby={colorError ? 'primaryColorError' : undefined}
              />
            </div>
            {colorError ? (
              <p id="primaryColorError" role="alert" className="text-ops-red-dark text-xs">
                {colorError}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Default is OPS Primary Blue. Changes re-theme the app immediately after saving.
              </p>
            )}
          </div>

          <LogoUploader
            label="Primary logo"
            help="Horizontal logo used in the top nav, sign-in screen (after first sign-in on this device), and email header. PNG with transparent background works best."
            kind="logo"
            url={logoUrl}
            onChange={setLogoUrl}
            onError={setSaveError}
            previewBg="#ffffff"
          />

          <LogoUploader
            label="Square icon"
            help="Square mark used in compact spots and as the browser favicon (when no primary logo is present)."
            kind="icon"
            url={iconUrl}
            onChange={setIconUrl}
            onError={setSaveError}
            previewBg="#ffffff"
          />

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
        </Card>

        <aside className="border-border bg-background rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium">Preview</h2>
          <div
            className="flex items-center gap-2 rounded-md p-4 text-white"
            style={{ backgroundColor: primaryColor || OPS_BRAND.defaultPrimaryColor }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="max-h-8 w-auto" />
            ) : (
              <span className="font-heading text-base font-semibold">{appName}</span>
            )}
          </div>
        </aside>
      </div>
    </PageHeader>
  );
}

function LogoUploader({
  label,
  help,
  kind,
  url,
  onChange,
  onError,
  previewBg,
}: {
  label: string;
  help: string;
  kind: 'logo' | 'icon';
  url: string | null;
  onChange: (url: string | null) => void;
  onError: (msg: string | null) => void;
  previewBg: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      onError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      onError('Image is too large (max 2 MB).');
      return;
    }
    setUploading(true);
    onError(null);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `admin-uploads/branding/${kind}-${String(Date.now())}.${ext}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file, { contentType: file.type });
      onChange(await getDownloadURL(r));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div
          className="border-input flex h-16 w-28 items-center justify-center overflow-hidden rounded-md border"
          style={{ backgroundColor: previewBg }}
        >
          {url ? (
            <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-muted-foreground text-xs">No image</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload'}
          </Button>
          {url ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onChange(null)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{help}</p>
    </div>
  );
}
