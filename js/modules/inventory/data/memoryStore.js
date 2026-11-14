// An in-memory store with the same contract as idbStore.js. Used by the unit tests (it can fail a write on purpose to
// prove that a crash leaves the previous state intact) and by nothing in the running app.
export function memoryStore() {
  let state = { stock: new Map(), sales: new Map(), meta: null };
  let failNext = false;
  const copy = (s) => ({ stock: new Map(s.stock), sales: new Map(s.sales), meta: s.meta });
  return {
    /** Make the next applyBatch fail after "writing" nothing, like a tab killed mid-transaction. */
    failNextApply() {
      failNext = true;
    },
    async readMeta() {
      return state.meta ? { ...state.meta } : null;
    },
    async putMeta(meta) {
      state = { ...state, meta: { ...meta } };
    },
    // One transaction: either every put, delete and the new meta land, or none do.
    async applyBatch({ stock, sales, meta }) {
      if (failNext) {
        failNext = false;
        throw new Error('simulated crash');
      }
      const next = copy(state);
      for (const [name, part] of [
        ['stock', stock],
        ['sales', sales],
      ]) {
        if (!part) continue;
        for (const code of part.del ?? []) next[name].delete(code);
        for (const row of part.put ?? []) next[name].set(row.code, row);
      }
      if (meta) next.meta = { ...meta };
      state = next;
    },
    async readAll(name) {
      return [...state[name].values()].map((r) => ({ ...r }));
    },
    async count(name) {
      return state[name].size;
    },
    async clear(name) {
      state = { ...state, [name]: new Map() };
    },
    async wipe() {
      state = { stock: new Map(), sales: new Map(), meta: null };
    },
  };
}
