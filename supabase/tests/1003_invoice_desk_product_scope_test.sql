begin;
do $$
begin
  if public.invoice_desk_amount_words(100000) <> 'One Thousand Pakistani Rupees Only' then raise exception 'thousand amount words mismatch'; end if;
  if public.invoice_desk_amount_words(10000000) <> 'One Lakh Pakistani Rupees Only' then raise exception 'lakh amount words mismatch'; end if;
  if public.invoice_desk_amount_words(100000000) <> 'Ten Crore Pakistani Rupees Only' then raise exception 'crore amount words mismatch'; end if;
end $$;
rollback;
