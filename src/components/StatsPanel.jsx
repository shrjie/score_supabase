import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { rpc } from '../lib/supabase'
import { useTitle } from '../lib/title'

const BANDS = [
  ['g90', '90+', '#1b5e20'],
  ['g80', '80-89', '#66bb6a'],
  ['g70', '70-79', '#ffca28'],
  ['g60', '60-69', '#ff9800'],
  ['g0', '未滿60', '#e53935'],
]

function summaryVal(st, name) {
  const it = (st.summary || []).find((x) => x.name === name)
  return it ? it.value : null
}

export default function StatsPanel() {
  const { title } = useTitle()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [slips, setSlips] = useState(null)
  const [trend, setTrend] = useState([])
  const [info, setInfo] = useState('')

  useEffect(() => {
    rpc('api_teacher_exams').then((l) => {
      const arr = Array.isArray(l) ? l : []
      setExams(arr)
      if (arr.length) setExamId(arr[0].id)
    })
  }, [])

  useEffect(() => {
    if (!examId) return
    setInfo('載入中…')
    rpc('api_class_slips', { p_exam: examId }).then((d) => {
      if (d?.success) { setSlips(d); setInfo('') }
      else { setSlips(null); setInfo('❌ ' + (d?.message || '載入失敗')) }
    })
  }, [examId])

  const loadTrend = useCallback(async (list) => {
    if (!list.length) return
    const results = []
    for (const e of list) {
      const rows = await rpc('api_class_stats', { p_exam: e.id })
      results.push({ name: e.name, rows: Array.isArray(rows) ? rows : [] })
    }
    const subjectNames = [...new Set(results.flatMap((r) => r.rows.map((x) => x.name)))]
    const data = results.map((r) => {
      const o = { name: r.name.replace(/^[^-]*-/, '') || r.name }
      r.rows.forEach((x) => { if (x.avg != null) o[x.name] = Number(x.avg) })
      return o
    })
    setTrend({ data, subjectNames })
  }, [])

  useEffect(() => { if (exams.length) loadTrend(exams) }, [exams, loadTrend])

  const students = useMemo(() => (slips?.students || []).filter((s) => !s.excluded), [slips])
  const stats = slips?.stats || []

  const histogram = useMemo(() => {
    const totals = students.map((s) => Number(summaryVal(s, '總分'))).filter((v) => isFinite(v))
    if (!totals.length) return []
    const size = 50
    const lo = Math.floor(Math.min(...totals) / size) * size
    const hi = Math.max(...totals)
    const bins = []
    for (let b = lo; b <= hi; b += size) bins.push({ range: `${b}~${b + size - 1}`, 人數: 0 })
    totals.forEach((v) => {
      let i = Math.floor((v - lo) / size)
      if (i < 0) i = 0
      if (i >= bins.length) i = bins.length - 1
      bins[i].人數++
    })
    return bins
  }, [students])

  const bandData = useMemo(
    () => stats.map((s) => ({
      name: s.name, '90+': s.g90, '80-89': s.g80, '70-79': s.g70, '60-69': s.g60, '未滿60': s.g0,
    })),
    [stats],
  )

  const avgData = useMemo(
    () => stats.map((s) => ({ name: s.name, 平均: s.avg, 最高: s.max, 最低: s.min })),
    [stats],
  )

  const movement = useMemo(() => {
    const list = students
      .map((s) => ({ name: `${s.seat} ${s.name}`, d: summaryVal(s, '進退步'), rank: summaryVal(s, '班名次') }))
      .filter((x) => x.d != null)
    return {
      up: [...list].sort((a, b) => b.d - a.d).slice(0, 5),
      down: [...list].sort((a, b) => a.d - b.d).slice(0, 5),
    }
  }, [students])

  const kpi = useMemo(() => {
    const totals = students.map((s) => Number(summaryVal(s, '總分'))).filter((v) => isFinite(v))
    const avgs = students.map((s) => Number(summaryVal(s, '平均'))).filter((v) => isFinite(v))
    const sum = totals.reduce((a, b) => a + b, 0)
    return {
      n: students.length,
      avgTotal: totals.length ? (sum / totals.length).toFixed(1) : '—',
      avg: avgs.length ? (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : '—',
      max: totals.length ? Math.max(...totals) : '—',
      min: totals.length ? Math.min(...totals) : '—',
    }
  }, [students])

  return (
    <div className="card">
      <div className="row">
        <div>
          <label>考試</label>
          <select value={examId} onChange={(e) => setExamId(e.target.value)} style={{ minWidth: 260 }}>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <span className="hint">統計不含測試帳；{title}</span>
      </div>
      {info && <div className="info">{info}</div>}

      {slips && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="kpi-v">{kpi.n}</div><div className="kpi-l">到考人數</div></div>
            <div className="kpi"><div className="kpi-v">{kpi.avgTotal}</div><div className="kpi-l">總分平均</div></div>
            <div className="kpi"><div className="kpi-v">{kpi.avg}</div><div className="kpi-l">平均平均</div></div>
            <div className="kpi"><div className="kpi-v">{kpi.max}</div><div className="kpi-l">總分最高</div></div>
            <div className="kpi"><div className="kpi-v">{kpi.min}</div><div className="kpi-l">總分最低</div></div>
          </div>

          <h3 style={{ marginTop: 18 }}>總分分佈</h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={histogram} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="人數" fill="#3f51b5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 style={{ marginTop: 18 }}>各科成績級距（人數）</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={bandData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Legend />
                {BANDS.map(([k, label, color]) => (
                  <Bar key={k} dataKey={label} stackId="a" fill={color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 style={{ marginTop: 18 }}>各科平均 / 最高 / 最低</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={avgData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="平均" fill="#3f51b5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="最高" fill="#66bb6a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="最低" fill="#e53935" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {trend.data?.length > 1 && (
            <>
              <h3 style={{ marginTop: 18 }}>各科平均走勢（跨考試）</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={trend.data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    {trend.subjectNames.map((s, i) => (
                      <Line key={s} type="monotone" dataKey={s} stroke={['#3f51b5', '#e53935', '#66bb6a', '#ff9800', '#8e24aa', '#00838f'][i % 6]} connectNulls dot />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <h3 style={{ marginTop: 18 }}>進步 / 退步（與前次比較）</h3>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <table className="sub">
                <thead><tr><th>班級</th><th>進步</th></tr></thead>
                <tbody>
                  {movement.up.map((x) => <tr key={x.name}><td>{x.name}</td><td style={{ color: '#2e7d32' }}>+{x.d}</td></tr>)}
                  {!movement.up.length && <tr><td colSpan={2}>無資料</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <table className="sub">
                <thead><tr><th>班級</th><th>退步</th></tr></thead>
                <tbody>
                  {movement.down.map((x) => <tr key={x.name}><td>{x.name}</td><td style={{ color: x.d < 0 ? '#c62828' : '#666' }}>{x.d > 0 ? '+' : ''}{x.d}</td></tr>)}
                  {!movement.down.length && <tr><td colSpan={2}>無資料</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
