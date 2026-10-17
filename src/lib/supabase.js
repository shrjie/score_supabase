import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] 尚未設定 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請參考 .env.example')
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// 學生帳號 → 合成 Email（Supabase Auth 需要 Email 形式）
export const STUDENT_EMAIL_DOMAIN = import.meta.env.VITE_STUDENT_EMAIL_DOMAIN || 'students.grade.local'

export function accountToEmail(account) {
  return `${String(account).trim().toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`
}

// 呼叫 security definer 的 RPC，統一錯誤格式
export async function rpc(fn, params = {}) {
  const { data, error } = await supabase.rpc(fn, params)
  if (error) return { success: false, message: error.message }
  return data
}
