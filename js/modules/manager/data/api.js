// The only file in this module that talks to Supabase. Reads follow the person's permissions (row-level security, or an
// owner-gated function where core tables are not readable); every write is a database function that checks, validates, logs
// and accepts an idempotency key. Mutations return { data, error } so pages can show the database's plain message.
import { callAdminFunction, db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// ── Staff ──
export const listStaff = () => one(db().rpc('mgmt_staff_list'));
export const getStaff = (id) => one(db().rpc('mgmt_staff_get', { p_staff_id: id }));
export const saveStaff = (payload) => db().rpc('mgmt_staff_save', payload);

// ── Staff logins (owner only: users.manage) ──
// Who already has a login. Rows are readable only with users.manage; the owner's own sign-in covers it.
export const listLogins = () =>
  one(db().from('profiles').select('user_id, staff_id, username, role_template, disabled_at').order('username'));
export const createLogin = ({ staffId, username, role, pin }) =>
  callAdminFunction('admin-users', { action: 'create_login', staff_id: staffId, username, role, pin });

// ── Notes ──
export const listNotes = (staffId) =>
  one(
    db()
      .from('mgmt_staff_notes')
      .select('id, body, created_at')
      .eq('staff_id', staffId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  );
export const addNote = (staffId, body, key) => db().rpc('mgmt_note_add', { p_staff_id: staffId, p_body: body, p_key: key });
export const removeNote = (id, reason) => db().rpc('mgmt_note_remove', { p_note_id: id, p_reason: reason || null });

// ── Staff credit ──
export const creditMonth = (monthIso) => one(db().rpc('mgmt_credit_month', { p_month: monthIso }));
export const creditAdd = (staffId, date, description, amount, key) =>
  db().rpc('mgmt_credit_add', { p_staff_id: staffId, p_date: date, p_description: description, p_amount: amount, p_key: key });
export const creditReverse = (entryId, reason, key) =>
  db().rpc('mgmt_credit_reverse', { p_entry_id: entryId, p_reason: reason, p_key: key });
export const creditSetDeduction = (staffId, month, kind, amount, reason, key) =>
  db().rpc('mgmt_credit_set_deduction', {
    p_staff_id: staffId,
    p_month: month,
    p_kind: kind,
    p_amount: amount,
    p_reason: reason || null,
    p_key: key,
  });
export const creditSetOpening = (staffId, month, amount, reason, key) =>
  db().rpc('mgmt_credit_set_opening', { p_staff_id: staffId, p_month: month, p_amount: amount, p_reason: reason, p_key: key });

// ── Rates, Generic, Salary ──
export const ratesList = () => one(db().rpc('mgmt_rates_list'));
export const rateSet = (rateKey, rate, reason, key) =>
  db().rpc('mgmt_rate_set', { p_rate_key: rateKey, p_rate: rate, p_reason: reason, p_key: key });
export const salaryColumns = (month) => one(db().rpc('mgmt_salary_columns', { p_month: month }));
export const salaryColumnAdd = (name, sign, fromMonth, key) =>
  db().rpc('mgmt_salary_column_add', { p_name: name, p_sign: sign, p_from: fromMonth, p_key: key });
export const salaryColumnRetire = (columnId, fromMonth, key) =>
  db().rpc('mgmt_salary_column_retire', { p_column_id: columnId, p_from: fromMonth, p_key: key });
export const genericMonth = (month) => one(db().rpc('mgmt_generic_month', { p_month: month }));
export const genericSave = (month, rows, reason, key) =>
  db().rpc('mgmt_generic_save', { p_month: month, p_rows: rows, p_reason: reason || null, p_key: key });
export const salaryMonth = (month) => one(db().rpc('mgmt_salary_month', { p_month: month }));
export const salarySave = (month, rows, reason, key) =>
  db().rpc('mgmt_salary_save', { p_month: month, p_rows: rows, p_reason: reason || null, p_key: key });
export const sheetClose = (month, kind, key) => db().rpc('mgmt_sheet_close', { p_month: month, p_kind: kind, p_key: key });

// ── Incentive ──
export const incentiveMonth = async (month) => {
  const rows = await one(db().rpc('mgmt_incentive_month', { p_month: month }));
  return rows[0];
};
export const incentiveSave = (month, inputs, reason, key) =>
  db().rpc('mgmt_incentive_save', { p_month: month, p_inputs: inputs, p_reason: reason || null, p_key: key });

// ── Petty Detail ──
export const pettyMonth = (month) => one(db().rpc('mgmt_petty_month', { p_month: month }));
export const pettySave = (month, groups, reason, key) =>
  db().rpc('mgmt_petty_save', { p_month: month, p_groups: groups, p_reason: reason || null, p_key: key });
export const pettyCopy = (fromMonth, toMonth, key) => db().rpc('mgmt_petty_copy', { p_from: fromMonth, p_to: toMonth, p_key: key });

// ── Ledgers (Expense, Jazz Cash, Misc Sections) and the Balance Tally ──
export const ledgersList = () => one(db().rpc('mgmt_ledgers_list'));
export const ledgerView = (ledgerId, from = null, to = null) =>
  one(db().rpc('mgmt_ledger_view', { p_ledger: ledgerId, p_from: from, p_to: to }));
export const ledgerAdd = (ledgerId, categoryId, date, shift, description, amount, key) =>
  db().rpc('mgmt_ledger_add', {
    p_ledger: ledgerId,
    p_category: categoryId,
    p_date: date,
    p_shift: shift || null,
    p_description: description,
    p_amount: amount,
    p_key: key,
  });
export const ledgerReverse = (entryId, reason, key) =>
  db().rpc('mgmt_ledger_reverse', { p_entry_id: entryId, p_reason: reason, p_key: key });
export const sectionCreate = (name, categories, key) =>
  db().rpc('mgmt_ledger_section_create', { p_name: name, p_categories: categories, p_key: key });
export const categoryAdd = (ledgerId, name, direction, key) =>
  db().rpc('mgmt_ledger_category_add', { p_ledger: ledgerId, p_name: name, p_direction: direction, p_key: key });
export const categoryRetire = (categoryId, key) => db().rpc('mgmt_ledger_category_retire', { p_category: categoryId, p_key: key });
export const tallyAccounts = () => one(db().rpc('mgmt_tally_accounts_list'));
export const tallyAccountAdd = (name, key) => db().rpc('mgmt_tally_account_add', { p_name: name, p_key: key });
export const tallyAccountRetire = (accountId, key) => db().rpc('mgmt_tally_account_retire', { p_account: accountId, p_key: key });
export const tallyGet = async (date) => (await one(db().rpc('mgmt_tally_get', { p_date: date })))[0];
export const tallyList = (limit = 30) => one(db().rpc('mgmt_tally_list', { p_limit: limit }));
export const tallySave = (date, accounts, appTotal, reason, key) =>
  db().rpc('mgmt_tally_save', { p_date: date, p_accounts: accounts, p_app_total: appTotal, p_reason: reason || null, p_key: key });

// ── Credit Inbox (lines recorded in Closing, filed by hand) ──
export const inboxLines = (state = null) => one(db().rpc('mgmt_inbox_lines', { p_state: state }));
export const inboxCount = () => one(db().rpc('mgmt_inbox_count'));
export const inboxFile = (
  lineId,
  target,
  { staffId = null, ledgerId = null, categoryId = null, shift = null, description = null, date = null, amount = null },
  key,
) =>
  db().rpc('mgmt_inbox_file', {
    p_line_id: lineId,
    p_target: target,
    p_staff_id: staffId,
    p_ledger: ledgerId,
    p_category: categoryId,
    p_shift: shift,
    p_description: description,
    p_key: key,
    p_date: date,
    p_amount: amount,
  });
export const inboxDismiss = (lineId, reason, key) => db().rpc('mgmt_inbox_dismiss', { p_line_id: lineId, p_reason: reason, p_key: key });
export const inboxReopen = (lineId, reason, key) => db().rpc('mgmt_inbox_reopen', { p_line_id: lineId, p_reason: reason, p_key: key });
