// Daily Check List maths and report building. Pure functions: no DOM, no database.
// Calculations and report layout are carried over unchanged from the original app.
import { escapeHtml as esc } from '../../../shared/html.js';

export const r2 = (x) => Math.round(x * 100) / 100;
export const fmtNum = (n) => Number(n).toLocaleString('en-US');
export const hasNum = (v) => {
  const s = String(v ?? '').trim();
  return s !== '' && !Number.isNaN(parseFloat(s));
};
export const numOf = (v) => {
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
};

// ── dates and times as the report prints them ──
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dateNice = (iso) => (iso ? `${iso.slice(8, 10)} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '—');
export const dateShort = (iso) => (iso ? `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}` : '');
export function timeNice(t) {
  if (!t) return '—';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m ?? 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── live figures on the form ──
export function calcStock(f) {
  const hasClosing = hasNum(f.s_closing);
  const closing = hasClosing ? parseFloat(f.s_closing) : 0;
  const net = numOf(f.s_cashsale) + numOf(f.s_creditsale);
  const ret = numOf(f.s_cashreturn) + numOf(f.s_creditreturn);
  const totalHand = r2(closing + net); // Closing = (A+B) − C
  return { hasClosing, net, ret, totalHand, opening: r2(totalHand - numOf(f.s_receive)) };
}
export const calcCustomers = (f) => numOf(f.c_cash) + numOf(f.c_panel);
export const calcLt7 = (f) => numOf(f.lt7_zero) + numOf(f.lt7_days);

// ── progress: a section is complete when every required box in it is filled ──
export const STOCK_REQUIRED = [
  's_receive',
  's_cashsale',
  's_creditsale',
  's_cashreturn',
  's_creditreturn',
  's_closing',
  's_homeservice',
  's_homecount',
  's_drivesales',
  's_drivecount',
  'c_cash',
  'c_panel',
  's_negstock',
];

export function requiredValues(section, state, template) {
  switch (section.id) {
    case 'stocks':
      return STOCK_REQUIRED.map((k) => state.fields[k]);
    case 'lt7':
      return [state.fields.lt7_zero, state.fields.lt7_days];
    case 'meter':
      return [state.fields.meter_ref];
    case 'comp':
      return state.comp.flat();
    case 'notes':
    case 'sig':
      return [];
    default:
      return template.items.filter((i) => i.section_id === section.id && i.active && !i.optional).map((i) => state.answers[i.key]);
  }
}
export function sectionProgress(section, state, template) {
  const vals = requiredValues(section, state, template);
  if (!vals.length) return 1;
  return vals.filter((v) => String(v ?? '').trim() !== '').length / vals.length;
}

// Sections in the order the page shows them.
export function pageSections(template) {
  const tpl = (kind) => template.sections.filter((s) => s.kind === kind && s.active).sort((a, b) => a.sort - b.sort);
  const mk = (id, number_label, title) => ({ id, number_label, title, kind: 'fixed', active: true });
  return [
    ...tpl('items'),
    mk('stocks', '24', 'Stocks Report'),
    ...tpl('table'),
    mk('lt7', '32', 'Less than 7 Days Stock Report'),
    mk('meter', '33', 'Electricity Meter Reading'),
    mk('comp', '34', 'Competitor Sales'),
    mk('notes', '✎', 'Notes'),
    mk('sig', '✓', 'Sign-off'),
  ];
}

// ── the report model (what gets printed, copied and sent) ──
const negify = (n) => {
  const x = Math.abs(n);
  return x ? `-${x}` : '0';
};

export function buildModel(template, state) {
  const f = state.fields;
  const answer = (it) => state.answers[it.key] ?? it.default_value;
  const items = (sec) => template.items.filter((i) => i.section_id === sec.id && i.active).sort((a, b) => a.sort - b.sort);
  const secs = (kind) => template.sections.filter((s) => s.kind === kind && s.active).sort((a, b) => a.sort - b.sort);

  const m = { branch: f.branch ?? '', rows: [], extra: [], stock: [], lt7: [], meter: [], comp: [], notes: '', negStock: '' };
  for (const sec of secs('items')) {
    if (sec.group_no) m.rows.push({ type: 'group', no: sec.group_no, title: sec.title });
    for (const it of items(sec)) m.rows.push({ type: 'item', no: it.no, label: it.label, val: answer(it) });
  }
  for (const sec of secs('table'))
    m.extra.push({ title: sec.title, rows: items(sec).map((it) => ({ no: it.no, label: it.label, val: answer(it) })) });

  const v = (k) => (hasNum(f[k]) ? String(parseFloat(f[k])) : '');
  const nv = (k) => (hasNum(f[k]) ? negify(numOf(f[k])) : '');
  const net = numOf(f.s_cashsale) + numOf(f.s_creditsale);
  const hasNet = hasNum(f.s_cashsale) || hasNum(f.s_creditsale);
  const hasRet = hasNum(f.s_cashreturn) || hasNum(f.s_creditreturn);
  const retTotal = Math.abs(numOf(f.s_cashreturn)) + Math.abs(numOf(f.s_creditreturn));
  const hasClosing = hasNum(f.s_closing);
  const totalHand = r2(numOf(f.s_closing) + net);
  const S = (label, value, bold, underline) => m.stock.push({ label, val: String(value), bold: !!bold, underline: !!underline });
  S('Opening Stock Position: (A)', hasClosing ? r2(totalHand - numOf(f.s_receive)) : '', true);
  S('Stock Receive from Warehouse: (B)', v('s_receive'), true);
  S('Total Stock in Hand: (A+B)', hasClosing ? totalHand : '', true);
  m.stock.push({ type: 'group', title: 'Daily Sales (C)' });
  S('Cash Sale:', v('s_cashsale'));
  S('Cash Sale Return:', nv('s_cashreturn'));
  S('Credit Sale:', v('s_creditsale'));
  S('Credit Sale Return:', nv('s_creditreturn'));
  S('Cash + Credit Return Total:', hasRet ? negify(retTotal) : '');
  S('Net Total:', hasNet ? net : '', true, true);
  S('Closing Stock position: (A+B) -(C)', v('s_closing'), true);
  S('Daily Home Service', v('s_homeservice'));
  S('Home Service No of Customers', v('s_homecount'));
  S('Drive thru customers sales', v('s_drivesales'));
  S('No. of drive thru customers', v('s_drivecount'));
  S('Cash Customers', v('c_cash'));
  S('Panel Customers', v('c_panel'));
  S('Total Number of Customers', hasNum(f.c_cash) || hasNum(f.c_panel) ? numOf(f.c_cash) + numOf(f.c_panel) : '');
  m.negStock = f.s_negstock ?? '';

  const blank = (k) => String(f[k] ?? '') === '';
  m.lt7 = [
    ['Date', dateShort(f.lt7_date)],
    ['Zero items', blank('lt7_zero') ? '' : numOf(f.lt7_zero)],
    ['Less than 7 Days', blank('lt7_days') ? '' : numOf(f.lt7_days)],
    ['Total items', blank('lt7_zero') && blank('lt7_days') ? '' : numOf(f.lt7_zero) + numOf(f.lt7_days)],
  ];
  m.meter = [
    ['Meter Reference Number', f.meter_ref ?? ''],
    ['Meter Reading', f.meter_reading ?? ''],
  ];
  m.comp = state.comp.filter((r) => r.some((c) => String(c ?? '').trim()));
  m.notes = String(f.notes ?? '').trim();
  return m;
}

// ── e-mail / clipboard HTML: inline styles, because mail programs ignore stylesheets ──
export function buildEmailHtml(m) {
  const FONT = 'font-family:Arial,Helvetica,sans-serif;';
  const GREEN = '#2e7d65';
  const TINT = '#e3eee8';
  const CELL = '#f4f8f6';
  const LIGHT = '#a8d08d';
  const LINE = '#1b1b1b';
  const W = 680;
  const cell = `${FONT}font-size:12px;line-height:16px;border:1px solid ${LINE};padding:5px 8px;vertical-align:middle;`;
  const head = (t, w, x) =>
    `<td width="${w}" style="${cell}width:${w}px;background-color:${GREEN};color:#fff;font-weight:bold;padding:7px 8px;${x || ''}">${esc(t)}</td>`;
  const tbl = (w, inner) =>
    `<table cellpadding="0" cellspacing="0" border="1" width="${w}" style="border-collapse:collapse;border:1px solid ${LINE};width:${w}px;table-layout:fixed;${FONT}font-size:12px;">${inner}</table>`;
  const h1 = (t) => `<div style="${FONT}font-size:14px;line-height:20px;font-weight:bold;color:#000;margin:0 0 6px 0;">${esc(t)}</div>`;
  const h3 = (t) => `<div style="${FONT}font-size:13px;line-height:18px;font-weight:bold;color:#000;margin:22px 0 6px 0;">${esc(t)}</div>`;

  let o = `<div style="${FONT}color:#000;">${h1(m.branch)}${h1('Checklist')}<div style="height:10px;"></div>`;
  let t = `<tr>${head('No.', 50, 'text-align:center;')}${head('Checklist item', 370)}${head('Remarks', 260)}</tr>`;
  let n = 0;
  for (const r of m.rows) {
    if (r.type === 'group') {
      t += `<tr><td colspan="3" style="${cell}background-color:${TINT};">${esc(r.no)}&nbsp;&nbsp;${esc(r.title)}</td></tr>`;
      n = 0;
    } else {
      const bg = n++ % 2 ? '#fff' : CELL;
      t += `<tr><td style="${cell}text-align:left;">${esc(r.no)}</td><td style="${cell}background-color:${bg};">${esc(r.label)}</td><td style="${cell}background-color:${bg};text-align:center;font-weight:bold;">${esc(r.val)}</td></tr>`;
    }
  }
  o += tbl(W, t);

  let s = `<tr>${head('Particulars', 300)}${head('Response or value', 220, 'text-align:center;')}</tr>`;
  for (const r of m.stock) {
    if (r.type === 'group') s += `<tr><td colspan="2" style="${cell}background-color:${TINT};font-weight:bold;">${esc(r.title)}</td></tr>`;
    else {
      s += `<tr><td style="${cell}background-color:${r.underline ? TINT : CELL};${r.bold ? 'font-weight:bold;' : ''}">${esc(r.label)}</td><td style="${cell}${r.underline ? `background-color:${TINT};` : ''}text-align:center;${r.bold ? 'font-weight:bold;' : ''}${r.underline ? 'text-decoration:underline;font-size:14px;' : ''}">${esc(r.val)}</td></tr>`;
    }
  }
  o += `${h3('24 Stocks Report')}${tbl(520, s)}<div style="${FONT}font-size:13px;font-weight:bold;margin-top:18px;">Current Stocks negative value</div><div style="${FONT}font-size:13px;font-weight:bold;margin-top:6px;">${esc(m.negStock)}</div>`;

  for (const x of m.extra) {
    const lh = `background-color:${LIGHT};color:#000;`;
    let e = `<tr>${head('No.', 50, `text-align:center;${lh}`)}${head('Checklist item', 370, lh)}${head('Remarks', 260, lh)}</tr>`;
    x.rows.forEach((r, i) => {
      const bg = i % 2 ? '#fff' : CELL;
      e += `<tr><td style="${cell}text-align:center;">${esc(r.no)}</td><td style="${cell}background-color:${bg};">${esc(r.label)}</td><td style="${cell}background-color:${bg};text-align:center;font-weight:bold;">${esc(r.val)}</td></tr>`;
    });
    o += h3(x.title) + tbl(W, e);
  }
  const kv = (title, pairs) => {
    let k = `<tr>${head('Particulars', 300)}${head('Response or value', 220, 'text-align:center;')}</tr>`;
    for (const p of pairs)
      k += `<tr><td style="${cell}background-color:${CELL};">${esc(p[0])}</td><td style="${cell}text-align:center;font-weight:bold;">${esc(p[1])}</td></tr>`;
    return h3(title) + tbl(520, k);
  };
  o += kv('32 Less than 7 Days Stock Report', m.lt7) + kv('33 Electricity Meter Reading', m.meter);

  let c = `<tr>${head('Pharmacy or medical store', 220)}${head('Stock value', 150, 'text-align:center;')}${head('Average per day', 150, 'text-align:center;')}${head('Total monthly sales', 160, 'text-align:center;')}</tr>`;
  m.comp.forEach((r, i) => {
    const bg = i % 2 ? '#fff' : CELL;
    c += `<tr><td style="${cell}background-color:${bg};font-weight:bold;">${esc(r[0])}</td>${[1, 2, 3].map((j) => `<td style="${cell}background-color:${bg};text-align:center;">${esc(r[j] || '')}</td>`).join('')}</tr>`;
  });
  o += h3('34 Competitor Sales') + tbl(W, c);
  if (m.notes) o += `${h3('Notes')}<div style="${FONT}font-size:12px;white-space:pre-wrap;">${esc(m.notes)}</div>`;
  return `${o}</div>`;
}

