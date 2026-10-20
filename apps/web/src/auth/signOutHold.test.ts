import { describe, expect, it } from 'vitest';
import { isSignOutHeld, registerSignOutHold } from './signOutHold';

describe('signOutHold', () => {
  it('is held only while a registered hold says so', () => {
    let holding = true;
    const unregister = registerSignOutHold(() => holding);
    expect(isSignOutHeld()).toBe(true);
    holding = false;
    expect(isSignOutHeld()).toBe(false);
    holding = true;
    unregister();
    expect(isSignOutHeld()).toBe(false);
  });

  it('treats a throwing hold as not holding', () => {
    const unregister = registerSignOutHold(() => {
      throw new Error('boom');
    });
    expect(isSignOutHeld()).toBe(false);
    unregister();
  });
});
