// A1 reference helpers. Positions are 0-based everywhere inside the engine: A1 is { row: 0, col: 0 }.
// Pure functions, no DOM.
export const MAX_ROWS = 10000; // the largest sheet (design section 2)
export const MAX_COLS = 100; // A to CV

// 0 -> "A", 25 -> "Z", 26 -> "AA", 99 -> "CV"
export function colLetters(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// "A" -> 0, "cv" -> 99, "AAA" -> 702. Returns -1 for anything that is not 1 to 3 letters.
export function colIndex(letters) {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const REF = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;

// "$B$12" -> { row: 11, col: 1, absRow: true, absCol: true }; null when the text is not shaped like a reference.
// The result may lie beyond the largest sheet (it is still a reference; evaluating it gives #REF!).
export function parseRef(word) {
  const m = REF.exec(word);
  if (!m) return null;
  const row = Number(m[4]) - 1;
  if (row < 0) return null; // A0 is not a reference
  return { row, col: colIndex(m[2]), absRow: m[3] === '$', absCol: m[1] === '$' };
}

export const refText = (ref) => `${ref.absCol ? '$' : ''}${colLetters(ref.col)}${ref.absRow ? '$' : ''}${ref.row + 1}`;

// Does this position exist in any sheet at all?
export const withinLimits = (row, col) => row >= 0 && col >= 0 && row < MAX_ROWS && col < MAX_COLS;

// A single number key for a position; numeric order of keys is row-major order. Columns are below 128.
export const keyOf = (row, col) => row * 128 + col;
export const rowOfKey = (key) => Math.floor(key / 128);
export const colOfKey = (key) => key % 128;
