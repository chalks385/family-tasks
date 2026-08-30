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
  | { cmd: "help" } | { cmd: "list" }
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

const HELP = [
  "📋 家庭待辦 — 傳訊息就能建立",
  "",
  "・晾衣服 → 一般待辦",
  "・!晾衣服（或 急 晾衣服）→ 🔴 緊急",
  "・每天 倒垃圾 → 每日重複",
  "・每週 / 每月 / 每3個月 / 每半年 / 每年 / 每5天 …",
  "・!每天 收衣服 → 緊急 + 重複",
  "",
  "・清單 → 看目前待辦",
  "・說明 → 顯示這個",
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

    const p = parse(ev.message.text);
    if ("cmd" in p && p.cmd === "help") { await reply(ev.replyToken, HELP + setupHint); continue; }
    if ("cmd" in p && p.cmd === "list") { await reply(ev.replyToken, (await listText()) + setupHint); continue; }
    if (!("title" in p) || !p.title) {
      await reply(ev.replyToken, "要做什麼呢？直接打事情名稱即可。\n輸入「說明」看用法。" + setupHint);
      continue;
    }

    const task = {
      title: p.title, urgency: p.urgency,
      is_recurring: p.is_recurring, period_days: p.period_days,
      status: "pending", created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("tasks").insert(task);
    if (error) { await reply(ev.replyToken, "新增失敗：" + error.message + setupHint); continue; }

    const badge = p.urgency === "urgent" ? "🔴 " : "";
    const rec = p.is_recurring ? `（🔁 ${periodLabel(p.period_days)}）` : "";
    await reply(ev.replyToken, `✅ 已新增：${badge}${p.title}${rec}${setupHint}`);
  }

  return new Response("ok");
});
