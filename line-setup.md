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

- 建立 / 完成的任務都會**立刻**反映在網頁 App。
- `完成 X` 的 X 用**任務名稱的一部分**即可（例如 `完成 垃圾`）；若同時符合多筆，bot 會請你打完整一點。
- 只能完成「目前待辦」中的任務；週期任務若還沒到下次，不在待辦內、不會被重複完成。

> 改了 `index.ts` 後要重新部署才會生效：`supabase functions deploy line-webhook --no-verify-jwt`
