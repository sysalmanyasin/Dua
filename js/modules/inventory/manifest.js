export default {
  id: 'inventory',
  title: 'Inventory',
  icon: 'shield', // a box icon needs a Foundation request (js/shared/icons.js is Foundation's)
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
    {
      path: '/inventory/ledger',
      title: 'Stock Ledger',
      desc: 'Never sold, dead stock, excess',
      permission: 'inventory.view',
      load: () => import('./ui/ledger.js'),
    },
    {
      path: '/inventory/reorder',
      title: 'Reorder',
      desc: 'What to buy, by days of cover',
      permission: 'inventory.view',
      load: () => import('./ui/reorder.js'),
    },
    {
      path: '/inventory/excess',
      title: 'Excess Working',
      desc: 'Whole packs you do not need',
      permission: 'inventory.view',
      load: () => import('./ui/excess.js'),
    },
    {
      path: '/inventory/health',
      title: 'Health',
      desc: 'Where the stock stands',
      permission: 'inventory.view',
      load: () => import('./ui/health.js'),
    },
    {
      path: '/inventory/deactivated',
      title: 'Deactivated',
      desc: 'Products the stock file no longer lists',
      permission: 'inventory.view',
      load: () => import('./ui/deactivated.js'),
    },
    {
      path: '/inventory/sync',
      title: 'Sync',
      desc: 'Update the stock data now',
      permission: 'inventory.sync',
      load: () => import('./ui/sync.js'),
    },
  ],
};
