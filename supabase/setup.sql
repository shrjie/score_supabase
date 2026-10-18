-- 本檔由 npm run bundle:sql 自動產生，請勿手動編輯。
-- 用法：在 Supabase Dashboard → SQL Editor 貼上本檔全部內容並執行。

-- ============================================================
-- 0001_init.sql
-- ============================================================
-- ============================================================
-- 班級成績查詢系統 — Supabase schema
-- 對應原 Google Apps Script 版（code.gs）的功能
-- 衍生值（總分/平均/班名次/前名次/進退步/各科排名）改為即時計算，不再儲存
-- ============================================================

create extension if not exists pgcrypto;

-- 私有 schema：放不暴露給 PostgREST 的輔助檢視
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- ---------------- 資料表 ----------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  account text not null unique,
  seat text not null default '',
  name text not null default '',
  class_no text not null default '',
  excluded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  weight numeric not null default 1 check (weight > 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  score numeric,
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id, subject_id)
);
create index if not exists scores_exam_idx on public.scores (exam_id);
create index if not exists scores_student_idx on public.scores (student_id);

create table if not exists public.app_config (
  key text primary key,
  value text
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor text,
  action text,
  detail text
);

-- ---------------- 輔助函式 ----------------
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teachers t where t.user_id = auth.uid());
$$;

create or replace function public.current_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.students where user_id = auth.uid() limit 1;
$$;

-- ---------------- 私有檢視（衍生計算） ----------------
-- 加權總分 / 平均（排除測試帳）
create or replace view private.exam_rank as
with agg as (
  select sc.exam_id, sc.student_id,
    sum(sc.score * su.weight) filter (where sc.score is not null) as weighted,
    sum(su.weight) filter (where sc.score is not null) as wsum
  from public.scores sc
  join public.subjects su on su.id = sc.subject_id
  join public.students st on st.id = sc.student_id
  where not st.excluded
  group by sc.exam_id, sc.student_id
)
select exam_id, student_id,
  weighted as total,
  case when wsum > 0 then round(weighted / wsum, 8) end as average,
  rank() over (partition by exam_id order by weighted desc) as class_rank
from agg;

-- 加上前名次（前一次考試的班名次）與進退步
create or replace view private.exam_rank_full as
select r.exam_id, r.student_id, r.total, r.average, r.class_rank,
  (select r2.class_rank
     from private.exam_rank r2
     join public.exams e2 on e2.id = r2.exam_id
     where r2.student_id = r.student_id
       and e2.position < (select e.position from public.exams e where e.id = r.exam_id)
     order by e2.position desc
     limit 1) as prev_rank
from private.exam_rank r;

-- 各科排名（排除測試帳）
create or replace view private.subject_rank as
select sc.exam_id, sc.student_id, sc.subject_id, sc.score,
  rank() over (partition by sc.exam_id, sc.subject_id order by sc.score desc) as rank
from public.scores sc
join public.students st on st.id = sc.student_id
where not st.excluded and sc.score is not null;

-- ---------------- RLS ----------------
alter table public.students enable row level security;
alter table public.teachers enable row level security;
alter table public.exams enable row level security;
alter table public.subjects enable row level security;
alter table public.scores enable row level security;
alter table public.app_config enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists students_teacher_all on public.students;
create policy students_teacher_all on public.students
  for all using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists students_self_read on public.students;
create policy students_self_read on public.students
  for select using (user_id = auth.uid());

drop policy if exists teachers_self on public.teachers;
create policy teachers_self on public.teachers
  for select using (user_id = auth.uid());

drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams
  for select using (auth.uid() is not null);
drop policy if exists exams_write on public.exams;
create policy exams_write on public.exams
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects
  for select using (auth.uid() is not null);
drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists scores_read on public.scores;
create policy scores_read on public.scores
  for select using (public.is_teacher() or student_id = public.current_student_id());
drop policy if exists scores_write on public.scores;
create policy scores_write on public.scores
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists config_read on public.app_config;
create policy config_read on public.app_config
  for select using (auth.uid() is not null);
drop policy if exists config_write on public.app_config;
create policy config_write on public.app_config
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs
  for select using (public.is_teacher());
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs
  for insert with check (public.is_teacher());

-- ---------------- RPC：共用 ----------------
create or replace function public.api_title()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_config where key = 'SYSTEM_TITLE'), '成績查詢系統');
$$;

