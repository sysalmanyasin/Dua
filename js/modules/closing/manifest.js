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
  ],
};
