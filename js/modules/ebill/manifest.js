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
      // Phase 1 reads only the product copy kept on this device, so the existing product-search permission is used.
      // Phase 2 seeds ebill.use in migration 06xx and switches this line to it.
      permission: 'inventory.search',
      load: () => import('./ui/pos.js'),
    },
  ],
};
