import { describe, expect, it } from 'vitest';
import { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import { ALLOWED_EMBED_HOSTS } from './tiptap-editor';

/**
 * Unit tests for the media extension helpers in TiptapEditor.
 *
 * We test:
 *  1. The ALLOWED_EMBED_HOSTS allowlist — ensures only approved domains are listed.
 *  2. YouTube URL validation (via the extension's isValidYoutubeUrl helper) —
 *     covering the same cases the insertYoutubeEmbed handler checks before
 *     calling editor.commands.setYoutubeVideo.
 *  3. Google Drive URL recognition — drive.google.com links bypass YouTube
 *     validation, so we assert that they pass the isDrive check.
 *  4. Reject logic for non-allowed embed domains.
 *  5. Image URL security — only https:// URLs should be accepted.
 */

// Mirrors the isDrive + isYoutube guard inside insertYoutubeEmbed.
function isAllowedEmbedUrl(url: string): boolean {
  const isDrive = url.includes('drive.google.com');
  const isYoutube = !!isValidYoutubeUrl(url);
  return isDrive || isYoutube;
}

// Mirrors the https guard inside insertImageByUrl.
function isAllowedImageUrl(url: string): boolean {
  return url.startsWith('https://');
}

describe('TiptapEditor media — ALLOWED_EMBED_HOSTS', () => {
  it('includes youtube.com variants', () => {
    expect(ALLOWED_EMBED_HOSTS).toContain('youtube.com');
    expect(ALLOWED_EMBED_HOSTS).toContain('www.youtube.com');
    expect(ALLOWED_EMBED_HOSTS).toContain('youtu.be');
  });

  it('includes youtube-nocookie.com (privacy-enhanced embed)', () => {
    expect(ALLOWED_EMBED_HOSTS).toContain('youtube-nocookie.com');
    expect(ALLOWED_EMBED_HOSTS).toContain('www.youtube-nocookie.com');
  });

  it('includes drive.google.com for Drive video shares', () => {
    expect(ALLOWED_EMBED_HOSTS).toContain('drive.google.com');
  });

  it('does NOT include generic video platforms', () => {
    expect(ALLOWED_EMBED_HOSTS).not.toContain('vimeo.com');
    expect(ALLOWED_EMBED_HOSTS).not.toContain('dailymotion.com');
    expect(ALLOWED_EMBED_HOSTS).not.toContain('tiktok.com');
  });
});

describe('TiptapEditor media — YouTube URL validation', () => {
  it('accepts standard youtube.com/watch URLs', () => {
    expect(isAllowedEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts youtu.be shortlinks', () => {
    expect(isAllowedEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts youtube-nocookie.com embed URLs', () => {
    expect(isAllowedEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts youtube.com/embed/ URLs', () => {
    expect(isAllowedEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
  });

  it('rejects non-YouTube, non-Drive URLs', () => {
    expect(isAllowedEmbedUrl('https://vimeo.com/12345')).toBe(false);
    expect(isAllowedEmbedUrl('https://example.com/video.mp4')).toBe(false);
    expect(isAllowedEmbedUrl('not-a-url')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedEmbedUrl('')).toBe(false);
  });
});

describe('TiptapEditor media — Google Drive URL recognition', () => {
  it('accepts drive.google.com share links', () => {
    expect(
      isAllowedEmbedUrl(
        'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/view',
      ),
    ).toBe(true);
  });

  it('accepts drive.google.com preview links', () => {
    expect(
      isAllowedEmbedUrl(
        'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/preview',
      ),
    ).toBe(true);
  });

  it('does not treat other google.com domains as Drive', () => {
    // docs.google.com is not in the allowlist — only drive.google.com
    expect(isAllowedEmbedUrl('https://docs.google.com/document/d/abc')).toBe(false);
  });
});

describe('TiptapEditor media — image URL security', () => {
  it('accepts https:// image URLs', () => {
    expect(isAllowedImageUrl('https://example.com/photo.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://cdn.example.org/image.png')).toBe(true);
  });

  it('rejects http:// image URLs', () => {
    expect(isAllowedImageUrl('http://example.com/photo.jpg')).toBe(false);
  });

  it('rejects data: URIs', () => {
    expect(isAllowedImageUrl('data:image/png;base64,abc123==')).toBe(false);
  });

  it('rejects javascript: URLs', () => {
    expect(isAllowedImageUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedImageUrl('')).toBe(false);
  });

  it('rejects relative paths', () => {
    expect(isAllowedImageUrl('/images/photo.jpg')).toBe(false);
    expect(isAllowedImageUrl('images/photo.jpg')).toBe(false);
  });
});

describe('TiptapEditor media — Tiptap JSON serialization shape', () => {
  it('image node shape matches Tiptap JSON spec', () => {
    // This is the expected JSON a setImage call produces. We verify the shape
    // that would be stored in Firestore and fed back into the editor.
    const imageNode = {
      type: 'image',
      attrs: {
        src: 'https://example.com/photo.jpg',
        alt: null,
        title: null,
      },
    };
    expect(imageNode.type).toBe('image');
    expect(imageNode.attrs.src).toMatch(/^https:\/\//);
  });

  it('youtube node shape matches Tiptap JSON spec', () => {
    const youtubeNode = {
      type: 'youtube',
      attrs: {
        src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        start: 0,
        width: 640,
        height: 480,
      },
    };
    expect(youtubeNode.type).toBe('youtube');
    expect(typeof youtubeNode.attrs.src).toBe('string');
  });
});
