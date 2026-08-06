-- =========================================================================
-- Luu y: schema nay duoc dong bo lai cho KHOP voi database Supabase hien tai
-- cua project (van con role "senior_qa" o profiles/project_members va trong
-- 2 policy tren test_cases). Neu sau nay muon bo han senior_qa, hay chay:
--
--   update profiles set role = 'admin' where role = 'senior_qa';
--   update project_members set role = 'admin' where role = 'senior_qa';
--
-- roi moi doi cac dong check(...) va policy ben duoi tu ('qa','senior_qa','admin')
-- ve ('qa','admin').
-- =========================================================================

create extension if not exists vector;
create extension if not exists pgcrypto; -- dam bao gen_random_uuid() luon co san

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'qa' check (role in ('qa','senior_qa','admin')),
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'qa' check (role in ('qa','senior_qa','admin')),
  joined_at timestamptz default now(),
  primary key (project_id, user_id)
);

create table if not exists requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  description text not null,
  source_file_url text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists test_case_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  requirement_id uuid references requirements(id),
  file_url text,
  raw_content jsonb,
  imported_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists test_case_embeddings (
  id uuid primary key default gen_random_uuid(),
  test_case_import_id uuid references test_case_imports(id) on delete cascade,
  content_snippet text,
  embedding vector(768),
  created_at timestamptz default now()
);

