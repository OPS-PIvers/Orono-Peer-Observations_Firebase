import { describe, expect, it } from 'vitest';
import { canDeleteObservationFolder } from './drive.js';

/**
 * Guard tests for deleteDriveFolder's defense-in-depth parent check:
 * Draft-delete cleanup must only ever remove a folder that actually
 * lives under the district observations parent. A spoofed driveFolderId
 * (the parent itself, another observation's folder reparented elsewhere,
 * or any foreign Drive id) must be refused.
 */

const PARENT = 'district-parent-folder';

describe('canDeleteObservationFolder', () => {
  it('allows a folder that is a direct child of the observations parent', () => {
    expect(
      canDeleteObservationFolder({
        folderId: 'obs-folder',
        parents: [PARENT],
        expectedParentFolderId: PARENT,
      }),
    ).toBe(true);
  });

  it('allows when the observations parent is one of several parents', () => {
    expect(
      canDeleteObservationFolder({
        folderId: 'obs-folder',
        parents: ['shared-drive-shortcut', PARENT],
        expectedParentFolderId: PARENT,
      }),
    ).toBe(true);
  });

  it('refuses the observations parent folder itself', () => {
    expect(
      canDeleteObservationFolder({
        folderId: PARENT,
        parents: ['drive-root'],
        expectedParentFolderId: PARENT,
      }),
    ).toBe(false);
  });

  it('refuses the parent folder even if its parents claim to include itself', () => {
    expect(
      canDeleteObservationFolder({
        folderId: PARENT,
        parents: [PARENT],
        expectedParentFolderId: PARENT,
      }),
    ).toBe(false);
  });

  it('refuses a folder living elsewhere in Drive', () => {
    expect(
      canDeleteObservationFolder({
        folderId: 'foreign-folder',
        parents: ['someone-elses-tree'],
        expectedParentFolderId: PARENT,
      }),
    ).toBe(false);
  });

  it('refuses a folder with no parent metadata', () => {
    expect(
      canDeleteObservationFolder({
        folderId: 'orphan-folder',
        parents: [],
        expectedParentFolderId: PARENT,
      }),
    ).toBe(false);
  });
});
