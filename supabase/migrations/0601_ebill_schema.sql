-- 0601_ebill_schema.sql — Emergency Billing: permissions, settings, tables, immutability and read access.
-- Range 0600-0699 belongs to Emergency Billing (docs/MODULES.md §5.1). Prefix ebill_, permissions ebill.*.
--
-- Rules built into the shape of the data:
--  * Every write goes through a security-definer function (0610, 0611, 0620). authenticated has SELECT only, through RLS.
--  * Posted invoices and their lines can never be updated, deleted or truncated (a refund or correction adds a new record, Phase 4).
--  * Finalize PINs live in ebill_pins as a bcrypt hash; the table has no grants and no policies, so no client can read it.
--  * invoice_id is made by the device and is the primary key: a retried upload can never create a second invoice.
--  * Nothing here touches Sales, Candela or Inventory data. Emergency invoices stay separate (owner, 15 Nov 2026).

create extension if not exists pgcrypto with schema extensions;

insert into public.permissions (key, description) values
 ('ebill.use', 'Use Emergency Billing: create and save invoices and see your own history'),
 ('ebill.history_all', 'See every Emergency Billing invoice'),
 ('ebill.manage', 'Emergency Billing manager: devices, staff discount limits, refunds and corrections'),
 ('ebill.discount_override', 'Give Emergency Billing discounts above the staff limit'),
 ('ebill.set_pin', 'Set Emergency Billing finalize PINs (owner)');

