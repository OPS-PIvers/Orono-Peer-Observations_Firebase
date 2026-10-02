import { useState } from 'react';
import { OPS_BRAND, type Rubric } from '@ops/shared';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { derivePrimaryShades } from '@/components/BrandingProvider';
import { useBranding } from '@/hooks/useBranding';
import { AssignmentToggle } from './AssignmentToggle';
import {
  buildRubricPrintHtml,
  printHtmlDocument,
  VIEW_PRINT_CONTENT,
  type PrintScope,
  MAX_SCRIPT_PAGES,
  type RubricPrintContent,
} from './printRubric';

export interface PrintRubricMenuProps {
  rubric: Rubric;
  assignedComponentIds: ReadonlySet<string>;
  /** The scope currently shown on screen ("Assigned only" / "Full Rubric"). */
  scope: PrintScope;
  title: string;
  subtitle?: string;
  /** Observer printing from an observation: ask what to include first.
   *  Otherwise the printout matches what is on screen. */
  withOptions?: boolean;
  /** Observation id; makes the observer's printout scan-ready (see
   *  `RubricPrintOptions.scanId`). */
  observationId?: string;
  className?: string;
}

type ToggleKey = 'lookFors' | 'componentNotes' | 'overallNotes';

const OPTION_ROWS: { key: ToggleKey; label: string; hint: string }[] = [
  { key: 'lookFors', label: 'Include look-fors', hint: 'A checklist under each component.' },
  {
    key: 'componentNotes',
    label: 'Include space for notes',
    hint: 'Ruled lines under each component.',
  },
  {
    key: 'overallNotes',
    label: 'Include space for overall comments',
    hint: 'A ruled section at the end.',
  },
];

/**
 * "Print" button for the rubric. Builds a print document styled like the
 * on-screen rubric grid (portrait Letter) and opens the browser print
 * dialog, where it can also be saved as a PDF. With `withOptions`, a
 * dialog first lets an observer pick the scope and what to include.
 */
export function PrintRubricMenu({
  rubric,
  assignedComponentIds,
  scope,
  title,
  subtitle,
  withOptions = false,
  observationId,
  className,
}: PrintRubricMenuProps) {
  const branding = useBranding();
  const [open, setOpen] = useState(false);
  const [printScope, setPrintScope] = useState<PrintScope>(scope);
  const [content, setContent] = useState<RubricPrintContent>(VIEW_PRINT_CONTENT);
  const [scriptOn, setScriptOn] = useState(false);
  const [scriptCount, setScriptCount] = useState('1');
  const scriptPages = scriptOn
    ? Math.min(Math.max(parseInt(scriptCount, 10) || 1, 1), MAX_SCRIPT_PAGES)
    : 0;

  const print = (s: PrintScope, c: RubricPrintContent, scanId?: string) => {
    // Same rule as BrandingProvider: the stock blue keeps the exact
    // DESIGN.md dark shade; a custom primary gets a derived one.
    const primaryDarkColor =
      branding.primaryColor.toLowerCase() === OPS_BRAND.defaultPrimaryColor.toLowerCase()
        ? '#1d2a5d'
        : derivePrimaryShades(branding.primaryColor).dark;
    printHtmlDocument(
      buildRubricPrintHtml({
        rubric,
        assignedComponentIds,
        scope: s,
        content: c,
        title,
        ...(subtitle ? { subtitle } : {}),
        appName: branding.appName,
        primaryColor: branding.primaryColor,
        primaryDarkColor,
        ...(scanId ? { scanId } : {}),
      }),
    );
  };

  const onClick = () => {
    if (!withOptions) {
      print(scope, VIEW_PRINT_CONTENT);
      return;
    }
    setPrintScope(scope);
    setOpen(true);
  };

  return (
    <>
      <Button variant="outline" size="sm" className={className} onClick={onClick}>
        <Printer />
        Print
      </Button>
      {withOptions ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Print rubric</DialogTitle>
              <DialogDescription>Choose what to include on the printout.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Components</p>
                <AssignmentToggle value={printScope} onChange={setPrintScope} />
              </div>
              <div className="space-y-1">
                {OPTION_ROWS.map((row) => (
                  <label
                    key={row.key}
                    htmlFor={`print-opt-${row.key}`}
                    className="hover:bg-ops-blue-lighter/30 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2"
                  >
                    <input
                      id={`print-opt-${row.key}`}
                      type="checkbox"
                      checked={content[row.key]}
                      onChange={(e) => setContent({ ...content, [row.key]: e.target.checked })}
                      className="accent-ops-blue mt-0.5 h-4 w-4 rounded"
                    />
                    <span className="text-sm font-medium">
                      {row.label}
                      <span className="text-muted-foreground block text-xs font-normal">
                        {row.hint}
                      </span>
                    </span>
                  </label>
                ))}
                <div className="hover:bg-ops-blue-lighter/30 flex items-start gap-3 rounded-md px-2 py-2">
                  <input
                    id="print-opt-script"
                    type="checkbox"
                    checked={scriptOn}
                    onChange={(e) => setScriptOn(e.target.checked)}
                    className="accent-ops-blue mt-0.5 h-4 w-4 rounded"
                  />
                  <label
                    htmlFor="print-opt-script"
                    className="flex-1 cursor-pointer text-sm font-medium"
                  >
                    Include script pages
                    <span className="text-muted-foreground block text-xs font-normal">
                      Lined pages at the end for scripting the lesson.
                    </span>
                  </label>
                  {scriptOn ? (
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_SCRIPT_PAGES}
                      value={scriptCount}
                      onChange={(e) => setScriptCount(e.target.value)}
                      onBlur={() => setScriptCount(String(scriptPages))}
                      aria-label="Number of script pages"
                      className="h-8 w-16"
                    />
                  ) : null}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  print(printScope, { ...content, scriptPages }, observationId);
                }}
              >
                <Printer />
                Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
