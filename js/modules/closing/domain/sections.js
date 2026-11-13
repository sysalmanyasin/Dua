// The guided ledger: one section at a time, in the order of the original Closing app (BUSINESS_RULES; brief section 6).
// `built` says whether this session has the screen yet: unbuilt sections show a short note and keep the nav working.
export const SECTIONS = [
  { key: 'pos', label: 'POS', icon: '🧾', title: 'POS Block', built: true },
  { key: 'mediq', label: 'MEDIQ', icon: '🛵', title: 'MEDIQ COD Orders', built: true },
  { key: 'shift', label: 'Shift', icon: '🔁', title: 'Shift Calculations', built: true },
  { key: 'hs', label: 'HS', icon: '🏠', title: 'HS Block (A)', step: '1', built: true },
  { key: 'strips', label: 'Strips', icon: '📦', title: 'Inventory Strips / Block Revenue (B)', step: '2', built: true },
  { key: 'invaudit', label: 'Inv Audit', icon: '📋', title: 'Inventory Audit', built: true },
  { key: 'misc', label: 'Misc', icon: '🧮', title: 'Ongoing / Miscellaneous Charges (C)', step: '3', built: true },
  { key: 'cc', label: 'Card', icon: '💳', title: 'Credit Card Summary (D)', step: '4', built: true },
  { key: 'till', label: 'Till', icon: '💵', title: 'Till Cash (E)', step: '5', built: true },
  { key: 'vault', label: 'Vault', icon: '🏦', title: 'Vault Cash', built: true },
  { key: 'credit', label: 'Credit', icon: '📒', title: 'Credit (Debtors)', built: true },
  { key: 'deposits', label: 'Deposit', icon: '💰', title: 'Deposits', built: true },
  { key: 'audit', label: 'Audit', icon: '📊', title: 'Cash Audit', built: true },
  { key: 'final-agg', label: 'Final', icon: '🧮', title: 'Final Summary', built: true },
];

export const sectionIndex = (key) =>
  Math.max(
    0,
    SECTIONS.findIndex((s) => s.key === key),
  );
export const clampSection = (i) => Math.min(SECTIONS.length - 1, Math.max(0, i));
