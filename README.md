# 班級成績查詢系統

給老師用的班級成績查詢／管理網站：學生線上查成績與排名，老師線上編修、匯入成績、列印成績單。

由原 Google Apps Script 版（`code.gs.txt`）改寫為 **Vite + React + Supabase**，可一鍵部署到 Netlify。每位老師使用自己的 Supabase 專案，資料完全獨立、互不影響。

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/shrjie/score_supabase)

---

## 功能

**學生端**（`/`，輸入帳號與密碼）
- 選考試 → 各科成績、班排名、總分、平均
- 與前次比較（前名次／進退步）、雷達圖、歷次趨勢圖
- 列印個人成績單

**老師端**（`/teacher`，只輸入管理密碼）
- 成績編修格（點格即改、即時重算總分與排名）、整班／單科貼上
- **匯入**：`Excel(.xlsx/.xls)` 或 `CSV` 匯入名冊與成績（自動建立科目與權重、含預覽）
- **統計圖表**：總分分佈、各科級距、各科平均/最高/最低、跨考試平均走勢、進步/退步排行
- 考試／科目（權重）／學生管理、重設學生密碼、測試帳（不排名）
- 列印總表與全班成績單、匯出 CSV、操作紀錄、系統標題設定、改管理密碼

## 架構

| 層 | 技術 |
|---|---|
| 前端 | Vite + React + react-router（HashRouter）+ recharts |
| 後端 | Supabase（Postgres + PostgREST RPC + Row Level Security） |
| 身分驗證 | Supabase Auth（老師用合成 Email + 單一密碼；學生用 `帳號@students.grade.local`） |
| 帳號開通 | Supabase Edge Function `admin`（service_role） |
| 檔案匯入 | SheetJS（瀏覽器端解析，不上傳檔案到伺服器） |
| 部署 | Netlify（`netlify.toml` 已設定標頭與環境變數提示） |

衍生值（總分／平均／班名次／前名次／進退步／各科排名）以 Postgres 視窗函式**即時計算**，不儲存。

---

## 安裝（約 10 分鐘）

需要三個免費帳號：**Supabase**、**Netlify**、**GitHub**。

> 建議流程：先 Fork 這個 repo → 建 Supabase（步驟 1–4）→ 用 Deploy 按鈕部署 Netlify（步驟 5）→ 最後回 Supabase 設定網址（步驟 6）。

### 步驟 1：建立 Supabase 專案
1. 到 <https://supabase.com> → New project（Region 選 `Northeast Asia (Tokyo)` 較快）。
2. 建好後到 **Project Settings → API**，記下：
   - `Project URL`（= `VITE_SUPABASE_URL`）
   - `anon` `public` key（= `VITE_SUPABASE_ANON_KEY`）

### 步驟 2：建立資料庫（貼一次）
1. **SQL Editor → New query**。
2. 打開本專案的 [`supabase/setup.sql`](supabase/setup.sql)，**全選複製、貼上、Run**。
   - 這會建立所有資料表、20 個 `api_*` 函式、Row Level Security 與預設系統標題。
   - 想用指令的話也可以用 Supabase CLI：`supabase link --project-ref <ref>` 後 `supabase db push`。

### 步驟 3：建立第一位老師帳號（貼一次）
1. 打開 [`supabase/create-teacher.sql`](supabase/create-teacher.sql)。
2. 把裡面的 `<你的密碼>` 改成你要的管理密碼（至少 6 碼），**全選複製、貼上、Run**。
   - Email 預設 `admin@teachers.grade.local`，須與 Netlify 的 `VITE_TEACHER_EMAIL` 相同（預設值相同，通常不用改）。

### 步驟 4：部署 Edge Function（學生帳號開通用）

**方式 A（Dashboard，免安裝工具）**
1. **Edge Functions → Create a new function**，名稱輸入 `admin`。
2. 把 [`supabase/functions/admin/index.ts`](supabase/functions/admin/index.ts) 的內容整份貼上取代預設程式，**Deploy**。

**方式 B（CLI）**
```bash
supabase login
supabase link --project-ref <你的-project-ref>
supabase functions deploy admin
```

### 步驟 5：部署到 Netlify（一鍵）
1. 點上方的 **Deploy to Netlify** 按鈕（或 <https://app.netlify.com/start/deploy?repository=https://github.com/shrjie/score_supabase>）。
2. 依指示授權 GitHub，選你的帳號建立新站。
3. 在環境變數欄位填入步驟 1 記下的：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. 按 Deploy，等 1–2 分鐘完成，取得你的網址（例：`https://xxxx.netlify.app`）。

