import { useCallback, useEffect, useState } from 'react'
import { rpc, supabase } from '../lib/supabase'

function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------------- 封存確認對話框（多層防呆） ----------------
function ArchiveDialog({ currentClass, onClose, onDone }) {
  const [preview, setPreview] = useState(null)
  const [newClass, setNewClass] = useState('')
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  // 一開啟就先向伺服器要「預覽」（此呼叫不會造成任何變更）
  useEffect(() => {
    rpc('api_archive_create', { p_note: '', p_new_class: '', p_confirm: false })
      .then((d) => setPreview(d?.success ? d : { warnings: ['無法取得預覽'], student_count: 0, exam_count: 0, score_count: 0 }))
      .catch(() => setPreview({ warnings: ['無法取得預覽'], student_count: 0, exam_count: 0, score_count: 0 }))
  }, [])

  // 輸入新班級代碼後即時重新取得預覽（檢查代碼是否重複等）
  useEffect(() => {
    const t = setTimeout(() => {
      rpc('api_archive_create', { p_note: note, p_new_class: newClass, p_confirm: false })
        .then((d) => setPreview(d?.success ? d : null))
    }, 350)
    return () => clearTimeout(t)
  }, [newClass, note])

  const w = preview?.warnings ?? []
  const nothing = (preview?.student_count ?? 0) === 0 && (preview?.exam_count ?? 0) === 0
  const sameClass = !!newClass.trim() && newClass.trim() === (preview?.class_no ?? currentClass)
  const typedOk = typed.trim() === newClass.trim() && newClass.trim().length > 0
  const canGo = !busy && !nothing && !sameClass && typedOk && ack && !err

  async function go() {
    setBusy(true)
    setErr('')
    const d = await rpc('api_archive_create', { p_note: note, p_new_class: newClass.trim(), p_confirm: true })
    setBusy(false)
    if (!d?.success) { setErr(d?.message || '封存失敗'); return }
    const accounts = Array.isArray(d.accounts) ? d.accounts : []
    let banned = 0
    if (accounts.length) {
      const r = await supabase.functions.invoke('admin', { body: { action: 'set_ban', accounts, banned: true } })
      if (r.data?.success) banned = r.data.updated ?? 0
    }
    await rpc('api_class_set', { p_class_no: newClass.trim() })
    setResult({ ...d, banned, newClass: newClass.trim() })
  }

  // ---------------- 封存完成畫面 ----------------
  if (result) {
    return (
      <div className="modal-overlay show">
        <div className="modal-box ok">
          <div className="modal-icon">✅</div>
          <div className="modal-title">封存完成</div>
          <div className="modal-msg" style={{ textAlign: 'left' }}>
            <div>原班級：<b>{result.class_no || '未設定'}</b> → 新班級：<b>{result.newClass}</b></div>
            <div style={{ marginTop: 6 }}>學生 <b>{result.student_count}</b> 人、考試 <b>{result.exam_count}</b> 場、成績 <b>{result.score_count}</b> 格已封存</div>
            <div style={{ marginTop: 6 }}>已停用畢業生登入帳號 <b>{result.banned}</b> 個</div>
            <div style={{ marginTop: 10, color: '#a01a5a', fontWeight: 700 }}>
              請立刻匯入新班級名冊；若封存有誤，請在下方按「取消封存」還原。
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn-p" onClick={() => { onDone?.(); onClose() }}>開始匯入新班級</button>
            <button className="btn-r" onClick={() => { onDone?.(result.id); onClose() }}>取消封存（還原）</button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------- 確認畫面 ----------------
  return (
    <div className="modal-overlay show" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-box err" style={{ maxWidth: 560, textAlign: 'left' }}>
        <div className="modal-title">⚠ 封存畢業班並開新班級</div>

        <div className="warn-box">
          這是整班操作，請逐項確認後再繼續。
        </div>

        <table className="sub" style={{ margin: '10px 0' }}>
          <tbody>
            <tr><th style={{ width: 130 }}>目前班級</th><td>{preview?.class_no || currentClass || '（未設定）'}</td></tr>
            <tr><th>將封存學生</th><td><b>{preview?.student_count ?? '…'}</b> 人（全部標記為已畢業）</td></tr>
            <tr><th>將封存考試</th><td><b>{preview?.exam_count ?? '…'}</b> 場（學生端將不再顯示）</td></tr>
            <tr><th>成績資料</th><td><b>{preview?.score_count ?? '…'}</b> 格（會存入快照，永久保留）</td></tr>
          </tbody>
        </table>

        {w.length > 0 && (
          <div className="warn-box" style={{ background: '#fff4e5', borderColor: '#ffb74d', color: '#8a4b00' }}>
            <b>請注意：</b>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {w.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        )}

        {nothing && (
          <div className="warn-box" style={{ background: '#fce4ec', borderColor: '#f06292', color: '#a01a5a' }}>
            沒有可封存的資料，操作已停用。
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <div>
            <label>新班級代碼 *</label>
            <input value={newClass} onChange={(e) => { setNewClass(e.target.value); setTyped('') }} placeholder="例如 1451" style={{ width: 130 }} />
          </div>
          <div>
            <label>備註（選填）</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如 1421 三年三班畢業" style={{ width: 220 }} />
          </div>
        </div>
        {sameClass && <div className="err-box show">新班級代碼不可與目前班級相同，請換一個。</div>}

        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            請輸入新班級代碼「<b>{newClass.trim() || '＿＿＿'}</b>」以啟用按鈕
          </label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={newClass.trim() || '先填上方新班級代碼'}
            disabled={!newClass.trim()}
            style={{ width: '100%' }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 18, height: 18 }} />
          我已了解：畢業生登入帳號將被停用，且此畫面關閉後需從「歷屆畢業班」才能還原。
        </label>

        {err && <div className="err-box show">{err}</div>}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn-g" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn-r" onClick={go} disabled={!canGo}>
            {busy ? '封存中…' : `確定封存 ${preview?.student_count ?? ''} 名學生並開新班級`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------- 主面板 ----------------
export default function ClassArchivePanel() {
  const [current, setCurrent] = useState('')
  const [newClass, setNewClass] = useState('')
  const [archives, setArchives] = useState([])
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState('')
  const [dialog, setDialog] = useState(false)
  const [restoreId, setRestoreId] = useState('')

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([rpc('api_class_current'), rpc('api_archives', { p_with_students: true })])
    setCurrent(c?.class_no ?? '')
    setArchives(Array.isArray(a) ? a : [])
  }, [])
  useEffect(() => { load() }, [load])

  function setClassOnly() {
    const v = newClass.trim()
    if (!v) { setInfo('❌ 請輸入新班級代碼'); return }
    if (v === current) { setInfo('❌ 新班級代碼與目前相同'); return }
    if (!confirm(`只把「目前班級代碼」改成 ${v}？\n\n不會變更任何學生或成績資料。`)) return
    setBusy(true)
    rpc('api_class_set', { p_class_no: v }).then((d) => {
      setBusy(false)
      if (!d?.success) { setInfo('❌ ' + (d?.message || '失敗')); return }
      setInfo(`✅ 目前班級代碼已改為 ${v}（資料未變動）`)
      setNewClass('')
      load()
    })
  }

  function doRestore(id) {
    setRestoreId(id)
  }

  function confirmRestore() {
    const a = archives.find((x) => x.id === restoreId)
    if (!a) return
    setBusy(true)
    rpc('api_archive_restore', { p_id: a.id }).then(async (d) => {
      if (!d?.success) {
        setBusy(false); setRestoreId('')
        setInfo('❌ ' + (d?.message || '失敗'))
        return
      }
      const accounts = Array.isArray(d.accounts) ? d.accounts : []
      if (accounts.length) await supabase.functions.invoke('admin', { body: { action: 'set_ban', accounts, banned: false } })
      setBusy(false); setRestoreId('')
      setInfo(`✅ 已取消封存「${a.class_no}」，${accounts.length} 個帳號已重新啟用`)
      load()
    })
  }

  return (
    <div className="card">
      <h3>班級管理</h3>
      <p className="hint">
        學生畢業後按「封存畢業班並開新班級」，系統會先顯示將封存的資料範圍，
        需輸入新班級代碼確認後才會執行。封存不刪除任何資料，可在下方隨時還原。
      </p>

      <div className="row">
        <div><label>目前班級代碼</label><input value={current} readOnly placeholder="尚未設定" style={{ width: 120, background: '#f2f7f4' }} /></div>
        <div><label>新班級代碼</label><input value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="例如 1451" style={{ width: 120 }} /></div>
        <div><label>&nbsp;</label><button className="btn-g" disabled={busy} onClick={setClassOnly}>只改班級代碼</button></div>
        <div><label>&nbsp;</label><button className="btn-p" onClick={() => setDialog(true)}>封存畢業班並開新班級</button></div>
      </div>
      <div className="info">{info}</div>

      {dialog && <ArchiveDialog currentClass={current} onClose={() => setDialog(false)} onDone={(restoreId) => {
        load()
        if (restoreId) { setInfo('ℹ️ 可在下方按「取消封存」還原'); doRestore(restoreId) }
      }} />}

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
              <button className="btn-r btn-s" disabled={busy} onClick={() => doRestore(a.id)}>取消封存</button>
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
                <tbody>{(a.students || []).map((s, i) => <tr key={i}><td>{s.seat}</td><td>{s.name}</td><td>{s.account}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {openId === 'exams:' + a.id && (
            <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
              <table className="sub">
                <thead><tr><th>考試</th></tr></thead>
                <tbody>{(a.exams || []).map((e, i) => <tr key={i}><td>{e.name}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {restoreId && (
        <div className="modal-overlay show" onClick={(e) => e.target === e.currentTarget && setRestoreId('')}>
          <div className="modal-box ok">
            <div className="modal-title">取消封存</div>
            <div className="modal-msg">
              確定要取消封存「{archives.find((x) => x.id === restoreId)?.class_no}」嗎？<br />
              該屆學生將恢復為在學、考試恢復顯示，並重新啟用其登入帳號。
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn-g" onClick={() => setRestoreId('')}>取消</button>
              <button className="btn-p" onClick={confirmRestore} disabled={busy}>{busy ? '處理中…' : '確定還原'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}