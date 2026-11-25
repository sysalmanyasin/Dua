export default {
  id: 'inbox',
  title: 'Inbox',
  icon: 'menu', // a bell icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 26 },
  permission: 'ntf.view_own',
  routes: [
    { path: '/inbox', title: 'Inbox', desc: 'Your messages and reminders', permission: 'ntf.view_own', load: () => import('./ui/page.js') },
  ],
};
