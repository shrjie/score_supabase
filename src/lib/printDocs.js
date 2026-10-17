// 產生列印用 HTML（獨立文件，開啟新視窗後自動列印）

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function fmt2(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return String(Math.round(n * 100) / 100)
}

export function openPrintWindow(html) {
  const w = window.open('', '_blank')
  if (!w) {
    alert('瀏覽器阻擋了彈出視窗，請允許後再試')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

const REPORT_CSS = `body{font-family:sans-serif;color:#000;margin:8mm}
h2{font-size:18px;text-align:center;margin-bottom:2px}
.rp-sub{text-align:center;font-size:11px;margin-bottom:6px}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1px solid #333;padding:2px 3px;font-size:9.5px;text-align:center;white-space:nowrap;overflow:hidden}
th{background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
td.name{text-align:left}td.fail{color:#c00;font-weight:900}
tr.test td{background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rp-foot{font-size:10px;margin-top:6px}h3{font-size:14px;text-align:center;margin:10px 0 4px}
table.compact th,table.compact td{font-size:8.5px;padding:2px 2px}`

const SLIP_CSS = `body{font-family:sans-serif;color:#000;margin:10mm}
h2{font-size:17px;text-align:center;margin-bottom:1px}
.sl-sub{text-align:center;font-size:11px;margin-bottom:3px}
.sl-info{display:flex;gap:24px;justify-content:center;font-size:12px;margin:6px 0;border-top:2px solid #333;border-bottom:1px solid #333;padding:4px 0}
table{border-collapse:collapse;width:100%;margin-top:4px}
th,td{border:1px solid #333;padding:5px 10px;font-size:13px;text-align:center}
table.scores th,table.scores td{font-size:10.5px;padding:2px 10px}
td.sub{text-align:left}td.fail{color:#c00;font-weight:900}td.pass{color:#1565c0;font-weight:700}
.sl-foot{font-size:10px;margin-top:4px}h3{font-size:13px;text-align:center;margin:8px 0 3px}
svg.trend{width:100%;height:auto;display:block}
table.compact th,table.compact td{font-size:8.5px;padding:2px 2px}
.slip{page-break-after:always}.slip:last-child{page-break-after:auto}`

function statsTable(rows) {
  if (!rows?.length) return ''
  let h = '<table class="compact"><thead><tr><th>科目</th><th>人數</th><th>平均</th><th>最高</th><th>最低</th><th>及格率%</th><th>90+</th><th>80-89</th><th>70-79</th><th>60-69</th><th>&lt;60</th></tr></thead><tbody>'
  rows.forEach((r) => {
    if (r.n) {
      h += `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.avg}</td><td>${r.max}</td><td>${r.min}</td><td>${r.rate}</td><td>${r.g90}</td><td>${r.g80}</td><td>${r.g70}</td><td>${r.g60}</td><td>${r.g0}</td></tr>`
    } else {
      h += `<tr><td>${esc(r.name)}</td><td colspan="10">—</td></tr>`
    }
  })
  return h + '</tbody></table>'
}

function isAvgName(name) {
  return String(name || '').includes('平均')
}
function isDerivedName(name) {
  return /排名|名次|總分|平均|進退步|前名次/.test(String(name || ''))
}

// 全班總表（座號/姓名/各科 + 全班統計）
export function buildReportHTML({ title, examName, students, subjects, scores, stats }) {
  const d = new Date()
  const ds = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  const head = ['座號', '姓名', ...subjects.map((s) => s.name)]
  let html = `<h2>${esc(title)}總表 — ${esc(examName)}</h2>`
  html += `<div class="rp-sub">列印日期：${ds}　共 ${students.length} 人（未滿 60 分紅字標示）</div>`
  html += '<table><thead><tr>'
  head.forEach((h) => { html += `<th>${esc(h)}</th>` })
  html += '</tr></thead><tbody>'
  students.forEach((st) => {
    html += `<tr${st.excluded ? ' class="test"' : ''}><td>${esc(st.seat)}</td><td class="name">${esc(st.name)}${st.excluded ? '（測）' : ''}</td>`
    subjects.forEach((sub) => {
      const v = scores[`${st.id}_${sub.id}`]
      const num = Number(v)
      const fail = !isDerivedName(sub.name) && !isAvgName(sub.name) && v !== null && v !== undefined && v !== '' && num < 60
      let out = v === null || v === undefined || v === '' ? '' : v
      if (isAvgName(sub.name) && isFinite(num)) out = Math.round(num * 100) / 100
      html += `<td${fail ? ' class="fail"' : ''}>${esc(out)}</td>`
    })
    html += '</tr>'
  })
  html += '</tbody></table>'
  if (stats?.length) html += `<h3>全班統計</h3>${statsTable(stats)}`
  html += '<div class="rp-foot">※ 總分、平均、排名、前名次、進退步由系統自動計算。</div>'
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>成績總表</title><style>${REPORT_CSS}</style></head><body onload="window.print()">${html}</body></html>`
}

// 走勢 SVG（伺服器原版邏輯移植）
export function trendSVG(pts) {
  const use = (pts || []).filter((p) => (p.average !== null && p.average !== undefined) || (p.rank !== null && p.rank !== undefined))
  if (!use.length) return ''
  const W = 700, H = 300, padL = 56, padR = 48, padT = 20, padB = 48
  const avgs = use.map((p) => p.average).filter((v) => v !== null && v !== undefined)
  const ranks = use.map((p) => p.rank).filter((v) => v !== null && v !== undefined)
  let aMin = avgs.length ? Math.min(...avgs) : 0
  let aMax = avgs.length ? Math.max(...avgs) : 100
  if (aMin === aMax) { aMin -= 5; aMax += 5 }
  const rMax = ranks.length ? Math.max(...ranks, 1) : 1
  const X = (i) => padL + (W - padL - padR) * (use.length === 1 ? 0.5 : i / (use.length - 1))
  const YA = (v) => padT + (H - padT - padB) * (1 - (v - aMin) / (aMax - aMin))
  const YR = (v) => padT + (H - padT - padB) * ((v - 1) / ((rMax - 1) || 1))
  const F = (n) => Math.round(Number(n) * 100) / 100
  let s = ''
  for (let g = 0; g <= 4; g++) {
    const y = F(padT + (H - padT - padB) * g / 4)
    s += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#cfe6d4"/>`
    s += `<text x="2" y="${F(y + 4)}" font-size="12" fill="#1565c0">${F(aMax - (aMax - aMin) * g / 4).toFixed(1)}</text>`
    s += `<text x="${W - padR + 9}" y="${F(y + 4)}" font-size="12" fill="#d81b60">${Math.round(1 + (rMax - 1) * g / 4)}</text>`
  }
  s += `<line x1="${padL}" y1="${padT - 8}" x2="${padL}" y2="${H - padB}" stroke="#1f3a2d" stroke-width="2"/>`
  s += `<line x1="${W - padR}" y1="${padT - 8}" x2="${W - padR}" y2="${H - padB}" stroke="#1f3a2d" stroke-width="2"/>`
  s += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR + 8}" y2="${H - padB}" stroke="#1f3a2d" stroke-width="2"/>`
  use.forEach((p, i) => {
    const x = F(X(i))
    s += `<text x="${x}" y="${H - padB + 24}" font-size="13" fill="#1f3a2d" text-anchor="middle">${esc(p.exam_name || '')}</text>`
  })
  s += `<text x="${padL + 8}" y="14" font-size="12" font-weight="bold" fill="#1565c0">● 平均</text>`
  s += `<text x="${padL + 72}" y="14" font-size="12" font-weight="bold" fill="#d81b60">● 班名次</text>`
  const path = (key, Y, color) => {
    let dd = '', dots = ''
    use.forEach((p, i) => {
      const v = p[key]
      if (v === null || v === undefined) return
      const x = F(X(i)), y = F(Y(v))
      dd += (dd ? 'L' : 'M') + x + ' ' + y
      dots += `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}"/>`
    })
    return dd ? `<path d="${dd}" fill="none" stroke="${color}" stroke-width="3"/>${dots}` : ''
  }
  if (avgs.length) s += path('average', YA, '#1565c0')
  if (ranks.length) s += path('rank', YR, '#d81b60')
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`
}

// 全班個人成績單
export function buildSlipsHTML({ title, examName, slips, stats }) {
  const d = new Date()
  const ds = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  const statsHTML = stats?.length ? `<h3>全班統計</h3>${statsTable(stats)}` : ''
  const parts = slips.map((stu) => {
    let subRows = ''
    ;(stu.subjects || []).forEach((s) => {
      const v = s.score === null || s.score === undefined || s.score === '' ? '—' : String(s.score)
      const n = parseFloat(v)
      const cls = !isNaN(n) && v !== '—' ? (n >= 60 ? 'pass' : 'fail') : ''
      const rk = s.rank === null || s.rank === undefined || s.rank === '' ? '—' : String(s.rank)
      subRows += `<tr><td class="sub">${esc(s.name)}</td><td class="${cls}">${esc(v)}</td><td>${esc(rk)}</td></tr>`
    })
    let sumRows = ''
    ;(stu.summary || []).forEach((s) => {
      sumRows += `<tr><td class="sub">${esc(s.name)}</td><td>${esc(fmt2(s.value))}</td></tr>`
    })
    let trendHTML = ''
    const tb = (stu.trend || []).filter((p) => p.average != null || p.rank != null)
    if (tb.length) {
      const ths = tb.map((p) => `<th>${esc(p.exam_name || '')}</th>`).join('')
      const tdsAvg = tb.map((p) => `<td>${fmt2(p.average)}</td>`).join('')
      const tdsRank = tb.map((p) => `<td>${fmt2(p.rank)}</td>`).join('')
      trendHTML = `<h3>歷次走勢</h3>${trendSVG(tb)}<table class="compact" style="margin-top:6px"><thead><tr><th></th>${ths}</tr></thead><tbody><tr><td>平均</td>${tdsAvg}</tr><tr><td>班名次</td>${tdsRank}</tr></tbody></table>`
    }
    return `<div class="slip">
<h2>${esc(title)}個人成績單</h2>
<div class="sl-sub">${esc(examName)}　列印日期：${ds}</div>
<div class="sl-info"><span>班級：${esc(stu.class_no || '')}</span><span>座號：${esc(stu.seat || '')}</span><span>姓名：${esc(stu.name || '')}${stu.excluded ? '（測）' : ''}</span><span>平均：${esc(fmt2(stu.average))}</span></div>
<table class="scores"><thead><tr><th>科目</th><th>分數</th><th>排名</th></tr></thead><tbody>${subRows}</tbody></table>
<h3>總分與名次</h3><table class="scores"><thead><tr><th>項目</th><th>內容</th></tr></thead><tbody>${sumRows}</tbody></table>
${statsHTML}${trendHTML}
<div class="sl-foot">※ 未滿 60 分以紅字標示。總分、平均、排名由系統自動計算。</div>
</div>`
  })
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>全班個人成績單</title><style>${SLIP_CSS}</style></head><body onload="window.print()">${parts.join('')}</body></html>`
}
