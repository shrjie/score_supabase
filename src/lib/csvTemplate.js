export function downloadCsv(name, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const text = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
