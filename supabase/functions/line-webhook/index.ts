// LINE Webhook → 寫入 FamilyTasks 的 tasks 表
// 部署：supabase functions deploy line-webhook --no-verify-jwt
//
// 需要的 secrets（supabase secrets set ...）：
//   LINE_CHANNEL_SECRET        LINE channel 的 secret（驗簽用）
//   LINE_CHANNEL_ACCESS_TOKEN  LINE 的 long-lived access token（回訊用）
//   ALLOWED_USER_IDS           允許使用的 LINE userId，逗號分隔（先留空以取得 userId）
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動注入。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const ALLOWED = (Deno.env.get("ALLOWED_USER_IDS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// AI 意圖解析（可選）：設了 ANTHROPIC_API_KEY 就用 Claude 理解訊息；沒設則退回關鍵字比對。
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const AI_MODEL = Deno.env.get("AI_MODEL") ?? "claude-haiku-4-5";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const DAY = 86400000;
const enc = new TextEncoder();

/* ---------- LINE 簽章驗證 ---------- */
async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!CHANNEL_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(CHANNEL_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === signature;
}

/* ---------- LINE 回訊 ---------- */
async function reply(replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}

/* ---------- 中文數字（常用）→ 數字 ---------- */
const CN: Record<string, number> = { 一:1, 兩:2, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
function toNum(s: string): number | null {
  const half = s.replace(/[０-９]/g, (d) => String("０１２３４５６７８９".indexOf(d)));
  if (/^\d+$/.test(half)) return parseInt(half, 10);
  if (s.length === 1 && CN[s]) return CN[s];
  if (s.length === 2 && s[0] === "十" && CN[s[1]]) return 10 + CN[s[1]];   // 十一~十九
  if (s.length === 2 && s[1] === "十" && CN[s[0]]) return CN[s[0]] * 10;   // 二十..九十
  return null;
}

/* ---------- 解析訊息 ---------- */
type Parsed =
  | { cmd: "help" } | { cmd: "list" } | { cmd: "done"; query: string }
  | { title: string; urgency: string; is_recurring: boolean; period_days: number | null };

function stripUrgent(t: string): [string, boolean] {
  const m = t.match(/^\s*(!|！|急[\s:：]*)/);
  return m ? [t.slice(m[0].length).trim(), true] : [t, false];
}
function stripPeriod(t: string): [string, number | null] {
  const words: [RegExp, number][] = [
    [/^每(天|日)[\s:：]*/, 1], [/^每(週|周)[\s:：]*/, 7], [/^每月[\s:：]*/, 30],
    [/^每半年[\s:：]*/, 180], [/^每年[\s:：]*/, 365],
  ];
  for (const [re, days] of words) { if (re.test(t)) return [t.replace(re, "").trim(), days]; }
  // 每 N 天/週/月/個月/年
  const m = t.match(/^每\s*([0-9０-９一二兩三四五六七八九十]+)\s*(天|日|週|周|個月|个月|月|年)[\s:：]*/);
  if (m) {
    const n = toNum(m[1]);
    if (n) {
      const unit = m[2];
      const mult = /天|日/.test(unit) ? 1 : /週|周/.test(unit) ? 7 : /年/.test(unit) ? 365 : 30;
      return [t.slice(m[0].length).trim(), n * mult];
    }
  }
  return [t, null];
}

function parse(textRaw: string): Parsed {
  const text = textRaw.trim();
  const low = text.toLowerCase();
  if (["說明", "help", "?", "？", "指令", "幫助"].includes(low)) return { cmd: "help" };
  if (["清單", "列表", "list", "待辦"].includes(low)) return { cmd: "list" };

  // 完成：完成/做完/搞定/done + 空格 + 任務名
  const doneM = text.match(/^\s*(完成了?|做完了?|搞定了?|done)\s+(.+)/i);
  if (doneM) return { cmd: "done", query: doneM[2].trim() };

  let t = text, urgency = "normal";
  let [t1, u1] = stripUrgent(t); t = t1;
  let [t2, period] = stripPeriod(t); t = t2;
  const [t3, u2] = stripUrgent(t); t = t3;                // 允許 "每天 !收衣服"
  if (u1 || u2) urgency = "urgent";

  return { title: t.trim(), urgency, is_recurring: period != null, period_days: period };
}

/* ---------- 顯示用 ---------- */
function periodLabel(days: number | null): string {
  const map: Record<number, string> = { 1:"每天", 7:"每週", 30:"每月", 90:"每 3 個月", 180:"每半年", 365:"每年" };
  return (days && map[days]) || `每 ${days} 天`;
}
function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString("zh-TW", { month:"numeric", day:"numeric", timeZone:"Asia/Taipei" });
}
function isActiveTask(t: any): boolean {
  if (!t.is_recurring) return t.status === "pending";
  if (t.status === "pending") return true;
  return t.next_due_at ? new Date(t.next_due_at).getTime() <= Date.now() : false;
}
// 完成時記錄「誰做的」→ 取 LINE 顯示名稱
async function senderName(source: any): Promise<string> {
  try {
    const uid = source?.userId;
    if (!uid) return "LINE";
    const url = source.type === "group"
      ? `https://api.line.me/v2/bot/group/${source.groupId}/member/${uid}`
      : source.type === "room"
        ? `https://api.line.me/v2/bot/room/${source.roomId}/member/${uid}`
        : `https://api.line.me/v2/bot/profile/${uid}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    if (r.ok) { const j = await r.json(); return j.displayName || "LINE"; }
  } catch (_) { /* ignore */ }
  return "LINE";
}

const HELP = [
  "📋 家庭待辦 — 傳訊息就能建立",
  "",
  "・晾衣服 → 一般待辦",
  "・!晾衣服（或 急 晾衣服）→ 🔴 緊急",
  "・每天 倒垃圾 → 每日重複",
  "・每週 / 每月 / 每3個月 / 每半年 / 每年 / 每5天 …",
  "・!每天 收衣服 → 緊急 + 重複",
  "",
  "・完成 晾衣服（或 做完 晾衣服）→ 打勾完成",
  "・清單 → 看目前待辦",
  "・說明 → 顯示這個",
  "",
  "也可以直接用白話，例如「記得每三個月換濾芯」。",
].join("\n");

async function listText(): Promise<string> {
  const { data, error } = await supabase.from("tasks").select("*");
  if (error) return "讀取失敗：" + error.message;
  const nowMs = Date.now();
  const active = (data ?? []).filter((t) =>
    !t.is_recurring ? t.status === "pending"
      : t.status === "pending" || (t.next_due_at && new Date(t.next_due_at).getTime() <= nowMs));
  if (!active.length) return "🎉 目前沒有待辦！";
  const urg = active.filter((t) => t.urgency === "urgent").map((t) => `🔴 ${t.title}`);
  const nor = active.filter((t) => t.urgency !== "urgent").map((t) => `・${t.title}`);
  return ["📋 目前待辦", ...urg, ...nor].join("\n");
}

/* ---------- 意圖：AI 理解（主）＋ 關鍵字比對（備援） ---------- */
type Intent =
  | { kind: "help" } | { kind: "list" }
  | { kind: "chitchat"; reply: string }
  | { kind: "complete"; query: string }
  | { kind: "create"; title: string; urgency: string; period_days: number | null };

// 關鍵字比對 → Intent（沒有 API key、或 AI 失敗時的備援）
function keywordIntent(text: string): Intent {
  const p = parse(text);
  if ("cmd" in p) {
    if (p.cmd === "help") return { kind: "help" };
    if (p.cmd === "list") return { kind: "list" };
    return { kind: "complete", query: p.query };
  }
  if (!p.title) return { kind: "help" };
  return { kind: "create", title: p.title, urgency: p.urgency, period_days: p.period_days };
}

const SYSTEM = `你是「家庭待辦」LINE 助理的訊息解析器。針對使用者的每一則訊息，判斷意圖並呼叫 record_intent 回報。

意圖：
- create：想新增一件要做的事（家事、代辦、提醒）。title 放乾淨的事情名稱（去掉「急」「每天」等修飾詞）；語氣緊急（急、趕快、馬上、快、!）→ urgency=urgent，否則 normal；週期性 → period_days（每天=1、每週=7、每月=30、每3個月=90、每半年=180、每年=365、每N天=N），一次性則省略。
- complete：想把某件事標記完成（完成、做完、搞定、弄好了、打勾）。事情名稱放 query。
- list：想看目前有哪些待辦（清單、還有什麼要做）。
- help：問怎麼用、有哪些指令。
- chitchat：打招呼、閒聊、道謝、與待辦無關。用繁體中文在 reply 回一句簡短友善的話，並溫和提示可直接打事情來新增。不要把閒聊當任務。

規則：只有明確是「要做的事」才用 create；像「你好」「謝謝」「在嗎」用 chitchat；不確定時傾向 chitchat，不要亂建任務。全部用繁體中文。`;

const INTENT_TOOL = {
  name: "record_intent",
  description: "判斷家庭待辦 LINE 訊息的意圖並抽取欄位",
  input_schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["create", "complete", "list", "help", "chitchat"] },
      title: { type: "string", description: "create：任務名稱（去掉急/週期等修飾詞）" },
      urgency: { type: "string", enum: ["urgent", "normal"], description: "create：是否緊急" },
      period_days: { type: "integer", description: "create：週期天數；一次性省略或 0" },
      query: { type: "string", description: "complete：要完成的任務名稱關鍵字" },
      reply: { type: "string", description: "chitchat：用繁體中文回一句友善的話" },
    },
    required: ["intent"],
  },
};

async function aiIntent(text: string): Promise<Intent | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 300,
        system: SYSTEM,
        tools: [INTENT_TOOL],
        tool_choice: { type: "tool", name: "record_intent" },
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find((b: any) => b.type === "tool_use");
    const a = block?.input;
    if (!a) return null;
    switch (a.intent) {
      case "help": return { kind: "help" };
      case "list": return { kind: "list" };
      case "chitchat":
        return { kind: "chitchat", reply: a.reply || "嗨！要新增待辦的話，直接打事情名稱就行～輸入「說明」看用法。" };
      case "complete":
        return a.query ? { kind: "complete", query: String(a.query) } : null;
      case "create":
        if (!a.title) return null;
        return {
          kind: "create",
          title: String(a.title),
          urgency: a.urgency === "urgent" ? "urgent" : "normal",
          period_days: (typeof a.period_days === "number" && a.period_days > 0) ? a.period_days : null,
        };
      default: return null;
    }
  } catch (_) { return null; }
}

/* ---------- 進入點 ---------- */
Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  if (!(await verifySignature(rawBody, signature))) {
    return new Response("bad signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("ok"); }

  for (const ev of payload.events ?? []) {
    if (ev.type !== "message" || ev.message?.type !== "text" || !ev.replyToken) continue;
    const userId = ev.source?.userId ?? "";

    // 白名單（尚未設定時 → 開放並回傳 userId 方便你設定）
    const setupHint = ALLOWED.length ? "" : `\n\n🔧（設定用）你的 userId：\n${userId}`;
    if (ALLOWED.length && !ALLOWED.includes(userId)) {
      await reply(ev.replyToken, "抱歉，你沒有使用權限 🙈");
      continue;
    }

    const intent = (await aiIntent(ev.message.text)) ?? keywordIntent(ev.message.text);

    if (intent.kind === "help") { await reply(ev.replyToken, HELP + setupHint); continue; }
    if (intent.kind === "list") { await reply(ev.replyToken, (await listText()) + setupHint); continue; }
    if (intent.kind === "chitchat") { await reply(ev.replyToken, intent.reply + setupHint); continue; }

    if (intent.kind === "complete") {
      const { data, error } = await supabase.from("tasks").select("*");
      if (error) { await reply(ev.replyToken, "讀取失敗：" + error.message + setupHint); continue; }
      const active = (data ?? []).filter(isActiveTask);
      const q = intent.query;
      let hits = active.filter((t) => t.title === q);                          // 完全相同優先
      if (!hits.length) hits = active.filter((t) => t.title.includes(q) || q.includes(t.title));
      if (!hits.length) {
        await reply(ev.replyToken, `找不到待辦：「${q}」\n輸入「清單」看目前有哪些。` + setupHint);
        continue;
      }
      if (hits.length > 1) {
        await reply(ev.replyToken, "有多筆符合，請打完整一點：\n" + hits.map((t) => `・${t.title}`).join("\n") + setupHint);
        continue;
      }
      const t = hits[0];
      const who = await senderName(ev.source);
      const nowMs = Date.now();
      const patch: any = t.is_recurring
        ? { status:"done", last_done_at:new Date(nowMs).toISOString(), last_done_by:who,
            next_due_at:new Date(nowMs + t.period_days * DAY).toISOString() }
        : { status:"done", last_done_at:new Date(nowMs).toISOString(), last_done_by:who };
      const upd = await supabase.from("tasks").update(patch).eq("id", t.id);
      if (upd.error) { await reply(ev.replyToken, "標記失敗：" + upd.error.message + setupHint); continue; }
      const rec = t.is_recurring ? `\n🔁 下次：${fmtDate(patch.next_due_at)}（${periodLabel(t.period_days)}）` : "";
      await reply(ev.replyToken, `✔️ 已完成：${t.title}（${who}）${rec}` + setupHint);
      continue;
    }

    // intent.kind === "create"
    if (!intent.title) {
      await reply(ev.replyToken, "要做什麼呢？直接打事情名稱即可。\n輸入「說明」看用法。" + setupHint);
      continue;
    }
    const task = {
      title: intent.title, urgency: intent.urgency,
      is_recurring: intent.period_days != null, period_days: intent.period_days,
      status: "pending", created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("tasks").insert(task);
    if (error) { await reply(ev.replyToken, "新增失敗：" + error.message + setupHint); continue; }

    const badge = intent.urgency === "urgent" ? "🔴 " : "";
    const rec = intent.period_days != null ? `（🔁 ${periodLabel(intent.period_days)}）` : "";
    await reply(ev.replyToken, `✅ 已新增：${badge}${intent.title}${rec}${setupHint}`);
  }

  return new Response("ok");
});
