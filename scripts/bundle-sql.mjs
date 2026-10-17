// 將 supabase/migrations/*.sql 依序合併成 supabase/setup.sql
// 用途：讓不熟悉 CLI 的使用者直接在 Supabase SQL Editor 一次貼上完成建表。
// 用法：npm run bundle:sql
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const parts = [
  '-- 本檔由 npm run bundle:sql 自動產生，請勿手動編輯。',
  '-- 用法：在 Supabase Dashboard → SQL Editor 貼上本檔全部內容並執行。',
  '',
]
for (const f of files) {
  parts.push(`-- ============================================================`)
  parts.push(`-- ${f}`)
  parts.push(`-- ============================================================`)
  parts.push(readFileSync(join(dir, f), 'utf8').trim())
  parts.push('')
}

writeFileSync(join(root, 'supabase', 'setup.sql'), parts.join('\n'))
console.log(`wrote supabase/setup.sql (${files.length} migrations: ${files.join(', ')})`)