create table if not exists test_case_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  requirement_id uuid references requirements(id),
  status text not null default 'generating' check (status in ('generating','generated','reviewed','approved')),
  generated_by_model text,
  -- PHASE 0 "analysis" cua Generation Agent (7-layer deep analysis: rules, EP/BVA,
  -- state transitions, attack vectors, risk ranking, document atom mapping...) -
  -- truoc day AI sinh ra ton token nhung bi vut bo hoan toan sau khi validate
  -- test_cases; gio luu lai o day de audit/hien thi lai ("AI Reasoning" o UI)
  -- ma khong can goi lai AI. Nullable vi khong phai lan generate nao AI cung
  -- tra ve analysis hop le (xem generationAnalysisSchema.safeParse trong
  -- app/api/ai/generate/route.ts - loi o day khong bao gio lam fail request).
  analysis jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists test_cases (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references test_case_sets(id) on delete cascade,
  code text not null,
  title text not null,
  category text not null check (category in ('positive','negative','boundary','ui_ux','compatibility','performance','security','integration','regression','accessibility','localization')),
  priority text not null default 'Major' check (priority in ('Critical','Major','Normal')),
  preconditions jsonb default '[]'::jsonb,
  test_data jsonb default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  expected_result text,
  status text not null default 'draft' check (status in ('draft','in_review','approved')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists test_case_versions (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid references test_cases(id) on delete cascade,
  snapshot jsonb not null,
  edited_by uuid references profiles(id),
  edited_at timestamptz default now()
);

create table if not exists ai_reviews (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references test_case_sets(id) on delete cascade,
  coverage_score numeric check (coverage_score >= 0 and coverage_score <= 100),
  review_payload jsonb not null,
  model_used text,
  reviewed_at timestamptz default now()
);

create table if not exists requirement_traceability (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references test_case_sets(id) on delete cascade,
  requirement_clause text not null,
  test_case_id uuid references test_cases(id),
  is_covered boolean default false
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid references test_cases(id) on delete cascade,
  user_id uuid references profiles(id),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  provider text not null,
  model text not null,
  tokens_input int,
  tokens_output int,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Trigger: tu dong tao 1 dong profiles moi khi co user moi dang ky qua Supabase Auth.
-- Neu khong co trigger nay, moi bang co FK toi profiles(id) se loi ngay sau signup
-- vi chua co ban ghi profiles tuong ung.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'qa'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create index if not exists idx_project_members_user_id on project_members(user_id);
create index if not exists idx_test_case_sets_project_id on test_case_sets(project_id);
create index if not exists idx_test_cases_set_id on test_cases(set_id);
create index if not exists idx_test_case_embeddings_vector on test_case_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table requirements enable row level security;
alter table test_case_imports enable row level security;
alter table test_case_embeddings enable row level security;
alter table test_case_sets enable row level security;
alter table test_cases enable row level security;
alter table test_case_versions enable row level security;
alter table ai_reviews enable row level security;
alter table requirement_traceability enable row level security;
alter table comments enable row level security;
alter table ai_usage_logs enable row level security;

-- Cho phep moi user da dang nhap xem thong tin co ban (ten, avatar, role) cua nguoi khac -
-- can thiet de hien thi ten thanh vien trong team page / comment. Bang nay khong chua
-- du lieu nhay cam nen chap nhan duoc; rieng UPDATE van gioi han ve chinh chu (xem duoi).
drop policy if exists profiles_select_self on profiles;
drop policy if exists profiles_select_authenticated on profiles;
create policy profiles_select_authenticated on profiles for select using (auth.uid() is not null);

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists projects_select_member on projects;
create policy projects_select_member on projects for select using (
  exists (select 1 from project_members pm where pm.project_id = projects.id and pm.user_id = auth.uid())
);

drop policy if exists projects_insert_owner on projects;
create policy projects_insert_owner on projects for insert with check (owner_id = auth.uid());

-- Chi admin cua project moi duoc xoa project (dung is_project_admin dinh nghia ben duoi,
-- nen policy nay duoc tao lai o cuoi sau khi ham da ton tai - xem duoi).

-- ----------------------------------------------------------------------------
-- Helper functions SECURITY DEFINER de kiem tra quyen thanh vien/admin project.
-- BAT BUOC dung cach nay thay vi EXISTS(select ... from project_members ...) truc tiep
-- trong chinh policy CUA BANG project_members - neu khong Postgres se rat vao loop
-- vo han ("infinite recursion detected in policy for relation project_members"):
-- de chay subquery, no phai ap dung lai chinh policy dang duoc dinh nghia.
-- Ham SECURITY DEFINER chay voi quyen cua nguoi tao (owner) nen KHONG bi RLS chan lai,
-- pha duoc vong lap. Chi dung cho dung 2 muc dich kiem tra quyen nay, khong dung sai.
-- ----------------------------------------------------------------------------
create or replace function public.is_project_member(p_project_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = p_user_id
  );
$$;

create or replace function public.is_project_admin(p_project_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = p_user_id and role = 'admin'
  );
$$;

drop policy if exists project_members_select_member on project_members;
create policy project_members_select_member on project_members for select using (
  is_project_member(project_members.project_id)
);

drop policy if exists projects_delete_admin on projects;
create policy projects_delete_admin on projects for delete using (
  is_project_admin(projects.id)
);

-- Admin cua project duoc quan ly toan bo thanh vien. Rieng INSERT con cho phep
-- "bootstrap": chu so huu project (projects.owner_id) tu them chinh minh lam
-- thanh vien dau tien - neu khong se bi ket (chua co admin nao de duoc phep them admin dau tien).
drop policy if exists project_members_manage_admin on project_members;
create policy project_members_manage_admin on project_members for all using (
  is_project_admin(project_members.project_id)
) with check (
  is_project_admin(project_members.project_id)
);

drop policy if exists project_members_bootstrap_owner on project_members;
create policy project_members_bootstrap_owner on project_members for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from projects p
    where p.id = project_members.project_id and p.owner_id = auth.uid()
  )
);

drop policy if exists requirements_member_access on requirements;
create policy requirements_member_access on requirements for all using (
  exists (select 1 from project_members pm where pm.project_id = requirements.project_id and pm.user_id = auth.uid())
) with check (
  exists (select 1 from project_members pm where pm.project_id = requirements.project_id and pm.user_id = auth.uid())
);

drop policy if exists test_case_imports_member_access on test_case_imports;
create policy test_case_imports_member_access on test_case_imports for all using (
  exists (select 1 from project_members pm where pm.project_id = test_case_imports.project_id and pm.user_id = auth.uid())
) with check (
  exists (select 1 from project_members pm where pm.project_id = test_case_imports.project_id and pm.user_id = auth.uid())
);

drop policy if exists test_case_embeddings_member_select on test_case_embeddings;
create policy test_case_embeddings_member_select on test_case_embeddings for select using (
  exists (
    select 1 from test_case_imports i
    join project_members pm on pm.project_id = i.project_id
    where i.id = test_case_embeddings.test_case_import_id and pm.user_id = auth.uid()
  )
);

drop policy if exists test_case_embeddings_member_insert on test_case_embeddings;
create policy test_case_embeddings_member_insert on test_case_embeddings for insert with check (
  exists (
    select 1 from test_case_imports i
    join project_members pm on pm.project_id = i.project_id
    where i.id = test_case_embeddings.test_case_import_id and pm.user_id = auth.uid()
  )
);

drop policy if exists test_case_sets_member_access on test_case_sets;
create policy test_case_sets_member_access on test_case_sets for all using (
  exists (select 1 from project_members pm where pm.project_id = test_case_sets.project_id and pm.user_id = auth.uid())
) with check (
  exists (select 1 from project_members pm where pm.project_id = test_case_sets.project_id and pm.user_id = auth.uid())
);

drop policy if exists test_cases_member_select on test_cases;
create policy test_cases_member_select on test_cases for select using (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = test_cases.set_id and pm.user_id = auth.uid()
  )
);