create or replace function public.api_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.students;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'message', '未登入');
  end if;
  if public.is_teacher() then
    return jsonb_build_object('success', true, 'role', 'teacher');
  end if;
  select * into s from public.students where user_id = auth.uid() limit 1;
  if s.id is null then
    return jsonb_build_object('success', false, 'message', '找不到學生資料');
  end if;
  return jsonb_build_object('success', true, 'role', 'student',
    'student', jsonb_build_object('id', s.id, 'seat', s.seat, 'name', s.name,
      'classNo', s.class_no, 'account', s.account));
end $$;

create or replace function public.api_exams()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name)
    order by e.position, e.created_at), '[]'::jsonb)
  from public.exams e;
$$;

-- ---------------- RPC：學生查詢 ----------------
create or replace function public.api_student_result(p_exam uuid, p_student uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  sid uuid; e_name text; subs jsonb; summ jsonb;
  tot numeric; avg_val numeric; cr int; pr int;
begin
  if public.is_teacher() and p_student is not null then
    sid := p_student;
  else
    sid := public.current_student_id();
  end if;
  if sid is null then return jsonb_build_object('success', false, 'message', '找不到學生身分'); end if;

  select name into e_name from public.exams where id = p_exam;
  if e_name is null then return jsonb_build_object('success', false, 'message', '找不到考試'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', su.name, 'score', sc.score, 'rank', sr.rank)
    order by su.position, su.name), '[]'::jsonb)
  into subs
  from public.subjects su
  left join public.scores sc on sc.subject_id = su.id and sc.exam_id = p_exam and sc.student_id = sid
  left join private.subject_rank sr on sr.subject_id = su.id and sr.exam_id = p_exam and sr.student_id = sid;

  select total, average, class_rank, prev_rank into tot, avg_val, cr, pr
  from private.exam_rank_full where exam_id = p_exam and student_id = sid;

  summ := jsonb_build_array(
    jsonb_build_object('name', '總分', 'value', tot),
    jsonb_build_object('name', '平均', 'value', avg_val),
    jsonb_build_object('name', '班名次', 'value', cr),
    jsonb_build_object('name', '前名次', 'value', pr),
    jsonb_build_object('name', '進退步', 'value',
      case when pr is not null and cr is not null then pr - cr end)
  );
  return jsonb_build_object('success', true, 'exam', e_name, 'subjects', subs,
    'summary', summ, 'average', avg_val);
end $$;

create or replace function public.api_student_trend()
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('exam_id', e.id, 'exam_name', e.name,
    'average', r.average, 'rank', r.class_rank) order by e.position, e.created_at), '[]'::jsonb)
  from public.exams e
  left join private.exam_rank r
    on r.exam_id = e.id and r.student_id = public.current_student_id();
$$;

create or replace function public.api_class_stats(p_exam uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.pos, t.name), '[]'::jsonb)
  from (
    select su.position as pos, su.name,
      count(sc.score) as n,
      round(avg(sc.score) filter (where sc.score is not null)::numeric, 2) as avg,
      max(sc.score) as max, min(sc.score) as min,
      round((count(*) filter (where sc.score >= 60))::numeric / nullif(count(sc.score), 0) * 100, 1) as rate,
      count(*) filter (where sc.score >= 90) as g90,
      count(*) filter (where sc.score >= 80 and sc.score < 90) as g80,
      count(*) filter (where sc.score >= 70 and sc.score < 80) as g70,
      count(*) filter (where sc.score >= 60 and sc.score < 70) as g60,
      count(*) filter (where sc.score < 60) as g0
    from public.subjects su
    left join (
      select sc.subject_id, sc.score
      from public.scores sc
      join public.students st on st.id = sc.student_id
      where sc.exam_id = p_exam and not st.excluded
    ) sc on sc.subject_id = su.id
    group by su.id, su.name, su.position
  ) t;
$$;

-- ---------------- RPC：老師 ----------------
create or replace function public.api_teacher_exams()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name)
    order by e.position, e.created_at) from public.exams e), '[]'::jsonb);
end $$;

create or replace function public.api_teacher_subjects()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'name', su.name, 'weight', su.weight)
    order by su.position, su.name) from public.subjects su), '[]'::jsonb);
end $$;

