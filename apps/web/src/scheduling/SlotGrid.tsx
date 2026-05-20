import { useMemo } from 'react';
import type { ObservationSlot } from '@ops/shared';
import { Button } from '@/components/ui/button';
import { formatLocalTime, formatYMD } from './slotTime';

type Slot = ObservationSlot & { id: string };

export interface SlotGridProps {
  /** Live slots for the invitee's building (caller filters by buildingId). */
  slots: Slot[];
  /** Currently chosen slot id, if any. */
  selectedSlotId: string | null;
  onSelect: (slot: Slot) => void;
  disabled?: boolean;
}

/**
 * Direct-mode slot picker. Slots are grouped by date; each period within a
 * day is a button. A slot is disabled the instant its status leaves
 * 'available' — that single field already reflects FCFS booking and
 * cross-building PE conflicts (both flow through slot status server-side).
 */
export function SlotGrid({ slots, selectedSlotId, onSelect, disabled = false }: SlotGridProps) {
  const byDate = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of slots) {
      const list = groups.get(slot.dateYMD);
      if (list) list.push(slot);
      else groups.set(slot.dateYMD, [slot]);
    }
    const dates = [...groups.keys()].sort();
    return dates.map((date) => {
      const daySlots = (groups.get(date) ?? [])
        .slice()
        .sort((a, b) => a.startMinute - b.startMinute);
      return { date, slots: daySlots };
    });
  }, [slots]);

  if (byDate.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No slots are currently available for your building.
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      {byDate.map((group) => (
        <div key={group.date} className="grid gap-2">
          <h3 className="text-ops-blue-dark text-sm font-semibold">{formatYMD(group.date)}</h3>
          <div className="flex flex-wrap gap-2">
            {group.slots.map((slot) => {
              const isAvailable = slot.status === 'available';
              const isSelected = slot.slotId === selectedSlotId;
              return (
                <Button
                  key={slot.id}
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  disabled={disabled || !isAvailable}
                  onClick={() => onSelect(slot)}
                >
                  {formatLocalTime(slot.startUTC)}
                  {slot.periodName ? ` · ${slot.periodName}` : ''}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
