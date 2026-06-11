import { describe, expect, it } from 'vitest';
import { parseAudioRecordedAt } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in uploadAudio.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const {
  audioFileName,
  mimeTypeToExt,
  normalizeMimeType,
  validateAudioMimeType,
  sniffAudioMimeType,
} = await import('./uploadAudio.js');

describe('mimeTypeToExt', () => {
  it.each([
    ['audio/webm', 'webm'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/m4a', 'm4a'],
    ['audio/ogg', 'ogg'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/wav', 'wav'],
    ['application/octet-stream', 'webm'],
  ])('maps %s to .%s', (mime, ext) => {
    expect(mimeTypeToExt(mime)).toBe(ext);
  });
});

describe('audioFileName', () => {
  it('mints audio-<iso>.<ext> truncated to whole seconds', () => {
    const at = new Date('2026-06-10T14:30:45.678Z');
    expect(audioFileName('audio/webm', at)).toBe('audio-2026-06-10T14-30-45.webm');
  });

  it('uses the extension for the mime type', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(audioFileName('audio/mp4', at)).toBe('audio-2026-01-02T03-04-05.m4a');
  });

  it('produces a filename whose timestamp round-trips through parseAudioRecordedAt', () => {
    const at = new Date('2026-06-10T14:30:45.000Z');
    const name = audioFileName('audio/webm', at);
    const parsed = parseAudioRecordedAt(name);
    expect(parsed?.toISOString()).toBe(at.toISOString());
  });
});

describe('normalizeMimeType', () => {
  it('strips codec parameters', () => {
    expect(normalizeMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('handles MIME types without parameters', () => {
    expect(normalizeMimeType('audio/mp4')).toBe('audio/mp4');
  });

  it('lowercases the result', () => {
    expect(normalizeMimeType('AUDIO/WEBM')).toBe('audio/webm');
  });

  it('strips leading/trailing whitespace', () => {
    expect(normalizeMimeType('  audio/mp4  ')).toBe('audio/mp4');
  });

  it('handles multiple parameters', () => {
    expect(normalizeMimeType('audio/ogg;codecs=opus;sampling=16000')).toBe('audio/ogg');
  });
});

describe('validateAudioMimeType', () => {
  it.each(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'])(
    'accepts %s',
    (mime) => {
      expect(validateAudioMimeType(mime)).toBe(mime);
    },
  );

  it('accepts MIME types with codec parameters', () => {
    expect(validateAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('rejects unsupported MIME types', () => {
    expect(() => validateAudioMimeType('audio/flac')).toThrow(
      'Unsupported audio MIME type: audio/flac',
    );
  });

  it('rejects arbitrary MIME types', () => {
    expect(() => validateAudioMimeType('image/png')).toThrow(
      'Unsupported audio MIME type: image/png',
    );
  });

  it('sets HTTP 415 status on error', () => {
    try {
      validateAudioMimeType('video/mp4');
    } catch (err) {
      expect((err as Record<string, unknown>)['statusCode']).toBe(415);
    }
  });

  it('rejects empty MIME type', () => {
    expect(() => validateAudioMimeType('')).toThrow();
  });
});

describe('sniffAudioMimeType', () => {
  describe('webm (EBML)', () => {
    it('accepts valid webm header', () => {
      const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/webm', buffer)).toBe(true);
    });

    it('rejects invalid webm header', () => {
      const buffer = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/webm', buffer)).toBe(false);
    });

    it('allows inconclusive buffer (too short)', () => {
      const buffer = Buffer.from([0x1a, 0x45]);
      expect(sniffAudioMimeType('audio/webm', buffer)).toBe(true);
    });
  });

  describe('mp4 (ftyp)', () => {
    it('accepts ftyp signature at offset 4', () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
      expect(sniffAudioMimeType('audio/mp4', buffer)).toBe(true);
    });

    it('rejects missing ftyp', () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x20, 0xff, 0xfb, 0x90, 0x00]);
      expect(sniffAudioMimeType('audio/mp4', buffer)).toBe(false);
    });

    it('allows inconclusive buffer (too short)', () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x20]);
      expect(sniffAudioMimeType('audio/mp4', buffer)).toBe(true);
    });
  });

  describe('ogg (OggS)', () => {
    it('accepts valid ogg header', () => {
      const buffer = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/ogg', buffer)).toBe(true);
    });

    it('rejects invalid ogg header', () => {
      const buffer = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/ogg', buffer)).toBe(false);
    });
  });

  describe('wav (RIFF + WAVE)', () => {
    it('accepts valid wav header', () => {
      const buffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]);
      expect(sniffAudioMimeType('audio/wav', buffer)).toBe(true);
    });

    it('rejects invalid riff format', () => {
      const buffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00,
      ]);
      expect(sniffAudioMimeType('audio/wav', buffer)).toBe(false);
    });

    it('allows inconclusive buffer (too short)', () => {
      const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/wav', buffer)).toBe(true);
    });
  });

  describe('mpeg (MP3 frame sync or ID3)', () => {
    it('accepts MP3 frame sync header', () => {
      const buffer = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/mpeg', buffer)).toBe(true);
    });

    it('accepts ID3v2 tag', () => {
      const buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/mpeg', buffer)).toBe(true);
    });

    it('rejects invalid mp3', () => {
      const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/mpeg', buffer)).toBe(false);
    });
  });

  describe('cross-format sniffing', () => {
    it('rejects webm content labeled as mp4', () => {
      const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/mp4', webmBuffer)).toBe(false);
    });

    it('rejects ogg content labeled as webm', () => {
      const oggBuffer = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/webm', oggBuffer)).toBe(false);
    });

    it('rejects mp3 content labeled as wav', () => {
      const mp3Buffer = Buffer.from([
        0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(sniffAudioMimeType('audio/wav', mp3Buffer)).toBe(false);
    });
  });

  describe('codec parameters', () => {
    it('sniffs correctly with codec parameters', () => {
      const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
      expect(sniffAudioMimeType('audio/webm;codecs=opus', webmBuffer)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('allows empty buffer (inconclusive)', () => {
      expect(sniffAudioMimeType('audio/webm', Buffer.alloc(0))).toBe(true);
    });

    it('allows 1-byte buffer (inconclusive)', () => {
      expect(sniffAudioMimeType('audio/mp4', Buffer.from([0x00]))).toBe(true);
    });

    it('is permissive for unknown MIME types', () => {
      expect(sniffAudioMimeType('audio/unknown', Buffer.from([0xff, 0xfe, 0xfd, 0xfc]))).toBe(true);
    });
  });
});