create or replace function public.api_teacher_students()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'account', s.account, 'seat', s.seat,
      'name', s.name, 'class_no', s.class_no, 'excluded', s.excluded)
    order by (case when s.seat ~ '^[0-9]+$' then s.seat::int else 999999 end), s.seat)
    from public.students s), '[]'::jsonb);
end $$;

create or replace function public.api_teacher_grid(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return jsonb_build_object(
    'success', true,
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'seat', s.seat, 'name', s.name, 'excluded', s.excluded)
      order by (case when s.seat ~ '^[0-9]+$' then s.seat::int else 999999 end), s.seat) from public.students s), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'name', su.name, 'weight', su.weight)
      order by su.position, su.name) from public.subjects su), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(sc.student_id::text || '_' || sc.subject_id::text, sc.score)
      from public.scores sc where sc.exam_id = p_exam), '{}'::jsonb)
  );
end $$;

create or replace function public.api_score_set(p_exam uuid, p_student uuid, p_subject uuid, p_score numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if p_score is not null and (p_score < -10000 or p_score > 10000) then
    return jsonb_build_object('success', false, 'message', '成績超出範圍');
  end if;
  insert into public.scores (exam_id, student_id, subject_id, score)
  values (p_exam, p_student, p_subject, p_score)
  on conflict (exam_id, student_id, subject_id)
    do update set score = excluded.score, updated_at = now();
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'edit_cell',
    '考試=' || p_exam || ' 學生=' || p_student || ' 科目=' || p_subject || ' 分數=' || coalesce(p_score::text, ''));
  return jsonb_build_object('success', true, 'score', p_score);
end $$;

create or replace function public.api_score_bulk(p_exam uuid, p_cells jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb; n int := 0; errs text[] := '{}'; v numeric; sid uuid; subid uuid; raw text;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if p_cells is null then return jsonb_build_object('success', true, 'updated', 0, 'errors', '[]'::jsonb); end if;
  for c in select * from jsonb_array_elements(p_cells) loop
    begin
      sid := (c ->> 'student_id')::uuid;
      subid := (c ->> 'subject_id')::uuid;
    exception when others then
      errs := array_append(errs, '無法解析資料列'); continue;
    end;
    raw := c ->> 'score';
    if raw is null or raw = '' then
      v := null;
    else
      begin
        v := raw::numeric;
      exception when others then
        errs := array_append(errs, '分數格式錯誤：' || raw); continue;
      end;
    end if;
    insert into public.scores (exam_id, student_id, subject_id, score)
    values (p_exam, sid, subid, v)
    on conflict (exam_id, student_id, subject_id)
      do update set score = excluded.score, updated_at = now();
    n := n + 1;
  end loop;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'bulk_upsert', '寫入 ' || n || ' 格');
  return jsonb_build_object('success', true, 'updated', n, 'errors', to_jsonb(errs));
end $$;

create or replace function public.api_exam_create(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); newid uuid; pos int;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if nm = '' then return jsonb_build_object('success', false, 'message', '考試名稱不可空白'); end if;
  if exists (select 1 from public.exams where name = nm) then
    return jsonb_build_object('success', false, 'message', '考試名稱重複'); end if;
  select coalesce(max(position), 0) + 1 into pos from public.exams;
  insert into public.exams (name, position) values (nm, pos) returning id into newid;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'create_exam', '新增考試：' || nm);
  return jsonb_build_object('success', true, 'id', newid, 'name', nm);
end $$;

create or replace function public.api_exam_rename(p_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, ''));
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if nm = '' then return jsonb_build_object('success', false, 'message', '名稱不可空白'); end if;
  if exists (select 1 from public.exams where name = nm and id <> p_id) then
    return jsonb_build_object('success', false, 'message', '名稱已存在'); end if;
  update public.exams set name = nm where id = p_id;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'rename_exam', '考試改名為：' || nm);
  return jsonb_build_object('success', true, 'name', nm);
end $$;

create or replace function public.api_exam_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  select name into nm from public.exams where id = p_id;
  if nm is null then return jsonb_build_object('success', false, 'message', '找不到考試'); end if;
  delete from public.exams where id = p_id;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'delete_exam', '刪除考試：' || nm);
  return jsonb_build_object('success', true);
end $$;

