import type { ComponentColor, RubricComponent } from '@ops/shared';

const DEFAULT_COLOR: ComponentColor = { bg: '#eaecf5', fg: '#1d2a5d' };

const FALLBACK_PALETTE: readonly ComponentColor[] = [
  { bg: '#dbeafe', fg: '#1e3a8a' },
  { bg: '#fef3c7', fg: '#78350f' },
  { bg: '#dcfce7', fg: '#14532d' },
  { bg: '#fce7f3', fg: '#831843' },
  { bg: '#ede9fe', fg: '#4c1d95' },
  { bg: '#ffedd5', fg: '#7c2d12' },
  { bg: '#cffafe', fg: '#164e63' },
  { bg: '#fee2e2', fg: '#7f1d1d' },
  { bg: '#e0e7ff', fg: '#312e81' },
  { bg: '#f3e8ff', fg: '#581c87' },
  { bg: '#ccfbf1', fg: '#134e4a' },
  { bg: '#fef9c3', fg: '#713f12' },
];

function hashStringToInt(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorFor(component: Pick<RubricComponent, 'id' | 'color'>): ComponentColor {
  if (component.color) return component.color;
  const idx = hashStringToInt(component.id) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx] ?? DEFAULT_COLOR;
}
