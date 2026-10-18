import { useCallback, useEffect, useState } from 'react'
import { rpc, supabase } from '../lib/supabase'

function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 班級封存 / 開新班級 / 歷屆畢業班查詢
export default function ClassArchivePanel({ onChanged }) {
  const [current, setCurrent] = useState('')
  const [newClass, setNewClass] = useState('')
  const [note, setNote] = useState('')
  const [archives, setArchives] = useState([])
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState('')

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([
      rpc('api_class_current'),
      rpc('api_archives', { p_with_students: true }),
    ])
    setCurrent(c?.class_no ?? '')
    setArchives(Array.isArray(a) ? a : [])
  }, [])

  useEffect(() => { load() }, [load])

  function setClassOnly() {
    const v = newClass.trim()
    if (!v) { setInfo('❌ 請輸入新班級代碼'); return }
    setBusy(true)
    rpc('api_class_set', { p_class_no: v }).then((d) => {
      setBusy(false)
      if (!d?.success) { setInfo('❌ ' + (d?.message || '失敗')); return }
      setInfo(`✅ 目前班級已設為 ${v}（不會變更既有學生資料）`)
      setNewClass('')
      load()
      onChanged?.()
    })
  }

  function doArchive() {
    const v = newClass.trim()
    if (!v) { setInfo('❌ 請先輸入新班級代碼'); return }
    if (!confirm(
      `確定要「封存畢業班並開新班級」嗎？\n\n` +
      `• 目前所有未畢業學生 → 標記為已畢業（不再出現在編修與排名）\n` +
      `• 目前所有未封存考試 → 標記為封存（學生端不再看到）\n` +
      `• 完整資料（學生／考試／科目／成績）會存入封存快照，可隨時查看\n` +
      `• 畢業生登入帳號將被停用\n` +
      `• 新班級代碼：${v}\n\n` +
      `此操作可由「取消封存」還原。確定繼續？`,
    )) return
    setBusy(true)
    setInfo('封存處理中…')
    rpc('api_archive_create', { p_note: note.trim() }).then(async (d) => {
      if (!d?.success) {
        setBusy(false)
        setInfo('❌ ' + (d?.message || '封存失敗'))
        return
      }
      const accounts = Array.isArray(d.accounts) ? d.accounts : []
      let banned = 0
      if (accounts.length) {
        const r = await supabase.functions.invoke('admin', { body: { action: 'set_ban', accounts, banned: true } })
        if (r.data?.success) banned = r.data.updated ?? 0
      }
      await rpc('api_class_set', { p_class_no: v })
      setBusy(false)
      setInfo(
        `✅ 已封存 ${d.class_no || '目前班級'}：學生 ${d.student_count} 人、考試 ${d.exam_count} 場、成績 ${d.score_count} 格；` +
        `已停用 ${banned} 個畢業生帳號；新班級為 ${v}`,
      )
      setNote('')
      setNewClass('')
      load()
      onChanged?.()
    })
  }

  function restore(a) {
    if (!confirm(`確定取消封存「${a.class_no}」（${fmtTime(a.archived_at)}）？\n\n該屆學生會恢復為在學、考試恢復顯示，並重新啟用登入帳號。`)) return
    setBusy(true)
    rpc('api_archive_restore', { p_id: a.id }).then(async (d) => {
      if (!d?.success) {
        setBusy(false)
        setInfo('❌ ' + (d?.message || '失敗'))
        return
      }
      const accounts = Array.isArray(d.accounts) ? d.accounts : []
      if (accounts.length) {
        await supabase.functions.invoke('admin', { body: { action: 'set_ban', accounts, banned: false } })
      }
      setBusy(false)
      setInfo(`✅ 已取消封存，${accounts.length} 個帳號已重新啟用`)
      load()
      onChanged?.()
    })
  }

  return (
    <div className="card">
      <h3>班級管理</h3>
      <p className="hint">
        學生畢業後按「封存畢業班並開新班級」，系統會把整班的資料做成快照保存，
        原班級的成績單仍可透過列印查到；新班級則沿用目前的科目與權重。
      </p>

      <div className="row">
        <div><label>目前班級代碼</label><input value={current} readOnly placeholder="尚未設定" style={{ width: 120, background: '#f2f7f4' }} /></div>
        <div><label>新班級代碼 *</label><input value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="例如 1451" style={{ width: 120 }} /></div>
        <div><label>備註（選填）</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如 1421 三年三班畢業" style={{ width: 200 }} /></div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div><label>&nbsp;</label><button className="btn-p" disabled={busy} onClick={doArchive}>封存畢業班並開新班級</button></div>
        <div><label>&nbsp;</label><button className="btn-g" disabled={busy} onClick={setClassOnly}>只改班級代碼</button></div>
      </div>
      <div className="info">{info}</div>

      <h3 style={{ marginTop: 20 }}>歷屆畢業班（{archives.length}）</h3>
      {!archives.length && <p className="hint">尚未有封存紀錄。</p>}
      {archives.map((a) => (
        <div key={a.id} style={{ border: '1.5px solid #cfe6d4', borderRadius: 10, padding: 12, marginBottom: 10, background: '#fff' }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <div>
              <span className="badge">{a.class_no || '未命名班級'}</span>{' '}
              <span className="hint" style={{ marginLeft: 8 }}>封存於 {fmtTime(a.archived_at)}</span>
            </div>
            <div style={{ flex: 1 }} />
            <div>
              <button className="btn-g btn-s" onClick={() => setOpenId(openId === a.id ? '' : a.id)}>
                {openId === a.id ? '收合' : `學生名單 (${a.student_count})`}
              </button>{' '}
              <button className="btn-g btn-s" onClick={() => setOpenId('exams:' + a.id)}>考試 ({a.exam_count})</button>{' '}
              <button className="btn-r btn-s" disabled={busy} onClick={() => restore(a)}>取消封存</button>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            學生 {a.student_count} 人・考試 {a.exam_count} 場・成績 {a.score_count} 格
            {a.note ? `　｜備註：${a.note}` : ''}
          </div>
          {openId === a.id && (
            <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
              <table className="sub">
                <thead><tr><th>座號</th><th>姓名</th><th>帳號</th></tr></thead>
                <tbody>
                  {(a.students || []).map((s, i) => (
                    <tr key={i}><td>{s.seat}</td><td>{s.name}</td><td>{s.account}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {openId === 'exams:' + a.id && (
            <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
              <table className="sub">
                <thead><tr><th>考試</th></tr></thead>
                <tbody>
                  {(a.exams || []).map((e, i) => (
                    <tr key={i}><td>{e.name}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}