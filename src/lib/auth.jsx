import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, accountToEmail, rpc } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadMe() {
    const d = await rpc('api_me')
    setMe(d && d.success ? d : null)
  }

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session ?? null)
      if (data.session) await loadMe()
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s ?? null)
      if (s) await loadMe()
      else setMe(null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signInTeacher(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { success: false, message: error.message }
    const d = await rpc('api_me')
    if (!d?.success || d.role !== 'teacher') {
      await supabase.auth.signOut()
      return { success: false, message: '此帳號不是老師帳號' }
    }
    setMe(d)
    return { success: true }
  }

  async function signInStudent(account, password) {
    const { error } = await supabase.auth.signInWithPassword({
      email: accountToEmail(account),
      password,
    })
    if (error) return { success: false, message: '帳號或密碼錯誤' }
    const d = await rpc('api_me')
    if (!d?.success || d.role !== 'student') {
      await supabase.auth.signOut()
      return { success: false, message: '此帳號不是學生帳號' }
    }
    setMe(d)
    return { success: true }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setMe(null)
  }

  const value = useMemo(
    () => ({ session, me, loading, signInTeacher, signInStudent, signOut, reloadMe: loadMe }),
    [session, me, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
