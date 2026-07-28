-- 1. Kích hoạt Vector Extension cho RAG
create extension if not exists vector;

-- 2. Bảng Profiles & Projects
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'qa' check (role in ('qa','senior_qa','admin')),
  created_at timestamptz default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- 3. Bảng Test Case Sets & Test Cases
create table public.test_case_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  status text not null default 'generating',
  generated_by_model text,
  created_at timestamptz default now()
);

create table public.test_cases (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references public.test_case_sets(id) on delete cascade,
  code text not null,
  title text not null,
  category text not null,
  priority text not null default 'P2',
  steps jsonb not null default '[]',
  expected_result text,
  status text not null default 'draft',
  created_at timestamptz default now()
);

-- 4. Bảng cho AI Review (Agent)
create table public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references public.test_case_sets(id) on delete cascade,
  coverage_score numeric,
  review_payload jsonb not null,
  model_used text,
  reviewed_at timestamptz default now()
);

-- Row Level Security (Mẫu cơ bản)
alter table public.projects enable row level security;
create policy "Cho phép user xem project của mình" 
on public.projects for select using (true); -- Tuỳ chỉnh lại theo auth.uid() ở thực tế
