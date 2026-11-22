-- Tests for 1111_workspace_style_validator_fix. Styles are invented.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.v(j text) returns boolean language sql as $$ select public.workspace_style_valid(j::jsonb) $$;

-- still valid
select pg_temp.ok(pg_temp.v('{}'), 'an empty style is valid');
select pg_temp.ok(pg_temp.v('{"weight":"bold","size":12,"color":"#FF0000","bg":"#00ff00","halign":"center","valign":"top","borders":{"top":"thin","left":"thick"},"numfmt":{"type":"currency","decimals":2,"currency":"PKR","pattern":"dd/mm/yyyy"}}'), 'a full style is valid');
select pg_temp.ok(pg_temp.v('{"numfmt":{}}'), 'a number format with no keys is still valid (type stays optional)');
select pg_temp.ok(pg_temp.v('{"size":8}') and pg_temp.v('{"size":72}') and pg_temp.v('{"numfmt":{"decimals":0}}') and pg_temp.v('{"numfmt":{"decimals":10}}'), 'range ends are valid');
-- the hole: wrong kind or null for a key that is present
select pg_temp.ok(not pg_temp.v('{"size":"big"}'), 'size as text is refused');
select pg_temp.ok(not pg_temp.v('{"size":8.5}'), 'a fractional size is refused');
select pg_temp.ok(not pg_temp.v('{"size":null}'), 'size null is refused');
select pg_temp.ok(not pg_temp.v('{"size":true}') and not pg_temp.v('{"size":[12]}') and not pg_temp.v('{"size":{"a":1}}'), 'size as a boolean, list or object is refused');
select pg_temp.ok(not pg_temp.v('{"weight":null}') and not pg_temp.v('{"weight":5}') and not pg_temp.v('{"weight":["bold"]}'), 'weight null, number or list is refused');
select pg_temp.ok(not pg_temp.v('{"halign":null}') and not pg_temp.v('{"valign":null}') and not pg_temp.v('{"halign":1}'), 'alignment null or a number is refused');
select pg_temp.ok(not pg_temp.v('{"borders":{"top":null}}') and not pg_temp.v('{"borders":{"top":1}}'), 'a border side set to null or a number is refused');
select pg_temp.ok(not pg_temp.v('{"numfmt":{"decimals":2.5}}') and not pg_temp.v('{"numfmt":{"decimals":"2"}}') and not pg_temp.v('{"numfmt":{"decimals":null}}'), 'decimals that are not a whole number are refused');
select pg_temp.ok(not pg_temp.v('{"numfmt":{"type":null}}') and not pg_temp.v('{"numfmt":{"type":1}}') and not pg_temp.v('{"numfmt":{"pattern":null}}') and not pg_temp.v('{"numfmt":{"pattern":5}}'), 'a number format type or pattern of null or a number is refused');
-- unchanged refusals
select pg_temp.ok(not pg_temp.v('{"color":null}') and not pg_temp.v('{"borders":null}') and not pg_temp.v('{"numfmt":null}') and not pg_temp.v('{"numfmt":{"currency":null}}'), 'null colour, borders, number format and currency stay refused');
select pg_temp.ok(not pg_temp.v('{"size":7}') and not pg_temp.v('{"size":100}') and not pg_temp.v('{"weight":"heavy"}') and not pg_temp.v('{"color":"red"}') and not pg_temp.v('{"font":"x"}') and not pg_temp.v('[]') and not pg_temp.v('null'), 'the earlier refusals still hold');
select pg_temp.ok(not pg_temp.v('{"borders":{"middle":"thin"}}') and not pg_temp.v('{"borders":{"top":"dotted"}}') and not pg_temp.v('{"numfmt":{"type":"text"}}') and not pg_temp.v('{"numfmt":{"decimals":11}}') and not pg_temp.v('{"numfmt":{"pattern":"mm/dd"}}') and not pg_temp.v('{"numfmt":{"extra":1}}'), 'unknown sides, values and number format keys stay refused');
-- the function is still internal and still the table constraint
select pg_temp.ok(not has_function_privilege('authenticated', 'public.workspace_style_valid(jsonb)', 'execute') and not has_function_privilege('anon', 'public.workspace_style_valid(jsonb)', 'execute'), 'the validator is not callable from the browser');
select pg_temp.ok(exists (select 1 from pg_proc where proname = 'workspace_style_valid' and 'search_path=public' = any (proconfig) and provolatile = 'i'), 'it is still immutable with a pinned search_path');
rollback;
