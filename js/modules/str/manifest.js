export default {
  id: 'str',
  title: 'STR',
  icon: 'menu', // a transfer/truck icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 60 },
  permission: 'str.view',
  routes: [
    {
      path: '/str',
      title: 'Transfers',
      desc: 'Stock transfer requests: awaited, dispatched and received',
      permission: 'str.view',
      load: () => import('./ui/list.js'),
    },
    {
      // No title: reached by tapping a transfer, so it is not a tab of its own.
      path: '/str/detail',
      permission: 'str.view',
      load: () => import('./ui/detail.js'),
    },
  ],
};
