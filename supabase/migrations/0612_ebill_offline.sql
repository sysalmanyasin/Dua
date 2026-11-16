-- 0612_ebill_offline.sql — what offline billing needs from the server (Phase 3).
--
-- A PIN cannot be checked offline against the server's hash without handing that hash to the device. Instead, after a person has
-- entered their PIN correctly ONLINE on a device, the server gives that device a random secret (kept only as a SHA-256 hash).
-- An invoice made offline carries that secret as "offline_proof"; when it syncs, the server accepts it as proof of the PIN only if:
--   * the secret matches this person's grant for this device,
--   * the person still has a PIN, and
--   * the PIN was not changed after the device last proved it (invoices made before a change are still honoured).
-- Everything else (discount limits, totals, device status, duplicates) is checked again exactly as for an online save.
-- Such invoices are marked pin_check = 'device' so the owner can see which were checked on the device.

alter table public.ebill_invoices add column pin_check text not null default 'server' check (pin_check in ('server','device'));

create table public.ebill_offline_grants (
  user_id      uuid not null references auth.users(id),
  device_id    uuid not null references public.ebill_devices(device_id),
  secret_hash  text not null,
  pin_set_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.ebill_offline_grants enable row level security;
revoke all on public.ebill_offline_grants from public, anon, authenticated;

-- Online only. Needs the right PIN (and counts wrong ones like any other PIN check). Returns the secret ONCE.
create or replace function public.ebill_offline_grant(p_device_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_res text; v_secret text; v_set timestamptz;
begin
  if not public.has_perm('ebill.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  select status into v_status from public.ebill_devices where device_id = p_device_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'device_unknown', 'message', 'This device is not registered yet.'); end if;
  if v_status <> 'active' then return jsonb_build_object('ok', false, 'code', 'device_inactive', 'message', 'This device has been deactivated.'); end if;
  if p_pin is null or btrim(p_pin) = '' then return jsonb_build_object('ok', false, 'code', 'pin_required', 'message', 'Enter your PIN.'); end if;
  v_res := public.ebill_check_pin(v_uid, p_pin);
  if v_res <> 'ok' then
    return jsonb_build_object('ok', false, 'code', v_res, 'message', case v_res
      when 'no_pin' then 'No PIN has been set for you. Ask the owner.' when 'locked' then 'Too many wrong PINs. Try again in 15 minutes.' else 'Wrong PIN.' end);
  end if;
  select set_at into v_set from public.ebill_pins where user_id = v_uid;
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.ebill_offline_grants(user_id, device_id, secret_hash, pin_set_at)
  values (v_uid, p_device_id, encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_set)
  on conflict (user_id, device_id) do update set secret_hash = excluded.secret_hash, pin_set_at = excluded.pin_set_at, created_at = now();
  perform public.log_activity('ebill.offline_grant', 'ebill_offline_grants', v_uid::text, null, jsonb_build_object('device_id', p_device_id), null);
  return jsonb_build_object('ok', true, 'secret', v_secret, 'pin_set_at', v_set);
end $$;

-- What an offline device needs to know about the person using it: their limits, whether saving needs a PIN, whether they have one.
create or replace function public.ebill_my_limits() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lim public.ebill_staff_limits%rowtype;
begin
  if not public.has_perm('ebill.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into lim from public.ebill_staff_limits where user_id = auth.uid();
  return jsonb_build_object(
    'max_pct', coalesce(lim.max_discount_pct, (select (value #>> '{}')::numeric from public.settings where key = 'ebill.max_discount_pct'), 0),
    'max_amount', coalesce(lim.max_discount_amount, (select (value #>> '{}')::numeric from public.settings where key = 'ebill.max_discount_amount'), 0),
    'override', public.has_perm('ebill.discount_override'),
    'pin_required', coalesce((select value = 'true'::jsonb from public.settings where key = 'ebill.pin_required'), true),
    'has_pin', exists (select 1 from public.ebill_pins where user_id = auth.uid()));
end $$;

revoke all on function public.ebill_offline_grant(uuid, text), public.ebill_my_limits() from public, anon, authenticated;
grant execute on function public.ebill_offline_grant(uuid, text), public.ebill_my_limits() to authenticated;

create or replace function public.ebill_save_invoice(p_invoice jsonb, p_pin text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid; v_dev uuid; v_client_ts timestamptz;
  v_customer text; v_mode text; v_comments text;
  v_cdisc_pct numeric; v_rmode text; v_rval numeric; v_tax_pct numeric; v_adj numeric; v_cash numeric; v_client_net numeric;
  e jsonb; v_lines jsonb := '[]'::jsonb; n int := 0;
  v_qty numeric; v_rate numeric; v_pack numeric; v_unit text; v_dmode text; v_dval numeric; v_gross numeric; v_disc numeric;
  v_code text; v_stock numeric; v_need numeric; v_flag text;
  v_pre_gross numeric := 0; v_line_total_sum numeric := 0; v_line_disc numeric := 0;
  v_cdisc numeric; v_rdisc numeric; v_net_gross numeric; v_tax numeric; v_net numeric;
  v_total_disc numeric; v_pct numeric; v_max_pct numeric; v_max_amt numeric; lim public.ebill_staff_limits%rowtype;
  v_existing public.ebill_invoices%rowtype; v_dev_status text; v_need_pin boolean; v_pin_res text;
  v_tz text; v_ts timestamptz; v_date date; v_name text; v_no text; v_new uuid;
  v_pin_check text := 'server'; v_proof text; v_gh text; v_gset timestamptz; v_pset timestamptz;
begin
  if not public.has_perm('ebill.use') then raise exception 'not allowed' using errcode = '42501'; end if;

  -- 1. read and validate the payload (any malformed value becomes code "invalid")
  begin
    v_id := (p_invoice ->> 'invoice_id')::uuid;
    v_dev := (p_invoice ->> 'device_id')::uuid;
    v_client_ts := (p_invoice ->> 'client_created_at')::timestamptz;
    v_customer := left(btrim(coalesce(p_invoice ->> 'customer', '')), 120);
    v_mode := p_invoice ->> 'payment_mode';
    v_comments := left(btrim(coalesce(p_invoice ->> 'comments', '')), 500);
    v_cdisc_pct := coalesce((p_invoice ->> 'customer_discount_pct')::numeric, 0);
    v_rmode := coalesce(p_invoice #>> '{receipt_discount,mode}', 'amt');
    v_rval := coalesce((p_invoice #>> '{receipt_discount,value}')::numeric, 0);
    v_tax_pct := coalesce((p_invoice ->> 'tax_pct')::numeric, 0);
    v_adj := coalesce((p_invoice ->> 'adjustment')::numeric, 0);
    v_cash := coalesce((p_invoice ->> 'cash_received')::numeric, 0);
    v_client_net := (p_invoice #>> '{totals,net_total}')::numeric;
    if v_id is null or v_dev is null or v_client_ts is null or v_client_net is null then raise exception 'missing'; end if;
    if v_mode not in ('Cash','Card','Credit') or v_rmode not in ('pct','amt') then raise exception 'bad value'; end if;
    if v_cdisc_pct < 0 or v_cdisc_pct > 100 or v_rval < 0 or v_tax_pct < 0 or v_tax_pct > 100 or v_cash < 0 or abs(v_adj) > 10000000 then raise exception 'range'; end if;
    if jsonb_typeof(p_invoice -> 'lines') <> 'array' or jsonb_array_length(p_invoice -> 'lines') not between 1 and 200 then raise exception 'lines'; end if;

    for e in select value from jsonb_array_elements(p_invoice -> 'lines') loop
      n := n + 1;
      v_code := left(btrim(coalesce(e ->> 'code', '')), 60);
      v_qty := (e ->> 'qty')::numeric; v_rate := (e ->> 'rate')::numeric;
      v_pack := coalesce((e ->> 'pack')::numeric, 1); v_unit := coalesce(e ->> 'unit', 'unit');
      v_dmode := coalesce(e #>> '{discount,mode}', 'pct'); v_dval := coalesce((e #>> '{discount,value}')::numeric, 0);
      if v_code = '' or coalesce(btrim(e ->> 'name'), '') = '' or v_qty is null or v_rate is null then raise exception 'line'; end if;
      if v_qty <= 0 or v_qty > 1000000 or v_rate < 0 or v_rate > 100000000 or v_pack <= 0 or v_dval < 0
         or v_unit not in ('unit','pack') or v_dmode not in ('pct','amt') then raise exception 'line range'; end if;
      v_gross := round(v_rate * v_qty, 2);
      v_disc := round(case when v_dmode = 'pct' then least(v_gross * least(v_dval, 100) / 100, v_gross) else least(v_dval, v_gross) end, 2);
      v_pre_gross := v_pre_gross + v_gross;
      v_line_disc := v_line_disc + v_disc;
      v_line_total_sum := v_line_total_sum + (v_gross - v_disc);
      -- stock check against the server's current figure (recorded, never blocking)
      select p.qty into v_stock from public.inventory_products p where p.code = v_code and p.active order by p.id limit 1;
      v_need := v_qty * case when v_unit = 'pack' then v_pack else 1 end;
      v_flag := case when not found then 'unknown' when v_stock <= 0 then 'none' when v_need > v_stock then 'short' else 'ok' end;
      v_lines := v_lines || jsonb_build_object('line_no', n, 'code', v_code, 'name', left(btrim(e ->> 'name'), 200),
        'generic', left(btrim(coalesce(e ->> 'generic', '')), 200), 'unit', v_unit, 'pack', v_pack, 'qty', v_qty, 'rate', round(v_rate, 2),
        'discount_mode', v_dmode, 'discount_value', v_dval, 'discount_amount', v_disc, 'line_total', v_gross - v_disc,
        'stock_qty', v_stock, 'stock_flag', v_flag);
    end loop;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The invoice data is not valid.');
  end;

  -- 2. a retry of an invoice already saved is success (idempotency by invoice_id)
  select * into v_existing from public.ebill_invoices where invoice_id = v_id;
  if found then
    if v_existing.staff_user = v_uid or public.has_perm('ebill.manage') then
      return jsonb_build_object('ok', true, 'code', 'duplicate', 'invoice_no', v_existing.invoice_no);
    end if;
    return jsonb_build_object('ok', false, 'code', 'id_conflict', 'message', 'That invoice id belongs to someone else.');
  end if;

  -- 3. the device must be registered and active
  select status into v_dev_status from public.ebill_devices where device_id = v_dev;
  if not found then return jsonb_build_object('ok', false, 'code', 'device_unknown', 'message', 'This device is not registered yet.'); end if;
  if v_dev_status <> 'active' then return jsonb_build_object('ok', false, 'code', 'device_inactive', 'message', 'This device has been deactivated.'); end if;

  -- 4. figures: recompute and compare
  v_cdisc := round(v_line_total_sum * v_cdisc_pct / 100, 2);
  v_rdisc := round(case when v_rmode = 'pct' then least((v_line_total_sum - v_cdisc) * least(v_rval, 100) / 100, v_line_total_sum - v_cdisc)
                        else least(v_rval, v_line_total_sum - v_cdisc) end, 2);
  v_net_gross := round(v_line_total_sum - v_cdisc - v_rdisc, 2);
  v_tax := round(v_net_gross * v_tax_pct / 100, 2);
  v_net := greatest(0, round(v_net_gross + v_tax + v_adj, 2));
  if abs(v_net - v_client_net) > 0.01 then
    return jsonb_build_object('ok', false, 'code', 'total_mismatch', 'message', 'The total does not match the items.', 'server_net_total', v_net);
  end if;

  -- 5. discount limits (staff row, else shop default); a manager override lifts them
  select * into lim from public.ebill_staff_limits where user_id = v_uid;
  v_max_pct := coalesce(lim.max_discount_pct, (select (value #>> '{}')::numeric from public.settings where key = 'ebill.max_discount_pct'), 0);
  v_max_amt := coalesce(lim.max_discount_amount, (select (value #>> '{}')::numeric from public.settings where key = 'ebill.max_discount_amount'), 0);
  v_total_disc := v_line_disc + v_cdisc + v_rdisc;
  v_pct := case when v_pre_gross > 0 then v_total_disc * 100 / v_pre_gross else 0 end;
  if (v_pct > v_max_pct + 0.0001 or v_total_disc > v_max_amt) and not public.has_perm('ebill.discount_override') then
    return jsonb_build_object('ok', false, 'code', 'discount_limit', 'message', 'The discount is above your limit.',
      'max_pct', v_max_pct, 'max_amount', v_max_amt, 'discount_pct', round(v_pct, 2), 'discount_amount', round(v_total_disc, 2));
  end if;

  -- 6. the finalize PIN: typed now (online), or, for an invoice made offline, proved by this device's grant (see ebill_offline_grant)
  v_need_pin := coalesce((select value = 'true'::jsonb from public.settings where key = 'ebill.pin_required'), true);
  if v_need_pin then
    if p_pin is null or btrim(p_pin) = '' then
      v_proof := p_invoice ->> 'offline_proof';
      if v_proof is null or v_proof = '' then return jsonb_build_object('ok', false, 'code', 'pin_required', 'message', 'Enter your PIN to save.'); end if;
      select set_at into v_pset from public.ebill_pins where user_id = v_uid;
      if v_pset is null then return jsonb_build_object('ok', false, 'code', 'no_pin', 'message', 'No PIN is set for you any more. Ask the owner.'); end if;
      select secret_hash, pin_set_at into v_gh, v_gset from public.ebill_offline_grants where user_id = v_uid and device_id = v_dev;
      if v_gh is null or v_gh <> encode(extensions.digest(v_proof, 'sha256'), 'hex') then
        return jsonb_build_object('ok', false, 'code', 'bad_proof', 'message', 'This device could not prove the PIN was entered. Ask the owner.');
      end if;
      -- the owner changed the PIN after this device last proved it: honour only invoices made before the change
      if v_gset <> v_pset and v_client_ts >= v_pset then
        return jsonb_build_object('ok', false, 'code', 'pin_changed', 'message', 'The PIN was changed after this invoice was made offline. The owner must review it.');
      end if;
      v_pin_check := 'device';
    else
      v_pin_res := public.ebill_check_pin(v_uid, p_pin);
      if v_pin_res <> 'ok' then
        return jsonb_build_object('ok', false, 'code', v_pin_res, 'message', case v_pin_res
          when 'no_pin' then 'No PIN has been set for you. Ask the owner.' when 'locked' then 'Too many wrong PINs. Try again in 15 minutes.' else 'Wrong PIN.' end);
      end if;
    end if;
  end if;

  -- 7. save
  v_tz := coalesce((select value #>> '{}' from public.settings where key = 'business_timezone'), 'Asia/Karachi');
  v_ts := least(v_client_ts, now() + interval '5 minutes'); -- a device clock in the future cannot back-date or forward-date a day
  v_date := (v_ts at time zone v_tz)::date;
  select coalesce(s.full_name, pr.username) into v_name from public.profiles pr left join public.staff s on s.id = pr.staff_id where pr.user_id = v_uid;
  v_no := 'EB-' || to_char(v_date, 'YYMMDD') || '-' || lpad(nextval('public.ebill_invoice_seq')::text, 5, '0');

  insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, customer, payment_mode, gross_total, line_discounts,
    customer_discount_pct, customer_discount, receipt_discount, net_gross, tax_pct, tax, adjustment, net_total, cash_received, comments, client_created_at, pin_check)
  values (v_id, v_no, v_date, v_dev, v_uid, coalesce(v_name, 'Staff'), v_customer, v_mode, round(v_line_total_sum, 2), round(v_line_disc, 2),
    v_cdisc_pct, v_cdisc, v_rdisc, v_net_gross, v_tax_pct, v_tax, round(v_adj, 2), v_net, round(v_cash, 2), v_comments, v_ts, v_pin_check)
  on conflict (invoice_id) do nothing returning invoice_id into v_new;
  if v_new is null then -- another retry won the race
    select invoice_no into v_no from public.ebill_invoices where invoice_id = v_id;
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'invoice_no', v_no);
  end if;

  insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, generic, unit, pack, qty, rate, discount_mode, discount_value, discount_amount, line_total, stock_qty, stock_flag)
  select v_id, x.line_no, x.code, x.name, x.generic, x.unit, x.pack, x.qty, x.rate, x.discount_mode, x.discount_value, x.discount_amount, x.line_total, x.stock_qty, x.stock_flag
  from jsonb_to_recordset(v_lines) as x(line_no int, code text, name text, generic text, unit text, pack numeric, qty numeric, rate numeric,
    discount_mode text, discount_value numeric, discount_amount numeric, line_total numeric, stock_qty numeric, stock_flag text);

  update public.ebill_devices set last_seen_at = now() where device_id = v_dev;
  perform public.log_activity('ebill.invoice_saved', 'ebill_invoices', v_id::text, null,
    jsonb_build_object('invoice_no', v_no, 'net_total', v_net, 'discount', round(v_total_disc, 2), 'device_id', v_dev, 'lines', n), null);
  return jsonb_build_object('ok', true, 'code', 'saved', 'invoice_no', v_no, 'net_total', v_net);
end $$;


