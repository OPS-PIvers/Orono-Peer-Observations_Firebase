import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Thin render-prop wrapper around @dnd-kit/sortable's useSortable. The
 * sortable list itself (DndContext + SortableContext) lives in the
 * caller, since drag handlers depend on the caller's data shape.
 *
 * Children receive a `dragHandleProps` object — spread it on the element
 * that should be the drag handle (usually a small grip icon button), so
 * the rest of the row stays interactive (toggles, inputs, etc.).
 */

export interface SortableItemProps {
  id: string;
  children: (api: {
    isDragging: boolean;
    dragHandleProps: React.HTMLAttributes<HTMLElement>;
  }) => React.ReactNode;
  className?: string;
}

export function SortableItem({ id, children, className }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  // `attributes` are aria-* hints; `listeners` are pointer/keyboard
  // events. Both must land on the handle, not the whole row, so users
  // can still click inputs.
  const dragHandleProps: React.HTMLAttributes<HTMLElement> = {
    ...attributes,
    ...(listeners as React.HTMLAttributes<HTMLElement>),
  };
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ isDragging, dragHandleProps })}
    </div>
  );
}

/**
 * Standard grip handle button — spread `dragHandleProps` onto it.
 * Renders the lucide GripVertical icon at the size most rows want.
 */
export function GripHandle({
  dragHandleProps,
  label = 'Drag to reorder',
}: {
  dragHandleProps: React.HTMLAttributes<HTMLElement>;
  label?: string;
}) {
  return (
    <button
      type="button"
      {...dragHandleProps}
      aria-label={label}
      className={cn(
        'text-muted-foreground hover:bg-muted inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md',
        'active:cursor-grabbing',
      )}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}
