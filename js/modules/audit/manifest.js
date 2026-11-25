// Every Audit page except counting is shown inside the tab frame (ui/frame.js). The page itself is unchanged.
const framed = (loader, options) => () => import('./ui/frame.js').then((f) => f.framed(loader, options));

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
      load: framed(() => import('./ui/hub.js')),
    },
    {
      path: '/audit/tools',
      title: 'Tools',
      desc: 'Expiry, barcodes, racks, templates and administration',
      anyOf: [
        'audit.expiry_log',
        'audit.expiry_manage',
        'audit.manage',
        'audit.barcode_scan',
        'audit.barcode_register',
        'audit.barcode_admin',
        'audit.templates',
        'audit.individual',
      ],
      load: framed(() => import('./ui/tools.js')),
    },
    {
      path: '/audit/engagements',
      title: 'Audits',
      desc: 'All audits, and start a new one',
      anyOf: ['audit.view', 'audit.manage'],
      load: framed(() => import('./ui/engagements.js')),
    },
    {
      path: '/audit/attention',
      title: 'Needs attention',
      desc: 'Rounds ready to compile, open conflicts and corrections waiting',
      anyOf: ['audit.compile', 'audit.review'],
      load: framed(() => import('./ui/attention.js')),
    },
    {
      path: '/audit/individuals',
      title: 'Individual audits',
      desc: 'Individual audits by month: who took part and what is outstanding',
      anyOf: ['audit.view', 'audit.manage'],
      load: framed(() => import('./ui/individuals.js'), { screen: 'overview' }),
    },
    {
      path: '/audit/individual-rounds',
      desc: 'Each person’s Individual rounds, how far counting has got, and the way to review',
      anyOf: ['audit.view', 'audit.manage'],
      load: framed(() => import('./ui/individuals.js'), { screen: 'rounds' }),
    },
    {
      path: '/audit/individual-review',
      desc: 'Review one Individual round: its differences and corrections',
      anyOf: ['audit.compile', 'audit.review', 'audit.suggest', 'audit.reopen', 'audit.view', 'audit.manage', 'audit.report'],
      load: framed(() => import('./ui/compile.js'), { screen: 'individual' }),
    },
    {
      path: '/audit/individual-reports',
      desc: 'Individual audit reports: per round, per person, and the combined month',
      anyOf: ['audit.view', 'audit.manage', 'audit.report'],
      load: framed(() => import('./ui/individualReports.js')),
    },
    {
      path: '/audit/engagement',
      desc: 'One audit: its team and rounds',
      anyOf: ['audit.view', 'audit.manage'],
      load: framed(() => import('./ui/engagement.js')),
    },
    {
      path: '/audit/round',
      desc: 'One round: who counts what, split, lock and start',
      anyOf: ['audit.view', 'audit.manage', 'audit.assign'],
      load: framed(() => import('./ui/round.js')),
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
      load: framed(() => import('./ui/individual.js')),
    },
    {
      path: '/audit/templates',
      title: 'Templates',
      desc: 'Saved lists of product codes',
      anyOf: ['audit.templates', 'audit.individual'],
      load: framed(() => import('./ui/templates.js')),
    },
    {
      path: '/audit/compile',
      desc: 'Progress, compile, differences, corrections, conflicts and the next round',
      anyOf: ['audit.compile', 'audit.review', 'audit.suggest', 'audit.reopen', 'audit.view', 'audit.manage', 'audit.report'],
      load: framed(() => import('./ui/compile.js'), { screen: 'review' }),
    },
    {
      path: '/audit/corrections',
      desc: 'Corrections waiting for a decision, approved ones waiting for a recompile, rejected ones, and counting again',
      anyOf: ['audit.compile', 'audit.review', 'audit.suggest', 'audit.reopen', 'audit.view', 'audit.manage', 'audit.report'],
      load: framed(() => import('./ui/compile.js'), { screen: 'corrections' }),
    },
    {
      path: '/audit/final',
      desc: 'The Final Snapshot of a round: make it final, then print or save it',
      anyOf: ['audit.finalize', 'audit.review', 'audit.report', 'audit.view', 'audit.manage'],
      load: framed(() => import('./ui/final.js')),
    },
    {
      path: '/audit/reports',
      title: 'Reports',
      desc: 'Rounds, results, people and the audit trail, with print and save as PDF',
      anyOf: ['audit.report', 'audit.review', 'audit.manage'],
      load: framed(() => import('./ui/reports.js')),
    },
    {
      path: '/audit/expiry',
      title: 'Expiry tracking',
      desc: 'Log near-expiry stock and search the shared register',
      anyOf: ['audit.expiry_log', 'audit.expiry_manage', 'audit.manage'],
      load: framed(() => import('./ui/expiry.js')),
    },
    {
      path: '/audit/expiry/racks',
      desc: 'Racks and who checks which rack each month',
      anyOf: ['audit.expiry_manage', 'audit.manage'],
      load: framed(() => import('./ui/racks.js')),
    },
    {
      path: '/audit/barcode',
      title: 'Barcodes',
      desc: 'Find a product by barcode, register and verify barcodes, settle conflicts',
      anyOf: ['audit.barcode_scan', 'audit.barcode_register', 'audit.barcode_admin'],
      load: framed(() => import('./ui/barcode.js')),
    },
    {
      path: '/audit/team',
      title: 'Team access',
      desc: 'Give a person the Deputy or Sub-Auditor set of audit permissions, or switch single ones',
      permission: 'users.manage',
      load: framed(() => import('./ui/team.js')),
    },
  ],
};
