export default {
  id: 'closing',
  title: 'Closing',
  icon: 'shield', // a ledger icon needs a Foundation request (js/shared/icons.js is Foundation)
  nav: { order: 20 },
  permission: null, // each page below says who may open it
  routes: [
    {
      path: '/closing',
      title: 'Closing',
      desc: 'Start or continue a shift closing',
      anyOf: ['closing.enter_own', 'closing.correct', 'closing.settings'],
      load: () => import('./ui/start.js'),
    },
    {
      path: '/closing/ledger',
      title: 'Closing Ledger',
      desc: 'The guided closing form',
      anyOf: ['closing.enter_own', 'closing.correct', 'closing.settings'],
      load: () => import('./ui/ledger.js'),
    },
    {
      path: '/closing/credit',
      title: 'Credit Ledger',
      desc: 'Credit position stored with each submitted closing',
      anyOf: ['closing.enter_own', 'closing.view_all', 'closing.review', 'closing.correct'],
      load: () => import('./ui/credit.js'),
    },
    {
      path: '/closing/misc',
      title: 'Misc Ledger',
      desc: 'Open and closed misc charges, with their age',
      anyOf: ['closing.enter_own', 'closing.view_all', 'closing.review', 'closing.correct'],
      load: () => import('./ui/misc.js'),
    },
    {
      path: '/closing/book',
      title: 'Closing Book',
      desc: 'Every submitted closing, one page each, with print and Save as PDF',
      anyOf: ['closing.view_all', 'closing.review', 'closing.correct'],
      load: () => import('./ui/book.js'),
    },
    {
      path: '/closing/history/cc',
      title: 'CC history',
      desc: 'Card (CC) at each Evening closing',
      anyOf: ['closing.view_all', 'closing.review', 'closing.correct'],
      load: () => import('./ui/history-cc.js'),
    },
    {
      path: '/closing/history/rbd',
      title: 'RBD history',
      desc: 'Returns, book bills and deposits',
      anyOf: ['closing.view_all', 'closing.review', 'closing.correct'],
      load: () => import('./ui/history-rbd.js'),
    },
    {
      path: '/closing/history/mediq',
      title: 'MEDIQ history',
      desc: 'MEDIQ orders and extras',
      anyOf: ['closing.view_all', 'closing.review', 'closing.correct'],
      load: () => import('./ui/history-mediq.js'),
    },
    {
      path: '/closing/review',
      title: 'Review',
      desc: 'Submitted closings and reopening one to correct it',
      anyOf: ['closing.review', 'closing.correct'],
      load: () => import('./ui/review.js'),
    },
    {
      path: '/closing/settings',
      title: 'Closing settings',
      desc: 'Strips, credit accounts, audit codes, till float and charges',
      anyOf: ['closing.settings'],
      load: () => import('./ui/settings.js'),
    },
  ],
};
