import { describe, expect, it } from 'vitest';
import { postSignInPath } from './postSignInPath';

describe('postSignInPath', () => {
  it('returns to the bounced-from page with its query and hash', () => {
    expect(
      postSignInPath({ from: { pathname: '/observations/abc', search: '?ack=1', hash: '#top' } }),
    ).toBe('/observations/abc?ack=1#top');
  });

  it('falls back to home without a usable destination', () => {
    expect(postSignInPath(null)).toBe('/');
    expect(postSignInPath({ sessionExpired: true })).toBe('/');
    expect(postSignInPath({ from: { pathname: '/sign-in' } })).toBe('/');
  });

  it('never leaves the app', () => {
    expect(postSignInPath({ from: { pathname: '//evil.example/x' } })).toBe('/');
    expect(postSignInPath({ from: { pathname: 'https://evil.example/' } })).toBe('/');
  });
});
