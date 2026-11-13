-- 0103_mgmt_hardening: found by the Supabase security advisor after 0101 and 0102 were applied to the live project.
-- The two Manager trigger functions had no fixed search_path (lint 0011). They only raise errors, so pinning it changes nothing
-- about how they behave. (0101 and 0102 are applied and are never edited.)
alter function public.mgmt_append_only() set search_path = public;
alter function public.mgmt_notes_guard() set search_path = public;
