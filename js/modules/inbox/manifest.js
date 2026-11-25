export default {
  id: 'inbox',
  title: 'Inbox',
  icon: 'bell',
  nav: { order: 26, hidden: true }, // not in the side menu: it is the bell in the top bar
  bell: { href: '/inbox', refreshMs: 60_000, load: () => import('./bell.js') },
  permission: 'ntf.view_own',
  routes: [
    { path: '/inbox', title: 'Inbox', desc: 'Your messages and reminders', permission: 'ntf.view_own', load: () => import('./ui/page.js') },
  ],
};
