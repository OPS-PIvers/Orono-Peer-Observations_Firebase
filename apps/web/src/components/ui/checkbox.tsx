import * as React from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Indeterminate state — drawn as a solid bar; not part of native input. */
  indeterminate?: boolean;
}

/**
 * Brand-styled native checkbox. Uses `accent-color` so the check uses the
 * OPS blue without bringing in @radix-ui/react-checkbox. Supports an
 * `indeterminate` prop for header-level select-all-some states.
 *
 * Sized at 18px to feel substantial on touch and align with body text.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
      ref,
      () => innerRef.current,
    );
    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);
    return (
      <input
        ref={innerRef}
        type="checkbox"
        className={cn(
          'accent-ops-blue border-input h-[18px] w-[18px] shrink-0 cursor-pointer rounded',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';