> 其他選填變數（`VITE_TEACHER_EMAIL`、`VITE_STUDENT_EMAIL_DOMAIN`、`VITE_DEFAULT_CLASS`）都有預設值，見下方說明。

### 步驟 6：設定登入網址與關閉公開註冊
回到 Supabase：
1. **Authentication → URL Configuration**：`Site URL` 填你的 Netlify 網址；`Redirect URLs` 也加入 `https://你的網址/**`。
2. **Authentication → Providers → Email**：關閉 **Allow new users to sign up**（本系統帳號由老師建立，不開放自行註冊）。

### 步驟 7：開始使用
1. 開 `https://你的網址/teacher` → 輸入步驟 3 設定的管理密碼登入。
2. 建議先到右上角 **改管理密碼** 換成你自己的密碼。
3. **學生管理 → 匯入名冊(Excel/CSV)**：上傳名冊（可下載範本），建立學生帳號。
4. **成績編修 → 匯入成績檔**：上傳成績表匯入。
5. 把 `https://你的網址/` 給學生，用「帳號 + 密碼」登入查詢。

---

## 環境變數說明

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | — | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | — | Supabase anon public key（可公開，受 RLS 保護） |
| `VITE_TEACHER_EMAIL` | | `admin@teachers.grade.local` | 老師帳號的合成 Email；登入只輸入密碼 |
| `VITE_STUDENT_EMAIL_DOMAIN` | | `students.grade.local` | 學生帳號合成 Email 的網域 |
| `VITE_DEFAULT_CLASS` | | （空） | 新增學生時的預設班級代碼 |

> Edge Function 的 `STUDENT_EMAIL_DOMAIN` 需與 `VITE_STUDENT_EMAIL_DOMAIN` 一致（預設值相同）。
> 本機開發：`cp .env.example .env`，填好兩個必填值後 `npm install && npm run dev`。

## 匯入檔格式

**名冊**（表頭需含 帳號／座號／姓名）
| 帳號 | 密碼 | 座號 | 姓名 | 班級 | 測試 |
|---|---|---|---|---|---|
| 1412101 | A123456789 | 1 | 王小明 | 1421 | |

**成績**（表頭第一列：座號、姓名，之後每欄一個科目；欄名可帶權重如 `國文*5`）
| 座號 | 姓名 | 國文*5 | 英文*3 | 數學*4 |
|---|---|---|---|---|
| 1 | 王小明 | 83 | 90 | 80 |

## 常用指令

```bash
npm install          # 安裝依賴
npm run dev          # 本機開發
npm run build        # 建置
npm run bundle:sql   # 重新產生 supabase/setup.sql（合併 migrations）
npm run deploy:gh    # 部署到 GitHub Pages（自動設定子路徑 base）
npm run deploy:cf    # 部署到 Cloudflare Pages（需 CLOUDFLARE_API_TOKEN）
```

## 已部署的站台（同一個 Supabase 資料庫）

| 平台 | 網址 |
|---|---|
| Netlify | https://fsjh-grade-query.netlify.app |
| GitHub Pages | https://shrjie.github.io/score_supabase/ |
| Cloudflare Pages | https://score-query-2ju.pages.dev |

三個站台共用同一份資料庫，資料一致；修改後可挑一個或全部重新部署。

**GitHub Pages**：使用 `gh-pages` 分支（`npm run deploy:gh` 會自動以 `VITE_BASE_PATH=/<repo>/` 建置後推送）。
**Cloudflare Pages**：需設定環境變數 `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID` 後執行 `npm run deploy:cf`。
**Cloudflare 安全標頭**：由 `public/_headers` 提供（CSP 等），Netlify 則由 `netlify.toml` 提供。

> GitHub Pages 無法自訂 HTTP 標頭（沒有 `_headers` 支援），安全標頭僅在 Netlify / Cloudflare 生效。

---

## 安全與注意事項
- 學生密碼＝身分證號很方便，但務必提醒學生修改；老師可用「重設密碼」協助。
- 範本請勿沿用預設密碼，第一次登入後立刻改管理密碼。
- 老師端所有資料操作都在資料庫端以 `is_teacher()` 檢查；anon 無法呼叫任何老師 RPC。
- 匯入檔在瀏覽器端解析，**不會上傳原始檔**到伺服器。
- 若使用量大，建議定期備份（Supabase Dashboard → Database → Backups），或在免費方案保留期內匯出。

## 授權
可自由使用與修改。
