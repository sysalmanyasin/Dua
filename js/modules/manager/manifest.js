export default {
  id: 'manager',
  title: 'Manager',
  icon: 'users',
  nav: { order: 20 },
  permission: null, // owner only: each page below lists the keys that may open it (and the database checks them again)
  routes: [
    {
      path: '/manager/staff',
      title: 'Staff Registry',
      desc: 'Everyone on the team: details, notes and credit',
      anyOf: ['mgmt.staff_view', 'mgmt.staff_edit'],
      load: () => import('./ui/staff.js'),
    },
    {
      path: '/manager/credit',
      title: 'Staff Credit',
      desc: 'Advances and repayments, month by month',
      anyOf: ['credit.view', 'mgmt.credit_manage'],
      load: () => import('./ui/credit.js'),
    },
  ],
};
