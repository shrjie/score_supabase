-- ============================================================
-- 封存防呆：改成兩階段確認（預覽 → 確認）
-- 1. api_archive_create 未帶 p_confirm=true 時只回傳「將封存什麼」的預覽，
--    完全不做任何變更，避免誤觸就整班畢業。
-- 2. 額外檢查：新班級代碼必填、不可與目前相同、沒有可封存資料時中止。
-- 3. 回傳 warnings 供 UI 顯示，讓老師在按下前就看到所有風險。
-- ============================================================

drop function if exists public.api_archive_create(text);

create or replace function public.api_archive_create(
  p_note text default null,
  p_new_class text default null,
  p_confirm boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cls text;
  ncls text := trim(coalesce(p_new_class, ''));
  scount int;
  ecount int;
  qcount int;
  gcount int;
  snap jsonb;
  aid uuid;
  warnings jsonb := '[]'::jsonb;
  w text;
begin
  if not public.is_teacher() then
    return jsonb_build_object('success', false, 'message', '需要老師權限');
  end if;

  select coalesce(
      (select value from public.app_config where key = 'CURRENT_CLASS'),
      (select class_no from public.students where not graduated order by created_at limit 1),
      '') into cls;

  select count(*) into scount from public.students where not graduated;
  select count(*) into gcount from public.students where graduated;
  select count(*) into ecount from public.exams where not archived;
  select count(*) into qcount from public.scores
    where student_id in (select id from public.students where not graduated);

  -- ---------------- 風險檢查（預覽與實際執行都跑） ----------------
  if scount = 0 then
    warnings := warnings || jsonb_build_array('目前沒有在學學生');
  end if;
  if ecount = 0 then
    warnings := warnings || jsonb_build_array('目前沒有未封存的考試');
  end if;
  if ncls = '' then
    warnings := warnings || jsonb_build_array('尚未填寫新班級代碼');
  end if;
  if ncls <> '' and ncls = cls then
    warnings := warnings || jsonb_build_array('新班級代碼與目前相同（' || cls || '），請換一個不同的代碼');
  end if;
  if gcount > 0 then
    warnings := warnings || jsonb_build_array('已有 ' || gcount || ' 名畢業生，請確認是否為預期結果');
  end if;
  if scount > 0 and (select count(*) from public.students where not graduated and user_id is null) > 0 then
    warnings := warnings || jsonb_build_array('部分學生尚未建立登入帳號，封存時不會停用其帳號');
  end if;

  -- ---------------- 階段一：預覽，不做任何變更 ----------------
  if not p_confirm then
    return jsonb_build_object(
      'success', true, 'dry_run', true, 'class_no', cls,
      'student_count', scount, 'exam_count', ecount, 'score_count', qcount,
      'graduated_count', gcount, 'warnings', warnings);
  end if;

  -- ---------------- 階段二：實際封存 ----------------
  if scount = 0 and ecount = 0 then
    return jsonb_build_object('success', false, 'message', '目前沒有可封存的學生或考試，已中止');
  end if;
  if ncls = '' then
    return jsonb_build_object('success', false, 'message', '請填寫新班級代碼');
  end if;
  if ncls = cls then
    return jsonb_build_object('success', false, 'message', '新班級代碼不可與目前相同：' || cls);
  end if;

  select jsonb_build_object(
    'students', coalesce((select jsonb_agg(to_jsonb(s)) from public.students s where not graduated), '[]'::jsonb),
    'exams',    coalesce((select jsonb_agg(to_jsonb(e)) from public.exams e where not archived), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(to_jsonb(su)) from public.subjects su), '[]'::jsonb),
    'scores',   coalesce((select jsonb_agg(to_jsonb(sc)) from public.scores sc
                   where sc.student_id in (select id from public.students where not graduated)), '[]'::jsonb)
  ) into snap;

  insert into public.class_archives (class_no, note, student_count, exam_count, score_count, snapshot)
    values (cls, nullif(trim(coalesce(p_note, '')), ''), scount, ecount, qcount, snap)
    returning id into aid;

  update public.students set graduated = true, graduated_at = now() where not graduated;
  update public.exams set archived = true where not archived;

  insert into public.audit_logs (actor, action, detail)
    values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'archive_class',
      '封存班級 ' || cls || ' → 開新班級 ' || ncls ||
      '：學生 ' || scount || ' 人、考試 ' || ecount || ' 場、成績 ' || qcount || ' 格');

  return jsonb_build_object('success', true, 'id', aid, 'class_no', cls, 'new_class', ncls,
    'student_count', scount, 'exam_count', ecount, 'score_count', qcount, 'warnings', warnings,
    'accounts', coalesce((select jsonb_agg(s.account) from public.students s
      where s.graduated and s.graduated_at >= now() - interval '10 seconds'), '[]'::jsonb));
end $$;

revoke all on function public.api_archive_create(text, text, boolean) from public;
grant execute on function public.api_archive_create(text, text, boolean) to authenticated;
revoke execute on function public.api_archive_create(text, text, boolean) from anon;