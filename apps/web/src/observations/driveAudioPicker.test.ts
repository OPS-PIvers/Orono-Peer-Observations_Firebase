import { describe, expect, it } from 'vitest';
import { labelFromFileName, normalizeAudioMimeType } from './driveAudioPicker';

describe('normalizeAudioMimeType', () => {
  it('stores Voice Memos (audio/x-m4a) as audio/mp4', () => {
    expect(normalizeAudioMimeType('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeAudioMimeType('audio/m4a')).toBe('audio/mp4');
    expect(normalizeAudioMimeType('video/mp4')).toBe('audio/mp4');
  });

  it('maps common aliases to their standard names', () => {
    expect(normalizeAudioMimeType('audio/mp3')).toBe('audio/mpeg');
    expect(normalizeAudioMimeType('audio/x-wav')).toBe('audio/wav');
    expect(normalizeAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMimeType('AUDIO/AAC')).toBe('audio/aac');
  });

  it('rejects formats transcription cannot read', () => {
    expect(normalizeAudioMimeType('audio/x-caf')).toBeNull();
    expect(normalizeAudioMimeType('application/pdf')).toBeNull();
    expect(normalizeAudioMimeType('')).toBeNull();
  });
});

describe('labelFromFileName', () => {
  it('drops the extension', () => {
    expect(labelFromFileName('New Recording 12.m4a', 80)).toBe('New Recording 12');
  });

  it('keeps names without an extension and trims to the limit', () => {
    expect(labelFromFileName('Period 3 intro', 80)).toBe('Period 3 intro');
    expect(labelFromFileName('abcdefghij.mp3', 4)).toBe('abcd');
  });
});
