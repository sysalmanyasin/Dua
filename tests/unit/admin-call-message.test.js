import { describe, expect, it } from 'vitest';
import { adminFailureMessage } from '../../js/core/supabase.js';

describe('admin call failure message', () => {
  it('explains an ended or unverified owner sign-in for 401 and 403', () => {
    expect(adminFailureMessage(401)).toMatch(/sign in again/i);
    expect(adminFailureMessage(403)).toMatch(/sign in again/i);
  });
  it('leaves other statuses to the screen or the server message', () => {
    expect(adminFailureMessage(500)).toBeNull();
    expect(adminFailureMessage(409)).toBeNull();
    expect(adminFailureMessage(0)).toBeNull();
  });
});
