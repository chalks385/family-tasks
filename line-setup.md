# 🟢 LINE 串接設定教學

讓你在 LINE 打字就能建立任務，任務即時出現在網頁 App。
架構：LINE Messaging API → Supabase Edge Function（`supabase/functions/line-webhook`）→ `tasks` 表。

> 你的 webhook 網址（下面會用到）：
> **`https://gqvcyvyrwfooerlxabjk.supabase.co/functions/v1/line-webhook`**

---

## A. 建立 LINE Messaging API channel
1. 到 <https://developers.line.biz/console/> 用 LINE 帳號登入
2. 建一個 **Provider**（名稱隨意，例如「家庭」）
3. 在 Provider 下 **Create a Messaging API channel**，填名稱（例如「家庭待辦」）等基本資料
4. 建好後記下兩個東西：
   - **Basic settings** 分頁 → **Channel secret**
   - **Messaging API** 分頁 → 最下面 **Channel access token (long-lived)** → 按 **Issue** → 複製 token
5. 還在 **Messaging API** 分頁，往下把這兩個關掉（才不會出現罐頭回覆）：
   - **Auto-reply messages** → Disabled
   - **Greeting messages** → 可關

> ⚠️ **關掉罐頭訊息的真正開關在另一個後台**：如果加了好友還是會收到
> 「感謝您的訊息！本帳號無法個別回覆…」，那是官方帳號的「自動回應訊息」。
> 到 **LINE Official Account Manager**（<https://manager.line.biz/>）→ 選帳號 →
> **設定 → 回應設定**：
> - **自動回應訊息** → 停用（Off）
> - **Webhook** → 啟用（On）
> - 有 **回應模式** 的話選 **Bot**
> 存檔後只會剩下我們 bot 自己的回覆。

---

## B. 部署 webhook 到 Supabase

### 方法一：Supabase CLI（推薦）
在這個專案資料夾的 terminal：
```bash
brew install supabase/tap/supabase       # 或： npm i -g supabase
supabase login
supabase link --project-ref gqvcyvyrwfooerlxabjk
supabase functions deploy line-webhook --no-verify-jwt
```
> `--no-verify-jwt` 一定要加：LINE 不會帶 Supabase 的 JWT，我們改用 LINE 簽章驗證。

設定 secrets（把 `xxx` 換成 A 步驟拿到的值，`ALLOWED_USER_IDS` 先留空）：
```bash
supabase secrets set \
  LINE_CHANNEL_SECRET=xxx \
  LINE_CHANNEL_ACCESS_TOKEN=xxx \
  ALLOWED_USER_IDS=
```

### 方法二：沒裝 CLI → 用 Dashboard
Supabase 專案 → **Edge Functions** → **Create a function** 命名 `line-webhook` →
把 [`supabase/functions/line-webhook/index.ts`](supabase/functions/line-webhook/index.ts) 內容貼上 → Deploy。
Secrets 在 **Project Settings → Edge Functions → Secrets** 新增（同上三個）。

### 🧠 讓 bot 更聰明（可選，強烈建議）
不設也能用（會退回關鍵字比對）；但設了之後，bot 會用 AI 理解白話：
`你好` 不會被當成家事、`記得每三個月換濾芯` 會自動變成週期任務。

**三層備援，哪一層拿不到就自動往下一層：**
`Gemini（免費額度）` → `Claude Haiku` → `關鍵字比對`

#### 選項 A：Gemini（免費，推薦）
1. 到 <https://aistudio.google.com/apikey> 免費申請一把 API key（AI…）
2. 設 secret 後重新部署：
   ```bash
   supabase secrets set GEMINI_API_KEY=你的Gemini_key
   supabase functions deploy line-webhook --no-verify-jwt
   ```
   - 預設模型 `gemini-3.6-flash`（免費額度，家用綽綽有餘）。
   - Google 之後若再改模型名稱，用 `GEMINI_MODEL` 覆蓋即可，例如
     `supabase secrets set GEMINI_MODEL=gemini-3.6-flash`（不用改程式）。

