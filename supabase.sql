-- ============================================================
-- FamilyTasks — Supabase 資料表
-- 用法：Supabase 專案 → 左側 SQL Editor → New query → 貼上全部 → Run
-- ============================================================

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  urgency      text not null default 'normal',   -- 'urgent' | 'normal'
  is_recurring boolean not null default false,
  period_days  integer,                           -- 週期天數；一次性任務為 null
  status       text not null default 'pending',   -- 'pending' | 'done'
  last_done_at timestamptz,
  last_done_by text,
  next_due_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- 安全設定：只有「登入且 email 在名單內」的人才能讀寫。
-- 拿到 anon 金鑰或網址但沒登入 → 完全存取不到資料。
--
-- ⬇⬇⬇ 把下面兩個 email 換成你和老婆真正的 email（用來登入的那個）⬇⬇⬇
alter table public.tasks enable row level security;

-- 先移除舊的（不論之前是全開版還是更早的名稱）
drop policy if exists "family full access" on public.tasks;
drop policy if exists "family members only" on public.tasks;

create policy "family members only"
  on public.tasks
  for all
  to authenticated
  using      ( (auth.jwt() ->> 'email') in ('chalks385@gmail.com', '換成老婆的email@example.com') )
  with check ( (auth.jwt() ->> 'email') in ('chalks385@gmail.com', '換成老婆的email@example.com') );

-- 開啟即時同步（一支手機改動，另一支自動看到）
-- Supabase 通常預設已開；若沒有，執行下一行：
-- alter publication supabase_realtime add table public.tasks;
