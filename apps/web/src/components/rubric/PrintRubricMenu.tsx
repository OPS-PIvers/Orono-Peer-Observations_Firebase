import type { Rubric } from '@ops/shared';
import { ChevronDown, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBranding } from '@/hooks/useBranding';
import { buildRubricPrintHtml, printHtmlDocument, type PrintScope } from './printRubric';

export interface PrintRubricMenuProps {
  rubric: Rubric;
  assignedComponentIds: ReadonlySet<string>;
  title: string;
  subtitle?: string;
  className?: string;
}

/**
 * "Print" button with a choice of assigned components or the full rubric.
 * Builds a clean, print-formatted document (not a print of the interactive
 * grid) and opens the browser print dialog, where it can also be saved as
 * a PDF.
 */
export function PrintRubricMenu({
  rubric,
  assignedComponentIds,
  title,
  subtitle,
  className,
}: PrintRubricMenuProps) {
  const branding = useBranding();

  const print = (scope: PrintScope) => {
    printHtmlDocument(
      buildRubricPrintHtml({
        rubric,
        assignedComponentIds,
        scope,
        title,
        ...(subtitle ? { subtitle } : {}),
        appName: branding.appName,
        primaryColor: branding.primaryColor,
      }),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <Printer />
          Print
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => print('assigned')}>Assigned components</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => print('full')}>Full rubric</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
