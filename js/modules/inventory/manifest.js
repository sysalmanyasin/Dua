export default {
  id: 'inventory',
  title: 'Inventory',
  icon: 'shield', // a box icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 40 },
  permission: null, // each page below says who may open it
  status: { anyOf: ['inventory.search'], load: () => import('./status.js') },
  routes: [
    {
      path: '/inventory',
      title: 'Overview',
      desc: 'Find a product and see its stock',
      permission: 'inventory.search',
      load: () => import('./ui/overview.js'),
    },
  ],
};
