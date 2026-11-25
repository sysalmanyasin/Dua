// Shared builders for the Task Master tests: rows shaped like the database's task_card() and friends.
export const T = (n) => `41000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const card = (n, o = {}) => ({
  id: T(n),
  title: `Task ${n}`,
  instructions: '',
  evidence_rule: 'none',
  priority: 'normal',
  status: 'assigned',
  source: 'manual',
  assignee_id: T(900),
  assignee_name: 'Ayesha Khan',
  due_on: '2099-01-01',
  overdue: false,
  rank: 4,
  version: 1,
  pending_request: null,
  ...o,
});
export const detail = (n, o = {}) => ({
  task: card(n, o.task),
  events: [{ at: '2026-11-24T05:00:00Z', kind: 'created', by: 'Owner', detail: {} }],
  comments: [],
  submissions: [],
  requests: [],
  can: { manage: false, is_assignee: true, verify: false, ...o.can },
  ...Object.fromEntries(Object.entries(o).filter(([k]) => !['task', 'can'].includes(k))),
});
export const flush = async (vi) => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
