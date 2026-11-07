export default {
  id: 'sales',
  title: 'Sales',
  icon: 'chart',
  nav: { order: 10 },
  permission: null, // each page below says who may open it
  status: { anyOf: ['sales.view_last_day', 'sales.view_history'], load: () => import('./status.js') },
  routes: [
    { path: '/sales', title: 'Index', permission: 'sales.view_history', load: () => import('./ui/index.js') },
    { path: '/sales/entry', title: 'Add Entry', anyOf: ['sales.enter', 'sales.edit'], load: () => import('./ui/entry.js') },
    { path: '/sales/data', title: 'Daily Data', permission: 'sales.view_history', load: () => import('./ui/data.js') },
    {
      path: '/sales/checklist',
      title: 'Daily Check List',
      anyOf: ['checklist.fill', 'checklist.view'],
      load: () => import('./ui/checklist.js'),
    },
    { path: '/sales/diff', title: 'Diff Report', permission: 'sales.view_history', load: () => import('./ui/diff.js') },
    { path: '/sales/deposit', title: 'Cash to Deposit', permission: 'sales.view_history', load: () => import('./ui/deposit.js') },
    { path: '/sales/yesterday', title: 'Last Day', permission: 'sales.view_last_day', load: () => import('./ui/yesterday.js') },
  ],
};