#### 選項 B：Claude Haiku（備援，或不想用 Gemini 時）
1. 到 <https://console.anthropic.com/> 拿一把 API key（`sk-ant-...`）
2. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-你的key` → 重新部署
   - 按 token 計費，家用一個月通常幾塊台幣。
   - 想更聰明可加 `AI_MODEL`，例如 `supabase secrets set AI_MODEL=claude-opus-5`。

> 兩個都設 → 平時走 Gemini（免費），Gemini 若暫時失敗就自動改用 Haiku，最穩。

---

## 讓不會用的人也看得到教學（歡迎訊息 + 圖文選單）

都在 **LINE Official Account Manager**（<https://manager.line.biz/>）設定。

### 歡迎訊息（新朋友一加就看到）
**主頁 → 加入好友的歡迎訊息**，貼上：
```
歡迎使用家庭待辦 🏠
直接打字就能新增待辦，例如：
・晾衣服
・!晾衣服（急事）
・每3個月 換濾芯（週期）
做完了就打「完成 晾衣服」。
輸入「說明」看完整用法、「清單」看目前待辦。
```

### 圖文選單（畫面下方常駐按鈕）
**主頁 → 圖文選單 → 建立**：
1. 版型選 **一列三格**（2500 × 843）
2. 背景圖上傳 [`assets/line-richmenu.png`](assets/line-richmenu.png)
3. 三格動作分別設成：

| 格子 | 動作類型 | 內容 |
|------|----------|------|
| 左「看清單」 | 傳送文字 | `清單` |
| 中「使用說明」 | 傳送文字 | `說明` |
| 右「開啟 App」 | 連結（URI） | `https://chalks385.github.io/family-tasks/` |

4. 設為使用中 → 存檔。點按鈕就會觸發對應動作。

---

## C. 把 webhook 接回 LINE
1. LINE console → **Messaging API** 分頁 → **Webhook URL** 填：
   `https://gqvcyvyrwfooerlxabjk.supabase.co/functions/v1/line-webhook` → **Update**
2. 按 **Verify** → 應顯示 **Success**
3. 打開 **Use webhook**（開關要是綠的）

---

## D. 加好友 + 鎖定只有你們能用
1. **Messaging API** 分頁有 **QR code**，手機 LINE 掃描加 bot 好友
2. 傳一則訊息給 bot（例如「說明」）→ bot 回覆最後會附上 **你的 userId（U 開頭）**，複製起來
3. 老婆也加好友、傳一則，拿到她的 userId
4. 把兩個 userId 設進白名單，重設 secret：
   ```bash
   supabase secrets set ALLOWED_USER_IDS=U你的id,U老婆的id
   ```
   （Dashboard 的話就到 Secrets 改 `ALLOWED_USER_IDS`）

設定後，別人就算加了 bot 也不能建立任務——只有你們兩個。

> 想在**家庭群組**用也可以：把 bot 拉進群組即可，語法一樣。

---

## 用法（直接對 bot 打字）
| 你打 | 結果 |
|------|------|
| `晾衣服` | 一般一次性任務 |
| `!晾衣服` 或 `急 晾衣服` | 🔴 緊急 |
| `每天 倒垃圾` | 每日重複 |
| `每週` / `每月` / `每3個月` / `每半年` / `每年` / `每5天 …` | 各種週期 |
| `!每天 收衣服` | 緊急 + 每日重複 |
| `完成 晾衣服`（或 `做完 晾衣服`） | 打勾完成（週期任務會自動算下次到期、記錄是誰做的） |
| `清單` | 看目前待辦 |
| `說明` | 顯示用法 |

- 設了 AI 金鑰（Gemini 或 Claude）後，也能用**白話**：`記得每三個月換濾芯`、`幫我把倒垃圾打勾`、`還有什麼要做`；打招呼／閒聊（`你好`）不會被當成家事。
- 建立 / 完成的任務都會**立刻**反映在網頁 App。
- `完成 X` 的 X 用**任務名稱的一部分**即可（例如 `完成 垃圾`）；若同時符合多筆，bot 會請你打完整一點。
- 只能完成「目前待辦」中的任務；週期任務若還沒到下次，不在待辦內、不會被重複完成。

> 改了 `index.ts` 後要重新部署才會生效：`supabase functions deploy line-webhook --no-verify-jwt`
