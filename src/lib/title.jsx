import { createContext, useContext, useEffect, useState } from 'react'
import { rpc } from './supabase'

const TitleContext = createContext('成績查詢系統')

export default function TitleProvider({ children }) {
  const [title, setTitle] = useState('成績查詢系統')

  useEffect(() => {
    let active = true
    rpc('api_title').then((t) => {
      if (active && typeof t === 'string' && t) setTitle(t)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <TitleContext.Provider value={{ title, setTitle }}>{children}</TitleContext.Provider>
  )
}

export function useTitle() {
  return useContext(TitleContext)
}