create or replace function public.api_subject_create(p_name text, p_weight numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); w numeric := coalesce(p_weight, 1); newid uuid; pos int;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if nm = '' then return jsonb_build_object('success', false, 'message', '科目名稱不可空白'); end if;
  if w <= 0 then return jsonb_build_object('success', false, 'message', '權重必須是正數'); end if;
  if exists (select 1 from public.subjects where name = nm) then
    return jsonb_build_object('success', false, 'message', '科目已存在'); end if;
  select coalesce(max(position), 0) + 1 into pos from public.subjects;
  insert into public.subjects (name, weight, position) values (nm, w, pos) returning id into newid;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'create_subject', '新增科目：' || nm || ' 權重=' || w);
  return jsonb_build_object('success', true, 'id', newid, 'name', nm, 'weight', w);
end $$;

create or replace function public.api_subject_edit(p_id uuid, p_name text, p_weight numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); oldname text;
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if nm = '' then return jsonb_build_object('success', false, 'message', '科目名稱不可空白'); end if;
  if p_weight is not null and p_weight <= 0 then
    return jsonb_build_object('success', false, 'message', '權重必須是正數'); end if;
  select name into oldname from public.subjects where id = p_id;
  if oldname is null then return jsonb_build_object('success', false, 'message', '找不到科目'); end if;
  if exists (select 1 from public.subjects where name = nm and id <> p_id) then
    return jsonb_build_object('success', false, 'message', '名稱重複：' || nm); end if;
  update public.subjects
    set name = nm, weight = coalesce(p_weight, weight)
    where id = p_id;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'edit_subject',
    oldname || ' → ' || nm || ' 權重=' || coalesce(p_weight::text, ''));
  return jsonb_build_object('success', true, 'name', nm);
end $$;

create or replace function public.api_audit(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('created_at', a.created_at, 'actor', a.actor,
      'action', a.action, 'detail', a.detail) order by a.created_at desc)
    from (select * from public.audit_logs order by created_at desc limit lim) a), '[]'::jsonb);
end $$;

