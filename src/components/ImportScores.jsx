import { useState } from 'react'
import { rpc } from '../lib/supabase'
import { parseTable, mapScores } from '../lib/tabular'
import { downloadCsv } from '../lib/csvTemplate'

const NEW = '__new__'

export default function ImportScores({ exams, onDone }) {
  const [examId, setExamId] = useState(exams?.[0]?.id || '')
  const [newName, setNewName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])

  const isNew = examId === NEW

  function template() {
    downloadCsv('成績匯入範本', [
      ['座號', '姓名', '國文*5', '英文*3', '數學*4', '社會*3', '自然*3'],
      ['1', '王小明', '83', '90', '80', '82', '84'],
    ])
  }

  async function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name); setInfo(''); setLog([]); setParsed(null)
    try {
      const table = await parseTable(f)
      const m = mapScores(table)
      if (!m.subjects.length) { setInfo('❌ 找不到科目欄（表頭需含「座號」，其餘欄位視為科目，例：國文*5）'); return }
      if (!m.rows.length) { setInfo('❌ 找不到分數資料列'); return }
      setParsed(m)
      setInfo(`讀到 ${m.subjects.length} 個科目欄、${m.rows.length} 列。匯入時會自動建立缺少的科目與權重。`)
    } catch (err) {
      setInfo('❌ 檔案解析失敗：' + err.message)
    }
  }

  async function run() {
    if (!parsed?.subjects?.length) return
    setBusy(true); setInfo(''); setLog([])
    const out = []
    try {
      let targetExam = examId
      if (isNew) {
        const nm = newName.trim()
        if (!nm) { setInfo('❌ 請輸入新考試名稱'); setBusy(false); return }
        const r = await rpc('api_exam_create', { p_name: nm })
        if (!r?.success) { setInfo('❌ ' + (r?.message || '建立考試失敗')); setBusy(false); return }
        targetExam = r.id
        out.push(`✅ 新增考試：${r.name}`)
      }

      const [students, subjects] = await Promise.all([
        rpc('api_teacher_students'),
        rpc('api_teacher_subjects'),
      ])
      const byName = {}
      const subList = Array.isArray(subjects) ? subjects : []
      subList.forEach((s) => { byName[s.name] = s })

      out.push('— 檢查科目 —')
      for (const sub of parsed.subjects) {
        let cur = byName[sub.name]
        if (!cur) {
          const r = await rpc('api_subject_create', { p_name: sub.name, p_weight: sub.weight ?? 1 })
          if (r?.success) { out.push(`＋ 新增科目 ${sub.name}（權重 ${sub.weight ?? 1}）`); byName[sub.name] = { id: r.id, name: r.name, weight: r.weight } }
          else out.push(`❌ 科目 ${sub.name}：${r?.message || '建立失敗'}`)
        } else if (sub.weight != null && Number(cur.weight) !== Number(sub.weight)) {
          const r = await rpc('api_subject_edit', { p_id: cur.id, p_name: cur.name, p_weight: sub.weight })
          if (r?.success) { out.push(`↻ 更新科目 ${cur.name} 權重 ${cur.weight}→${sub.weight}`); cur.weight = sub.weight }
          else out.push(`❌ 科目 ${cur.name}：${r?.message || '更新失敗'}`)
        }
      }
      setLog([...out])

      const seatMap = {}
      const nameMap = {}
      ;(Array.isArray(students) ? students : []).forEach((s) => {
        seatMap[String(s.seat).trim()] = s.id
        nameMap[String(s.name).trim()] = s.id
      })

      const cells = []
      let miss = 0
      for (const row of parsed.rows) {
        const sid = (row.seat && seatMap[row.seat]) || (row.name && nameMap[row.name])
        if (!sid) { out.push(`⚠ 第 ${row.line} 列（座號 ${row.seat || '—'} ${row.name || ''}）找不到學生，略過`); miss++; continue }
        row.values.forEach((v) => {
          const sub = byName[v.subject]
          if (sub) cells.push({ student_id: sid, subject_id: sub.id, score: v.score })
        })
      }
      if (!cells.length) { out.push('❌ 沒有可寫入的分數'); setLog([...out]); setInfo('❌ 匯入中止'); setBusy(false); return }

      const d = await rpc('api_score_bulk', { p_exam: targetExam, p_cells: cells })
      if (!d?.success) { out.push('❌ ' + (d?.message || '寫入失敗')) }
      else {
        out.push(`✅ 已寫入 ${d.updated} 格`)
        if (d.errors?.length) out.push(...d.errors.map((e) => '⚠ ' + e))
      }
      setLog([...out])
      setParsed(null)
      const exName = isNew ? newName.trim() : (exams.find((e) => e.id === examId)?.name || '')
      setInfo(`完成（${exName}）：寫入 ${d?.updated ?? 0} 格${miss ? `，${miss} 列跳過` : ''}`)
      onDone?.(targetExam)
    } catch (err) {
      setInfo('❌ ' + err.message)
    }
    setBusy(false)
  }

  return (
    <div>
      <p className="hint">
        支援 Excel(.xlsx/.xls) 與 CSV。表頭第一列：座號、姓名、之後每欄一個科目；科目欄可寫權重如「國文*5」，未寫則沿用現有或預設 1。
      </p>
      <div className="row">
        <div>
          <label>匯入到考試</label>
          <select value={examId} onChange={(e) => setExamId(e.target.value)} style={{ minWidth: 220 }}>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            <option value={NEW}>＋ 新增考試…</option>
          </select>
        </div>
        {isNew && (
          <div>
            <label>新考試名稱</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：二上二段" />
          </div>
        )}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div><label>&nbsp;</label><input type="file" accept=".csv,.xlsx,.xls" onChange={pick} disabled={busy} /></div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={template}>下載範本</button></div>
        {parsed && (
          <div><label>&nbsp;</label><button className="btn-p" onClick={run} disabled={busy}>{busy ? '匯入中…' : '開始匯入'}</button></div>
        )}
      </div>
      {fileName && <div className="hint">已選檔案：{fileName}</div>}
      {info && <div className="info">{info}</div>}

      {parsed && (
        <>
          <p className="hint" style={{ marginTop: 6 }}>
            科目：{parsed.subjects.map((s) => `${s.name}${s.weight != null ? `(*${s.weight})` : ''}`).join('、')}
            {parsed.ignored.length ? `　｜略過欄位：${parsed.ignored.join('、')}` : ''}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="sub" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>列</th><th>座號</th><th>姓名</th>{parsed.subjects.map((s) => <th key={s.ci}>{s.name}</th>)}</tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 8).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td><td>{r.seat}</td><td>{r.name}</td>
                    {parsed.subjects.map((s) => {
                      const v = r.values.find((x) => x.subject === s.name)
                      return <td key={s.ci} style={{ textAlign: 'center' }}>{v ? v.score : ''}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 8 && <p className="hint">…僅預覽前 8 列，共 {parsed.rows.length} 列</p>}
          </div>
        </>
      )}
      {log.length > 0 && (
        <div className="info" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{log.join('\n')}</div>
      )}
    </div>
  )
}
