import { readFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import { it } from 'vitest';

// prettier-ignore
it('prints Prettier output for the Candela summary helper', async () => {
  const source = await readFile(
    new URL('../../js/modules/candela-sales/domain/summary.js', import.meta.url),
    'utf8',
  );
  const cleanSource = source.replaceAll('// prettier-ignore\n', '');
  const formatted = await prettier.format(cleanSource, {
    parser: 'babel',
    plugins: [babel, estree],
    singleQuote: true,
    printWidth: 140,
    trailingComma: 'all',
  });
  throw new Error(`PRETTIER_OUTPUT_BEGIN\n${formatted}\nPRETTIER_OUTPUT_END`);
});
