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
    {
      path: '/manager/salary',
      title: 'Salary',
      desc: 'Monthly salary sheet and payslips',
      anyOf: ['mgmt.salary', 'mgmt.salary_view'],
      load: () => import('./ui/salary.js'),
    },
    {
      path: '/manager/generic',
      title: 'Generic Sheet',
      desc: 'Generic sale and incentive for each person',
      anyOf: ['mgmt.salary', 'mgmt.salary_view'],
      load: () => import('./ui/generic.js'),
    },
    {
      path: '/manager/incentive',
      title: 'Incentive',
      desc: 'Monthly incentive and the owner’s share',
      anyOf: ['mgmt.incentive'],
      load: () => import('./ui/incentive.js'),
    },
    {
      path: '/manager/petty',
      title: 'Petty Cash',
      desc: 'Monthly petty cash vouchers',
      anyOf: ['mgmt.petty_cash'],
      load: () => import('./ui/petty.js'),
    },
  ],
};
