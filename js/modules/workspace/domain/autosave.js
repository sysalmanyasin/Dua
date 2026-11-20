// Autosave for one open note. Pure logic with injected timers, so it is fully testable.
//
// States: saved | dirty | saving | offline | error | conflict | invalid
//  * Typing marks the note dirty and (re)starts a short timer; one save runs at a time.
//  * If a save fails in transit (offline, timeout) the SAME content is sent again with the SAME operation id, with growing
//    delays, until the server answers. The server answers a repeated operation id with its first answer, so a lost
//    response can never make a person conflict with their own earlier save. Newer typing waits until that save is settled.
//  * A conflict stops autosave: the editor must resolve it (see ui/note.js) and call resume().
//  * Nothing here talks to the network: the caller passes send({ content, opId }).

export const AUTOSAVE_DELAY_MS = 1500;
export const RETRY_DELAYS_MS = Object.freeze([3000, 10000, 30000, 60000]);

export function createAutosaver({
  getContent,
  send,
  onStatus = () => {},
  makeId,
  delay = AUTOSAVE_DELAY_MS,
  retry = RETRY_DELAYS_MS,
  timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) },
}) {
  let status = 'saved';
  let dirty = false;
  let rev = 0; // grows with every change
  let pending = null; // { opId, content, rev } - a save that has not been answered yet
  let timer = null;
  let running = null; // promise of the save in progress
  let failures = 0;
  let paused = false;
  let lastResult = null;

  const set = (s, extra) => {
    status = s;
    onStatus(s, extra);
  };
  const stopTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const schedule = (ms) => {
    stopTimer();
    timer = timers.set(() => {
      timer = null;
      run();
    }, ms);
  };

  async function run() {
    if (running || paused) return running ?? undefined;
    if (!pending) {
      if (!dirty) return undefined;
      pending = { opId: makeId(), content: getContent(), rev };
    }
    set('saving');
    const sending = pending;
    running = (async () => {
      try {
        const result = await send({ content: sending.content, opId: sending.opId });
        lastResult = result;
        if (result?.status === 'invalid') {
          // The note cannot be saved as written (for example too large). Nothing is retried until the person edits again.
          pending = null;
          set('invalid', result);
          return;
        }
        if (result?.status === 'conflict') {
          paused = true;
          set('conflict', result);
          return;
        }
        failures = 0;
        pending = null;
        if (rev !== sending.rev) {
          dirty = true;
          schedule(delay);
          set('dirty');
        } else {
          dirty = false;
          set('saved', result);
        }
      } catch (e) {
        // Keep `pending`: the same payload and id are sent again.
        const wait = retry[Math.min(failures, retry.length - 1)];
        failures += 1;
        set(e?.code === 'offline' ? 'offline' : 'error', e);
        schedule(wait);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    // Call after every edit.
    changed() {
      rev += 1;
      dirty = true;
      if (paused) return;
      if (!running && !pending) set('dirty');
      if (!running) schedule(pending ? Math.min(delay, 1000) : delay);
    },
    // Save right now (leaving the page, "Save version"). Resolves when the save is settled.
    async flush() {
      stopTimer();
      let guard = 0;
      while ((dirty || pending) && !paused && guard < 5) {
        guard += 1;
        await run();
        if (status === 'offline' || status === 'error') {
          stopTimer();
          break;
        }
      }
      return status;
    },
    // After the editor has resolved a conflict: the content now on screen is what should be saved next.
    resume({ saveNow = false } = {}) {
      paused = false;
      pending = null;
      failures = 0;
      dirty = saveNow || dirty;
      if (dirty) schedule(saveNow ? 0 : delay);
      else set('saved');
    },
    // Everything on screen is already saved (after loading a different version).
    reset() {
      stopTimer();
      paused = false;
      pending = null;
      dirty = false;
      failures = 0;
      set('saved');
    },
    isUnsaved: () => dirty || pending !== null || running !== null,
    status: () => status,
    lastResult: () => lastResult,
    destroy() {
      stopTimer();
      paused = true;
    },
  };
}