drop policy if exists test_cases_member_insert on test_cases;
create policy test_cases_member_insert on test_cases for insert with check (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = test_cases.set_id and pm.user_id = auth.uid()
  )
);

drop policy if exists test_cases_member_update on test_cases;
create policy test_cases_member_update on test_cases for update using (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = test_cases.set_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = test_cases.set_id and pm.user_id = auth.uid()
      and (test_cases.status <> 'approved' or pm.role in ('senior_qa','admin'))
  )
);

-- Xoa test case: cho phep moi thanh vien project (qa hoac admin) - truoc day
-- chi gioi han senior_qa/admin nhung thuc te qa van can tu xoa duoc case cua minh.
drop policy if exists test_cases_senior_delete on test_cases;
create policy test_cases_senior_delete on test_cases for delete using (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = test_cases.set_id and pm.user_id = auth.uid() and pm.role in ('qa', 'senior_qa', 'admin')
  )
);

drop policy if exists test_case_versions_member_access on test_case_versions;
create policy test_case_versions_member_access on test_case_versions for all using (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = test_case_versions.test_case_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = test_case_versions.test_case_id and pm.user_id = auth.uid()
  )
);

drop policy if exists ai_reviews_member_access on ai_reviews;
create policy ai_reviews_member_access on ai_reviews for all using (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = ai_reviews.set_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = ai_reviews.set_id and pm.user_id = auth.uid()
  )
);

drop policy if exists requirement_traceability_member_access on requirement_traceability;
create policy requirement_traceability_member_access on requirement_traceability for all using (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = requirement_traceability.set_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_case_sets s
    join project_members pm on pm.project_id = s.project_id
    where s.id = requirement_traceability.set_id and pm.user_id = auth.uid()
  )
);

drop policy if exists comments_member_access on comments;
create policy comments_member_access on comments for all using (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = comments.test_case_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = comments.test_case_id and pm.user_id = auth.uid()
  )
);

drop policy if exists ai_usage_logs_select_self on ai_usage_logs;
create policy ai_usage_logs_select_self on ai_usage_logs for select using (user_id = auth.uid());

drop policy if exists ai_usage_logs_insert_self on ai_usage_logs;
create policy ai_usage_logs_insert_self on ai_usage_logs for insert with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Migration: doi thang priority tu P1..P4 sang Critical/Major/Normal.
-- An toan chay lai nhieu lan (idempotent) - chi migrate neu constraint cu con ton tai.
-- Mapping: P1 -> Critical, P2 -> Major, P3/P4 -> Normal.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'test_cases' and column_name = 'priority'
  ) then
    alter table test_cases alter column priority drop default;
    update test_cases set priority = case priority
      when 'P1' then 'Critical'
      when 'P2' then 'Major'
      when 'P3' then 'Normal'
      when 'P4' then 'Normal'
      else priority
    end
    where priority in ('P1','P2','P3','P4');

    alter table test_cases drop constraint if exists test_cases_priority_check;
    alter table test_cases add constraint test_cases_priority_check
      check (priority in ('Critical','Major','Normal'));
    alter table test_cases alter column priority set default 'Major';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Realtime: bat publication cho bang comments de UI comment tren test case
