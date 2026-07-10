import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface AdminSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * Free-text filter box used across admin list pages (Staff, Modules,
 * Buildings, Roles, Rubrics). Purely a controlled text input — pages own
 * the actual filtering logic since what fields get matched differs per
 * entity (e.g. Staff also matches building names, Modules match module ID).
 */
export function AdminSearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  'aria-label': ariaLabel,
}: AdminSearchInputProps) {
  return (
    <div className={cn('relative max-w-md', className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="pr-9 pl-9"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
