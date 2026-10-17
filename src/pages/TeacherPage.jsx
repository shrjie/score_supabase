import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useTitle } from '../lib/title'
import { buildReportHTML, buildSlipsHTML, openPrintWindow } from '../lib/printDocs'

const TABS = [
  ['grade', '成績編修'],
  ['exam', '考試科目'],
  ['stu', '學生管理'],
  ['audit', '操作紀錄'],
]

function actorLabel(actor) {
  const a = String(actor ?? '')
  if (!a || a === 'teacher' || a.includes('@teachers.grade.local')) return '老師'
  return a
}

function Modal({ state, onClose }) {
  if (!state) return null
  const good = state.ok !== false
  return (
    <div className="modal-overlay show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-box ${good ? 'ok' : 'err'}`}>
        <div className="modal-icon">{good ? '✅' : '❌'}</div>
        <div className="modal-title">{state.title}</div>
        <div className="modal-msg">{state.message}</div>
        <button className="btn-primary" onClick={onClose}>確定</button>
      </div>
    </div>
  )
}

export default function TeacherPage() {
  const { title, setTitle } = useTitle()
  const { me, session, signInTeacher, signOut, changePassword, loading } = useAuth()

  const [password, setPassword] = useState('')
  const [loginErr, setLoginErr] = useState('')

  const [tab, setTab] = useState('grade')
  const [modal, setModal] = useState(null)
  const [pwOpen, setPwOpen] = useState(false)

  const isTeacher = me?.success && me.role === 'teacher'

  async function doLogin() {
    setLoginErr('')
    if (!password) {
      setLoginErr('請輸入管理密碼')
      return
    }
    const d = await signInTeacher(password)
    if (!d.success) setLoginErr(d.message)
  }

  if (!isTeacher) {
    return (
      <div className="app teacher">
        <header>
          <div className="hd">
            <h1>老師成績管理</h1>
            <Link className="switch-link" to="/">回學生端</Link>
          </div>
        </header>
        <main>
          <div className="card">
            <h3>老師登入</h3>
            <br />
            <div className="row">
              <div>
                <label>管理密碼</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                  placeholder="請輸入管理密碼"
                  style={{ width: 260 }}
                />
              </div>
              <div>
                <label>&nbsp;</label>
                <button className="btn-p" disabled={loading} onClick={doLogin}>登入</button>
              </div>
            </div>
            {loginErr && <div className="err-box show">{loginErr}</div>}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app teacher">
      <header>
        <div className="hd">
          <h1>
            老師成績管理 <Link className="switch-link" to="/">回學生端</Link>
          </h1>
          <div className="hd-right">
            <button className="btn-g btn-s" onClick={() => setPwOpen((v) => !v)}>改管理密碼</button>
            <button className="btn-g btn-s" onClick={signOut}>登出</button>
          </div>
        </div>
      </header>
      <main>
        {pwOpen && <PasswordPanel changePassword={changePassword} onClose={() => setPwOpen(false)} />}
        <div className="tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {tab === 'grade' && <GradePanel onModal={setModal} />}
        {tab === 'exam' && <ExamPanel onModal={setModal} title={title} setTitle={setTitle} />}
        {tab === 'stu' && <StudentPanel onModal={setModal} />}
        {tab === 'audit' && <AuditPanel />}
      </main>
      <Modal state={modal} onClose={() => setModal(null)} />
    </div>
  )
}

function PasswordPanel({ changePassword, onClose }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setErr(''); setInfo('')
    if (!oldPw || !newPw) { setErr('舊密碼與新密碼不可空白'); return }
    if (newPw !== newPw2) { setErr('兩次新密碼不一致'); return }
    setBusy(true)
    const d = await changePassword(oldPw, newPw)
    setBusy(false)
    if (!d.success) { setErr(d.message); return }
    setInfo('✅ 密碼已變更')
    setOldPw(''); setNewPw(''); setNewPw2('')
  }

  return (
    <div className="card dashed" style={{ borderColor: '#66bb6a' }}>
      <h3>改管理密碼 <button className="btn-g btn-s" style={{ float: 'right' }} onClick={onClose}>關閉</button></h3>
      <br />
      <div className="row">
        <div><label>舊密碼</label><input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} /></div>
        <div><label>新密碼 (至少6碼)</label><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></div>
        <div><label>確認新密碼</label><input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} /></div>
        <div><label>&nbsp;</label><button className="btn-p" disabled={busy} onClick={submit}>{busy ? '處理中…' : '確認變更'}</button></div>
      </div>
      {info && <div className="info">{info}</div>}
      {err && <div className="err-box show">{err}</div>}
    </div>
  )
}