-- co the subscribe qua supabase-js .channel(...).on('postgres_changes', ...).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table comments;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Migration: them cot test_case_sets.analysis (jsonb) cho DB da chay schema.sql
-- tu truoc khi cot nay ton tai. An toan chay lai nhieu lan (idempotent).
-- Xem comment day du o dinh nghia bang test_case_sets phia tren.
-- ----------------------------------------------------------------------------
alter table test_case_sets add column if not exists analysis jsonb;

-- ============================================================================
-- Phase 3 roadmap item: "Automation test with AI" (Playwright Automation Agent).
-- Xem lib/ai/prompts/playwright-agent.ts, lib/validators/playwright.ts,
-- lib/automation/browser-runner.ts, app/api/ai/playwright + app/api/automation/*.
--
-- automation_scripts: 1 ban ghi = 1 lan "Generate Playwright Code" cho 1 test case.
--   Giong tinh than test_case_versions - KHONG BAO GIO ghi de, luon insert version
--   moi (version tang dan) de QA xem lai lich su / diff cac lan generate.
-- automation_runs: 1 ban ghi = 1 lan "Run Automation Test". Luu status, thoi gian
--   chay, screenshot (path trong storage bucket automation-screenshots, KHONG luu
--   public URL vi bucket private), chi tiet loi (neu fail/error), va snapshot code
--   THUC SU da chay (co the khac ban moi nhat trong automation_scripts neu QA sua tay).
--
-- Ca 2 bang deu join qua test_cases -> test_case_sets -> project_members giong het
-- pattern cua test_case_versions/comments (xem RLS ben duoi) - test_cases van KHONG
-- co project_id truc tiep, tuan thu dung "Core Principle #4" cua README.
-- ============================================================================

-- Badge trang thai automation tren the test case (library list) - xem
-- components/test-case-list/test-case-table.tsx. Cap nhat boi app/api/ai/playwright
-- (not_generated -> generated) va app/api/automation/run (-> passed | failed).
alter table test_cases add column if not exists automation_status text not null default 'not_generated'
  check (automation_status in ('not_generated', 'generated', 'passed', 'failed'));

create table if not exists automation_scripts (
  id uuid primary key default gen_random_uuid()
);
-- ALTER ... ADD COLUMN IF NOT EXISTS instead of relying on CREATE TABLE IF NOT
-- EXISTS alone: if a table named automation_scripts already exists in your DB
-- (e.g. a partial run of an earlier version of this migration), CREATE TABLE
-- IF NOT EXISTS is a silent no-op and any columns missing from that old shape
-- would otherwise never get added - which is exactly what produces
-- "column test_case_id does not exist" on the CREATE INDEX/policy statements
-- below. This block self-heals regardless of what was already there.
alter table automation_scripts add column if not exists test_case_id uuid references test_cases(id) on delete cascade;
alter table automation_scripts add column if not exists version int not null default 1;
alter table automation_scripts add column if not exists code text;
alter table automation_scripts add column if not exists imports_used jsonb default '[]'::jsonb;
alter table automation_scripts add column if not exists selectors_used jsonb default '[]'::jsonb;
alter table automation_scripts add column if not exists warnings jsonb default '[]'::jsonb;
-- environment.public shape only (browser/target_url/auth_mode) - KHONG BAO GIO
-- chua cookie_token/password, xem toPublicEnvironment() trong lib/validators/playwright.ts.
alter table automation_scripts add column if not exists environment jsonb;
-- snapshot cua DOM/element map dung lam grounding context cho lan generate nay (audit trail).
alter table automation_scripts add column if not exists element_map jsonb;
alter table automation_scripts add column if not exists model_used text;
alter table automation_scripts add column if not exists generated_by uuid references profiles(id);
alter table automation_scripts add column if not exists created_at timestamptz default now();
-- code was added as nullable above (ADD COLUMN can't add a NOT NULL column to
-- a table that may already have rows without a default); enforce NOT NULL now
-- that any pre-existing rows would already have a value or this is a fresh table.
do $$
begin
  if not exists (select 1 from automation_scripts where code is null) then
    alter table automation_scripts alter column code set not null;
  end if;
end $$;

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid()
);
alter table automation_runs add column if not exists test_case_id uuid references test_cases(id) on delete cascade;
alter table automation_runs add column if not exists script_id uuid references automation_scripts(id) on delete set null;
alter table automation_runs add column if not exists status text check (status in ('passed', 'failed', 'error'));
alter table automation_runs add column if not exists duration_ms int;
-- PATH trong bucket automation-screenshots (vd '<test_case_id>/<run_id>.png'), khong
-- phai URL public - bucket la private, UI luon xin signed URL moi khi hien thi.
alter table automation_runs add column if not exists screenshot_url text;
alter table automation_runs add column if not exists failure_details jsonb;
alter table automation_runs add column if not exists code_snapshot text;
alter table automation_runs add column if not exists run_by uuid references profiles(id);
alter table automation_runs add column if not exists started_at timestamptz default now();
alter table automation_runs add column if not exists finished_at timestamptz;
do $$
begin
  if not exists (select 1 from automation_runs where status is null) then
    alter table automation_runs alter column status set not null;
  end if;
  if not exists (select 1 from automation_runs where code_snapshot is null) then
    alter table automation_runs alter column code_snapshot set not null;
  end if;
end $$;

create index if not exists idx_automation_scripts_test_case_id on automation_scripts(test_case_id);
create index if not exists idx_automation_runs_test_case_id on automation_runs(test_case_id);

alter table automation_scripts enable row level security;
alter table automation_runs enable row level security;

drop policy if exists automation_scripts_member_access on automation_scripts;
create policy automation_scripts_member_access on automation_scripts for all using (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = automation_scripts.test_case_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = automation_scripts.test_case_id and pm.user_id = auth.uid()
  )
);

drop policy if exists automation_runs_member_access on automation_runs;
create policy automation_runs_member_access on automation_runs for all using (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = automation_runs.test_case_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id = automation_runs.test_case_id and pm.user_id = auth.uid()
  )
);

-- ----------------------------------------------------------------------------
-- Storage: bucket rieng cho screenshot cua automation run, PRIVATE (khong public) -
-- object name convention: '<test_case_id>/<run_id>.png' (xem lib/automation/screenshot-storage.ts),
-- de policy duoi day co the tach test_case_id ra tu ten object va doi chieu project_members
-- (giong het "join qua test_case_sets" cua moi bang khac trong file nay).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('automation-screenshots', 'automation-screenshots', false)
on conflict (id) do nothing;

create or replace function public.can_access_automation_screenshot(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from test_cases tc
    join test_case_sets s on s.id = tc.set_id
    join project_members pm on pm.project_id = s.project_id
    where tc.id::text = split_part(object_name, '/', 1) and pm.user_id = auth.uid()
  );
$$;

drop policy if exists automation_screenshots_select on storage.objects;
create policy automation_screenshots_select on storage.objects for select using (
  bucket_id = 'automation-screenshots' and can_access_automation_screenshot(name)
);

drop policy if exists automation_screenshots_insert on storage.objects;
create policy automation_screenshots_insert on storage.objects for insert with check (
  bucket_id = 'automation-screenshots' and can_access_automation_screenshot(name)
);

drop policy if exists automation_screenshots_update on storage.objects;
create policy automation_screenshots_update on storage.objects for update using (
  bucket_id = 'automation-screenshots' and can_access_automation_screenshot(name)
);

drop policy if exists automation_screenshots_delete on storage.objects;
create policy automation_screenshots_delete on storage.objects for delete using (
  bucket_id = 'automation-screenshots' and can_access_automation_screenshot(name)
);
