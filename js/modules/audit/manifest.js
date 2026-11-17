export default {
  id: 'audit',
  title: 'Audit',
  icon: 'shield', // an audit icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 50 },
  blurb: 'Stock audits, counting teams and reports',
  hub: true, // its first page lists the other audit pages
  permission: null, // each page below says who may open it
  routes: [
    {
      path: '/audit',
      title: 'Audit',
      desc: 'Your audits and the pages you may open',
      anyOf: [
        'audit.count',
        'audit.individual',
        'audit.view',
        'audit.manage',
        'audit.review',
        'audit.report',
        'audit.expiry_log',
        'audit.barcode_scan',
        'audit.barcode_register',
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
      path: '/audit/team',
      title: 'Team access',
      desc: 'Give a person the Deputy or Sub-Auditor set of audit permissions, or switch single ones',
      permission: 'users.manage',
      load: () => import('./ui/team.js'),
    },
  ],
};
