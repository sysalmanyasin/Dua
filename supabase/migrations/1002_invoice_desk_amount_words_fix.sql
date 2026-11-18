-- Correct PKR crore/lakh/thousand grouping for database-side amount words.
create or replace function public.invoice_desk_amount_words(p_amount numeric)
returns text language plpgsql immutable strict set search_path = public as $$
declare
  v_paisa bigint;
  v_rupees bigint;
  v_cents integer;
  v_crore integer;
  v_lakh integer;
  v_thousand integer;
  v_remainder integer;
  v_result text := '';
begin
  if p_amount < 0 or p_amount > 999999999.99 then
    raise exception 'amount out of range' using errcode = '22023';
  end if;
  v_paisa := round(p_amount * 100)::bigint;
  v_rupees := v_paisa / 100;
  v_cents := (v_paisa % 100)::integer;
  if v_rupees = 0 and v_cents = 0 then return 'Zero Pakistani Rupees Only'; end if;
  v_crore := (v_rupees / 10000000)::integer;
  v_lakh := (v_rupees / 100000 % 100)::integer;
  v_thousand := (v_rupees / 1000 % 100)::integer;
  v_remainder := (v_rupees % 1000)::integer;
  if v_crore > 0 then v_result := public.invoice_desk_under_thousand(v_crore) || ' Crore'; end if;
  if v_lakh > 0 then v_result := concat_ws(' ', nullif(v_result,''), public.invoice_desk_under_thousand(v_lakh) || ' Lakh'); end if;
  if v_thousand > 0 then v_result := concat_ws(' ', nullif(v_result,''), public.invoice_desk_under_thousand(v_thousand) || ' Thousand'); end if;
  if v_remainder > 0 then v_result := concat_ws(' ', nullif(v_result,''), public.invoice_desk_under_thousand(v_remainder)); end if;
  v_result := v_result || ' Pakistani Rupees';
  if v_cents > 0 then v_result := v_result || ' And ' || public.invoice_desk_under_thousand(v_cents) || ' Paisa'; end if;
  return v_result || ' Only';
end $$;
