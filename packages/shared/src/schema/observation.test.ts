import { describe, expect, it } from 'vitest';
import { observationComponentEntry, parseAudioRecordedAt } from './observation.js';

describe('observationComponentEntry schema', () => {
  it('no longer includes scratchNotes field', () => {
    const entry = observationComponentEntry.parse({
      proficiency: 'proficient',
      selectedLookForIds: [],
    });
    expect(entry).toEqual({
      proficiency: 'proficient',
      selectedLookForIds: [],
    });
    expect('scratchNotes' in entry).toBe(false);
  });

  it('uses only proficiency and selectedLookForIds', () => {
    const entry = observationComponentEntry.parse({
      proficiency: null,
      selectedLookForIds: ['lf1', 'lf2'],
    });
    expect(entry.proficiency).toBe(null);
    expect(entry.selectedLookForIds).toEqual(['lf1', 'lf2']);
  });
});

describe('parseAudioRecordedAt', () => {
  it('parses the minted audio-<iso>.<ext> filename as a UTC instant', () => {
    const at = parseAudioRecordedAt('audio-2026-06-10T14-30-45.webm');
    expect(at).not.toBeNull();
    expect(at?.toISOString()).toBe('2026-06-10T14:30:45.000Z');
  });

  it('parses regardless of extension', () => {
    expect(parseAudioRecordedAt('audio-2026-01-02T03-04-05.m4a')?.toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    expect(parseAudioRecordedAt('audio-2026-01-02T03-04-05.ogg')?.toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('returns null for a filename that does not match the minted pattern', () => {
    expect(parseAudioRecordedAt('recording.webm')).toBeNull();
    expect(parseAudioRecordedAt('audio.webm')).toBeNull();
    expect(parseAudioRecordedAt('my-audio-2026-06-10T14-30-45.webm')).toBeNull();
  });

  it('returns null when the timestamp digits are the wrong width', () => {
    // The minted format zero-pads every field; a single-digit month/day is not
    // a filename uploadAudio ever produces, so it should not parse.
    expect(parseAudioRecordedAt('audio-2026-6-10T14-30-45.webm')).toBeNull();
    expect(parseAudioRecordedAt('audio-26-06-10T14-30-45.webm')).toBeNull();
  });

  it('is the inverse of the uploadAudio filename format', () => {
    const iso = new Date('2026-12-31T23:59:59.000Z').toISOString();
    const fileName = `audio-${iso.replace(/[:.]/g, '-').slice(0, 19)}.webm`;
    expect(parseAudioRecordedAt(fileName)?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });
});
