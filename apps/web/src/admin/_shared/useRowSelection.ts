import { useCallback, useState } from 'react';

export interface UseRowSelectionResult {
  selectMode: boolean;
  selected: Set<string>;
  toggleRow: (id: string) => void;
  toggleAll: (visibleIds: string[]) => void;
  clear: () => void;
  toggleSelectMode: () => void;
}

/**
 * Row-selection state shared by every admin list that wires up
 * AdminDataView's `selection` prop — select-mode toggle, per-row toggle,
 * select-all-visible, and clear. Lifted out of StaffPage so the same
 * checkbox/select-mode behavior is available to ModulesPage, BuildingsPage,
 * RolesPage, etc. without re-deriving it per page.
 */
export function useRowSelection(): UseRowSelectionResult {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((visibleIds: string[]) => {
    setSelected((prev) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((m) => !m);
    setSelected(new Set());
  }, []);

  return { selectMode, selected, toggleRow, toggleAll, clear, toggleSelectMode };
}
