import { describe, expect, it, vi } from 'vitest';
import type { AudioRecordingMeta } from '@ops/shared';

vi.mock('@/lib/firebase', () => ({ auth: {}, functionsHttpUrl: vi.fn() }));

import {
  audioExtension,
  formatRecordingDuration,
  recordingDownloadName,
  recordingTitle,
} from './recordings';

const meta = (overrides: Partial<AudioRecordingMeta> = {}): AudioRecordingMeta => ({
  recordedAt: new Date(2026, 8, 30, 9, 14),
  durationSec: 245,
  label: '',
  ...overrides,
});

describe('recordingTitle', () => {
  it('uses the label when set, else the list position', () => {
    expect(recordingTitle(meta({ label: 'Warm-up' }), 0)).toBe('Warm-up');
    expect(recordingTitle(meta({ label: '   ' }), 1)).toBe('Recording 2');
    expect(recordingTitle(undefined, 2)).toBe('Recording 3');
  });
});

describe('formatRecordingDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatRecordingDuration(245)).toBe('4:05');
    expect(formatRecordingDuration(3729)).toBe('1:02:09');
    expect(formatRecordingDuration(0)).toBe('0:00');
  });

  it('is null when unknown', () => {
    expect(formatRecordingDuration(null)).toBeNull();
    expect(formatRecordingDuration(undefined)).toBeNull();
  });
});

describe('recordingDownloadName', () => {
  it('builds <teacher>-<date>-<title>.<ext> with file-safe characters', () => {
    expect(
      recordingDownloadName({
        observedName: "Jane O'Doe",
        meta: meta(),
        title: 'Period 3: intro',
        mimeType: 'audio/webm;codecs=opus',
      }),
    ).toBe('Jane-O-Doe-2026-09-30-Period-3-intro.webm');
  });

  it('omits an unknown date and maps Safari mp4 to .m4a', () => {
    expect(
      recordingDownloadName({
        observedName: 'Jane Doe',
        meta: undefined,
        title: 'Recording 1',
        mimeType: 'audio/mp4',
      }),
    ).toBe('Jane-Doe-Recording-1.m4a');
  });
});

describe('audioExtension', () => {
  it('matches uploadAudio', () => {
    expect(audioExtension('audio/ogg')).toBe('ogg');
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('')).toBe('webm');
  });
});