create or replace function public.api_config_set_title(p_title text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := trim(coalesce(p_title, ''));
begin
  if not public.is_teacher() then return jsonb_build_object('success', false, 'message', '需要老師權限'); end if;
  if t = '' then return jsonb_build_object('success', false, 'message', '標題不可空白'); end if;
  insert into public.app_config (key, value) values ('SYSTEM_TITLE', t)
    on conflict (key) do update set value = excluded.value;
  insert into public.audit_logs (actor, action, detail)
  values (coalesce(auth.jwt() ->> 'email', 'teacher'), 'edit_title', '系統標題改為：' || t);
  return jsonb_build_object('success', true, 'title', t);
end $$;

-- ---------------- 權限 ----------------
revoke all on function public.api_title() from public;
revoke all on function public.api_me() from public;
revoke all on function public.api_exams() from public;
revoke all on function public.api_student_result(uuid, uuid) from public;
revoke all on function public.api_student_trend() from public;
revoke all on function public.api_class_stats(uuid) from public;
revoke all on function public.api_teacher_exams() from public;
revoke all on function public.api_teacher_subjects() from public;
revoke all on function public.api_teacher_students() from public;
revoke all on function public.api_teacher_grid(uuid) from public;
revoke all on function public.api_score_set(uuid, uuid, uuid, numeric) from public;
revoke all on function public.api_score_bulk(uuid, jsonb) from public;
revoke all on function public.api_exam_create(text) from public;
revoke all on function public.api_exam_rename(uuid, text) from public;
revoke all on function public.api_exam_delete(uuid) from public;
revoke all on function public.api_subject_create(text, numeric) from public;
revoke all on function public.api_subject_edit(uuid, text, numeric) from public;
revoke all on function public.api_audit(int) from public;
revoke all on function public.api_config_set_title(text) from public;

grant execute on function public.api_title() to anon, authenticated;
grant execute on function public.api_me() to authenticated;
grant execute on function public.api_exams() to authenticated;
grant execute on function public.api_student_result(uuid, uuid) to authenticated;
grant execute on function public.api_student_trend() to authenticated;
grant execute on function public.api_class_stats(uuid) to authenticated;
grant execute on function public.api_teacher_exams() to authenticated;
grant execute on function public.api_teacher_subjects() to authenticated;
grant execute on function public.api_teacher_students() to authenticated;
grant execute on function public.api_teacher_grid(uuid) to authenticated;
grant execute on function public.api_score_set(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.api_score_bulk(uuid, jsonb) to authenticated;
grant execute on function public.api_exam_create(text) to authenticated;
grant execute on function public.api_exam_rename(uuid, text) to authenticated;
grant execute on function public.api_exam_delete(uuid) to authenticated;
grant execute on function public.api_subject_create(text, numeric) to authenticated;
grant execute on function public.api_subject_edit(uuid, text, numeric) to authenticated;
grant execute on function public.api_audit(int) to authenticated;
grant execute on function public.api_config_set_title(text) to authenticated;

-- ---------------- 預設設定 ----------------
insert into public.app_config (key, value) values ('SYSTEM_TITLE', '班級成績查詢系統')
  on conflict (key) do nothing;

-- ============================================================
-- 0002_class_slips.sql
-- ============================================================
-- ============================================================
-- 全班個人成績單批次資料（老師列印用）
-- 一次回傳整班的各科分數/排名、總結、歷次走勢與全班統計
-- ============================================================

create or replace function public.api_class_slips(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare e_name text;
begin
  if not public.is_teacher() then
    return jsonb_build_object('success', false, 'message', '需要老師權限');
  end if;
  select name into e_name from public.exams where id = p_exam;
  if e_name is null then
    return jsonb_build_object('success', false, 'message', '找不到考試');
  end if;

  return jsonb_build_object(
    'success', true,
    'exam', e_name,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seat', s.seat, 'name', s.name,
        'class_no', s.class_no, 'excluded', s.excluded,
        'subjects', coalesce((
          select jsonb_agg(jsonb_build_object('name', su.name, 'score', sc.score, 'rank', sr.rank)
            order by su.position, su.name)
          from public.subjects su
          left join public.scores sc on sc.subject_id = su.id and sc.exam_id = p_exam and sc.student_id = s.id
          left join private.subject_rank sr on sr.subject_id = su.id and sr.exam_id = p_exam and sr.student_id = s.id
        ), '[]'::jsonb),
        'summary', jsonb_build_array(
          jsonb_build_object('name', '總分', 'value', rf.total),
          jsonb_build_object('name', '平均', 'value', rf.average),
          jsonb_build_object('name', '班名次', 'value', rf.class_rank),
          jsonb_build_object('name', '前名次', 'value', rf.prev_rank),
          jsonb_build_object('name', '進退步', 'value',
            case when rf.prev_rank is not null and rf.class_rank is not null
                 then rf.prev_rank - rf.class_rank end)
        ),
        'average', rf.average,
        'trend', coalesce((
          select jsonb_agg(jsonb_build_object('exam_name', e2.name, 'average', r2.average, 'rank', r2.class_rank)
            order by e2.position, e2.created_at)
          from public.exams e2
          left join private.exam_rank r2 on r2.exam_id = e2.id and r2.student_id = s.id
        ), '[]'::jsonb)
      ) order by (case when s.seat ~ '^[0-9]+$' then s.seat::int else 999999 end), s.seat)
      from public.students s
    ), '[]'::jsonb),
    'stats', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.pos, t.name), '[]'::jsonb)
      from (
        select su.position as pos, su.name,
          count(sc.score) as n,
          round(avg(sc.score) filter (where sc.score is not null)::numeric, 2) as avg,
          max(sc.score) as max, min(sc.score) as min,
          round((count(*) filter (where sc.score >= 60))::numeric / nullif(count(sc.score), 0) * 100, 1) as rate,
          count(*) filter (where sc.score >= 90) as g90,
          count(*) filter (where sc.score >= 80 and sc.score < 90) as g80,
          count(*) filter (where sc.score >= 70 and sc.score < 80) as g70,
          count(*) filter (where sc.score >= 60 and sc.score < 70) as g60,
          count(*) filter (where sc.score < 60) as g0
        from public.subjects su
        left join (
          select sc.subject_id, sc.score
          from public.scores sc
          join public.students st on st.id = sc.student_id
          where sc.exam_id = p_exam and not st.excluded
        ) sc on sc.subject_id = su.id
        group by su.id, su.name, su.position
      ) t
    )
  );
end $$;

revoke all on function public.api_class_slips(uuid) from public;
grant execute on function public.api_class_slips(uuid) to authenticated;

