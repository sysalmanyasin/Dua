# Workspace formulas: the rules (Phase 6)

Written before the code, as `workspace.design.md` section 6 requires. If the code and this file disagree, fix one of them
the same day. Pure code in `js/modules/workspace/domain/formulas/`: no DOM, no network, no `eval`, no `new Function`.

## What is stored

A formula cell stores its text (`formula`, starts with `=`, at most 1,000 characters) and **no value**. Results are
calculated in the browser and never stored (the database check "not both value and formula" stays). The text uses A1
references. The server only stores text; the browser rewrites references when rows or columns are inserted or deleted.

## Values

A value is one of: a number (a finite double), text, a boolean, **empty** (`null`), or an **error value**
(`{ error: '#REF!' }` and so on). Errors are values: nothing in the engine throws for bad user input.

The five errors: `#REF!` (a reference that points nowhere), `#VALUE!` (wrong kind of value, wrong number of arguments,
a range where one value is needed, a result that is not a finite number, text longer than 32,767 characters),
`#DIV/0!`, `#NAME?` (unknown function or name, or text that is not a valid formula), `#CIRC!` (the cell is part of a
circular reference). There is no `#NUM!`: a result that is not finite becomes `#VALUE!`, except division by zero.

A formula never ends as empty: an empty result is shown as 0 (`=A1` where A1 is empty shows 0).

## Syntax

- Numbers: `12`, `3.5`, `.5`, `1e3`, `2E-2`. Text: `"like this"`, a quote inside text is written twice (`"say ""hi"""`).
  `TRUE` and `FALSE` (any case). Error literals `#REF!`, `#VALUE!`, `#DIV/0!`, `#NAME?`, `#CIRC!` (the rewrite writes
  `#REF!` into formulas whose reference was deleted).
- References: `A1`, `$A$1`, `A$1`, `$A1`, and ranges `A1:B9`. Columns A to CV (100), rows 1 to 10,000. A reference to a
  cell that is not in the sheet (beyond its current rows or columns) is `#REF!`. A range may be written either way round
  (`B9:A1` is `A1:B9`). **Same sheet only**: `Sheet2!A1` is a syntax error (decision N-10).
- Operators, from tightest to loosest: unary `-` and `+`; `^`; `*` `/`; `+` `-`; `&`; comparisons `= <> < > <= >=`.
  As in Excel, **unary minus binds tighter than `^`** (`-2^2` is 4) and `^` is **left to right** (`2^3^2` is 64).
  Parentheses group. The argument separator is a comma. Spaces are ignored outside text.
- Names are case-insensitive. A word followed by `(` is a function; a word shaped like a reference (`LOG10` without a
  bracket) is a reference; any other word is `#NAME?`. At most 64 levels of nesting.

## Functions (11)

| Function | Arguments | Result |
|---|---|---|
| `SUM` `AVERAGE` `MIN` `MAX` | 1 or more | over the numbers; `AVERAGE` of no numbers is `#DIV/0!`; `SUM` of none is 0; `MIN` and `MAX` of none are 0 |
| `COUNT` | 1 or more | how many numbers |
| `COUNTA` | 1 or more | how many are not empty (text, `""`, booleans and errors all count) |
| `IF(test, then, else)` | 2 or 3 | only the chosen branch is evaluated; a missing `else` is `FALSE` |
| `AND` `OR` | 1 or more | every argument is evaluated (a later error still wins); needs at least one logical value, otherwise `#VALUE!` |
| `ROUND(x, digits)` | 1 or 2 | digits default 0; whole digits only (fraction dropped), clamped to -15..15 |
| `ABS(x)` | 1 | absolute value |
| `CONCAT(a, b, ...)` | 1 or more | the arguments as text, joined; ranges are joined in row order |

Wrong number of arguments is `#VALUE!`. Any other function name is `#NAME?`.

## Reference arguments and literal arguments

`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `AND`, `OR` treat the two differently, as spreadsheets do:

- **Cells and ranges** (`A1`, `A1:B9`): text, booleans and empty cells are **ignored** (`COUNTA` counts all but empty).
- **Typed values** (`5`, `"3"`, `TRUE`, `A1+1`, `IF(...)`): coerced. `"3"` is 3, `TRUE` is 1, `""` or `"abc"` is `#VALUE!`.

