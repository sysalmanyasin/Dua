export default {
  id: 'audit',
  title: 'Audit',
  icon: 'shield', // an audit icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 50 },
  blurb: 'Stock audits, counting teams and reports',
  hub: true, // its first page lists the other audit pages
  permission: null, // each page below says who may open it
  // counts and scans waiting on the device block signing out (AUD-9, OD-6)
  outbox: async () => {
    await import('./data/outboxStore.js');
    return import('./data/barcodeStore.js');
  },
  routes: [
    {
      path: '/audit',
      title: 'Overview',
      desc: 'Your role-aware Audit Command Centre',
      anyOf: [
        'audit.count',
        'audit.individual',
        'audit.view',
        'audit.manage',
        'audit.assign',
        'audit.compile',
        'audit.suggest',
        'audit.finalize',
        'audit.reopen',
        'audit.templates',
        'audit.expiry_manage',
        'audit.review',
        'audit.report',
        'audit.expiry_log',
        'audit.barcode_scan',
        'audit.barcode_register',
        'audit.barcode_admin',
      ],
      load: () => import('./ui/hub.js'),
    },
    {
      path: '/audit/engagements',
      title: 'Audits',
      desc: 'All audits, and start a new one',
      anyOf: ['audit.view', 'audit.manage'],
      load: () => import('./ui/engagements.js'),
    },
    {
      path: '/audit/engagement',
      desc: 'One audit: its team and rounds',
      anyOf: ['audit.view', 'audit.manage'],
      load: () => import('./ui/engagement.js'),
    },
    {
      path: '/audit/round',
      desc: 'One round: who counts what, split, lock and start',
      anyOf: ['audit.view', 'audit.manage', 'audit.assign'],
      load: () => import('./ui/round.js'),
    },
    {
      path: '/audit/count',
      title: 'Counting',
      desc: 'Count the items given to you, even without signal, and submit',
      anyOf: ['audit.count'],
      load: () => import('./ui/count.js'),
    },
    {
      path: '/audit/individual',
      title: 'Individual Audit',
      desc: 'Pick products yourself and count them',
      anyOf: ['audit.individual'],
      load: () => import('./ui/individual.js'),
    },
    {
      path: '/audit/templates',
      title: 'Templates',
      desc: 'Saved lists of product codes',
      anyOf: ['audit.templates', 'audit.individual'],
      load: () => import('./ui/templates.js'),
    },
    {
      path: '/audit/compile',
      desc: 'Progress, compile, differences, corrections, conflicts and the next round',
      anyOf: ['audit.compile', 'audit.review', 'audit.suggest', 'audit.reopen', 'audit.view', 'audit.manage', 'audit.report'],
      load: () => import('./ui/compile.js'),
    },
    {
      path: '/audit/final',
      desc: 'The Final Snapshot of a round: make it final, then print or save it',
      anyOf: ['audit.finalize', 'audit.review', 'audit.report', 'audit.view', 'audit.manage'],
      load: () => import('./ui/final.js'),
    },
    {
      path: '/audit/reports',
      title: 'Reports',
      desc: 'Rounds, results, people and the audit trail, with print and save as PDF',
      anyOf: ['audit.report', 'audit.review', 'audit.manage'],
      load: () => import('./ui/reports.js'),
    },
    {
      path: '/audit/expiry',
      title: 'Expiry tracking',
      desc: 'Log near-expiry stock and search the shared register',
      anyOf: ['audit.expiry_log', 'audit.expiry_manage', 'audit.manage'],
      load: () => import('./ui/expiry.js'),
    },
    {
      path: '/audit/expiry/racks',
      desc: 'Racks and who checks which rack each month',
      anyOf: ['audit.expiry_manage', 'audit.manage'],
      load: () => import('./ui/racks.js'),
    },
    {
      path: '/audit/barcode',
      title: 'Barcodes',
      desc: 'Find a product by barcode, register and verify barcodes, settle conflicts',
      anyOf: ['audit.barcode_scan', 'audit.barcode_register', 'audit.barcode_admin'],
      load: () => import('./ui/barcode.js'),
    },
    {
      path: '/audit/team',
      title: 'Team access',
      desc: 'Give a person the Deputy or Sub-Auditor set of audit permissions, or switch single ones',
      permission: 'users.manage',
      load: () => import('./ui/team.js'),
    },
  ],
};
