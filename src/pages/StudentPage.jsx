import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useTitle } from '../lib/title'

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return String(Math.round(n * 100) / 100)
}

function classStatsTable(rows) {
  if (!rows?.length) return null
  return (
    <table className="data compact">
      <thead>
        <tr>
          <th>科目</th><th>人數</th><th>平均</th><th>最高</th><th>最低</th>
          <th>及格率%</th><th>90+</th><th>80-89</th><th>70-79</th><th>60-69</th><th>&lt;60</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            {r.n ? (
              <>
                <td>{r.n}</td><td>{r.avg}</td><td>{r.max}</td><td>{r.min}</td>
                <td>{r.rate}</td><td>{r.g90}</td><td>{r.g80}</td><td>{r.g70}</td><td>{r.g60}</td><td>{r.g0}</td>
              </>
            ) : (
              <td colSpan={10}>—</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function StudentPage() {
  const { title } = useTitle()
  const { me, session, signInStudent, signOut } = useAuth()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [result, setResult] = useState(null)
  const [trend, setTrend] = useState([])
  const [stats, setStats] = useState([])

  useEffect(() => {
    if (!me?.success) return
    rpc('api_exams').then((list) => setExams(Array.isArray(list) ? list : []))
    rpc('api_student_trend').then((t) => setTrend(Array.isArray(t) ? t : []))
  }, [me])

  useEffect(() => {
    if (!me?.success || !examId) {
      setResult(null)
      setStats([])
      return
    }
    let active = true
    rpc('api_student_result', { p_exam: examId }).then((d) => {
      if (active && d?.success) setResult(d)
    })
    rpc('api_class_stats', { p_exam: examId }).then((d) => {
      if (active) setStats(Array.isArray(d) ? d : [])
    })
    return () => {
      active = false
    }
  }, [me, examId])

  async function doLogin() {
    setErr('')
    if (!account.trim() || !password) {
      setErr('請輸入帳號密碼')
      return
    }
    setBusy(true)
    const d = await signInStudent(account, password)
    if (!d.success) setErr(d.message)
    setBusy(false)
  }

  const curExam = useMemo(() => exams.find((e) => e.id === examId), [exams, examId])

  const avgV = useMemo(() => {
    if (!result) return null
    const a = result.summary?.find((s) => s.name === '平均')
    return a?.value ?? result.average ?? null
  }, [result])

  function printSlip() {
    if (!result || !me?.student) return
    const rows = (result.subjects || [])
      .map((s) => {
        const v = s.score === null || s.score === undefined || s.score === '' ? '—' : String(s.score)
        const n = parseFloat(v)
        const cls = !isNaN(n) && v !== '—' ? (n >= 60 ? 'pass' : 'fail') : ''
        const rk = s.rank === null || s.rank === undefined || s.rank === '' ? '—' : String(s.rank)
        return `<tr><td class="sub">${s.name}</td><td class="${cls}">${v}</td><td>${rk}</td></tr>`
      })
      .join('')
    const sumRows = (result.summary || [])
      .map((s) => `<tr><td class="sub">${s.name}</td><td>${fmtNum(s.value)}</td></tr>`)
      .join('')
    const d = new Date()
    const ds = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
    const st = me.student
    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>個人成績單</title>
<style>body{font-family:sans-serif;color:#000;margin:10mm}h2{font-size:18px;text-align:center}
.sl-sub{text-align:center;font-size:12px;margin-bottom:8px}
.sl-info{display:flex;gap:24px;justify-content:center;font-size:13px;margin:8px 0;border-top:2px solid #333;border-bottom:1px solid #333;padding:6px 0}
table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #333;padding:5px 10px;font-size:13px;text-align:center}
td.sub{text-align:left}td.fail{color:#c00;font-weight:900}td.pass{color:#1565c0;font-weight:700}</style>
</head><body onload="window.print()">
<h2>${title}個人成績單</h2>
<div class="sl-sub">${result.exam}　列印日期：${ds}</div>
<div class="sl-info"><span>班級：${st.classNo || ''}</span><span>座號：${st.seat || ''}</span><span>姓名：${st.name || ''}</span><span>平均：${fmtNum(avgV)}</span></div>
<table><thead><tr><th>科目</th><th>分數</th><th>排名</th></tr></thead><tbody>${rows}</tbody></table>
<h3 style="text-align:center;margin-top:12px">總分與名次</h3>
<table><thead><tr><th>項目</th><th>內容</th></tr></thead><tbody>${sumRows}</tbody></table>
<div style="font-size:11px;margin-top:8px">※ 未滿 60 分以紅字標示。總分、平均、排名由系統自動計算。</div>
</body></html>`
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
  }

  if (!session || !me?.success) {
    return (
      <div className="app student">
        <header>
          <div className="header-inner">
            <div />
            <div className="brand">
              <div className="logo">福</div>
              <h1>
                <span className="sys-title">{title}</span>
                <span className="sub">Grade Inquiry System</span>
              </h1>
            </div>
            <div />
          </div>
        </header>
        <main>
          <div className="glass card">
            <div className="card-title">學生登入</div>
            <div className="form-group">
              <label>帳號</label>
              <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="請輸入帳號" />
            </div>
            <div className="form-group">
              <label>密碼</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                placeholder="請輸入密碼"
              />
            </div>
            <button className="btn-primary" disabled={busy} onClick={doLogin}>
              {busy ? '驗證中…' : '登 入'}
            </button>
            {err && <div className="msg-error">{err}</div>}
            <div className="top-link">
              <Link to="/teacher">老師編修入口 →</Link>
            </div>
          </div>
        </main>
        <footer>程式設計：3C不正師</footer>
      </div>
    )
  }

  const st = me.student
  return (
    <div className="app student">
      <header>
        <div className="header-inner">
          <div />
          <div className="brand">
            <div className="logo">福</div>
            <h1>
              <span className="sys-title">{title}</span>
              <span className="sub">Grade Inquiry System</span>
            </h1>
          </div>
          <div className="right">
            <button className="btn-ghost" onClick={signOut}>登出</button>
          </div>
        </div>
      </header>
      <main>
        <div className="glass banner">
          <div><span className="info-label">座號</span> <span className="info-value">{st.seat || '—'}</span></div>
          <div><span className="info-label">姓名</span> <span className="info-value">{st.name || '—'}</span></div>
          <div><span className="info-label">平均</span> <span className="info-value">{fmtNum(avgV)}</span></div>
        </div>

        <div className="glass exam-selector">
          <div className="form-group" style={{ margin: 0 }}>
            <label>選擇考試</label>
            <select value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">-- 請選擇 --</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        </div>

        {result && (
          <>
            <div className="glass">
              <div className="table-header">📋 {result.exam}</div>
              <table className="data">
                <thead><tr><th>科目</th><th>分數</th><th>排名</th></tr></thead>
                <tbody>
                  {(result.subjects || []).map((s) => {
                    const v = s.score === null || s.score === undefined || s.score === '' ? '—' : String(s.score)
                    const n = parseFloat(v)
                    const isNum = !isNaN(n) && v !== '—'
                    return (
                      <tr key={s.name} className={isNum && n < 60 ? 'fail-row' : ''}>
                        <td>{s.name}</td>
                        <td className={isNum ? (n >= 60 ? 'pass' : 'fail') : ''}>{v}</td>
                        <td>{s.rank === null || s.rank === undefined ? '—' : s.rank}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {result.summary?.length > 0 && (
              <div className="glass" style={{ marginTop: 16 }}>
                <div className="table-header">總分與名次</div>
                <table className="data">
                  <thead><tr><th>項目</th><th>內容</th></tr></thead>
                  <tbody>
                    {result.summary.map((s) => (
                      <tr key={s.name}><td>{s.name}</td><td>{fmtNum(s.value)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {result && result.subjects?.length >= 3 && (
          <div className="glass chart-card">
            <div className="card-title">各科雷達圖</div>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={result.subjects.map((s) => ({ name: s.name, value: Number(s.score) || 0 }))}>
                <PolarGrid />
                <PolarAngleAxis dataKey="name" />
                <PolarRadiusAxis domain={[0, 100]} />
                <Radar dataKey="value" stroke="#2e7d32" fill="#66bb6a" fillOpacity={0.45} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="hint">滿分 100 分（僅螢幕顯示，不列印）</div>
          </div>
        )}

        {stats.length > 0 && (
          <div className="glass chart-card">
            <div className="card-title">全班統計</div>
            <div style={{ overflowX: 'auto' }}>{classStatsTable(stats)}</div>
          </div>
        )}

        {trend.length > 0 && (
          <div className="glass chart-card">
            <div className="card-title">歷次走勢</div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trend.map((p) => ({ ...p, name: p.exam_name }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" reversed />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="average" name="平均" stroke="#1565c0" connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="rank" name="班名次" stroke="#d81b60" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {result && (
          <div className="print-row">
            <button className="btn-print" onClick={printSlip}>列印個人成績單</button>
          </div>
        )}
      </main>
      <footer>程式設計：3C不正師</footer>
    </div>
  )
}
