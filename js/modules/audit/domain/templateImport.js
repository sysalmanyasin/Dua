// Reads templates exported from the old Audit Hub app: JSON like [{ "name": "Syrups", "codes": ["040700", "078751"] }].
// "codes" may be a list or one string (spaces, commas or lines). Returns { templates, skipped }.
import { parseCodes } from './count.js';

export function parseTemplateImport(text, existingNames = []) {
  let data;
  try {
    data = JSON.parse(String(text ?? '').trim());
  } catch {
    return { error: 'This is not valid JSON. Paste exactly what the export gave you.' };
  }
  if (data && !Array.isArray(data) && Array.isArray(data.templates)) data = data.templates;
  if (!Array.isArray(data)) return { error: 'Expected a list of templates.' };
  const seen = new Set(existingNames.map((n) => String(n).trim().toLowerCase()));
  const templates = [];
  let skipped = 0;
  for (const t of data) {
    const name = String(t?.name ?? '')
      .trim()
      .slice(0, 80);
    const codes = parseCodes(Array.isArray(t?.codes) ? t.codes.join(' ') : String(t?.codes ?? ''));
    if (name.length < 2 || codes.length === 0 || seen.has(name.toLowerCase())) {
      skipped += 1;
      continue;
    }
    seen.add(name.toLowerCase());
    templates.push({ name, codes });
  }
  return { templates, skipped };
}
