export default {
  id: 'candela-sales',
  title: 'Candela Sales',
  icon: 'chart',
  nav: { order: 15 },
  permission: null, // each page below says who may open it
  // The status pill is offered to staff who hold only candela.today_total; the shell lets pills through even when
  // the person has no page in this module.
  status: { anyOf: ['candela.today_total', 'candela.view'], refreshMs: 60_000, load: () => import('./status.js') },
  routes: [
    {
      path: '/candela-sales',
      title: 'Overview',
      desc: 'Today, this month and the latest Candela update',
      permission: 'candela.view',
      load: () => import('./ui/overview.js'),
    },
    {
      path: '/candela-sales/history',
      title: 'Daily History',
      desc: 'Every kept day: cash, card, credit and total',
      permission: 'candela.view',
      load: () => import('./ui/history.js'),
    },
    {
      path: '/candela-sales/credit',
      title: 'Credit by Customer',
      desc: 'Credit sales per customer (not an outstanding balance)',
      permission: 'candela.view',
      load: () => import('./ui/credit.js'),
    },
    {
      path: '/candela-sales/reports',
      title: 'Reports',
      desc: 'Monthly summaries and Candela corrections, with print',
      permission: 'candela.view',
      load: () => import('./ui/reports.js'),
    },
  ],
};
