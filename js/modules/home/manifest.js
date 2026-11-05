export default {
  id: 'home',
  title: 'Home',
  icon: 'home',
  core: true, // cannot be switched off
  nav: { order: 0 },
  permission: null, // any signed-in, active user
  routes: [{ path: '/home', load: () => import('./ui/page.js') }],
};