function GradePanel({ onModal }) {
  const { title } = useTitle()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [grid, setGrid] = useState(null)
  const [info, setInfo] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkInfo, setBulkInfo] = useState('')
  const [singleOpen, setSingleOpen] = useState(false)
  const [singleSub, setSingleSub] = useState('')
  const [singleText, setSingleText] = useState('')
  const [singleInfo, setSingleInfo] = useState('')

  const loadExams = useCallback(async () => {
    const list = await rpc('api_teacher_exams')
    const arr = Array.isArray(list) ? list : []
    setExams(arr)
    if (arr.length && !arr.find((e) => e.id === examId)) setExamId(arr[0].id)
  }, [examId])

  useEffect(() => { loadExams() }, [loadExams])

  const loadGrid = useCallback(async (id) => {
    if (!id) return
    const d = await rpc('api_teacher_grid', { p_exam: id })
    if (!d?.success) {
      setInfo('❌ ' + (d?.message || '載入失敗'))
      setGrid(null)
      return
    }
    setGrid(d)
    setInfo(`✅ ${d.students.length} 人 × ${d.subjects.length} 科・單格改完自動存`)
  }, [])

  useEffect(() => { loadGrid(examId) }, [examId, loadGrid])

  async function saveCell(studentId, subjectId, value) {
    const score = value === '' ? null : Number(value)
    if (value !== '' && isNaN(score)) {
      onModal({ ok: false, title: '格式錯誤', message: '請輸入數字，空白=未輸入' })
      return
    }
    const d = await rpc('api_score_set', { p_exam: examId, p_student: studentId, p_subject: subjectId, p_score: score })
    if (!d?.success) {
      onModal({ ok: false, title: '儲存失敗', message: d?.message || '失敗' })
      return
    }
    loadGrid(examId)
  }

  function exportCSV() {
    if (!grid) return
    const lines = []
    lines.push(['座號', '姓名', ...grid.subjects.map((s) => s.name)].join(','))
    grid.students.forEach((st) => {
      const row = [st.seat, st.name + (st.excluded ? ' (測試)' : '')]
      grid.subjects.forEach((sub) => {
        const v = grid.scores[`${st.id}_${sub.id}`]
        row.push(v === null || v === undefined ? '' : v)
      })
      lines.push(row.join(','))
    })
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (exams.find((e) => e.id === examId)?.name || 'exam') + '_總表.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function applyBulk() {
    setBulkInfo('')
    const raw = bulkText.replace(/\r/g, '')
    const lines = raw.split('\n').filter((l) => l.length).map((l) => l.split('\t').map((c) => c.trim()))
    if (lines.length < 2) { setBulkInfo('❌ 內容不足'); return }
    const header = lines[0]
    let seatIdx = header.findIndex((h) => h.includes('座號') || h.toLowerCase() === 'seat')
    if (seatIdx < 0) seatIdx = 0
    const nameIdx = header.findIndex((h) => h.includes('姓名') || h.toLowerCase() === 'name')
    const byName = {}
    grid.subjects.forEach((s) => { byName[s.name] = s.id })
    const cols = []
    header.forEach((h, ci) => {
      if (ci === seatIdx || ci === nameIdx) return
      if (byName[h]) cols.push({ ci, sid: byName[h] })
    })
    if (!cols.length) { setBulkInfo('❌ 表頭找不到對應科目'); return }
    const seatMap = {}
    grid.students.forEach((s) => { seatMap[String(s.seat).trim()] = s.id })
    const cells = []
    let warns = ''
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i]
      const seat = String(row[seatIdx] || '').trim()
      if (!seat) continue
      const sid = seatMap[seat]
      if (!sid) { warns += `⚠ 第${i + 1}列座號 ${seat} 不在名單\n`; continue }
      cols.forEach((c) => {
        const v = String(row[c.ci] ?? '').trim()
        if (v !== '') cells.push({ student_id: sid, subject_id: c.sid, score: isNaN(Number(v)) ? v : Number(v) })
      })
    }
    if (!cells.length) { setBulkInfo('❌ 無有效資料'); return }
    const d = await rpc('api_score_bulk', { p_exam: examId, p_cells: cells })
    setBulkInfo(d?.success ? `${warns}✅ 已寫入 ${d.updated} 格` : '❌ ' + (d?.message || '失敗'))
    loadGrid(examId)
  }

  async function applySingle() {
    setSingleInfo('')
    if (!singleSub) { setSingleInfo('❌ 請先選擇科目'); return }
    const sub = grid.subjects.find((s) => s.id === singleSub)
    const lines = singleText.replace(/\r/g, '').split('\n')
    const cells = []
    lines.forEach((raw, i) => {
      const v = String(raw).split('\t')[0].trim()
      if (v === '') return
      if (i >= grid.students.length) return
      cells.push({ student_id: grid.students[i].id, subject_id: singleSub, score: isNaN(Number(v)) ? v : Number(v) })
    })
    if (!cells.length) { setSingleInfo('❌ 沒有可填入的分數'); return }
    if (!confirm(`將 ${cells.length} 筆分數填入「${sub?.name}」（座號順序）？`)) return
    setSingleInfo('寫入中…')
    const d = await rpc('api_score_bulk', { p_exam: examId, p_cells: cells })
    if (!d?.success) { setSingleInfo('❌ ' + (d?.message || '失敗')); return }
    setSingleInfo(`✅ 已填入 ${d.updated} 格`)
    setSingleText('')
    loadGrid(examId)
  }

  async function printReport() {
    if (!grid) { alert('請先選擇考試並載入'); return }
    const stats = await rpc('api_class_stats', { p_exam: examId })
    const examName = exams.find((e) => e.id === examId)?.name || ''
    openPrintWindow(buildReportHTML({
      title, examName, students: grid.students, subjects: grid.subjects,
      scores: grid.scores, stats: Array.isArray(stats) ? stats : [],
    }))
  }

  function printSlips() {
    if (!grid) { alert('請先選擇考試並載入'); return }
    const w = window.open('', '_blank')
    if (!w) { alert('瀏覽器阻擋了彈出視窗，請允許後再試'); return }
    w.document.write('<!DOCTYPE html><body style="font-family:sans-serif;padding:24px">資料產生中，請稍候…</body>')
    const examName = exams.find((e) => e.id === examId)?.name || ''
    rpc('api_class_slips', { p_exam: examId }).then((d) => {
      if (!d?.success) {
        w.document.open()
        w.document.write(`<body><p>${d?.message || '載入失敗'}</p></body>`)
        w.document.close()
        return
      }
      const html = buildSlipsHTML({ title, examName, slips: d.students || [], stats: d.stats || [] })
      w.document.open()
      w.document.write(html)
      w.document.close()
    })
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <label>考試</label>
          <select value={examId} onChange={(e) => setExamId(e.target.value)} style={{ minWidth: 260 }}>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={() => { setBulkOpen(false); setSingleOpen((v) => !v) }}>單科貼上</button></div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={() => setBulkOpen((v) => !v)}>整班貼上</button></div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={printReport}>列印總表(PDF)</button></div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={printSlips}>全班成績單(PDF)</button></div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={exportCSV}>匯出CSV</button></div>
        <span className="hint">點白格直接改，離開自動存並即時重算總分/排名。灰底為自動計算欄。</span>
      </div>
      <div className="info">{info}</div>

      {bulkOpen && (
        <div className="card dashed" style={{ marginTop: 12 }}>
          <h3>一次貼上全班成績</h3>
          <p className="hint">從 Excel 複製含表頭範圍貼上（第一列：座號 / 姓名 / 科目…）</p>
          <textarea className="bulk" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn-p" onClick={applyBulk}>寫入</button>
            <button className="btn-g" onClick={() => setBulkOpen(false)}>關閉</button>
          </div>
          <div className="info" style={{ whiteSpace: 'pre-wrap' }}>{bulkInfo}</div>
        </div>
      )}

      {singleOpen && grid && (
        <div className="card dashed" style={{ marginTop: 12 }}>
          <h3>單科整欄貼上</h3>
          <p className="hint">從 Excel 複製一整欄分數（座號由小到大往下排），選好科目後貼上。空白列自動跳過不覆蓋。</p>
          <div className="row">
            <div>
              <label>填入科目</label>
              <select value={singleSub} onChange={(e) => setSingleSub(e.target.value)} style={{ minWidth: 180 }}>
                <option value="">-- 請選擇 --</option>
                {grid.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label>&nbsp;</label><button className="btn-p" onClick={applySingle}>填入</button></div>
            <div><label>&nbsp;</label><button className="btn-g" onClick={() => setSingleOpen(false)}>關閉</button></div>
          </div>
          <textarea className="bulk" style={{ height: 140 }} value={singleText} onChange={(e) => setSingleText(e.target.value)} placeholder="每列一個分數（座號順序）" />
          <div className="info">{singleInfo}</div>
        </div>
      )}

      {grid && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>座號</th><th>姓名</th>
                {grid.subjects.map((s) => <th key={s.id}>{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.students.map((st) => (
                <tr key={st.id} className={st.excluded ? 'test-row' : ''}>
                  <td className="ro">{st.seat}</td>
                  <td className="ro" style={{ textAlign: 'left' }}>{st.name}{st.excluded ? '（測）' : ''}</td>
                  {grid.subjects.map((sub) => {
                    const key = `${st.id}_${sub.id}`
                    const v = grid.scores[key]
                    return (
                      <td className="c" key={sub.id}>
                        <input
                          className="cell"
                          inputMode="decimal"
                          defaultValue={v === null || v === undefined ? '' : v}
                          key={key + '_' + (v ?? '')}
                          onBlur={(e) => saveCell(st.id, sub.id, e.target.value.trim())}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ExamPanel({ onModal, title, setTitle }) {
  const [exams, setExams] = useState([])
  const [subjects, setSubjects] = useState([])
  const [titleInput, setTitleInput] = useState(title)
  const [newExam, setNewExam] = useState('')
  const [newSubName, setNewSubName] = useState('')
  const [newSubWeight, setNewSubWeight] = useState('')
  const [info, setInfo] = useState('')

  const reload = useCallback(async () => {
    setExams(Array.isArray(await rpc('api_teacher_exams')) ? await rpc('api_teacher_exams') : [])
    const subs = await rpc('api_teacher_subjects')
    setSubjects(Array.isArray(subs) ? subs : [])
  }, [])

  useEffect(() => { reload() }, [reload])

  async function saveTitle() {
    const d = await rpc('api_config_set_title', { p_title: titleInput.trim() })
    if (d?.success) { setTitle(titleInput.trim()); setInfo('✅ 標題已更新') }
    else setInfo('❌ ' + (d?.message || '失敗'))
  }

  async function createExam() {
    const d = await rpc('api_exam_create', { p_name: newExam.trim() })
    if (d?.success) { setNewExam(''); onModal({ title: '新增考試成功', message: `「${d.name}」已建立` }); reload() }
    else onModal({ ok: false, title: '新增失敗', message: d?.message || '失敗' })
  }

  async function renameExam(e) {
    const n = prompt('新名稱：', e.name)
    if (!n || n.trim() === e.name) return
    const d = await rpc('api_exam_rename', { p_id: e.id, p_name: n.trim() })
    if (d?.success) reload()
    else onModal({ ok: false, title: '改名失敗', message: d?.message || '失敗' })
  }

  async function deleteExam(e) {
    if (!confirm(`確定刪除「${e.name}」？全班成績會一併刪除，無法復原。`)) return
    const d = await rpc('api_exam_delete', { p_id: e.id })
    if (d?.success) reload()
    else onModal({ ok: false, title: '刪除失敗', message: d?.message || '失敗' })
  }

  async function createSubject() {
    const d = await rpc('api_subject_create', { p_name: newSubName.trim(), p_weight: newSubWeight === '' ? null : Number(newSubWeight) })
    if (d?.success) { setNewSubName(''); setNewSubWeight(''); reload() }
    else onModal({ ok: false, title: '新增科目失敗', message: d?.message || '失敗' })
  }

  async function saveSubject(s) {
    const d = await rpc('api_subject_edit', { p_id: s.id, p_name: s.name, p_weight: s.weight })
    if (d?.success) setInfo('✅ 已儲存並即時重算')
    else setInfo('❌ ' + (d?.message || '失敗'))
  }

  return (
    <div className="card">
      <h3>系統標題名稱</h3>
      <div className="row">
        <div><label>系統標題 *</label><input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} style={{ width: 320 }} /></div>
        <div><label>&nbsp;</label><button className="btn-p" onClick={saveTitle}>儲存標題</button></div>
      </div>
      <hr />
      <h3>新增考試次數</h3>
      <div className="row">
        <div><label>考試名稱 *</label><input value={newExam} onChange={(e) => setNewExam(e.target.value)} placeholder="114-1 第二次段考" style={{ width: 260 }} /></div>
        <div><label>&nbsp;</label><button className="btn-p" onClick={createExam}>新增考試</button></div>
      </div>
      <div className="info">{info}</div>
      <h3 style={{ marginTop: 16 }}>科目管理（改名稱或權重會即時重算）</h3>
      <div className="row">
        <div><label>名稱</label><input value={newSubName} onChange={(e) => setNewSubName(e.target.value)} placeholder="英文" /></div>
        <div><label>權重</label><input value={newSubWeight} onChange={(e) => setNewSubWeight(e.target.value)} placeholder="3" style={{ width: 80 }} /></div>
        <div><label>&nbsp;</label><button className="btn-p" onClick={createSubject}>新增科目</button></div>
      </div>
      <table className="sub" style={{ marginTop: 10 }}>
        <thead><tr><th>科目名稱</th><th>權重</th><th /></tr></thead>
        <tbody>
          {subjects.map((s) => (
            <tr key={s.id}>
              <td>
                <input
                  defaultValue={s.name}
                  onBlur={(e) => { s.name = e.target.value.trim() }}
                  style={{ width: 160 }}
                />
              </td>
              <td>
                <input
                  className="w"
                  type="number"
                  defaultValue={s.weight}
                  onBlur={(e) => { s.weight = Number(e.target.value) }}
                />
              </td>
              <td><button className="btn-p btn-s" onClick={() => saveSubject(s)}>儲存</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 16 }}>現有考試</h3>
      {exams.map((e) => (
        <div key={e.id} style={{ marginBottom: 6 }}>
          <span className="badge">📝 {e.name}</span>{' '}
          <button className="btn-g btn-s" onClick={() => renameExam(e)}>改名</button>{' '}
          <button className="btn-r btn-s" onClick={() => deleteExam(e)}>刪除</button>
        </div>
      ))}
    </div>
  )
}

function StudentPanel({ onModal }) {
  const [students, setStudents] = useState([])
  const [info, setInfo] = useState('')
  const [form, setForm] = useState({ account: '', password: '', seat: '', name: '', class_no: '1421', excluded: false })

  const reload = useCallback(async () => {
    const list = await rpc('api_teacher_students')
    setStudents(Array.isArray(list) ? list : [])
  }, [])
  useEffect(() => { reload() }, [reload])

  async function upsert() {
    if (!form.account || !form.seat || !form.name) { setInfo('❌ 帳號/座號/姓名不可空白'); return }
    const { data, error } = await supabase.functions.invoke('admin', {
      body: { action: 'upsert_student', ...form },
    })
    if (error || !data?.success) { setInfo('❌ ' + (error?.message || data?.message || '失敗')); return }
    setInfo('✅ 已儲存')
    setForm({ account: '', password: '', seat: '', name: '', class_no: '1421', excluded: false })
    reload()
  }

  async function toggleExcluded(s) {
    const toEx = !s.excluded
    if (!confirm(`${s.seat} ${s.name} → ${toEx ? '測試帳(不排名)' : '正式生'}？`)) return
    const { data, error } = await supabase.functions.invoke('admin', {
      body: { action: 'upsert_student', account: s.account, password: '', seat: s.seat, name: s.name, class_no: s.class_no, excluded: toEx },
    })
    if (error || !data?.success) { onModal({ ok: false, title: '失敗', message: error?.message || data?.message || '失敗' }); return }
    reload()
  }

  async function resetPassword(s) {
    const pw = prompt(`將學生「${s.seat} ${s.name}」的密碼重設為：`, '')
    if (pw === null) return
    if (pw.trim().length < 6) { setInfo('❌ 新密碼至少 6 碼'); return }
    const { data, error } = await supabase.functions.invoke('admin', {
      body: { action: 'reset_password', account: s.account, password: pw.trim() },
    })
    if (error || !data?.success) { setInfo('❌ ' + (error?.message || data?.message || '失敗')); return }
    setInfo(`✅ 已重設「${s.seat} ${s.name}」的密碼`)
  }

  return (
    <div className="card">
      <h3>學生名單 <span className="hint">(測試帳不列入排名)</span></h3>
      <table className="sub" style={{ marginTop: 8 }}>
        <thead><tr><th>座號</th><th>姓名</th><th>帳號</th><th>班級</th><th>狀態</th><th /></tr></thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.account}>
              <td style={{ textAlign: 'center' }}>{s.seat}</td>
              <td>{s.name}{s.excluded ? <span className="test-badge">測</span> : ''}</td>
              <td>{s.account}</td>
              <td>{s.class_no}</td>
              <td>{s.excluded ? '測試(不排名)' : '正式'}</td>
              <td>
                <button className="btn-g btn-s" onClick={() => toggleExcluded(s)}>{s.excluded ? '轉正式' : '設測試'}</button>{' '}
                <button className="btn-g btn-s" onClick={() => resetPassword(s)}>重設密碼</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 16 }}>新增 / 更新學生（帳號重複=更新，密碼留空=不改）</h3>
      <div className="row">
        <div><label>帳號 *</label><input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} /></div>
        <div><label>密碼</label><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="新增時必填" /></div>
        <div><label>座號 *</label><input value={form.seat} onChange={(e) => setForm({ ...form, seat: e.target.value })} style={{ width: 80 }} /></div>
        <div><label>姓名 *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 120 }} /></div>
        <div><label>班級</label><input value={form.class_no} onChange={(e) => setForm({ ...form, class_no: e.target.value })} style={{ width: 100 }} /></div>
        <div><label>測試帳</label><input type="checkbox" checked={form.excluded} onChange={(e) => setForm({ ...form, excluded: e.target.checked })} style={{ width: 20, height: 20 }} /></div>
        <div><label>&nbsp;</label><button className="btn-p" onClick={upsert}>儲存</button></div>
      </div>
      <div className="info">{info}</div>
    </div>
  )
}

function AuditPanel() {
  const [logs, setLogs] = useState([])
  const [info, setInfo] = useState('')

  const load = useCallback(async () => {
    setInfo('載入中…')
    const d = await rpc('api_audit', { p_limit: 200 })
    if (Array.isArray(d)) { setLogs(d); setInfo(`共 ${d.length} 筆（最近 200）`) }
    else setInfo('❌ 載入失敗')
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="card">
      <h3>操作紀錄 <span className="hint">(最近 200 筆)</span></h3>
      <button className="btn-p" onClick={load}>載入紀錄</button>
      <div className="info">{info}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="sub" style={{ marginTop: 8 }}>
          <thead><tr><th>時間</th><th>老師</th><th>動作</th><th>明細</th></tr></thead>
          <tbody>
            {logs.map((l, i) => {
              const t = new Date(l.created_at)
              const ts = `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
              return (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{ts}</td>
                  <td>{actorLabel(l.actor)}</td>
                  <td>{l.action}</td>
                  <td style={{ wordBreak: 'break-all' }}>{l.detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