-- ============================================================
-- 0003_fix_class_slips.sql
-- ============================================================
-- 修正 api_class_slips：補上 exam_rank_full 的 join（原 0002 缺少 FROM 來源）
create or replace function public.api_class_slips(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare e_name text;
begin
  if not public.is_teacher() then
    return jsonb_build_object('success', false, 'message', '需要老師權限');
  end if;
  select name into e_name from public.exams where id = p_exam;
  if e_name is null then
    return jsonb_build_object('success', false, 'message', '找不到考試');
  end if;

  return jsonb_build_object(
    'success', true,
    'exam', e_name,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seat', s.seat, 'name', s.name,
        'class_no', s.class_no, 'excluded', s.excluded,
        'subjects', coalesce((
          select jsonb_agg(jsonb_build_object('name', su.name, 'score', sc.score, 'rank', sr.rank)
            order by su.position, su.name)
          from public.subjects su
          left join public.scores sc on sc.subject_id = su.id and sc.exam_id = p_exam and sc.student_id = s.id
          left join private.subject_rank sr on sr.subject_id = su.id and sr.exam_id = p_exam and sr.student_id = s.id
        ), '[]'::jsonb),
        'summary', jsonb_build_array(
          jsonb_build_object('name', '總分', 'value', rf.total),
          jsonb_build_object('name', '平均', 'value', rf.average),
          jsonb_build_object('name', '班名次', 'value', rf.class_rank),
          jsonb_build_object('name', '前名次', 'value', rf.prev_rank),
          jsonb_build_object('name', '進退步', 'value',
            case when rf.prev_rank is not null and rf.class_rank is not null
                 then rf.prev_rank - rf.class_rank end)
        ),
        'average', rf.average,
        'trend', coalesce((
          select jsonb_agg(jsonb_build_object('exam_name', e2.name, 'average', r2.average, 'rank', r2.class_rank)
            order by e2.position, e2.created_at)
          from public.exams e2
          left join private.exam_rank r2 on r2.exam_id = e2.id and r2.student_id = s.id
        ), '[]'::jsonb)
      ) order by (case when s.seat ~ '^[0-9]+$' then s.seat::int else 999999 end), s.seat)
      from public.students s
      left join private.exam_rank_full rf on rf.exam_id = p_exam and rf.student_id = s.id
    ), '[]'::jsonb),
    'stats', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.pos, t.name), '[]'::jsonb)
      from (
        select su.position as pos, su.name,
          count(sc.score) as n,
          round(avg(sc.score) filter (where sc.score is not null)::numeric, 2) as avg,
          max(sc.score) as max, min(sc.score) as min,
          round((count(*) filter (where sc.score >= 60))::numeric / nullif(count(sc.score), 0) * 100, 1) as rate,
          count(*) filter (where sc.score >= 90) as g90,
          count(*) filter (where sc.score >= 80 and sc.score < 90) as g80,
          count(*) filter (where sc.score >= 70 and sc.score < 80) as g70,
          count(*) filter (where sc.score >= 60 and sc.score < 70) as g60,
          count(*) filter (where sc.score < 60) as g0
        from public.subjects su
        left join (
          select sc.subject_id, sc.score
          from public.scores sc
          join public.students st on st.id = sc.student_id
          where sc.exam_id = p_exam and not st.excluded
        ) sc on sc.subject_id = su.id
        group by su.id, su.name, su.position
      ) t
    )
  );
end $$;

revoke all on function public.api_class_slips(uuid) from public;
grant execute on function public.api_class_slips(uuid) to authenticated;

-- ============================================================
-- 0004_revoke_anon_rpc.sql
-- ============================================================
-- ============================================================
-- 安全性強化：收回 anon 對 api_* 函式的執行權
-- 背景：Supabase 預設權限會把 EXECUTE 給 anon/authenticated，
--       0001 的 revoke ... from public 擋不住，導致未登入者仍可呼叫
--       例如 api_class_stats / api_exams 讀到全班統計。
-- 保留 api_title() 供登入頁顯示標題（公開資訊）。
-- 注意：不可收回 is_teacher() / current_student_id()，
--       因為 RLS policy 會以查詢者身分呼叫它們。
-- ============================================================

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

-- api_title 維持可匿名呼叫（登入畫面需要）
grant execute on function public.api_title() to anon;

-- ============================================================
-- 0005_class_archive.sql
-- ============================================================
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

-- ============================================================
-- 0006_archive_safety.sql
-- ============================================================
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
