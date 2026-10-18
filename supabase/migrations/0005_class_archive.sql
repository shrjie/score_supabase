-- ============================================================
-- 畢業生封存 / 開新班級
-- 1. 學生加「已畢業」標記、考試加「已封存」標記
-- 2. class_archives 保存封存當下��完整資料快照（可隨時查閱歷屆）
-- 3. 相關 RPC（皆需老師權限）
-- 設計原則：封存不刪除任何資料，原始表格與成績都保留，
--           只是在「現行班級」的畫面中隱藏，另存快照供歷屆查詢。
-- ============================================================

-- ---------------- 欄位 ----------------
alter table public.students add column if not exists graduated boolean not null default false;
alter table public.students add column if not exists graduated_at timestamptz;

alter table public.exams add column if not exists archived boolean not null default false;

-- 封存紀錄
create table if not exists public.class_archives (
  id uuid primary key default gen_random_uuid(),
  class_no text not null,
  archived_at timestamptz not null default now(),
  note text,
  student_count int not null default 0,
  exam_count int not null default 0,
  score_count int not null default 0,
  snapshot jsonb not null default '{}'::jsonb
);
comment on table public.class_archives is '畢業班封存快照（含學生/考試/科目/成績原始資料）';

alter table public.class_archives enable row level security;
drop policy if exists class_archives_teacher_all on public.class_archives;
create policy class_archives_teacher_all on public.class_archives
  for all using (public.is_teacher()) with check (public.is_teacher());

-- 目前班級代碼（供新增學生預設值與顯示）
insert into public.app_config (key, value) values ('CURRENT_CLASS', '')
  on conflict (key) do nothing;

-- ---------------- 既有 RPC：改為可篩選畢業/封存 ----------------
drop function if exists public.api_teacher_students();
create or replace function public.api_teacher_students(p_include_graduated boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'account', s.account, 'seat', s.seat,
        'name', s.name, 'class_no', s.class_no, 'excluded', s.excluded,
        'graduated', s.graduated)
      order by (case when s.seat ~ '^[0-9]+$' then s.seat::int else 999999 end), s.seat)
    from public.students s
    where p_include_graduated or not s.graduated), '[]'::jsonb);
end $$;

drop function if exists public.api_teacher_exams();
create or replace function public.api_teacher_exams(p_include_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'archived', e.archived)
      order by e.position, e.created_at)
    from public.exams e
    where p_include_archived or not e.archived), '[]'::jsonb);
end $$;

-- 編修格只顯示未畢業學生
create or replace function public.api_teacher_grid(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return jsonb_build_object(
    'success', true,
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'seat', s.seat, 'name', s.name, 'excluded', s.excluded)
      order by (case when s.seat ~ '^[0-9]+$' then s.seat::int else 999999 end), s.seat)
      from public.students s where not s.graduated), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'name', su.name, 'weight', su.weight)
      order by su.position, su.name) from public.subjects su), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(sc.student_id::text || '_' || sc.subject_id::text, sc.score)
      from public.scores sc
      where sc.exam_id = p_exam
        and sc.student_id in (select id from public.students where not graduated)), '{}'::jsonb)
  );
end $$;

-- 學生端考試清單隱藏封存考試
create or replace function public.api_exams()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name)
      order by e.position, e.created_at)
    from public.exams e where not e.archived), '[]'::jsonb);
$$;

-- ---------------- 封存 / 開新班 ----------------

-- 目前班級代碼（若未設定過，取現有在學生的班級）
create or replace function public.api_class_current()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'class_no', coalesce(
      (select value from public.app_config where key = 'CURRENT_CLASS'),
      (select class_no from public.students where not graduated order by created_at limit 1),
      ''));
$$;

-- 設定目前班級代碼
create or replace function public.api_class_set(p_class_no text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_class_no, ''));
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if nm = '' then return jsonb_build_object('success', false, 'message', '班級代碼不可空白'); end if;
  insert into public.app_config (key, value) values ('CURRENT_CLASS', nm)
    on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor, action, detail)
    values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'set_class', '目前班級設為：' || nm);
  return jsonb_build_object('success', true, 'class_no', nm);
end $$;

