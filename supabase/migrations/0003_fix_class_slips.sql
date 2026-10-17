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
