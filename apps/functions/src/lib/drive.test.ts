import { describe, expect, it } from 'vitest';
import {
  ResumableUploadGoneError,
  isResumableSessionUrl,
  parseResumableResponse,
} from './drive.js';

const SESSION =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&upload_id=ABC123';

describe('isResumableSessionUrl', () => {
  it('accepts a Drive resumable session URL', () => {
    expect(isResumableSessionUrl(SESSION)).toBe(true);
  });

  it('refuses other hosts, paths, schemes and URLs without an upload id', () => {
    for (const url of [
      SESSION.replace('www.googleapis.com', 'evil.example.com'),
      SESSION.replace('https://www.googleapis.com', 'https://www.googleapis.com.evil.example'),
      SESSION.replace('https:', 'http:'),
      SESSION.replace('/upload/drive/v3/files', '/drive/v3/files'),
      SESSION.replace('&upload_id=ABC123', ''),
      'http://169.254.169.254/computeMetadata/v1/',
      'not a url',
    ]) {
      expect(isResumableSessionUrl(url)).toBe(false);
    }
  });
});

describe('parseResumableResponse', () => {
  it('reads how much Drive has from a 308', async () => {
    const res = new Response(null, { status: 308, headers: { Range: 'bytes=0-8388607' } });
    expect(await parseResumableResponse(res)).toEqual({ done: false, received: 8388608 });
  });

  it('treats a 308 without Range as nothing received', async () => {
    expect(await parseResumableResponse(new Response(null, { status: 308 }))).toEqual({
      done: false,
      received: 0,
    });
  });

  it('returns the file when the last piece lands', async () => {
    const res = new Response(JSON.stringify({ id: 'f1', name: 'audio.webm' }), { status: 200 });
    expect(await parseResumableResponse(res)).toEqual({
      done: true,
      fileId: 'f1',
      fileName: 'audio.webm',
    });
  });

  it('reports an expired session so the upload can start over', async () => {
    await expect(parseResumableResponse(new Response('', { status: 404 }))).rejects.toBeInstanceOf(
      ResumableUploadGoneError,
    );
  });

  it('throws on other errors', async () => {
    await expect(
      parseResumableResponse(new Response('quota', { status: 403 })),
    ).rejects.toThrow(/403/);
  });
});
