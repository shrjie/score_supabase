export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQ = false
  const s = String(text).replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ } else inQ = false
      } else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c === '\r') { /* skip */ }
    else cell += c
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

export async function parseTable(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return parseCsv(await file.text())
  }
  const mod = await import('xlsx')
  const XLSX = mod.default ?? mod
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false })
  return rows.filter((r) => (r || []).some((c) => String(c).trim() !== ''))
}

export const cell = (v) => (v === null || v === undefined ? '' : String(v).trim())
const normH = (v) => cell(v).replace(/[\s　]/g, '').toLowerCase()

// 欄位別名：對應常見名單表頭（同時支援繁簡體與「序號」）
//   學號 → 登入帳號、身分證字號 → 登入密碼（沿用原 GAS 版慣例）
export const STUDENT_FIELDS = {
  account: ['帳號', '账号', '帐号', '帳户', '賬號', '學號', '学号', '學生學號', '学生学号', 'account'],
  password: [
    '密碼', '密码', '身分證字號', '身份證字號', '身分證號碼', '身份證號碼',
    '身分证字號', '身份证字号', '身分证号码', '身份证号码', '身分證', '身份證', '身分证', '身份证',
    'password', 'passwd', 'pwd',
  ],
  seat: ['座號', '座号', '座次', '序號', '序号', '序位', 'seat', 'no'],
  name: ['姓名', 'name'],
  class_no: ['班級', '班级', '班别', '班級代號', 'class'],
  excluded: ['測試', '测试', '排除', '不排名', 'test', 'exclude'],
}

function detectCol(header, keys) {
  // 先找完全相符，避免 'no' 這類短字誤判到其他欄位
  for (const k of keys) {
    for (let i = 0; i < header.length; i++) {
      if (normH(header[i]) === k) return i
    }
  }
  // 再用包含比對
  for (let i = 0; i < header.length; i++) {
    const h = normH(header[i])
    if (h && keys.some((k) => h.includes(k))) return i
  }
  return -1
}

function findHeaderRow(rows, keys, min = 2) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hits = (rows[i] || []).filter((c) => keys.some((k) => normH(c).includes(k))).length
    if (hits >= min) return i
  }
  return -1
}

function toBool(v) {
  const s = cell(v).toLowerCase()
  if (s === '') return false
  if (['1', 'v', 'y', 'yes', 'true', 't', '是', '測試', 'test', '✓', '✔'].includes(s)) return true
  const n = Number(s)
  return isFinite(n) && n > 0
}

export function mapStudents(rows) {
  const allKeys = Object.values(STUDENT_FIELDS).flat()
  const hi = findHeaderRow(rows, allKeys)
  if (hi < 0) return { header: [], records: [] }
  const header = rows[hi]
  const idx = {}
  Object.entries(STUDENT_FIELDS).forEach(([f, keys]) => { idx[f] = detectCol(header, keys) })
  if (idx.account < 0 || idx.seat < 0 || idx.name < 0) {
    return { header, records: [], missing: ['account', 'seat', 'name'].filter((f) => idx[f] < 0) }
  }
  const records = []
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]
    const account = cell(row[idx.account])
    const seat = cell(row[idx.seat])
    const name = cell(row[idx.name])
    if (!account && !seat && !name) continue
    records.push({
      line: r + 1,
      account,
      seat,
      name,
      password: idx.password >= 0 ? cell(row[idx.password]) : '',
      class_no: idx.class_no >= 0 ? cell(row[idx.class_no]) : '',
      excluded: idx.excluded >= 0 ? toBool(row[idx.excluded]) : false,
    })
  }
  return { header, records }
}

const DERIVED = /排名|名次|總分|平均|進退步|備註|總計/

export function parseSubjectHeader(h) {
  const s = cell(h)
  const m = s.match(/^(.+?)\s*[*＊xX×]\s*([0-9]+(?:\.[0-9]+)?)\s*$/)
  if (m) return { name: m[1].trim(), weight: Number(m[2]) }
  return { name: s, weight: null }
}

export function mapScores(rows) {
  const hi = findHeaderRow(rows, ['座號', '座号', '座次', 'seat', '姓名', 'name'], 1)
  if (hi < 0) return { subjects: [], rows: [], ignored: [] }
  const header = rows[hi]
  const seatIdx = detectCol(header, ['座號', '座号', 'seat'])
  const nameIdx = detectCol(header, ['姓名', 'name'])
  const subjects = []
  const ignored = []
  for (let ci = 0; ci < header.length; ci++) {
    if (ci === seatIdx || ci === nameIdx) continue
    const raw = cell(header[ci])
    if (!raw) continue
    if (DERIVED.test(raw)) { ignored.push(raw); continue }
    const { name, weight } = parseSubjectHeader(raw)
    if (!name) continue
    subjects.push({ ci, name, weight })
  }
  const out = []
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]
    const seat = seatIdx >= 0 ? cell(row[seatIdx]) : ''
    const name = nameIdx >= 0 ? cell(row[nameIdx]) : ''
    if (!seat && !name) continue
    const values = []
    subjects.forEach((sub) => {
      const v = cell(row[sub.ci])
      if (v === '') return
      const n = Number(v)
      if (!isFinite(n)) return
      values.push({ subject: sub.name, score: n })
    })
    if (!values.length) continue
    out.push({ line: r + 1, seat, name, values })
  }
  return { subjects, rows: out, ignored }
}
