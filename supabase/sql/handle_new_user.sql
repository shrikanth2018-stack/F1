-- handle_new_user.sql — capture of production trigger (MF-08 part-1).
-- Function definition pasted verbatim from `pg_get_functiondef` output.
-- Per MF-03 audit: trigger continues to write NULL branch_id;
-- complete_onboarding_atomic fills it from zone/hub.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  BEGIN
    INSERT INTO public.profiles (id, role, phone_number)
    VALUES (NEW.id, 'customer', NEW.phone)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END;
  $function$
;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
