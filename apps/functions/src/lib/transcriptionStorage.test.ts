import { describe, expect, it } from 'vitest';
import { parseGcsUri } from './transcriptionStorage.js';

describe('parseGcsUri', () => {
  it('splits a gs:// URI into bucket and object', () => {
    expect(parseGcsUri('gs://my-bucket/transcription/job123')).toEqual({
      bucket: 'my-bucket',
      object: 'transcription/job123',
    });
  });

  it('returns null for legacy Gemini Files URIs and junk', () => {
    expect(parseGcsUri('files/abc123')).toBeNull();
    expect(parseGcsUri('https://generativelanguage.googleapis.com/v1beta/files/abc')).toBeNull();
    expect(parseGcsUri('gs://bucket-only')).toBeNull();
  });
});
