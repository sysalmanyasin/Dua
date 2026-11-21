// Staff form rules (the database repeats them). No national ID number is stored anywhere (MGR-7).
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const CODE_RE = /^[A-Z0-9-]{2,16}$/;
const PHONE_RE = /^[0-9+() -]{5,20}$/;
const blank = (v) => v === '' || v === null || v === undefined;

export function validateStaffForm(f, today) {
  const e = {};
  const name = String(f.full_name ?? '').trim();
  if (name.length < 2 || name.length > 80) e.full_name = 'Name must be 2 to 80 characters.';
  const phone = String(f.phone ?? '').trim();
  if (phone && !PHONE_RE.test(phone)) e.phone = 'Phone number looks wrong.';
  if (f.joined_on && (f.joined_on > today || f.joined_on < '1980-01-01')) e.joined_on = 'Joining date looks wrong.';
  const desig = String(f.designation ?? '').trim();
  if (desig.length > 60) e.designation = 'Designation is too long.';
  const code = String(f.staff_code ?? '')
    .trim()
    .toUpperCase();
  if (code && !CODE_RE.test(code)) e.staff_code = 'Use 2 to 16 letters, digits or dashes.';
  const order = blank(f.sort_order) ? 999 : Number(f.sort_order);
  if (!Number.isInteger(order) || order < 1 || order > 999) e.sort_order = 'Order must be 1 to 999.';
  if (f.private) {
    if (String(f.private.father_name ?? '').length > 80) e.father_name = 'Too long.';
    if (String(f.private.address ?? '').length > 200) e.address = 'Too long.';
    if (f.private.blood_group && !BLOOD_GROUPS.includes(f.private.blood_group)) e.blood_group = 'Pick from the list.';
  }
  return e;
}

// What is sent to the database. Private details are sent only when the person may edit them.
export function staffPayload(f, key) {
  return {
    p_staff_id: f.staff_id ?? null,
    p_full_name: String(f.full_name).trim(),
    p_phone: String(f.phone ?? '').trim() || null,
    p_joined_on: f.joined_on || null,
    p_active: Boolean(f.active),
    p_designation: String(f.designation ?? '').trim() || null,
    p_staff_code:
      String(f.staff_code ?? '')
        .trim()
        .toUpperCase() || null,
    p_sort_order: blank(f.sort_order) ? 999 : Number(f.sort_order),
    p_private: f.private
      ? {
          father_name: String(f.private.father_name ?? '').trim(),
          address: String(f.private.address ?? '').trim(),
          blood_group: f.private.blood_group || '',
        }
      : null,
    p_key: key,
  };
}

// ── Staff login (owner only). The server repeats these rules and also refuses weak PINs (0000, 1234, years...). ──
const USERNAME_RE = /^[a-z][a-z0-9._-]{2,23}$/;
export const LOGIN_ROLES = ['junior', 'senior'];

// A starting point only: the first name in lower case. The owner can change it.
export function suggestUsername(fullName) {
  const words = String(fullName ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  let name = words[0] ?? '';
  if (name.length < 3 && words.length > 1) name = words.slice(0, 2).join('.');
  name = name.replace(/^[^a-z]+/, '').slice(0, 24); // a username starts with a letter
  return name.length >= 3 ? name : '';
}

export function validateLoginForm(l) {
  const e = {};
  const username = String(l.username ?? '')
    .trim()
    .toLowerCase();
  if (!USERNAME_RE.test(username)) e.username = '3 to 24 letters or digits (. _ - allowed); start with a letter.';
  if (!LOGIN_ROLES.includes(l.role)) e.role = 'Choose Junior or Senior.';
  if (!/^\d{4}$/.test(String(l.pin ?? ''))) e.pin = 'The PIN must be exactly 4 digits.';
  else if (l.pin !== l.pin2) e.pin2 = 'The two PINs do not match.';
  return e;
}
