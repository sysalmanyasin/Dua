export default {
  id: 'tools',
  title: 'Tools',
  icon: 'shield',
  nav: { order: 95 },
  permission: 'tools.view', // owner only
  routes: [{ path: '/tools', title: 'Tools', desc: 'Alerts, backups and feed health', load: () => import('./ui/page.js') }],
};
