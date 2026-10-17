// Supabase Edge Function：學生/老師帳號開通（需要 service_role）
// 前端以 supabase.functions.invoke('admin', { body: { action, ... } }) 呼叫
// 只有已登入且具老師身分的使用者能執行。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STUDENT_EMAIL_DOMAIN = Deno.env.get('STUDENT_EMAIL_DOMAIN') ?? 'students.grade.local'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return json({ success: false, message: '未授權' }, 401)

  const callerId = userData.user.id
  const { data: teacher } = await admin.from('teachers').select('user_id').eq('user_id', callerId).maybeSingle()
  if (!teacher) return json({ success: false, message: '需要老師權限' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ success: false, message: '格式錯誤' }, 400)
  }

  const action = String(body.action ?? '')

  try {
    if (action === 'upsert_student') {
      return await upsertStudent(admin, body)
    }
    if (action === 'reset_password') {
      return await resetPassword(admin, body)
    }
    if (action === 'delete_student') {
      return await deleteStudent(admin, body)
    }
    if (action === 'add_teacher') {
      return await addTeacher(admin, body)
    }
    return json({ success: false, message: '未知 action：' + action }, 400)
  } catch (e) {
    return json({ success: false, message: String((e as Error)?.message ?? e) }, 500)
  }
})

async function upsertStudent(admin: any, b: Record<string, unknown>) {
  const account = String(b.account ?? '').trim()
  const seat = String(b.seat ?? '').trim()
  const name = String(b.name ?? '').trim()
  const classNo = String(b.class_no ?? '1421').trim() || '1421'
  const excluded = !!b.excluded
  const password = b.password ? String(b.password) : ''

  if (!account || !seat || !name) {
    return json({ success: false, message: '帳號/座號/姓名不可空白' }, 400)
  }

  const email = `${account.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`
  const { data: existing } = await admin.from('students').select('id, user_id, account').eq('account', account).maybeSingle()

  let userId = existing?.user_id ?? null

  if (!existing) {
    if (!password) return json({ success: false, message: '新增學生需提供初始密碼' }, 400)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { account, name, role: 'student' },
    })
    if (createErr) return json({ success: false, message: createErr.message }, 400)
    userId = created.user.id
    const { error: insErr } = await admin.from('students').insert({
      user_id: userId, account, seat, name, class_no: classNo, excluded,
    })
    if (insErr) {
      await admin.auth.admin.deleteUser(userId)
      return json({ success: false, message: insErr.message }, 400)
    }
  } else {
    if (userId && password) {
      await admin.auth.admin.updateUserById(userId, { password })
    }
    if (!userId && password) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { account, name, role: 'student' },
      })
      if (!createErr) userId = created.user.id
    }
    const { error: updErr } = await admin.from('students')
      .update({ seat, name, class_no: classNo, excluded, user_id: userId })
      .eq('id', existing.id)
    if (updErr) return json({ success: false, message: updErr.message }, 400)
  }

  await admin.from('audit_logs').insert({
    actor: 'teacher', action: 'upsert_student',
    detail: `帳號=${account}${password ? '（重設密碼）' : ''} 測試=${excluded ? 1 : 0}`,
  })
  return json({ success: true })
}

async function deleteStudent(admin: any, b: Record<string, unknown>) {
  const account = String(b.account ?? '').trim()
  const { data: existing } = await admin.from('students').select('id, user_id').eq('account', account).maybeSingle()
  if (!existing) return json({ success: false, message: '找不到學生' }, 404)
  await admin.from('students').delete().eq('id', existing.id)
  if (existing.user_id) await admin.auth.admin.deleteUser(existing.user_id)
  await admin.from('audit_logs').insert({ actor: 'teacher', action: 'delete_student', detail: `帳號=${account}` })
  return json({ success: true })
}

async function resetPassword(admin: any, b: Record<string, unknown>) {
  const account = String(b.account ?? '').trim()
  const password = String(b.password ?? '')
  if (!account || !password) return json({ success: false, message: '帳號與新密碼不可空白' }, 400)
  if (password.length < 6) return json({ success: false, message: '新密碼至少 6 碼' }, 400)
  const { data: existing } = await admin.from('students').select('id, user_id').eq('account', account).maybeSingle()
  if (!existing) return json({ success: false, message: '找不到學生' }, 404)
  if (!existing.user_id) return json({ success: false, message: '此學生尚未建立登入帳號' }, 400)
  const { error } = await admin.auth.admin.updateUserById(existing.user_id, { password })
  if (error) return json({ success: false, message: error.message }, 400)
  await admin.from('audit_logs').insert({ actor: 'teacher', action: 'reset_password', detail: `學生帳號=${account}` })
  return json({ success: true })
}

async function addTeacher(admin: any, b: Record<string, unknown>) {
  const email = String(b.email ?? '').trim()
  const password = String(b.password ?? '')
  const displayName = String(b.display_name ?? '').trim()
  if (!email || !password) return json({ success: false, message: 'Email 與密碼不可空白' }, 400)
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { role: 'teacher', name: displayName },
  })
  if (error) return json({ success: false, message: error.message }, 400)
  const { error: insErr } = await admin.from('teachers').insert({ user_id: created.user.id, display_name: displayName })
  if (insErr) return json({ success: false, message: insErr.message }, 400)
  return json({ success: true })
}
