import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_CLASS } from '../lib/config'
import { parseTable, mapStudents } from '../lib/tabular'
import { downloadCsv } from '../lib/csvTemplate'

const FIELD_LABEL = { account: '學號/帳號', seat: '座號', name: '姓名' }

// 學生名冊批次匯入（Excel / CSV）
// 支援欄位：座號、姓名、學號(=帳號)、身分證字號(=密碼)、班級、測試
export default function ImportStudents({ onDone, defaultClass }) {
  const [records, setRecords] = useState(null)
  const [fileName, setFileName] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState('')
  const [log, setLog] = useState([])

  function template() {
    downloadCsv('學生名冊範本', [
      ['座號', '姓名', '學號', '身分證字號', '班級'],
      ['1', '王小明', '1421101', 'A123456789', DEFAULT_CLASS || '1421'],
    ])
  }

  async function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name); setInfo(''); setLog([]); setRecords(null); setProg('')
    try {
      const table = await parseTable(f)
      const m = mapStudents(table)
      if (m.missing) {
        setInfo('❌ 表頭缺少必要欄位：' + m.missing.map((k) => FIELD_LABEL[k]).join('、'))
        return
      }
      if (!m.records.length) { setInfo('❌ 找不到資料列'); return }
      setRecords(m.records)
      const need = m.records.filter((r) => !r.password).length
      setInfo(
        `讀取 ${m.records.length} 筆` +
        (need ? `（${need} 筆沒填密碼，只有新增的學生才需要）` : '') +
        '，確認後按「開始匯入」。',
      )
    } catch (err) {
      setInfo('❌ 檔案解析失敗：' + err.message)
    }
  }

  async function run() {
    if (!records?.length) return
    setBusy(true); setInfo(''); setLog([])
    const out = []
    let ok = 0, fail = 0
    const cls = (defaultClass ?? DEFAULT_CLASS ?? '').trim()
    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      setProg(`${i + 1}/${records.length}`)
      if (!r.account || !r.seat || !r.name) {
        out.push(`⚠ 第 ${r.line} 列缺 學號/座號/姓名，略過`); fail++; setLog([...out]); continue
      }
      const { data, error } = await supabase.functions.invoke('admin', {
        body: {
          action: 'upsert_student', account: r.account, password: r.password,
          seat: r.seat, name: r.name, class_no: r.class_no || cls, excluded: r.excluded,
        },
      })
      if (error || !data?.success) {
        out.push(`❌ ${r.seat} ${r.name}：${error?.message || data?.message || '失敗'}`); fail++
      } else ok++
      setLog([...out])
    }
    setBusy(false); setProg('')
    setInfo(`完成：成功 ${ok} 筆，失敗 ${fail} 筆`)
    setRecords(null)
    onDone?.()
  }

  return (
    <div>
      <p className="hint">
        支援 Excel(.xlsx/.xls) 與 CSV，一次匯入整班，不必一筆一筆輸入。
        表頭可為：<b>座號 / 姓名 / 學號 / 身分證字號</b>（學號會作為登入帳號、身分證字號作為登入密碼），
        也接受「帳號 / 密碼 / 班級 / 測試」等寫法。
        帳號已存在＝更新該生資料，密碼留空＝不改密碼。
      </p>
      <div className="warn-box" style={{ marginBottom: 8 }}>
        檔案只在你的瀏覽器解析，不會上傳到伺服器。但檔案含有身分證字號，請勿外流。
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <div><label>&nbsp;</label><input type="file" accept=".csv,.xlsx,.xls" onChange={pick} disabled={busy} /></div>
        <div><label>&nbsp;</label><button className="btn-g" onClick={template}>下載範本</button></div>
        {records?.length > 0 && (
          <div><label>&nbsp;</label><button className="btn-p" onClick={run} disabled={busy}>{busy ? `匯入中 ${prog}` : `開始匯入 ${records.length} 筆`}</button></div>
        )}
      </div>
      {fileName && <div className="hint">已選檔案：{fileName}</div>}
      {info && <div className="info">{info}</div>}
      {records?.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="sub" style={{ marginTop: 8 }}>
            <thead><tr><th>列</th><th>座號</th><th>姓名</th><th>學號/帳號</th><th>班級</th><th>密碼</th><th>測試</th></tr></thead>
            <tbody>
              {records.slice(0, 10).map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td><td>{r.seat}</td><td>{r.name}</td><td>{r.account}</td>
                  <td>{r.class_no || '（沿用目前班級）'}</td>
                  <td>{r.password ? '●●●●' : '（不改）'}</td>
                  <td>{r.excluded ? '是' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 10 && <p className="hint">…僅預覽前 10 筆，共 {records.length} 筆</p>}
        </div>
      )}
      {log.length > 0 && (
        <div className="info" style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{log.join('\n')}</div>
      )}
    </div>
  )
}