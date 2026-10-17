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
  class_no text not null default '1421',
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
insert into public.app_config (key, value) values ('SYSTEM_TITLE', '福山國中成績查詢')
  on conflict (key) do nothing;
