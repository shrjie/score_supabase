#!/usr/bin/env python3
"""班級成績查詢系統 — 資料庫備份工具

把 Supabase 專案的所有 public schema 資料表匯出成：
  - 一份可直接還原的 SQL（delete + insert）
  - 一份 JSON（方便人工檢視或轉換）

用法（憑證不會寫進檔案，從環境變數或 ~/.supabase-access-token 讀取）：
  export SUPABASE_ACCESS_TOKEN=sbp_xxx
  export SUPABASE_PROJECT_REF=ufsbtxlqbhaxaavxpozo
  python3 scripts/backup-db.py

或只給專案 ref（token 放 ~/.supabase-access-token）：
  python3 scripts/backup-db.py ufsbtxlqbhaxaavxpozo

備份預設寫到 ~/grade-query-backup/，只保留最近 10 份。
注意：備份含有學生個資，請勿提交到 git（尤其本 repo 是公開的）。
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN") or (
    open(os.path.expanduser("~/.supabase-access-token")).read().strip()
    if os.path.exists(os.path.expanduser("~/.supabase-access-token"))
    else ""
)
REF = os.environ.get("SUPABASE_PROJECT_REF") or (sys.argv[1] if len(sys.argv) > 1 else "")
OUT_DIR = os.environ.get("BACKUP_DIR") or os.path.expanduser("~/grade-query-backup")
KEEP = 10

if not TOKEN or not REF:
    sys.exit("需要 SUPABASE_ACCESS_TOKEN 與 SUPABASE_PROJECT_REF（或用引數傳入 project ref）")


def query(sql: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=180).read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"查詢失敗：{e.read().decode()[:300]}")


def literal(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


tables = [
    list(t.values())[0]
    for t in query(
        "select table_name from information_schema.tables "
        "where table_schema='public' and table_type='BASE TABLE' order by table_name"
    )
]

now = datetime.datetime.now()
stamp = now.strftime("%Y%m%d-%H%M%S")
os.makedirs(OUT_DIR, exist_ok=True)

sql = [
    "-- 班級成績查詢系統 完整資料備份",
    f"-- 產生時間: {now:%Y-%m-%d %H:%M:%S}",
    f"-- 專案 ref: {REF}",
    "-- 含學生個資，請妥善保管",
    "",
    "begin;",
]
payload = {}
total = 0

for t in tables:
    rows = query(f'select * from public."{t}"')
    payload[t] = rows
    total += len(rows)
    print(f"  {t:14} {len(rows)} 列")
    if not rows:
        continue
    cols = list(rows[0].keys())
    sql.append(f"\n-- ===== {t} ({len(rows)} 列) =====")
    sql.append(f"delete from public.{t};")
    for r in rows:
        sql.append(
            f"insert into public.{t} ({','.join(cols)}) values "
            f"({','.join(literal(r[c]) for c in cols)});"
        )
sql.append("\ncommit;")

sql_path = os.path.join(OUT_DIR, f"backup-{stamp}.sql")
json_path = os.path.join(OUT_DIR, f"backup-{stamp}.json")
open(sql_path, "w", encoding="utf-8").write("\n".join(sql))
open(json_path, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=1, default=str))

files = sorted(f for f in os.listdir(OUT_DIR) if f.startswith("backup-"))
for f in files[:-KEEP]:
    os.remove(os.path.join(OUT_DIR, f))

print(f"\n合計 {total} 列 → {OUT_DIR}")
print(f"SQL {os.path.getsize(sql_path):,} bytes / JSON {os.path.getsize(json_path):,} bytes")
