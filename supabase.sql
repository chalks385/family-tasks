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

-- 讓前端（anon 金鑰）可以讀寫。
-- 這是「家用、憑網址存取」的簡化設定：知道網址的人就能用，沒有帳號登入。
alter table public.tasks enable row level security;

drop policy if exists "family full access" on public.tasks;
create policy "family full access"
  on public.tasks
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 開啟即時同步（一支手機改動，另一支自動看到）
-- Supabase 通常預設已開；若沒有，執行下一行：
-- alter publication supabase_realtime add table public.tasks;
