import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeCSVField, rowToCSV, generateCSV, downloadCSV } from './exportCsv';

describe('exportCsv', () => {
  describe('escapeCSVField', () => {
    it('returns field as-is when no special characters', () => {
      expect(escapeCSVField('simple')).toBe('simple');
      expect(escapeCSVField('John Doe')).toBe('John Doe');
    });

    it('wraps and escapes field with comma', () => {
      expect(escapeCSVField('Smith, Jr.')).toBe('"Smith, Jr."');
    });

    it('wraps and escapes field with quote', () => {
      expect(escapeCSVField('Says "hello"')).toBe('"Says ""hello"""');
    });

    it('wraps and escapes field with newline', () => {
      expect(escapeCSVField('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('handles field with multiple special characters', () => {
      expect(escapeCSVField('John "Jack" Smith, Jr.\nEvergreen')).toBe(
        '"John ""Jack"" Smith, Jr.\nEvergreen"',
      );
    });

    it('handles empty string', () => {
      expect(escapeCSVField('')).toBe('');
    });
  });

  describe('rowToCSV', () => {
    it('converts simple row to CSV line', () => {
      const row = { name: 'John', email: 'john@test.com', role: 'Teacher' };
      const keys = ['name', 'email', 'role'];
      expect(rowToCSV(row, keys)).toBe('John,john@test.com,Teacher');
    });

    it('escapes fields that need escaping', () => {
      const row = { name: 'Smith, Jr.', email: 'smith@test.com', role: 'Co-Teacher' };
      const keys = ['name', 'email', 'role'];
      expect(rowToCSV(row, keys)).toBe('"Smith, Jr.",smith@test.com,Co-Teacher');
    });

    it('handles missing fields gracefully', () => {
      const row = { name: 'John', email: 'john@test.com' };
      const keys = ['name', 'email', 'role'];
      expect(rowToCSV(row, keys)).toBe('John,john@test.com,');
    });

    it('respects key order', () => {
      const row = { name: 'John', email: 'john@test.com', role: 'Teacher' };
      const keys = ['email', 'name', 'role'];
      expect(rowToCSV(row, keys)).toBe('john@test.com,John,Teacher');
    });
  });

  describe('generateCSV', () => {
    it('generates CSV with header and one row', () => {
      const rows = [{ name: 'John', email: 'john@test.com' }];
      const headers = ['Name', 'Email'];
      const keys = ['name', 'email'];
      const csv = generateCSV(rows, headers, keys);
      const lines = csv.split('\n');
      // First line includes UTF-8 BOM character
      expect(lines[0]).toBe('\u{FEFF}Name,Email');
      expect(lines[1]).toBe('John,john@test.com');
    });

    it('generates CSV with multiple rows', () => {
      const rows = [
        { name: 'John', role: 'Teacher' },
        { name: 'Jane', role: 'Admin' },
      ];
      const headers = ['Name', 'Role'];
      const keys = ['name', 'role'];
      const csv = generateCSV(rows, headers, keys);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[0]).toContain('Name,Role');
      expect(lines[1]).toBe('John,Teacher');
      expect(lines[2]).toBe('Jane,Admin');
    });

    it('escapes special characters in CSV output', () => {
      const rows = [{ name: 'Smith, Jr.', email: 'smith@test.com' }];
      const headers = ['Name', 'Email'];
      const keys = ['name', 'email'];
      const csv = generateCSV(rows, headers, keys);
      const lines = csv.split('\n');
      expect(lines[1]).toBe('"Smith, Jr.",smith@test.com');
    });

    it('handles empty rows array', () => {
      const csv = generateCSV([], ['Name', 'Email'], ['name', 'email']);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(1); // just header
      expect(lines[0]).toContain('Name,Email');
    });
  });

  describe('downloadCSV', () => {
    beforeEach(() => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(document, 'createElement').mockReturnValue(
        Object.assign(document.createElement('a'), {
          click: vi.fn(),
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates a download link and triggers click', () => {
      const createElementSpy = vi.spyOn(document, 'createElement');
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      downloadCSV('test,data\n1,2', 'test.csv');

      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
    });
  });
});
