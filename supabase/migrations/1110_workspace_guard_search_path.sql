-- 1110_workspace_guard_search_path: Dua Workspace. Pins the search_path of the four trigger-guard functions
-- (Supabase advisor: function_search_path_mutable). It was left open in 1100 and 1101 and noted as a follow-up.
-- Their bodies use only schema-qualified names (public.) and now(), so pinning changes no behaviour; the existing
-- 1100 and 1101 tests still prove every guard rule. Nothing else changes.
alter function public.workspace_documents_guard() set search_path = public;
alter function public.workspace_members_guard() set search_path = public;
alter function public.workspace_folders_guard() set search_path = public;
alter function public.workspace_note_revisions_guard() set search_path = public;
