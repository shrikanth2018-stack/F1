-- 1stOne F1 — Sync auth.users.phone changes into profiles.phone_number
--
-- handle_new_user fires only on INSERT, so when a user changes their login
-- phone via supabase.auth.updateUser({ phone }) + verifyOtp, auth.users.phone
-- updates but profiles.phone_number stays stale. This trigger closes the gap.

CREATE OR REPLACE FUNCTION public.sync_profile_phone_on_auth_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND NEW.phone IS NOT NULL THEN
    UPDATE public.profiles
      SET phone_number = NEW.phone,
          updated_at   = NOW()
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_phone_updated ON auth.users;
CREATE TRIGGER on_auth_user_phone_updated
  AFTER UPDATE OF phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_phone_on_auth_update();
