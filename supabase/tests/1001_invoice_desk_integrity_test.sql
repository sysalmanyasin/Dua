begin;
do $$
begin
  if public.invoice_desk_amount_words(0) <> 'Zero Pakistani Rupees Only' then raise exception 'zero words mismatch'; end if;
  raise notice 'pass: zero amount words';

  if public.invoice_desk_amount_words(12.34) <> 'Twelve Pakistani Rupees And Thirty Four Paisa Only' then raise exception 'paisa words mismatch'; end if;
  raise notice 'pass: rupees and paisa words';

  if public.invoice_desk_amount_words(12345678.90) <> 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Pakistani Rupees And Ninety Paisa Only' then raise exception 'crore/lakh/thousand words mismatch'; end if;
  raise notice 'pass: crore, lakh and thousand grouping';

  if public.invoice_desk_amount_words(999999999.99) <> 'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Pakistani Rupees And Ninety Nine Paisa Only' then raise exception 'upper bound words mismatch'; end if;
  raise notice 'pass: maximum supported amount words';
end $$;
rollback;
