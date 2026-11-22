-- 1111_workspace_style_validator_fix: Dua Workspace Sheets. Closes a hole in workspace_style_valid (from 1102).
-- The old checks were written as "if key is present and not (value is valid) then refuse". For a JSON null, or a value of the
-- wrong kind (a string or a fraction where a whole number is wanted), the validity test gave NULL, not false, so nothing was
-- refused: size "big", size 8.5, weight null, numfmt.decimals 2.5, a border side set to null and similar were stored.
-- Rule now: if a key is present, its value must be exactly valid (null is not valid). Which keys exist, their allowed values
-- and the 500-byte cap are unchanged. A style with a missing key is still fine; numfmt.type stays optional.
-- Only new writes are affected: rows already stored are not re-checked (a workbook restored from an older restore point
-- that holds such a row would be refused, and there are no workbooks in use yet). Same signature, so the table check
-- constraint and the callers keep working. Fix-forward: 1102 is left as it was applied.
create or replace function public.workspace_style_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare k text; b jsonb; side text; nf jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 500 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('weight', 'size', 'color', 'bg', 'borders', 'halign', 'valign', 'numfmt') then return false; end if;
  end loop;
  if p ? 'weight' and (jsonb_typeof(p -> 'weight') is distinct from 'string' or (p ->> 'weight') not in ('normal', 'bold')) then return false; end if;
  if p ? 'size' and not coalesce(public.workspace_json_int(p -> 'size') between 8 and 72, false) then return false; end if;
  if p ? 'color' and (jsonb_typeof(p -> 'color') is distinct from 'string' or (p ->> 'color') !~ '^#[0-9a-fA-F]{6}$') then return false; end if;
  if p ? 'bg' and (jsonb_typeof(p -> 'bg') is distinct from 'string' or (p ->> 'bg') !~ '^#[0-9a-fA-F]{6}$') then return false; end if;
  if p ? 'halign' and (jsonb_typeof(p -> 'halign') is distinct from 'string' or (p ->> 'halign') not in ('left', 'center', 'right')) then return false; end if;
  if p ? 'valign' and (jsonb_typeof(p -> 'valign') is distinct from 'string' or (p ->> 'valign') not in ('top', 'middle', 'bottom')) then return false; end if;
  if p ? 'borders' then
    b := p -> 'borders';
    if jsonb_typeof(b) is distinct from 'object' then return false; end if;
    for side in select jsonb_object_keys(b) loop
      if side not in ('top', 'right', 'bottom', 'left') or jsonb_typeof(b -> side) is distinct from 'string'
         or (b ->> side) not in ('thin', 'medium', 'thick') then return false; end if;
    end loop;
  end if;
  if p ? 'numfmt' then
    nf := p -> 'numfmt';
    if jsonb_typeof(nf) is distinct from 'object' then return false; end if;
    for k in select jsonb_object_keys(nf) loop
      if k not in ('type', 'decimals', 'currency', 'pattern') then return false; end if;
    end loop;
    if nf ? 'type' and (jsonb_typeof(nf -> 'type') is distinct from 'string' or (nf ->> 'type') not in ('general', 'number', 'currency', 'percent', 'date')) then return false; end if;
    if nf ? 'decimals' and not coalesce(public.workspace_json_int(nf -> 'decimals') between 0 and 10, false) then return false; end if;
    if nf ? 'currency' and (jsonb_typeof(nf -> 'currency') is distinct from 'string' or (nf ->> 'currency') !~ '^[A-Z]{3}$') then return false; end if;
    if nf ? 'pattern' and (jsonb_typeof(nf -> 'pattern') is distinct from 'string' or (nf ->> 'pattern') not in ('dd/mm/yyyy', 'yyyy-mm-dd', 'dd mmm yyyy')) then return false; end if;
  end if;
  return true;
end $$;
-- same grants as 1102: an internal validator, not callable from the browser
revoke all on function public.workspace_style_valid(jsonb) from public, anon, authenticated;
