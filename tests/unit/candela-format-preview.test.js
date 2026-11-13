import { readFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import { it } from 'vitest';

// prettier-ignore
it('prints Prettier output for the Candela files', async () => {
  const files = [
    'js/modules/candela-sales/domain/summary.js',
    'tests/unit/candela-sales-domain.test.js',
  ];
  const output = [];

  for (const path of files) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    const cleanSource = source.replaceAll('// prettier-ignore\n', '');
    const formatted = await prettier.format(cleanSource, {
      parser: 'babel',
      plugins: [babel, estree],
      singleQuote: true,
      printWidth: 140,
      trailingComma: 'all',
    });
    output.push(`FILE: ${path}\n${formatted}`);
  }

  throw new Error(`PRETTIER_OUTPUT_BEGIN\n${output.join('\n')}\nPRETTIER_OUTPUT_END`);
});
