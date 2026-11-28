-- 1405: close KI-1 for the Android area. The trigger function app_devices_forget_attendance_secret (1403) kept the built-in PUBLIC execute
-- right, so the visitor role could run it. It is not SECURITY DEFINER and touches no data when called directly, but nothing should be
-- callable by anon unless it is meant to be. A trigger function needs no EXECUTE right to fire (Postgres checks it only when the trigger
-- is created). Safe to re-run. Rollback: grant execute on function public.app_devices_forget_attendance_secret() to public;
revoke execute on function public.app_devices_forget_attendance_secret() from public, anon, authenticated;