-- 封存現有班級（畢業）：快照 + 標記畢業 + 封存考試
create or replace function public.api_archive_create(p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cls text;
  scount int; ecount int; qcount int;
  snap jsonb;
  aid uuid;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;

  select coalesce(
      (select value from public.app_config where key = 'CURRENT_CLASS'),
      (select class_no from public.students where not graduated order by created_at limit 1),
      '') into cls;

  select count(*) into scount from public.students where not graduated;
  select count(*) into ecount from public.exams where not archived;
  select count(*) into qcount from public.scores
    where student_id in (select id from public.students where not graduated);

  if scount = 0 and ecount = 0 then
    return jsonb_build_object('success', false, 'message', '目前沒有可封存的學生或考試');
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
      '封存班級 ' || cls || '：學生 ' || scount || ' 人、考試 ' || ecount || ' 場、成績 ' || qcount || ' 格');

  return jsonb_build_object('success', true, 'id', aid, 'class_no', cls,
    'student_count', scount, 'exam_count', ecount, 'score_count', qcount,
    'accounts', coalesce((select jsonb_agg(s.account) from public.students s
      where s.graduated and s.graduated_at >= now() - interval '10 seconds'), '[]'::jsonb));
end $$;

-- 歷屆封存清單（含各屆學生名單；snapshot 可選）
create or replace function public.api_archives(p_with_students boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'class_no', a.class_no, 'archived_at', a.archived_at, 'note', a.note,
        'student_count', a.student_count, 'exam_count', a.exam_count, 'score_count', a.score_count,
        'exams', coalesce((select jsonb_agg(jsonb_build_object('name', x->>'name')
                     order by (x->>'position')::int nulls last)
                   from jsonb_array_elements(coalesce(a.snapshot->'exams', '[]'::jsonb)) x), '[]'::jsonb),
        'students', case when p_with_students then
            coalesce((select jsonb_agg(jsonb_build_object(
                'seat', x->>'seat', 'name', x->>'name', 'account', x->>'account')
              order by (case when (x->>'seat') ~ '^[0-9]+$' then (x->>'seat')::int else 999999 end), x->>'seat')
              from jsonb_array_elements(coalesce(a.snapshot->'students', '[]'::jsonb)) x), '[]'::jsonb)
          else '[]'::jsonb end
      ) order by a.archived_at desc)
    from public.class_archives a), '[]'::jsonb);
end $$;

-- 取消封存（把該屆學生與考試恢復為在學／未封存）
create or replace function public.api_archive_restore(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare aid uuid; stamp timestamptz;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;

  select id, snapshot->'archived_at' into aid, stamp from public.class_archives where id = p_id;
  if aid is null then return jsonb_build_object('success', false, 'message', '找不到封存紀錄'); end if;

  update public.students s
    set graduated = false, graduated_at = null
    from jsonb_array_elements(coalesce(
      (select a.snapshot->'students' from public.class_archives a where a.id = aid), '[]'::jsonb)) x
    where s.id = (x->>'id')::uuid;

  update public.exams e
    set archived = false
    from jsonb_array_elements(coalesce(
      (select a.snapshot->'exams' from public.class_archives a where a.id = aid), '[]'::jsonb)) x
    where e.id = (x->>'id')::uuid;

  insert into public.audit_logs (actor, action, detail)
    values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'restore_class', '取消封存：' || aid);
  return jsonb_build_object('success', true, 'accounts',
    coalesce((select jsonb_agg(s.account) from public.students s
      where s.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(
        (select a.snapshot->'students' from public.class_archives a where a.id = aid), '[]'::jsonb)) x)), '[]'::jsonb));
end $$;

-- ---------------- 權限 ----------------
-- 本次新增／重建的 api_* 必須收回 PUBLIC 執行權，
-- 否則 Supabase 預設讓 anon 也能呼叫（0004 只收回 anon，不夠）。
-- 注意：不可動 is_teacher() / current_student_id()，RLS policy 會以查詢者身分呼叫。
revoke all on function public.api_teacher_students(boolean) from public;
revoke all on function public.api_teacher_exams(boolean) from public;
revoke all on function public.api_teacher_grid(uuid) from public;
revoke all on function public.api_exams() from public;
revoke all on function public.api_class_current() from public;
revoke all on function public.api_class_set(text) from public;
revoke all on function public.api_archive_create(text) from public;
revoke all on function public.api_archives(boolean) from public;
revoke all on function public.api_archive_restore(uuid) from public;

grant execute on function public.api_teacher_students(boolean) to authenticated;
grant execute on function public.api_teacher_exams(boolean) to authenticated;
grant execute on function public.api_teacher_grid(uuid) to authenticated;
grant execute on function public.api_exams() to authenticated;
grant execute on function public.api_class_current() to authenticated;
grant execute on function public.api_class_set(text) to authenticated;
grant execute on function public.api_archive_create(text) to authenticated;
grant execute on function public.api_archives(boolean) to authenticated;
grant execute on function public.api_archive_restore(uuid) to authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ '^api_'
  loop
    execute format('revoke execute on function %s from anon', f.sig);
  end loop;
end $$;

grant execute on function public.api_title() to anon;