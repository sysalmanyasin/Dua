export default {
  id: 'tasks',
  title: 'Tasks',
  icon: 'tasks',
  nav: { order: 25, links: [{ id: 'team', title: 'Team', path: '/tasks/team', icon: 'users', order: 25.5 }] }, // Team shows for the Owner only (the page needs tasks.manage)
  permission: null, // each page below says who may open it (the database checks again)
  routes: [
    {
      path: '/tasks',
      title: 'My Tasks',
      desc: 'Your work, in the order to do it',
      permission: 'tasks.view_own',
      load: () => import('./ui/mine.js'),
    },
    {
      path: '/tasks/verify',
      title: 'To Verify',
      desc: 'Work handed in, waiting for you to check',
      permission: 'tasks.verify',
      load: () => import('./ui/verify.js'),
    },
    {
      path: '/tasks/manage',
      title: 'All Tasks',
      desc: 'Create, assign, re-date and cancel tasks',
      permission: 'tasks.manage',
      load: () => import('./ui/manage.js'),
    },
    {
      path: '/tasks/requests',
      title: 'Requests',
      desc: 'Change requests from the team',
      permission: 'tasks.manage',
      load: () => import('./ui/requests.js'),
    },
    {
      path: '/tasks/schedules',
      title: 'Schedules',
      desc: 'Tasks that repeat by themselves',
      permission: 'tasks.manage',
      load: () => import('./ui/schedules.js'),
    },
    {
      path: '/tasks/team',
      title: 'Team',
      desc: 'Workload and completion rate',
      permission: 'tasks.manage',
      load: () => import('./ui/team.js'),
    },
  ],
};
