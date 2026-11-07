export default {
  id: 'access',
  title: 'Users & Access',
  icon: 'users',
  nav: { order: 90 },
  permission: 'users.manage',
  routes: [{ path: '/access', title: 'Users & Access', desc: 'People, roles and permissions', load: () => import('./ui/page.js') }],
};
