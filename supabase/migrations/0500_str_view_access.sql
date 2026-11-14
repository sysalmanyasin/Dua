-- 0500 (STR): who may read stock transfer records.
-- Owner decisions STR-1, STR-2, STR-7 (13 Nov 2026): STR is read-only; the owner grants `str.view` to staff one by one
-- (no role preset gets it); cost prices stay on the table but are never readable by plain table access.
--
-- 1. New permission `str.view` (list, detail, Report, Zero Dispatch, search, print). `str.create` and `str.approve`
--    stay in the catalogue but no STR screen or function uses them.
-- 2. The two feed read policies (0009, which used `str.approve`) now use `str.view`, in the wrapped form that runs the
--    permission check once per query instead of once per row (docs/SESSIONS.md 3.9).
-- 3. `str_line_items.cost_price` is no longer selectable by signed-in users. Cost is shown only through
--    `str_line_costs()` (0502) to people who hold both `str.view` and `inventory.view_cost`. The feed writes as the
--    service role / function owner and is not affected. Nobody may `select *` from this table any more.
-- Safe whether or not Inventory's 0301 (which rewrites the same policies with `str.approve`) is present.
insert into public.permissions (key, description) values
 ('str.view', 'See stock transfer requests, their reports and the zero-dispatch list');

drop policy if exists str_headers_read on public.str_headers;
create policy str_headers_read on public.str_headers for select to authenticated
  using ((select public.has_perm('str.view')));
drop policy if exists str_lines_read on public.str_line_items;
create policy str_lines_read on public.str_line_items for select to authenticated
  using ((select public.has_perm('str.view')));

revoke select on public.str_line_items from authenticated;
grant select (id, str_id, str_item_id, product_code, product_name, carton_no, str_qty, dispatch_qty, receive_qty,
              net_dispatch_qty, product_price, synced_at) on public.str_line_items to authenticated;