An error anywhere in the arguments is the result, the first one in argument order (inside a range: row by row, left to
right). **COUNT and COUNTA are the exception: they never return an error from their arguments** (COUNTA counts an error as
a value, COUNT ignores it). A range where a single value is needed (`=A1:B2+1`, the test of `IF`, `ROUND`'s argument) is `#VALUE!`; there is
no implicit intersection.

## Converting between kinds

- **To a number** (arithmetic, `ROUND`, `ABS`, typed arguments): a number stays; `TRUE` 1, `FALSE` 0; empty 0; text only if
  it is a plain number (optional sign, digits, optional decimal, optional exponent, surrounding spaces ignored), else
  `#VALUE!`. Not accepted as text numbers: `1,200`, `5%`, `0x10`, `Infinity`.
- **To text** (`&`, `CONCAT`): a number as in the grid (whole numbers exactly, others to 15 significant digits, so
  `0.1+0.2` gives `0.3`); `TRUE` or `FALSE`; empty is `""`.
- **To true or false** (`IF` test, `AND`, `OR`): a boolean stays; a number is true unless 0; the text `"TRUE"` or
  `"FALSE"` (any case); empty is false; other text is `#VALUE!`.
- **Comparisons** (`=` `<>` `<` `>` `<=` `>=`): two numbers numerically; two texts case-insensitively by code point (no
  locale: the same answer on every phone); two booleans `FALSE` before `TRUE`. Different kinds: numbers sort before text
  before booleans, so `5<"a"` is true and `5="5"` is false. An empty cell takes the kind of the other side (0, `""` or
  `FALSE`); empty with empty is equal. An error on either side is the result.

## Arithmetic

Plain JavaScript doubles. `x/0` is `#DIV/0!`; `0^-1` is `#DIV/0!`; `0^0` is 1; any other result that is not finite (overflow,
`(-8)^(1/3)`) is `#VALUE!`. `-0` is shown as 0.

**ROUND is half away from zero** on the decimal reading of the number: 2.5 gives 3, -2.5 gives -3, `ROUND(1.005, 2)` gives
1.01 (not 1.00, which a naive `Math.round(x*100)/100` gives). It first reads the number to 15 significant digits, then
rounds. Negative digits round to tens, hundreds: `ROUND(1250, -2)` is 1300.

## Circular references

Detected from the dependency graph, not from what happens to run, so `=IF(TRUE,1,A1)` in `A1` is circular. A cell on a
cycle (a cell that refers to itself, directly, through other cells, or through a range that contains it) is `#CIRC!`. Cells
that depend on it get `#CIRC!` too (an error is passed on like any other).

## Recalculation

One graph per sheet: each formula cell lists the cells and ranges it reads. Changing cells recalculates only those cells
and everything that depends on them, in dependency order. The engine is iterative (a chain of 50,000 formulas does not
overflow the stack). A test checks that incremental recalculation always gives the same answer as recalculating
everything from scratch.

## Inserting and deleting rows and columns

The text of every formula is rewritten (`rewrite.js`), keeping the author's spacing and `$` marks:

- Insert n rows at position p: a row at or after p moves down by n. A range that spans the insertion point grows.
- Delete rows: a reference to a deleted row becomes `#REF!`; rows after it move up. A range loses its deleted rows and
  shrinks; a range with no rows left becomes `#REF!`. Same for columns.
- `translateFormula` (for copy and paste): relative parts move by the offset, `$` parts stay; a result outside the
  sheet becomes `#REF!`.

## How it shows up in the app (Phase 6 integration)

- A formula cell shows its **result**, formatted with the cell's number format; the bar above the grid shows the formula text
  and "Shows: result". Errors show in red, centred (`#DIV/0!`, `#CIRC!`, ...).
- Typing `=` starts a formula. The editor checks it with the parser and refuses one that cannot be read, with a plain reason
  ("This formula cannot be read: The formula ends too soon."). It accepts unknown function names: the cell shows `#NAME?`.
  To store text that begins with `=`, start with an apostrophe (`'=not a formula`).
- A number that does not fit its column is shown as `####` (never cut short, which would look like a different number); the
  bar always has the full value.
- Results are rebuilt whenever the sheet's version moves (every change, ours or anyone's) and when another sheet is shown.
  `domain/formulas/sheetCalc.js` maps the sheet's stable row and column ids to the engine's positions.
- Rewriting formulas for inserted or deleted rows is ready (`rewrite.js`) but nothing calls it yet: the row and column
  screens (Phase 5, increment 7) must store the rewritten text in the same batch as the structure change. A test proves the
  numbers stay the same when they do.

## Limits and safety

Formula length 1,000; nesting 64; a text result at most 32,767 characters (else `#VALUE!`); the fuzz test feeds random text
and checks that nothing throws and nothing is executed. ESLint already bans `eval` and `new Function`.

## Not in this phase

Other sheets, whole-column references (`A:A`), `%`, named ranges, array formulas, dates and times, text functions beyond
`CONCAT`, localised separators. Each would be a new decision.
