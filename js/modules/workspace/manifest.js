export default {
  id: 'workspace',
  title: 'Dua Workspace',
  icon: 'menu',
  nav: { order: 86 },
  permission: null, // each page below says who may open it
  routes: [
    {
      path: '/workspace',
      title: 'Workspace',
      desc: 'Your notes, and notes shared with you',
      permission: 'workspace.use',
      load: () => import('./ui/home.js'),
    },
    {
      // No title, so it is not a tab: people reach it from the Workspace list. The router carries no ids, so the open note is
      // kept in session storage (see domain/documents.js OPEN_KEY).
      path: '/workspace/note',
      permission: 'workspace.use',
      load: () => import('./ui/note.js'),
    },
  ],
};
