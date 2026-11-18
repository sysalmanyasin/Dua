export default {
  id: 'ebill',
  title: 'Emergency Billing',
  icon: 'shield', // a till icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 70 },
  permission: null, // the page says who may open it
  routes: [
    {
      path: '/ebill',
      title: 'Emergency POS',
      desc: 'Bill a customer when the normal POS is unavailable',
      permission: 'ebill.use', // seeded by migration 0601; the owner grants it person by person in Users & Access
      load: () => import('./ui/pos.js'),
    },
    {
      path: '/ebill/history',
      title: 'History',
      desc: 'Every invoice, with whether it has reached the server',
      anyOf: ['ebill.use', 'ebill.history_all', 'ebill.manage'],
      load: () => import('./ui/history.js'),
    },
    {
      path: '/ebill/settings',
      title: 'Emergency Billing Settings',
      desc: 'Staff PINs, discount limits and devices',
      anyOf: ['ebill.set_pin', 'ebill.manage'],
      load: () => import('./ui/settings.js'),
    },
  ],
};
