# 資料庫保活與備份

Supabase **免費方案**的專案若連續 7 天活動過低會被**自動暫停**（paused），網站會離線。
本專案已設定兩層保險。

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 專案 ref | `ufsbtxlqbhaxaavxpozo`（grade-query） |
| 方案 | Free（會被暫停） |
| DB 內建保活 | ✅ 已啟用，每天 2 次（UTC 02:23 / 13:47） |
| 外部保活（GitHub Actions） | 需自行啟用，見下方 |
| 本機備份 | ✅ `~/grade-query-backup/`（每次執行會保留最近 10 份） |

## 第一層：資料庫內建保活（已啟用）

在 Supabase 內用 `pg_cron` + `pg_net`，每天兩次對自己的 REST API 發出請求，維持「使用者活動」。

```sql
-- 查看排程
select jobname, schedule, active from cron.job where jobname like 'keepalive%';

-- 查看是否真的有在跑
select ran_at, status_code from ops.keepalive_log order by ran_at desc limit 10;

-- 手動補一次
select net.http_get(
  url := 'https://ufsbtxlqbhaxaavxpozo.supabase.co/rest/v1/app_config?select=key',
  headers := '{"apikey":"<ANON_KEY>","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
  timeout_milliseconds := 15000);
```

> 注意：專案被暫停時排程也會跟著停，恢復專案後排程會自動繼續。

## 第二層：GitHub Actions（建議再啟用一份外部流量）

`.github/workflows/keepalive-backup.yml` 會每天兩次 ping，並每週產生一次完整備份。

啟用步驟：

1. **授權 GitHub 推送 workflow 檔**（你的 GitHub token 目前沒有 `workflow` 權限）：
   ```bash
   gh auth refresh -h github.com -s workflow
   ```
   授權後執行 `git push` 即可送出。

   不想授權的話，到 GitHub 網頁 <https://github.com/shrjie/score_supabase/actions> → **New workflow**，
   把該檔內容貼上去儲存。

2. **在 repo 加入 Secrets**（Settings → Secrets and variables → Actions）：

   | 名稱 | 值 |
   |---|---|
   | `SUPABASE_URL` | `https://ufsbtxlqbhaxaavxpozo.supabase.co` |
   | `SUPABASE_ANON_KEY` | Dashboard → Settings → API 的 anon key |
   | `SUPABASE_PROJECT_ID` | `ufsbtxlqbhaxaavxpozo` |
   | `SUPABASE_DB_URL` | `postgresql://postgres.<ref>:<DB密碼>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` |

3. 到 Actions 分頁手動執行一次 **Keep Supabase alive + daily backup**，確認綠燈。

## 被暫停時怎麼救

Supabase 會在暫停前約一週寄信警告。若真的被暫停：

1. 到 <https://supabase.com/dashboard> → 選專案 → **Resume project**
2. 官方文件說明最多可在暫停後 **1 年內**恢復，資料與設定會完整保留

## 長期最安心的做法

升級 **Pro** 方案即可保證不會因閒置被暫停（Pro 也提供每日備份可下載）。
若不想付費，至少保留上面兩層保活 + 定期手動備份。

## 備份說明

- 備份檔**含有學生姓名、帳號與密碼雜湊**，屬個人資料，**不可提交到本 repo（本 repo 是公開的）**。
- 本機備份預設在 `~/grade-query-backup/`，已保留最近 10 份。
- Actions 的備份存於 artifact（保留 30 天），不會進 git。
