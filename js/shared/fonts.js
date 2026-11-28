// The shared font library: every family bundled in vendor/fonts/ and declared in css/fonts.css, so no module depends on fonts that
// only some devices have. Use `stack(key)` in a module's CSS-in-JS or a picker; css/*.css files use the same stacks directly.
// The bundled face comes first; the system names after it are the fallback while the file loads (and for old browsers).
export const FONTS = Object.freeze({
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif", kind: 'sans' },
  'plex-mono': { label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, monospace", kind: 'mono' },
  caladea: { label: 'Caladea (Cambria)', stack: "'Caladea', Cambria, 'Noto Serif', Georgia, serif", kind: 'serif' },
  carlito: { label: 'Carlito (Calibri)', stack: "'Carlito', Calibri, 'Segoe UI', Arial, sans-serif", kind: 'sans' },
  cousine: { label: 'Cousine (Courier New)', stack: "'Cousine', 'Courier New', 'Liberation Mono', monospace", kind: 'mono' },
  'comic-neue': { label: 'Comic Neue (Comic Sans)', stack: "'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', cursive", kind: 'casual' },
  'naskh-urdu': {
    label: 'Noto Naskh Arabic (Urdu, Arabic)',
    stack: "'Noto Naskh Arabic', Arial, 'Segoe UI', Tahoma, sans-serif",
    kind: 'urdu',
  },
});
export const fontKeys = () => Object.keys(FONTS);
export const stack = (key) => (FONTS[key] ?? FONTS.inter).stack;
