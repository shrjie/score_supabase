# 班級成績查詢系統

由原 Google Apps Script 版（`code.gs.txt`）改寫：**Vite + React + Supabase**，可部署到 Netlify / GitHub Pages。

## 架構

| 層 | 技術 |
|---|---|
| 前端 | Vite 8 + React 19 + react-router（HashRouter）+ recharts |
| 後端 | Supabase（Postgres + PostgREST RPC + Row Level Security） |
| 身分驗證 | Supabase Auth（老師用真實 Email；學生用 `帳號@students.grade.local` 合成 Email） |
| 帳號開通 | Supabase Edge Function `admin`（service_role） |
| 部署 | Netlify（`netlify.toml` 已設定） |

衍生值（總分／平均／班名次／前名次／進退步／各科排名）改為**即時計算**（Postgres 視窗函式），不再像 GAS 版寫回儲存格。

## 資料表

- `students` 學生（連結 `auth.users`）
- `teachers` 老師（連結 `auth.users`）
- `exams` 考試（`position` 決定先後，用於「前名次」）
- `subjects` 科目（`weight` 權重）
- `scores` 成績（exam × student × subject）
- `app_config` 系統設定（系統標題）
- `audit_logs` 操作紀錄

## 首次設定

### 1. 建立 Supabase 專案

到 https://supabase.com 建立專案，記下 Project URL 與 anon key。

### 2. 套用資料庫結構

用 Supabase CLI（建議）：

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

或直接在 Dashboard → SQL Editor 貼上 `supabase/migrations/0001_init.sql` 執行。

### 3. 建立第一位老師

Dashboard → Authentication → Users → Add user（設定 Email + 密碼，勾選 Auto Confirm）。

再到 SQL Editor 執行（把 Email 換成你的）：

```sql
insert into public.teachers (user_id, display_name)
select id, '班導' from auth.users where email = '你的老師Email';
```

### 4. 部署 Edge Function（學生開通用）

```bash
supabase functions deploy admin
```

（`STUDENT_EMAIL_DOMAIN` 預設 `students.grade.local`，如要更改需與前端 `.env` 一致。）

### 5. 本機開發

```bash
cp .env.example .env    # 填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 6. 部署 Netlify

```bash
npm run build
netlify deploy --prod
```

或在 Netlify 網站設定環境變數 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_STUDENT_EMAIL_DOMAIN`。

## 路由

- `/` 學生端（登入 → 選考試 → 成績／統計／趨勢／雷達 → 列印個人成績單）
- `/teacher` 老師端（成績編修格、整班貼上、科目／考試／學生管理、操作紀錄、系統標題、匯出 CSV）
