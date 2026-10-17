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
