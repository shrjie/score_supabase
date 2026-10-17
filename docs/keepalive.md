# 資料庫保活與備份

Supabase **免費方案**的專案若連續 7 天活動過低會被**自動暫停**（paused），網站會離線。
本專案已設定兩層保險，並有自動備份。

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 專案 ref | `ufsbtxlqbhaxaavxpozo`（grade-query） |
| 方案 | Free（會被暫停） |
| 保活 1：資料庫內建 `pg_cron`+`pg_net` | ✅ 已啟用，每天 2 次（UTC 02:23 / 13:47） |
| 保活 2：GitHub Actions 外部排程 | ✅ 已啟用，每天 2 次（UTC 03:10 / 15:10） |
| 自動備份 | ✅ 每次排程產生 `schema.sql` + `data.sql`（artifact，保留 30 天） |
| 本機備份 | ✅ `~/grade-query-backup/`（保留最近 10 份） |

## 保活機制

**第一層（資料庫內）** — 用 `pg_cron` 排程 + `pg_net` 對自己的 REST API 發請求。

```sql
-- 查看排程
select jobname, schedule, active from cron.job where jobname like 'keepalive%';

-- 確認真的有在跑
select ran_at, status_code from ops.keepalive_log order by ran_at desc limit 10;
```

**第二層（GitHub Actions，外部流量）** — `.github/workflows/keepalive-backup.yml`

- 每天兩次 `curl` Supabase REST API，若非 200 則 job 失敗（會通知）
- 同時產生備份 artifact

檢視執行狀態：<https://github.com/shrjie/score_supabase/actions>

> 若 GitHub 顯示排程沒跑，通常是 repo 閒置超過 60 天自動停用排程，重新手動執行一次即可恢復。

## 需要的 GitHub Secrets

Settings → Secrets and variables → Actions（已設定好）：

| 名稱 | 內容 |
|---|---|
| `SUPABASE_URL` | `https://ufsbtxlqbhaxaavxpozo.supabase.co` |
| `SUPABASE_ANON_KEY` | Dashboard → Settings → API 的 anon key |
| `SUPABASE_PROJECT_ID` | `ufsbtxlqbhaxaavxpozo` |
| `SUPABASE_DB_URL` | `postgresql://postgres.<ref>:<DB密碼>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` |

手動執行一次：**Actions → Keep Supabase alive + backup → Run workflow**

## 手動備份（本機）

```bash
export SUPABASE_ACCESS_TOKEN=你的token        # 或存入 ~/.supabase-access-token
python3 scripts/backup-db.py ufsbtxlqbhaxaavxpozo
```

輸出到 `~/grade-query-backup/`（SQL 可直接還原 + JSON）。

## 被暫停時怎麼救

Supabase 會在暫停前約一週寄信警告。若真的被暫停：

1. 到 <https://supabase.com/dashboard> → 選專案 → **Resume project**
2. 官方文件說明最多可在暫停後 **1 年內**恢復，資料與設定會完整保留

## 長期最安心的做法

升級 **Pro** 方案即可保證不會因閒置被暫停（Pro 也提供每日可下載備份）。
若不想付費，維持上面兩層保活 + 定期手動備份。

## ⚠️ 個資注意

備份檔**含有學生姓名、帳號與密碼雜湊**，屬個人資料，**不可提交到本 repo（本 repo 為公開）**。
