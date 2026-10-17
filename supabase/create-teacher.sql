-- ============================================================
-- 建立第一位「老師（管理員）」帳號
-- 用法：把下面的 <你的密碼> 改掉後，在 Supabase Dashboard → SQL Editor 貼上並執行一次。
--   - 密碼至少 6 碼，建議 12 碼以上。
--   - Email 預設 admin@teachers.grade.local，需與 Netlify 環境變數 VITE_TEACHER_EMAIL 相同。
--   - 之後可隨時在網站「老師端 → 改管理密碼」自行更換密碼。
-- 可重複執行：帳號已存在時會直接更新密碼。
-- ============================================================
do $$
declare
  t_email text := 'admin@teachers.grade.local';
  t_pass  text := '<你的密碼>';
  uid uuid;
begin
  if t_pass = '<你的密碼>' or length(t_pass) < 6 then
    raise exception '請先把 <你的密碼> 改成至少 6 碼的密碼再執行';
  end if;

  select id into uid from auth.users where email = t_email;

  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', t_email,
      crypt(t_pass, gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{"role":"teacher"}',
      '', '', '', ''
    );
    insert into auth.identities (
      provider_id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      uid::text, uid, 'email', jsonb_build_object('sub', uid::text, 'email', t_email), now(), now(), now()
    );
  else
    update auth.users
      set encrypted_password = crypt(t_pass, gen_salt('bf')), email_confirmed_at = now()
      where id = uid;
  end if;

  insert into public.teachers (user_id, display_name) values (uid, '班導')
    on conflict (user_id) do nothing;

  raise notice '老師帳號已建立／更新：%', t_email;
end $$;
