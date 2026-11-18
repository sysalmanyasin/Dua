export default {
  id: 'invoice-desk',
  title: 'Invoice Desk',
  icon: 'chart',
  nav: { order: 85 },
  permission: null,
  routes: [
    {
      path: '/invoice-desk',
      title: 'New Invoice',
      desc: 'Create and preview an invoice',
      permission: 'invoice_desk.manage',
      load: () => import('./ui/create.js'),
    },
    {
      path: '/invoice-desk/history',
      title: 'History',
      desc: 'Find and reprint saved invoices',
      permission: 'invoice_desk.manage',
      load: () => import('./ui/history.js'),
    },
    {
      path: '/invoice-desk/products',
      title: 'Products',
      desc: 'Manage business-specific suggestions',
      permission: 'invoice_desk.manage',
      load: () => import('./ui/products.js'),
    },
  ],
};