-- No role preset carries any ebill right (like Candela, and so Foundation's role tests stay true). The owner (admin, with MFA) holds all of
-- them; everyone else is given ebill.use person by person in Users & Access, so the owner decides who may bill in an emergency.

insert into public.settings(key, value, staff_visible) values
 ('ebill.max_discount_pct', '10', false),
 ('ebill.max_discount_amount', '1000', false),
 ('ebill.pin_required', 'true', false);

create sequence public.ebill_invoice_seq;

-- ───────── devices ─────────
create table public.ebill_devices (
  device_id          uuid primary key,
  label              text not null default 'Device' check (length(label) between 1 and 60),
  status             text not null default 'active' check (status in ('active','deactivated')),
  registered_by      uuid not null references auth.users(id),
  registered_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  deactivated_at     timestamptz,
  deactivated_by     uuid references auth.users(id),
  deactivate_reason  text
);
alter table public.ebill_devices enable row level security;

-- ───────── invoices (append-only) ─────────
create table public.ebill_invoices (
  invoice_id            uuid primary key,
  invoice_no            text not null unique,
  business_date         date not null,
  device_id             uuid not null references public.ebill_devices(device_id),
  staff_user            uuid not null references auth.users(id),
  staff_name            text not null,
  customer              text not null default '',
  payment_mode          text not null check (payment_mode in ('Cash','Card','Credit')),
  gross_total           numeric(14,2) not null check (gross_total >= 0),
  line_discounts        numeric(14,2) not null default 0 check (line_discounts >= 0),
  customer_discount_pct numeric(5,2) not null default 0 check (customer_discount_pct between 0 and 100),
  customer_discount     numeric(14,2) not null default 0 check (customer_discount >= 0),
  receipt_discount      numeric(14,2) not null default 0 check (receipt_discount >= 0),
  net_gross             numeric(14,2) not null check (net_gross >= 0),
  tax_pct               numeric(5,2) not null default 0 check (tax_pct >= 0),
  tax                   numeric(14,2) not null default 0 check (tax >= 0),
  adjustment            numeric(14,2) not null default 0,
  net_total             numeric(14,2) not null check (net_total >= 0),
  cash_received         numeric(14,2) not null default 0 check (cash_received >= 0),
  comments              text not null default '',
  status                text not null default 'posted' check (status in ('posted','refunded','corrected')),
  client_created_at     timestamptz not null,
  created_at            timestamptz not null default now()
);
create index ebill_invoices_date_idx on public.ebill_invoices (business_date);
create index ebill_invoices_staff_idx on public.ebill_invoices (staff_user);
create index ebill_invoices_device_idx on public.ebill_invoices (device_id);
alter table public.ebill_invoices enable row level security;

create table public.ebill_invoice_lines (
  id               bigint generated always as identity primary key,
  invoice_id       uuid not null references public.ebill_invoices(invoice_id),
  line_no          integer not null,
  code             text not null,
  name             text not null,
  generic          text not null default '',
  unit             text not null check (unit in ('unit','pack')),
  pack             numeric not null default 1 check (pack > 0),
  qty              numeric not null check (qty > 0),
  rate             numeric(14,2) not null check (rate >= 0),
  discount_mode    text not null check (discount_mode in ('pct','amt')),
  discount_value   numeric not null default 0 check (discount_value >= 0),
  discount_amount  numeric(14,2) not null default 0 check (discount_amount >= 0),
  line_total       numeric(14,2) not null check (line_total >= 0),
  stock_qty        numeric,          -- what the server's stock figure said at save time; null = product not found
  stock_flag       text not null default 'unknown' check (stock_flag in ('ok','short','none','unknown')),
  unique (invoice_id, line_no)
);
alter table public.ebill_invoice_lines enable row level security;

-- ───────── staff PIN hashes and discount limits ─────────
create table public.ebill_pins (
  user_id       uuid primary key references auth.users(id),
  pin_hash      text not null,
  set_by        uuid references auth.users(id),
  set_at        timestamptz not null default now(),
  failed_count  integer not null default 0,
  locked_until  timestamptz
);
alter table public.ebill_pins enable row level security;

create table public.ebill_staff_limits (
  user_id             uuid primary key references auth.users(id),
  max_discount_pct    numeric(5,2) check (max_discount_pct between 0 and 100),
  max_discount_amount numeric(14,2) check (max_discount_amount >= 0),
  updated_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);
alter table public.ebill_staff_limits enable row level security;

-- ───────── posted invoices are never changed ─────────
create or replace function public.ebill_no_change() returns trigger
language plpgsql as $$ begin raise exception 'posted Emergency Billing records cannot be changed or deleted' using errcode = '42501'; end $$;
create trigger ebill_invoices_frozen before update or delete on public.ebill_invoices for each row execute function public.ebill_no_change();
create trigger ebill_invoices_no_truncate before truncate on public.ebill_invoices for each statement execute function public.ebill_no_change();
create trigger ebill_lines_frozen before update or delete on public.ebill_invoice_lines for each row execute function public.ebill_no_change();
create trigger ebill_lines_no_truncate before truncate on public.ebill_invoice_lines for each statement execute function public.ebill_no_change();

-- ───────── read access (no write grants anywhere) ─────────
revoke all on public.ebill_devices, public.ebill_invoices, public.ebill_invoice_lines, public.ebill_pins, public.ebill_staff_limits
  from public, anon, authenticated;
revoke all on sequence public.ebill_invoice_seq from public, anon, authenticated;
grant select on public.ebill_devices, public.ebill_invoices, public.ebill_invoice_lines, public.ebill_staff_limits to authenticated;

create policy ebill_devices_read on public.ebill_devices for select to authenticated
  using ((select public.has_perm('ebill.manage')));
create policy ebill_invoices_read on public.ebill_invoices for select to authenticated
  using ((staff_user = (select auth.uid()) and (select public.has_perm('ebill.use')))
         or (select public.has_perm('ebill.history_all')) or (select public.has_perm('ebill.manage')));
-- a line is visible exactly when its invoice is (the sub-select runs under the invoice policy above)
create policy ebill_lines_read on public.ebill_invoice_lines for select to authenticated
  using (exists (select 1 from public.ebill_invoices i where i.invoice_id = ebill_invoice_lines.invoice_id));
create policy ebill_limits_read on public.ebill_staff_limits for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('ebill.manage')));
-- ebill_pins: RLS on, no policy, no grant: nobody reads hashes.
