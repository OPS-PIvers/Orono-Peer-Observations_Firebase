import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField, UrlField, isOpenableUrl, urlTail } from './fields';

describe('urlTail', () => {
  it('returns null for values that fit', () => {
    expect(urlTail('https://short.test/x')).toBeNull();
  });
  it('returns the last N characters with a leading ellipsis', () => {
    const long = `https://drive.google.com/file/d/${'A'.repeat(40)}/view?usp=sharing`;
    const tail = urlTail(long, 20);
    expect(tail).toBe(`…${long.slice(-20)}`);
  });
});

describe('isOpenableUrl', () => {
  it('accepts http(s) only', () => {
    expect(isOpenableUrl('https://x.test')).toBe(true);
    expect(isOpenableUrl('http://x.test')).toBe(true);
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('/my-rubric')).toBe(false);
    expect(isOpenableUrl('')).toBe(false);
  });
});

describe('TextField', () => {
  it('uses a text-sm label and wires the error to the input', () => {
    render(<TextField label="Title" value="" onChange={() => undefined} error="Required." />);
    const label = screen.getByText('Title');
    expect(label.className).toContain('text-sm');
    expect(label.className).not.toContain('text-xs');
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Required.');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('renders no alert when there is no error', () => {
    render(<TextField label="Title" value="x" onChange={() => undefined} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid');
  });
});

describe('UrlField', () => {
  it('shows the tail of a long link and an Open link', () => {
    const long = `https://drive.google.com/file/d/${'A'.repeat(40)}/view?usp=sharing`;
    render(<UrlField label="URL" value={long} onChange={() => undefined} />);
    expect(screen.getByText(`…${long.slice(-44)}`)).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /open link/i });
    expect(open).toHaveAttribute('href', long);
    expect(open).toHaveAttribute('target', '_blank');
  });

  it('shows neither for a short relative path', () => {
    render(<UrlField label="URL" value="/my-rubric" onChange={() => undefined} />);
    expect(screen.queryByText(/End of link/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