export function buildPlainText(m) {
  let o = `${m.branch}\nChecklist\n\nNo.\tChecklist item\tRemarks\n`;
  for (const r of m.rows) o += r.type === 'group' ? `${r.no}  ${r.title}\n` : `${r.no}\t${r.label}\t${r.val}\n`;
  o += '\n24 Stocks Report\nParticulars\tResponse or value\n';
  for (const r of m.stock) o += r.type === 'group' ? `${r.title}\n` : `${r.label}\t${r.val}\n`;
  o += `\nCurrent Stocks negative value\n${m.negStock}\n`;
  for (const x of m.extra) {
    o += `\n${x.title}\nNo.\tChecklist item\tRemarks\n`;
    for (const r of x.rows) o += `${r.no}\t${r.label}\t${r.val}\n`;
  }
  o += '\n32 Less than 7 Days Stock Report\nParticulars\tResponse or value\n';
  for (const p of m.lt7) o += `${p[0]}\t${p[1]}\n`;
  o += '\n33 Electricity Meter Reading\nParticulars\tResponse or value\n';
  for (const p of m.meter) o += `${p[0]}\t${p[1]}\n`;
  o += '\n34 Competitor Sales\nPharmacy or medical store\tStock value\tAverage per day\tTotal monthly sales\n';
  for (const r of m.comp) o += `${r.join('\t')}\n`;
  if (m.notes) o += `\nNotes: ${m.notes}\n`;
  return o;
}

export const reportSubject = (branch, isoDate) => `Daily Check List — ${branch} — ${isoDate}`;
