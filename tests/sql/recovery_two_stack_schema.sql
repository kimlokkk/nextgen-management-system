-- SYNTHETIC two-stack fixture. Both separate Postgres containers initialize this.
CREATE SCHEMA auth;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations SELECT lpad(g::text,3,'0') FROM generate_series(1,24) g;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),role text);
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.profiles(id,role) VALUES(new.id,'admin'); RETURN new; END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TABLE public.branches(id uuid PRIMARY KEY,name text);
CREATE TABLE public.programmes(id uuid PRIMARY KEY,name text);
CREATE TABLE public.session_templates(id uuid PRIMARY KEY,
 branch_id uuid REFERENCES public.branches(id),
 programme_id uuid REFERENCES public.programmes(id));
CREATE TABLE public.students(id uuid PRIMARY KEY,status text);
CREATE TABLE public.parents(id uuid PRIMARY KEY);
CREATE TABLE public.student_guardians(
 student_id uuid REFERENCES public.students(id),
 parent_id uuid REFERENCES public.parents(id));
CREATE TABLE public.enrollments(id uuid PRIMARY KEY,
 student_id uuid REFERENCES public.students(id),
 default_session_id uuid REFERENCES public.session_templates(id),
 status text);
CREATE TABLE public.schedule_batches(id uuid PRIMARY KEY,
 branch_id uuid REFERENCES public.branches(id), schedule_month date);
CREATE TABLE public.class_sessions(id uuid PRIMARY KEY,
 schedule_batch_id uuid REFERENCES public.schedule_batches(id),
 class_date date);
CREATE TABLE public.student_bookings(id uuid PRIMARY KEY,
 class_session_id uuid REFERENCES public.class_sessions(id));
CREATE TABLE public.legacy_september_evidence(id uuid PRIMARY KEY,source_batch text);
CREATE TABLE public.legacy_replacement_reviews(id uuid PRIMARY KEY,
 source_batch text,target_class_id uuid REFERENCES public.class_sessions(id));
CREATE TABLE public.fixture_extra_01(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_02(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_03(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_04(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_05(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_06(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_07(id uuid PRIMARY KEY);
CREATE TABLE public.fixture_extra_08(id uuid PRIMARY KEY);
