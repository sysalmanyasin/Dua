-- 0113_mgmt_tally_ledger_sign: the Balance Tally takes the Jazz Cash ledger balance with the opposite sign.
-- Before: total counted = ledger balance + the counted accounts. Now: total counted = the counted accounts - the ledger balance
-- (a ledger at -28,260 adds 28,260). The ledger balance itself is stored exactly as before (the raw Jazz Cash balance as of the date).
--
-- Nothing already saved is changed (snapshots stay append-only). So that the history uses one convention, mgmt_tally_get and
-- mgmt_tally_list work total and difference out from the stored parts (the accounts, the ledger balance, the app total) instead of
-- reading the stored total and difference. mgmt_tally_save stores the new rule for every count made from now on.
-- Only these three functions are replaced; their grants stay as they are (create or replace keeps them).

create or replace function public.mgmt_tally_get(p_date date)
returns table (has_snapshot boolean, revision int, ledger_balance numeric, accounts jsonb, app_total numeric, total numeric, difference numeric, live_ledger_balance numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare s public.mgmt_tally_snapshots; v_live numeric; v_ledger numeric; v_counted numeric; v_app numeric;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null then raise exception 'pick a date'; end if;
  select * into s from public.mgmt_tally_snapshots where snap_date = p_date order by revision desc limit 1;
  v_live := public.mgmt_ledger_balance((select id from public.mgmt_ledgers where code = 'jazzcash'), p_date);
  v_ledger := coalesce(s.ledger_balance, v_live);
  v_app := coalesce(s.app_total, 0);
  select coalesce(sum((t.a ->> 'amount')::numeric), 0) into v_counted from jsonb_array_elements(coalesce(s.accounts, '[]'::jsonb)) as t(a);
  return query select (s.id is not null), s.revision, v_ledger, coalesce(s.accounts, '[]'::jsonb), v_app,
                      v_counted - v_ledger, v_counted - v_ledger - v_app, v_live;
end $$;

create or replace function public.mgmt_tally_list(p_limit int default 30)
returns table (snap_date date, revision int, total numeric, app_total numeric, difference numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select x.snap_date, x.revision, x.counted - x.ledger_balance, x.app_total, x.counted - x.ledger_balance - x.app_total
  from (
    select distinct on (s.snap_date) s.snap_date, s.revision, s.ledger_balance, s.app_total,
           (select coalesce(sum((t.a ->> 'amount')::numeric), 0) from jsonb_array_elements(s.accounts) as t(a)) as counted
    from public.mgmt_tally_snapshots s order by s.snap_date, s.revision desc
  ) x
  order by x.snap_date desc limit least(greatest(coalesce(p_limit, 30), 1), 365);
end $$;

-- Same as 0107 except the total: the counted accounts minus the Jazz Cash ledger balance as of the date.
create or replace function public.mgmt_tally_save(p_date date, p_accounts jsonb, p_app_total numeric, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; cur public.mgmt_tally_snapshots; a record; e jsonb; v_list jsonb := '[]'::jsonb; v_amt numeric; v_sum numeric := 0;
  v_ledger numeric; v_total numeric; v_id uuid; res jsonb; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_seen uuid[] := '{}';
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'tally_save');
  if cached is not null then return cached; end if;
  if p_date is null or p_date > today or p_date < date '2000-01-01' then raise exception 'date cannot be in the future'; end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then raise exception 'accounts must be a list'; end if;
  if p_app_total is null or abs(p_app_total) > 1000000000 or p_app_total <> round(p_app_total, 2) then raise exception 'the app total is out of range or has more than 2 decimals'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;
  for e in select * from jsonb_array_elements(p_accounts) loop
    if coalesce(e ->> 'account_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'an account has no valid id'; end if;
    if (e ->> 'account_id')::uuid = any (v_seen) then raise exception 'an account is listed twice'; end if;
    v_seen := v_seen || (e ->> 'account_id')::uuid;
    select * into a from public.mgmt_tally_accounts where id = (e ->> 'account_id')::uuid and retired_at is null;
    if not found then raise exception 'unknown or retired account'; end if;
    if coalesce(e ->> 'amount', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'account amounts must be numbers'; end if;
    v_amt := (e ->> 'amount')::numeric;
    if abs(v_amt) > 1000000000 or v_amt <> round(v_amt, 2) then raise exception 'an amount is out of range or has more than 2 decimals'; end if;
    v_list := v_list || jsonb_build_array(jsonb_build_object('account_id', a.id, 'name', a.name, 'amount', v_amt));
    v_sum := v_sum + v_amt;
  end loop;
  v_ledger := public.mgmt_ledger_balance((select id from public.mgmt_ledgers where code = 'jazzcash'), p_date);
  v_total := v_sum - v_ledger;
  select * into cur from public.mgmt_tally_snapshots where snap_date = p_date order by revision desc limit 1;
  if cur.id is not null and cur.accounts = v_list and cur.app_total = p_app_total and cur.ledger_balance = v_ledger then
    res := jsonb_build_object('unchanged', true, 'revision', cur.revision);
    perform public.mgmt_idem_put(p_key, 'tally_save', res);
    return res;
  end if;
  if cur.id is not null and (v_reason is null or length(v_reason) < 3) then raise exception 'this date already has a count: a reason is required to change it'; end if;
  insert into public.mgmt_tally_snapshots (snap_date, revision, ledger_balance, accounts, app_total, total, difference, reason, created_by)
    values (p_date, coalesce(cur.revision + 1, 0), v_ledger, v_list, p_app_total, v_total, v_total - p_app_total, v_reason, auth.uid()) returning id into v_id;
  perform public.log_activity('mgmt.tally_saved', 'mgmt_tally_snapshots', v_id::text, null, jsonb_build_object('snap_date', p_date, 'revision', coalesce(cur.revision + 1, 0)), v_reason);
  res := jsonb_build_object('id', v_id, 'revision', coalesce(cur.revision + 1, 0), 'difference', v_total - p_app_total);
  perform public.mgmt_idem_put(p_key, 'tally_save', res);
  return res;
end $$;
