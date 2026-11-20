import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosaver, RETRY_DELAYS_MS } from '../../js/modules/workspace/domain/autosave.js';

let n;
const makeId = () => `op${++n}`;
const offline = () => Object.assign(new Error('offline'), { code: 'offline' });
const tick = (ms) => vi.advanceTimersByTimeAsync(ms);

function setup(sendImpl) {
  const statuses = [];
  const calls = [];
  const state = { text: 'a' };
  const send = vi.fn(async (p) => {
    calls.push(p);
    return sendImpl(p, calls.length);
  });
  const as = createAutosaver({ getContent: () => state.text, send, onStatus: (s) => statuses.push(s), makeId });
  return { as, send, calls, statuses, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  n = 0;
});
afterEach(() => vi.useRealTimers());

describe('autosave', () => {
  it('saves once, a moment after typing stops', async () => {
    const { as, send, state, statuses } = setup(async () => ({ status: 'saved' }));
    state.text = 'h';
    as.changed();
    state.text = 'he';
    as.changed();
    state.text = 'hel';
    as.changed();
    expect(send).not.toHaveBeenCalled();
    expect(as.status()).toBe('dirty');
    await tick(AUTOSAVE_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await tick(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ content: 'hel', opId: 'op1' });
    expect(as.status()).toBe('saved');
    expect(statuses).toContain('saving');
    expect(as.isUnsaved()).toBe(false);
  });

  it('does nothing when nothing changed', async () => {
    const { as, send } = setup(async () => ({ status: 'saved' }));
    await tick(10000);
    expect(send).not.toHaveBeenCalled();
    expect(as.status()).toBe('saved');
  });

  it('typing during a save is saved afterwards, with a new operation id', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { as, send, state } = setup(async (_p, i) => (i === 1 ? (await gate, { status: 'saved' }) : { status: 'saved' }));
    state.text = 'one';
    as.changed();
    await tick(AUTOSAVE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    state.text = 'two';
    as.changed();
    expect(as.isUnsaved()).toBe(true);
    release();
    await tick(0);
    expect(as.status()).toBe('dirty');
    await tick(AUTOSAVE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual({ content: 'two', opId: 'op2' });
    expect(as.status()).toBe('saved');
  });

  it('after a failure resends the SAME content and operation id, even if the person kept typing', async () => {
    const { as, send, state, calls } = setup(async (_p, i) => {
      if (i === 1) throw offline();
      return { status: 'saved' };
    });
    state.text = 'first';
    as.changed();
    await tick(AUTOSAVE_DELAY_MS);
    expect(as.status()).toBe('offline');
    state.text = 'second';
    as.changed();
    await tick(RETRY_DELAYS_MS[0] + 10);
    expect(calls[1]).toEqual({ content: 'first', opId: 'op1' });
    await tick(AUTOSAVE_DELAY_MS + 10);
    expect(calls[2]).toEqual({ content: 'second', opId: 'op2' });
    expect(send).toHaveBeenCalledTimes(3);
    expect(as.status()).toBe('saved');
  });

  it('backs off with growing delays and keeps trying', async () => {
    const { as, send, state } = setup(async () => {
      throw offline();
    });
    state.text = 'x';
    as.changed();
    await tick(AUTOSAVE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    await tick(RETRY_DELAYS_MS[0]);
    expect(send).toHaveBeenCalledTimes(2);
    await tick(RETRY_DELAYS_MS[1] - 1);
    expect(send).toHaveBeenCalledTimes(2);
    await tick(2);
    expect(send).toHaveBeenCalledTimes(3);
    await tick(RETRY_DELAYS_MS[2]);
    await tick(RETRY_DELAYS_MS[3]);
    await tick(RETRY_DELAYS_MS[3]);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(as.status()).toBe('offline');
    expect(as.isUnsaved()).toBe(true);
  });

  it('reports other failures as error, still retrying', async () => {
    const { as, state } = setup(async () => {
      throw new Error('boom');
    });
    state.text = 'x';
    as.changed();
    await tick(AUTOSAVE_DELAY_MS);
    expect(as.status()).toBe('error');
  });

  it('a conflict stops autosave until the editor resumes', async () => {
    const { as, send, state } = setup(async () => ({ status: 'conflict', conflict_id: 'c1', head_version: 4 }));
    state.text = 'mine';
    as.changed();
    await tick(AUTOSAVE_DELAY_MS);
    expect(as.status()).toBe('conflict');
    expect(as.lastResult().conflict_id).toBe('c1');
    state.text = 'more';
    as.changed();
    await tick(60000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(as.isUnsaved()).toBe(true);
    as.resume({ saveNow: true });
    await tick(5);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].opId).toBe('op2');
  });

  it('flush saves immediately and settles', async () => {
    const { as, send, state } = setup(async () => ({ status: 'saved' }));
    state.text = 'now';
    as.changed();
    const s = await as.flush();
    expect(s).toBe('saved');
    expect(send).toHaveBeenCalledTimes(1);
    await tick(10000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush gives up cleanly when offline, leaving the work marked unsaved', async () => {
    const { as, state } = setup(async () => {
      throw offline();
    });
    state.text = 'now';
    as.changed();
    const s = await as.flush();
    expect(s).toBe('offline');
    expect(as.isUnsaved()).toBe(true);
  });

  it('reset marks everything saved; destroy stops all timers', async () => {
    const { as, send, state } = setup(async () => ({ status: 'saved' }));
    state.text = 'x';
    as.changed();
    as.reset();
    await tick(10000);
    expect(send).not.toHaveBeenCalled();
    expect(as.status()).toBe('saved');
    as.changed();
    as.destroy();
    await tick(10000);
    expect(send).not.toHaveBeenCalled();
  });
});
