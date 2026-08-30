# 🏠 家庭待辦 FamilyTasks

一個給家裡兩個人共用的超簡單待辦網頁。老婆放事情、你下班打勾完成，
有些事情（例如換濾芯）設成週期性，做完後到期會自動回到待處理清單。

- 🔴 **Urgent / ⚪ 一般** 兩種優先度，緊急的置頂
- ✅ 任一人都能打勾完成，會記下是誰完成的
- 🔁 **週期任務**：設每 N 天重複（每週 / 每月 / 每 3 個月…），
  做完後到期日一到自動浮回待處理（不需任何背景程式）
- 📱 一個網址，兩支手機瀏覽器都能開，免裝 App、登入後才能存取
- 🟢 **LINE 串接**：直接傳訊息給 bot 就能建立任務（見 [line-setup.md](line-setup.md)）

---

## 兩種模式

打開 `index.html` 就能用。程式會依 `index.html` 最上方的設定自動切換：

| 模式 | 條件 | 說明 |
|------|------|------|
| **本機模式** | 沒填 Supabase 金鑰 | 資料存在這台裝置的瀏覽器，只有這台看得到。適合先試玩。 |
| **雲端模式** | 填了 Supabase 金鑰 | 資料存雲端，兩支手機共用、即時同步。**日常要用的就是這個。** |

---

## 上雲步驟（讓兩支手機共用）

### 1. 建立 Supabase 專案（免費）
1. 到 <https://supabase.com> 用 Google 或 email 註冊、新增一個 Project（免費方案即可）
2. 打開 [`supabase.sql`](supabase.sql)，把裡面兩個 `email` 換成**你和老婆真正用來登入的 email**，
   然後到左側 **SQL Editor → New query** 全部貼上、按 **Run**（建好資料表 + 安全政策）
3. 左側 **Project Settings → API**，複製兩個值：
   - **Project URL**（像 `https://xxxx.supabase.co`）
   - **anon public** 金鑰（很長一串）

### 1.5 設定登入網址（magic link 才會生效）
左側 **Authentication → URL Configuration**：
- **Site URL** 填你的網站網址（例如 `https://你的帳號.github.io/family-tasks/`）
- **Redirect URLs** 也把同一個網址加進去
（沒設這步，點 email 裡的登入連結會失效。）

### 2. 填進網頁
打開 `index.html`，找到最上方這兩行，貼上剛剛複製的值：
```js
const SUPABASE_URL = "";        // 貼上 Project URL
const SUPABASE_ANON_KEY = "";   // 貼上 anon public 金鑰
```

### 3. 放到網路上（讓手機能開）
把 `index.html` 部署到任一免費靜態網頁空間，得到一個網址，傳給老婆加到手機主畫面：

- **Cloudflare Pages**、**Netlify**、**Vercel**、**GitHub Pages** 都可以，免費
- 最快：Netlify（<https://app.netlify.com/drop>）把整個資料夾拖進去就有網址

> 手機打開網址後，用瀏覽器「加入主畫面」，就像一個 App 一樣。

---

## 使用說明

- 右下角 **＋** 新增待辦：填標題、選急不急、選要不要週期重複
- 點左邊圓圈 = 完成；週期任務完成後會顯示「下次 X 月 X 日」
- 右上角「我是」設定你的名字，完成事情會記錄是誰做的
- 週期任務到期會自動回到待處理（打開或切回網頁時即時更新）

## 關於安全（已上鎖）
- 需要**登入**才能使用：用 email 收 magic link，點連結登入，不用記密碼。
- 資料庫 RLS 只允許 `supabase.sql` 名單內的 email 讀寫。**就算有人拿到金鑰或網址，
  沒登入、或不在名單內，也完全存取不到資料。** 所以放在 public repo 也沒關係。
- 想新增／移除可用的人：改 `supabase.sql` 裡的 email 名單、重跑一次即可。
- 第一次在新手機用：打開網址 → 輸入 email → 收信點連結（在同一支手機開）→ 登入完成，之後會記住。
