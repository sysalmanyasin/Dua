// AUD-9: signing out with counts that have not reached the database is blocked until they are sent; the person may discard
// them after confirming. The shell's sign-out button is core code, so this listens for its click before the shell does.
import { outboxStore } from '../data/outboxStore.js';

let installed = false;
let passing = false;

export function installSignOutGuard(doc = document, ask = (message) => window.confirm(message)) {
  if (installed) return;
  installed = true;
  doc.addEventListener(
    'click',
    (e) => {
      const button = e.target?.closest?.('[data-action="signout"]');
      if (!button || passing) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      (async () => {
        const store = outboxStore();
        let waiting = 0;
        try {
          waiting = await store.count();
        } catch {
          waiting = 0;
        }
        if (waiting > 0) {
          const discard = ask(
            `${waiting} ${waiting === 1 ? 'count has' : 'counts have'} not been sent yet. If you sign out now they are lost.\n\nOK discards them and signs out. Cancel keeps you signed in so they can send.`,
          );
          if (!discard) return;
        }
        try {
          await store.reset(); // also forgets the saved item list: it holds stock and prices
        } catch {
          // nothing to forget, or the browser refused: signing out still goes ahead
        }
        passing = true;
        try {
          button.click();
        } finally {
          passing = false;
        }
      })();
    },
    true,
  );
}
