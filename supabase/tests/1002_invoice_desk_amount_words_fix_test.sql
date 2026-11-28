-- Tests for 1000/1002 Invoice Desk amount in words (Audit 0, T4). Pure function, no data. Expected strings were worked out by hand
-- from the crore / lakh / thousand grouping, not copied from the function.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

do $t$ begin
  perform pg_temp.ok(public.invoice_desk_amount_words(0) = 'Zero Pakistani Rupees Only', 'zero');
  perform pg_temp.ok(public.invoice_desk_amount_words(1) = 'One Pakistani Rupees Only', 'one rupee');
  perform pg_temp.ok(public.invoice_desk_amount_words(19) = 'Nineteen Pakistani Rupees Only', 'a teen');
  perform pg_temp.ok(public.invoice_desk_amount_words(20) = 'Twenty Pakistani Rupees Only', 'a round ten has no stray word');
  perform pg_temp.ok(public.invoice_desk_amount_words(21) = 'Twenty One Pakistani Rupees Only', 'twenty one');
  perform pg_temp.ok(public.invoice_desk_amount_words(100) = 'One Hundred Pakistani Rupees Only', 'one hundred');
  perform pg_temp.ok(public.invoice_desk_amount_words(999) = 'Nine Hundred Ninety Nine Pakistani Rupees Only', '999');
  perform pg_temp.ok(public.invoice_desk_amount_words(1000) = 'One Thousand Pakistani Rupees Only', 'one thousand');
  perform pg_temp.ok(public.invoice_desk_amount_words(99999) = 'Ninety Nine Thousand Nine Hundred Ninety Nine Pakistani Rupees Only', 'just under a lakh');
  perform pg_temp.ok(public.invoice_desk_amount_words(100000) = 'One Lakh Pakistani Rupees Only', 'one lakh, not "one hundred thousand"');
  perform pg_temp.ok(public.invoice_desk_amount_words(10000000) = 'One Crore Pakistani Rupees Only', 'one crore');
  perform pg_temp.ok(public.invoice_desk_amount_words(10100000) = 'One Crore One Lakh Pakistani Rupees Only', 'a crore and a lakh, nothing between');
  perform pg_temp.ok(public.invoice_desk_amount_words(123456) = 'One Lakh Twenty Three Thousand Four Hundred Fifty Six Pakistani Rupees Only', '123456');
  perform pg_temp.ok(public.invoice_desk_amount_words(1234.50) = 'One Thousand Two Hundred Thirty Four Pakistani Rupees And Fifty Paisa Only', 'rupees and paisa');
  perform pg_temp.ok(public.invoice_desk_amount_words(12345678.99) = 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Pakistani Rupees And Ninety Nine Paisa Only', 'crore, lakh and paisa');
  perform pg_temp.ok(public.invoice_desk_amount_words(999999999.99) = 'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Pakistani Rupees And Ninety Nine Paisa Only', 'the largest allowed amount');
  perform pg_temp.ok(public.invoice_desk_amount_words(1.005) = public.invoice_desk_amount_words(1.01), 'paisa rounds half up at the third decimal');
  perform pg_temp.ok(public.invoice_desk_amount_words(null) is null, 'null in, null out (strict)');
  perform pg_temp.fails('select public.invoice_desk_amount_words(-0.01)', 'a negative amount is refused', 'out of range');
  perform pg_temp.fails('select public.invoice_desk_amount_words(1000000000)', 'an amount of 100 crore or more is refused', 'out of range');
  perform pg_temp.ok((select provolatile = 'i' and proisstrict from pg_proc where proname = 'invoice_desk_amount_words'), 'the function is immutable and strict');
  perform pg_temp.ok((select proconfig::text like '%search_path=public%' from pg_proc where proname = 'invoice_desk_amount_words'), 'its search_path is pinned');
  -- KNOWN DEFECT KI-2 (docs/KNOWN_ISSUES.md): an amount below one rupee yields ' Pakistani Rupees And ... Paisa Only' with an empty
  -- leading word. The browser function has the same behaviour (tests/unit/invoice-desk-known-defects.test.js). Not asserted here as correct.
  perform pg_temp.ok(public.invoice_desk_amount_words(0.50) like '%Fifty Paisa Only', 'a sub-rupee amount still ends in its paisa words (wording is KI-2)');
end $t$;
rollback;
