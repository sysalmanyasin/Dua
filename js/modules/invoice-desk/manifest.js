// Phase 0 registration only. Invoice Desk is in progress; no invoice workflows are implemented yet.
// The owner-only tools.view gate keeps this status page out of the general staff navigation.
export default {
  id: 'invoice-desk',
  title: 'Invoice Desk',
  icon: 'receipt',
  nav: { order: 85 },
  permission: 'tools.view',
  routes: [
    {
      path: '/invoice-desk/status',
      title: 'Status',
      desc: 'Invoice Desk implementation status',
      load: () => import('./ui/status.js'),
    },
  ],
};
