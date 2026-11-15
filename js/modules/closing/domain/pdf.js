// A small PDF writer, so the Closing Book can be made inside the app with no library and no network (the repo vendors no PDF code).
// It writes real text (selectable, searchable, tiny files) using the 14 standard fonts every PDF viewer already has, and simple shapes.
// Coordinates are millimetres from the TOP-LEFT of the page. Text is limited to what the standard fonts hold (Latin letters, digits,
// common punctuation); anything else is replaced by "?" rather than breaking the file.

const PT = 72 / 25.4;

// Glyph widths (per 1000 em) for ASCII 32..126, from the standard Helvetica and Helvetica-Bold metrics.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278,
  278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_B = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333,
  333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611,
  611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const FONTS = {
  helv: { id: 'F1', name: 'Helvetica', widths: HELV },
  helvB: { id: 'F2', name: 'Helvetica-Bold', widths: HELV_B },
  mono: { id: 'F3', name: 'Courier', fixed: 600 },
  monoB: { id: 'F4', name: 'Courier-Bold', fixed: 600 },
  helvI: { id: 'F5', name: 'Helvetica-Oblique', widths: HELV },
};

// Characters outside ASCII that WinAnsi (the encoding used) has, written as the single byte the encoding expects.
const WIN = { '×': '\xD7', '·': '\xB7', '—': '\x97', '–': '\x96', '•': '\x95' };
const REPLACE = { '−': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '₨': 'Rs', '‹': '<', '›': '>', '\u00A0': ' ' };
const WIN_WIDTH = { '\xD7': 584, '\xB7': 278, '\x97': 1000, '\x96': 556, '\x95': 350 };

/** The text as the single-byte string the PDF will hold. */
export function encode(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (WIN[ch] !== undefined) out += WIN[ch];
    else if (c >= 32 && c <= 126) out += ch;
    else if (c >= 0xa1 && c <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}

/** Width in millimetres of text at a size in points. */
export function textWidth(s, font = 'helv', size = 8) {
  const f = FONTS[font];
  let units = 0;
  for (const ch of encode(s)) {
    const c = ch.charCodeAt(0);
    units += f.fixed ?? (c >= 32 && c <= 126 ? f.widths[c - 32] : (WIN_WIDTH[ch] ?? 556));
  }
  return (units * size) / 1000 / PT;
}

/** The text cut with "..." so it is no wider than maxMm. */
export function fit(s, font, size, maxMm) {
  const t = String(s ?? '');
  if (textWidth(t, font, size) <= maxMm) return t;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${t.slice(0, mid).trimEnd()}...`, font, size) <= maxMm) lo = mid;
    else hi = mid - 1;
  }
  return `${t.slice(0, lo).trimEnd()}...`;
}

const rgb = (hex) => {
  const h = String(hex).replace('#', '');
  const n = [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3));
  return n.join(' ');
};
const num = (n) => (Math.round(n * 100) / 100).toString();
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

class Page {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.ops = [];
    this.fonts = new Set();
  }
  y(mm) {
    return num((this.h - mm) * PT);
  }
  x(mm) {
    return num(mm * PT);
  }
  /** A rectangle. Options: fill, stroke (hex), lw (mm), r (corner radius, mm). */
  rect(x, y, w, h, { fill, stroke, lw = 0.2, r = 0 } = {}) {
    if (!fill && !stroke) return;
    const o = this.ops;
    if (fill) o.push(`${rgb(fill)} rg`);
    if (stroke) o.push(`${rgb(stroke)} RG ${num(lw * PT)} w`);
    const X = x * PT;
    const Y = (this.h - y - h) * PT;
    const W = w * PT;
    const H = h * PT;
    if (r > 0) {
      const R = Math.min(r * PT, W / 2, H / 2);
      const k = R * 0.5523;
      o.push(
        `${num(X + R)} ${num(Y)} m ${num(X + W - R)} ${num(Y)} l ${num(X + W - R + k)} ${num(Y)} ${num(X + W)} ${num(Y + R - k)} ${num(X + W)} ${num(Y + R)} c`,
        `${num(X + W)} ${num(Y + H - R)} l ${num(X + W)} ${num(Y + H - R + k)} ${num(X + W - R + k)} ${num(Y + H)} ${num(X + W - R)} ${num(Y + H)} c`,
        `${num(X + R)} ${num(Y + H)} l ${num(X + R - k)} ${num(Y + H)} ${num(X)} ${num(Y + H - R + k)} ${num(X)} ${num(Y + H - R)} c`,
        `${num(X)} ${num(Y + R)} l ${num(X)} ${num(Y + R - k)} ${num(X + R - k)} ${num(Y)} ${num(X + R)} ${num(Y)} c h`,
      );
    } else o.push(`${num(X)} ${num(Y)} ${num(W)} ${num(H)} re`);
    o.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  }
  line(x1, y1, x2, y2, { stroke = '#000000', lw = 0.2 } = {}) {
    this.ops.push(`${rgb(stroke)} RG ${num(lw * PT)} w ${this.x(x1)} ${this.y(y1)} m ${this.x(x2)} ${this.y(y2)} l S`);
  }
  /** Text with its baseline at y. align: left | right | center (x is then the right edge or the centre). */
  text(s, x, y, { font = 'helv', size = 8, color = '#000000', align = 'left', up = false } = {}) {
    const t = encode(s);
    if (!t) return;
    const f = FONTS[font];
    this.fonts.add(font);
    const w = textWidth(s, font, size);
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const tm = up ? `0 1 -1 0 ${this.x(x0)} ${this.y(y)} Tm` : `1 0 0 1 ${this.x(x0)} ${this.y(y)} Tm`;
    this.ops.push(`BT ${rgb(color)} rg /${f.id} ${num(size)} Tf ${tm} (${esc(t)}) Tj ET`);
  }
  width(s, font, size) {
    return textWidth(s, font, size);
  }
}

export class Pdf {
  constructor({ title = '' } = {}) {
    this.title = title;
    this.pages = [];
  }
  addPage(w = 210, h = 297) {
    const p = new Page(w, h);
    this.pages.push(p);
    return p;
  }
  /** The file as bytes. */
  build() {
    const fontKeys = Object.keys(FONTS);
    const objs = [];
    const add = (body) => objs.push(body) && objs.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PAGES');
    const fontRefs = {};
    for (const k of fontKeys) fontRefs[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k].name} /Encoding /WinAnsiEncoding >>`);
    const info = add(`<< /Title (${esc(encode(this.title))}) /Producer (Dua Closing) >>`);
    const kids = [];
    const fontDict = fontKeys.map((k) => `/${FONTS[k].id} ${fontRefs[k]} 0 R`).join(' ');
    for (const p of this.pages) {
      const content = p.ops.join('\n');
      const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pg = add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w * PT)} ${num(p.h * PT)}] /Resources << /Font << ${fontDict} >> >> /Contents ${c} 0 R >>`,
      );
      kids.push(`${pg} 0 R`);
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
  toBlob() {
    return new Blob([this.build()], { type: 'application/pdf' });
  }
}
