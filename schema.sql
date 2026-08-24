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
  -- Cau truc GeneratedTestCase day du (code/title/category/steps/...) cua chinh
  -- case duoc embed - luu lai de RAG retrieval (match_test_case_embeddings ben
  -- duoi) tra thang ve duoc object test case, khong can parse lai content_snippet.
  raw_case jsonb,
  embedding vector(768),
  created_at timestamptz default now()
);

-- Idempotent cho DB da chay schema.sql tu truoc khi co cot raw_case.
alter table test_case_embeddings add column if not exists raw_case jsonb;

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
  -- on delete set null (khong phai cascade): xoa 1 test case khong duoc lam mat
  -- luon requirement_clause khoi ma tran traceability, chi lam clause do quay ve
  -- trang thai "chua duoc cover". Xem migration idempotent ngay ben duoi de fix
  -- cac DB da tao truoc khi co on delete action nay.
  test_case_id uuid references test_cases(id) on delete set null,
  is_covered boolean default false
);

-- Migration idempotent: cac DB da chay "create table if not exists" tu truoc khi
-- co "on delete set null" o tren se van con constraint cu (NO ACTION), gay loi
-- "update or delete on table test_cases violates foreign key constraint
-- requirement_traceability_test_case_id_fkey" khi xoa test case. Doi lai constraint
-- de an toan xoa test case ma khong mat dong requirement_traceability.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'requirement_traceability_test_case_id_fkey'
      and table_name = 'requirement_traceability'
  ) then
    alter table requirement_traceability
      drop constraint requirement_traceability_test_case_id_fkey;
  end if;

  alter table requirement_traceability
    add constraint requirement_traceability_test_case_id_fkey
    foreign key (test_case_id) references test_cases(id) on delete set null;
end $$;

-- Khi test_case_id bi set null do test case bi xoa, tu dong dua is_covered ve
-- false thay vi de app phai tu xu ly rieng.
create or replace function set_traceability_uncovered()
returns trigger as $$
begin
  if new.test_case_id is null then
    new.is_covered := false;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_traceability_uncovered on requirement_traceability;
create trigger trg_traceability_uncovered
  before update on requirement_traceability
  for each row
  when (old.test_case_id is not null and new.test_case_id is null)
  execute function set_traceability_uncovered();

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
create index if not exists idx_test_case_imports_project_id on test_case_imports(project_id);

-- ----------------------------------------------------------------------------
-- RAG retrieval: semantic search over previously-embedded old test cases,
-- scoped to a single project. Called from services/rag/test-case-rag.ts
-- (POST /api/ai/retrieve) with the embedding of the current requirement
-- description as query_embedding. NOT security definer - runs with the
-- caller's privileges so the existing test_case_embeddings_member_select /
-- test_case_imports_member_access RLS policies apply exactly as if the join
-- were run directly by the client; match_project_id only narrows which of the
-- caller's own projects to search within.
-- ----------------------------------------------------------------------------
create or replace function public.match_test_case_embeddings(
  query_embedding vector(768),
  match_project_id uuid,
  match_count int default 5,
  match_threshold float default 0.5
)
returns table (
  id uuid,
  test_case_import_id uuid,
  content_snippet text,
  raw_case jsonb,
  similarity float
)
language sql
stable
as $$
  select
    tce.id,
    tce.test_case_import_id,
    tce.content_snippet,
    tce.raw_case,
    1 - (tce.embedding <=> query_embedding) as similarity
  from test_case_embeddings tce
  join test_case_imports tci on tci.id = tce.test_case_import_id
  where tci.project_id = match_project_id
    and tce.embedding is not null
    and 1 - (tce.embedding <=> query_embedding) > match_threshold
  order by tce.embedding <=> query_embedding
  limit match_count;
$$;

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
-- Page Object Model classes (Requirement 1 v2 - lay cam hung tu
-- ai-agent-playwright-typescript-template's src/pages/ui/*.ts layout). Moi phan tu:
-- {class_name, file_name, page_label, page_url, code} - xem pageObjectSchema trong
-- lib/validators/playwright.ts. "code" instantiates chung qua `new <class_name>(page)`.
-- Duoc bien dich + noi vao CUNG scope voi spec body khi chay inline (xem
-- lib/automation/browser-runner.ts#compilePageObjectsToJs), va la nguon cho tinh nang
-- "Export Playwright Project" (Requirement 2 roadmap - moi page object -> 1 file rieng
-- duoi src/pages/ui/).
alter table automation_scripts add column if not exists page_objects jsonb default '[]'::jsonb;
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
-- CRITICAL FIX: soft-delete column referenced everywhere (GET .../scripts,
-- DELETE .../scripts/[scriptId]) but never actually added by any prior
-- migration - every read/delete of automation_scripts was failing at the DB
-- level with "column automation_scripts.deleted_at does not exist" until this
-- line existed. NULL = active/visible; set = soft-deleted (see DELETE handler
-- in app/api/test-cases/[id]/automation/scripts/[scriptId]/route.ts). Kept as
-- a soft delete (not a hard DELETE) so automation_runs.script_id references
-- and each run's code_snapshot/page_objects_snapshot audit trail stay intact.
alter table automation_scripts add column if not exists deleted_at timestamptz;
-- "Review Gate" state machine (Architectural Pattern): a freshly generated
-- script always lands 'pending_review' - it must be explicitly reviewed,
-- either "Approve & Run" (PATCH .../scripts/[scriptId], approve as-is) or
-- "Edit / Tweak" (POST .../scripts, self-approves on save) - before the Run
-- button will execute it. Enforced both client-side (RunResultPanel /
-- useAutomation.runTest) and server-side (app/api/automation/run/route.ts),
-- so it can't be bypassed by calling the run API directly. Batch Automation
-- (lib/automation/batch-runner.ts) deliberately runs through a different,
-- lower-level code path (runGeneratedScript directly, not this HTTP route) -
-- it stays unattended by design and is unaffected by this gate.
alter table automation_scripts add column if not exists status text not null default 'pending_review'
  check (status in ('pending_review', 'approved'));
alter table automation_scripts add column if not exists approved_by uuid references profiles(id);
alter table automation_scripts add column if not exists approved_at timestamptz;
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
-- Snapshot cua page_objects DUNG khi chay lan nay (cung tinh than voi code_snapshot -
-- co the khac ban moi nhat trong automation_scripts neu chay ad-hoc code chua luu).
alter table automation_runs add column if not exists page_objects_snapshot jsonb default '[]'::jsonb;
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
-- Covers the run-history query (WHERE test_case_id = ? ORDER BY started_at DESC LIMIT 20):
-- without this, Postgres scans+sorts every run for the test case on each page load.
create index if not exists idx_automation_runs_test_case_started_at on automation_runs(test_case_id, started_at desc);

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

-- ============================================================================
-- Phase 4 roadmap item: "Batch Automation" (Import test cases -> run automation
-- on many/all at once instead of one record at a time). See AUTOMATION_QA_FIXES.md
-- for the browser-runner.ts hardening this batch layer sits on top of unchanged -
-- batch execution reuses runGeneratedScript() as-is, one test case per invocation.
--
-- Architecture constraint driving this design: deployed on Vercel HOBBY plan.
--   - maxDuration is hard-capped at 60s regardless of what a route declares.
--   - Vercel Cron on Hobby only fires once/day - NOT usable as a queue "tick".
--   - No long-running worker process exists on serverless.
-- => There is no server-side background runner. The queue is advanced by the
--    browser tab itself calling /api/automation/batch-run/[id]/process-next
--    once per item, in a loop, for as long as the tab stays open. A batch is
--    fully resumable: closing the tab just pauses it at whatever's still
--    'queued' - reopening and clicking Resume continues from there. This is a
--    deliberate trade-off for the current hosting tier, not a hidden limitation.
--
-- Security: automation_batch_run_items NEVER stores cookie_token / username /
-- password - same "never persisted" rule as environment_config_schema in
-- lib/validators/playwright.ts. Credentials (when the chosen environment's
-- auth_mode isn't 'none') are entered once by the user at batch-start time,
-- held only in browser memory (React state) for the lifetime of the batch, and
-- resent with every process-next call. Reopening a paused batch asks for them
-- again - that's the accepted cost of not persisting secrets.
-- ============================================================================

-- project_environments: reusable, NON-secret automation target config per
-- project (browser + target_url + which auth mode to prompt for) - saved so a
-- QA doesn't retype the target URL for every single test case / every batch.
-- Deliberately holds NOTHING secret - see header comment above.
create table if not exists project_environments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  browser text not null default 'chromium' check (browser in ('chromium', 'firefox', 'edge')),
  target_url text not null,
  auth_mode text not null default 'none' check (auth_mode in ('none', 'cookie', 'login')),
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create index if not exists idx_project_environments_project_id on project_environments(project_id);

alter table project_environments enable row level security;

drop policy if exists project_environments_member_access on project_environments;
create policy project_environments_member_access on project_environments for all using (
  exists (
    select 1 from project_members pm
    where pm.project_id = project_environments.project_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from project_members pm
    where pm.project_id = project_environments.project_id and pm.user_id = auth.uid()
  )
);

-- automation_batch_runs: 1 row = 1 "Run Automation on N test cases" batch.
-- status is derived/updated as items complete (not a live aggregate query) so
-- the batch list page stays a cheap single-table read.
create table if not exists automation_batch_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  environment_id uuid references project_environments(id) on delete set null,
  -- Denormalized snapshot of the environment's public config at batch-start time
  -- (browser/target_url/auth_mode) - so a batch's history stays meaningful even
  -- if the saved environment is later edited or deleted (on delete set null above).
  environment_snapshot jsonb not null,
  total_count int not null default 0,
  queued_count int not null default 0,
  running_count int not null default 0,
  passed_count int not null default 0,
  failed_count int not null default 0,
  error_count int not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'completed')),
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_automation_batch_runs_project_id on automation_batch_runs(project_id);

-- automation_batch_run_items: 1 row = 1 test case's place in a batch. Deliberately
-- thin - the actual pass/fail evidence (screenshot, failure_details) is still
-- written to automation_runs by the exact same runGeneratedScript()+insert path
-- app/api/automation/run already uses (see app/api/automation/batch-run/[id]/process-next),
-- linked back here via run_id. This table only tracks QUEUE POSITION/STATUS, not
-- run results, so there's exactly one source of truth for "what happened".
create table if not exists automation_batch_run_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references automation_batch_runs(id) on delete cascade,
  test_case_id uuid references test_cases(id) on delete cascade,
  -- Order test cases were added to the batch in - process-next always picks the
  -- lowest-position 'queued' item, so results land in a predictable order.
  position int not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'error', 'skipped')),
  -- Set when this item required a Generate step first (no automation_scripts yet)
  -- and that step itself failed - distinct from a run failure.
  generate_error text,
  run_id uuid references automation_runs(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_automation_batch_run_items_batch_id on automation_batch_run_items(batch_id);
create index if not exists idx_automation_batch_run_items_status on automation_batch_run_items(batch_id, status);

alter table automation_batch_runs enable row level security;
alter table automation_batch_run_items enable row level security;

drop policy if exists automation_batch_runs_member_access on automation_batch_runs;
create policy automation_batch_runs_member_access on automation_batch_runs for all using (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_batch_runs.project_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_batch_runs.project_id and pm.user_id = auth.uid()
  )
);

drop policy if exists automation_batch_run_items_member_access on automation_batch_run_items;
create policy automation_batch_run_items_member_access on automation_batch_run_items for all using (
  exists (
    select 1 from automation_batch_runs b
    join project_members pm on pm.project_id = b.project_id
    where b.id = automation_batch_run_items.batch_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from automation_batch_runs b
    join project_members pm on pm.project_id = b.project_id
    where b.id = automation_batch_run_items.batch_id and pm.user_id = auth.uid()
  )
);

-- Atomically claims the next queued item in a batch (FOR UPDATE SKIP LOCKED so
-- two tabs polling the same batch — or the client tab + a future cron fallback —
-- never both grab the same test case). SECURITY DEFINER (matching
-- is_project_member's pattern above) because it needs to lock across rows
-- regardless of the caller's own RLS visibility ordering; the membership check
-- is done explicitly up front since SECURITY DEFINER bypasses the table's RLS.
create or replace function public.claim_next_batch_item(p_batch_id uuid)
returns automation_batch_run_items
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed automation_batch_run_items;
begin
  if not exists (
    select 1 from automation_batch_runs b
    join project_members pm on pm.project_id = b.project_id
    where b.id = p_batch_id and pm.user_id = auth.uid()
  ) then
    raise exception 'Không có quyền truy cập batch này.';
  end if;

  select * into claimed
  from automation_batch_run_items
  where batch_id = p_batch_id and status = 'queued'
  order by position asc
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update automation_batch_run_items
  set status = 'running', started_at = now()
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

grant execute on function public.claim_next_batch_item(uuid) to authenticated;

-- ============================================================================
-- Automation Agent Rebuild (xem docs/automation-agent-rebuild.md cho thiết kế
-- đầy đủ) - Pha 1: Schema + Page Object Registry. KHONG doi hanh vi chay hien
-- tai - moi cot/bang moi deu co default an toan, execution_mode mac dinh
-- 'serverless' cho toan bo environment cu, nen khong ai bi anh huong ngay khi
-- migration nay chay.
--
-- Van de duoc giai quyet: truoc day moi lan "Generate" tren 1 test case sinh
-- LAI TU DAU toan bo Page Object cho moi trang no cham toi - 2 test case cung
-- cham trang Login se tao ra 2 ban LoginPage doc lap, co the lech nhau (khac
-- selector neu DOM doi giua 2 lan generate, khac method set). Vi pham nguyen
-- tac DRY cua Page Object Model va la rao can truc tiep cho tinh nang export
-- ra git (se tao duplicate file). Gio Page Object la 1 ENTITY SONG O CAP
-- PROJECT (automation_page_objects), duoc MO RONG dan qua cac lan generate
-- (them method moi), khong bao gio bi regenerate/ghi de tu dau.
--
-- automation_scripts.page_objects (jsonb, da co) KHONG bi xoa - van la SNAPSHOT
-- "tai thoi diem generate", dung lam nguon cho RUN (dam bao chay dung ban da
-- duoc review/approve, khong am tham chay code registry moi hon chua duoc
-- duyet). Registry la nguon cho GENERATE LAN SAU va cho EXPORT.
-- ============================================================================

-- automation_page_objects: 1 class Page Object = 1 hang, duy nhat theo
-- (project_id, class_name). "code" la noi dung file .ts day du, "method_signatures"
-- la audit trail nhe (khong phai AST) cho biet method nao duoc ai/khi nao them -
-- dung de hien thi lich su tren UI Registry va lam input cho Merge Engine
-- (xem lib/automation/page-object-merge.ts) khi so sanh voi 1 ban AI moi de xuat.
create table if not exists automation_page_objects (
  id uuid primary key default gen_random_uuid()
);
alter table automation_page_objects add column if not exists project_id uuid references projects(id) on delete cascade;
alter table automation_page_objects add column if not exists class_name text;
alter table automation_page_objects add column if not exists file_name text;
alter table automation_page_objects add column if not exists page_label text;
-- URL da chuan hoa (bo query string, thay UUID/id so nguyen dai bang ':id') de
-- lan inspect sau match duoc "day la cung 1 trang" du query string khac nhau -
-- xem normalizePageUrlPattern() trong lib/automation/page-object-registry.ts.
alter table automation_page_objects add column if not exists page_url_pattern text;
alter table automation_page_objects add column if not exists code text;
alter table automation_page_objects add column if not exists method_signatures jsonb not null default '[]'::jsonb;
alter table automation_page_objects add column if not exists version int not null default 1;
alter table automation_page_objects add column if not exists updated_by uuid references profiles(id);
alter table automation_page_objects add column if not exists updated_at timestamptz default now();
alter table automation_page_objects add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (select 1 from automation_page_objects where class_name is null or file_name is null or code is null) then
    alter table automation_page_objects alter column class_name set not null;
    alter table automation_page_objects alter column file_name set not null;
    alter table automation_page_objects alter column code set not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'automation_page_objects_project_class_unique'
  ) then
    alter table automation_page_objects
      add constraint automation_page_objects_project_class_unique unique (project_id, class_name);
  end if;
end $$;

create index if not exists idx_automation_page_objects_project_id on automation_page_objects(project_id);

-- automation_script_page_object_refs: ghi lai 1 script (1 lan Generate cho 1 test
-- case) da dung registry entry nao O PHIEN BAN NAO tai thoi diem generate - can
-- cho traceability + export (Exporter biet chinh xac phai lay dung version nao,
-- khong am tham keo 1 thay doi registry moi hon vao ban export cua 1 script cu).
create table if not exists automation_script_page_object_refs (
  script_id uuid references automation_scripts(id) on delete cascade,
  page_object_id uuid references automation_page_objects(id) on delete cascade,
  page_object_version_used int not null,
  created_at timestamptz default now(),
  primary key (script_id, page_object_id)
);

-- automation_registry_conflicts: hang doi review khi Merge Engine phat hien 1
-- method AI de xuat TRUNG TEN voi 1 method da co trong registry nhung NOI DUNG
-- khac nhau - khong bao gio tu dong ghi de (P3 trong tai lieu thiet ke), luon
-- can con nguoi doi chieu. Luu ca 2 ban (proposed/existing) de reviewer thay
-- diff ngay tren UI ma khong can doi chieu code thu cong.
create table if not exists automation_registry_conflicts (
  id uuid primary key default gen_random_uuid()
);
alter table automation_registry_conflicts add column if not exists project_id uuid references projects(id) on delete cascade;
alter table automation_registry_conflicts add column if not exists page_object_id uuid references automation_page_objects(id) on delete cascade;
alter table automation_registry_conflicts add column if not exists method_name text;
alter table automation_registry_conflicts add column if not exists reason text;
alter table automation_registry_conflicts add column if not exists proposed_code text;
alter table automation_registry_conflicts add column if not exists existing_code text;
alter table automation_registry_conflicts add column if not exists source_test_case_id uuid references test_cases(id) on delete set null;
alter table automation_registry_conflicts add column if not exists source_script_id uuid references automation_scripts(id) on delete set null;
alter table automation_registry_conflicts add column if not exists status text not null default 'pending'
  check (status in ('pending', 'resolved_keep_existing', 'resolved_use_proposed', 'resolved_manual'));
alter table automation_registry_conflicts add column if not exists resolved_by uuid references profiles(id);
alter table automation_registry_conflicts add column if not exists resolved_at timestamptz;
alter table automation_registry_conflicts add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (select 1 from automation_registry_conflicts where method_name is null or reason is null) then
    alter table automation_registry_conflicts alter column method_name set not null;
    alter table automation_registry_conflicts alter column reason set not null;
  end if;
end $$;

create index if not exists idx_automation_registry_conflicts_project_status
  on automation_registry_conflicts(project_id, status);

-- automation_suite_exports: audit trail cho tinh nang "Export to Git" (Pha 5 -
-- xem docs/automation-agent-rebuild.md#4.4). Bang nay bat dau vo dung ngay tu
-- Pha 1 vi khong co gi phu thuoc vao no de hoat dong - tao truoc de khoi phai
-- migrate them lan nua khi Exporter duoc xay. TUYET DOI KHONG co cot luu git
-- token - chi luu KET QUA cua viec dung token (commit_sha), giong het cach
-- cookie_token/login o project_environments khong bao gio duoc ben nay dot cham.
create table if not exists automation_suite_exports (
  id uuid primary key default gen_random_uuid()
);
alter table automation_suite_exports add column if not exists project_id uuid references projects(id) on delete cascade;
alter table automation_suite_exports add column if not exists scope jsonb not null default '{}'::jsonb;
alter table automation_suite_exports add column if not exists script_versions jsonb not null default '[]'::jsonb;
alter table automation_suite_exports add column if not exists target text;
alter table automation_suite_exports add column if not exists commit_sha text;
alter table automation_suite_exports add column if not exists pr_url text;
alter table automation_suite_exports add column if not exists exported_by uuid references profiles(id);
alter table automation_suite_exports add column if not exists exported_at timestamptz default now();

create index if not exists idx_automation_suite_exports_project_id on automation_suite_exports(project_id);

-- ── execution_mode: chon Preview (serverless, eval-based, nhu hien tai) hay ──
-- Full run (self-hosted, @playwright/test that voi trace/video/retry/report) -
-- xem lib/automation/runner.ts. Mac dinh 'serverless' cho MOI environment cu/moi
-- - self_hosted chi thuc su chay duoc khi AUTOMATION_RUNTIME=local (validator
-- server-side tu choi chon self_hosted tren Vercel, giong cach assertBrowserAllowed
-- da chan firefox/edge tren serverless tu truoc).
alter table project_environments add column if not exists execution_mode text not null default 'serverless'
  check (execution_mode in ('serverless', 'self_hosted'));

-- automation_runs: them cot cho ket qua "Full run" (self-hosted) - trace/video/
-- report chi self-hosted moi dien, serverless de null. is_flaky = true khi lan
-- retry-1 (self-hosted, xem P4 trong tai lieu thiet ke) cho ket qua KHAC lan dau
-- (fail roi pass) - khong bao gio am tham bao xanh, luon danh dau ro flaky != passed.
alter table automation_runs add column if not exists trace_url text;
alter table automation_runs add column if not exists video_url text;
alter table automation_runs add column if not exists html_report_url text;
alter table automation_runs add column if not exists attempts int not null default 1;
alter table automation_runs add column if not exists is_flaky boolean not null default false;
alter table automation_runs add column if not exists execution_mode text not null default 'serverless_preview'
  check (execution_mode in ('serverless_preview', 'self_hosted'));

-- BUG FIX: the original 'status' check constraint (further up this file, when
-- automation_runs was first created) only allows ('passed','failed','error') - it
-- predates 'flaky' (self-hosted retry-then-pass, see comment above). Without this,
-- every self-hosted run whose outcome is 'flaky' would be REJECTED at insert time by
-- Postgres, not just mis-displayed - this must run, not just be a nice-to-have.
-- Postgres names an inline column-level check constraint '<table>_<column>_check' by
-- default, which is what the original `add column ... check (...)` above produced.
alter table automation_runs drop constraint if exists automation_runs_status_check;
alter table automation_runs add constraint automation_runs_status_check
  check (status in ('passed', 'failed', 'error', 'flaky'));

alter table automation_page_objects enable row level security;
alter table automation_script_page_object_refs enable row level security;
alter table automation_registry_conflicts enable row level security;
alter table automation_suite_exports enable row level security;

drop policy if exists automation_page_objects_member_access on automation_page_objects;
create policy automation_page_objects_member_access on automation_page_objects for all using (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_page_objects.project_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_page_objects.project_id and pm.user_id = auth.uid()
  )
);

-- Khong co project_id truc tiep tren bang ref - join qua page_object_id (da du
-- de xac dinh quyen truy cap; script_id luon thuoc cung project voi page_object_id
-- no tro toi vi day la invariant ung dung tao ra, khong phai constraint DB rieng -
-- xem lib/automation/page-object-registry-orchestrator.ts).
drop policy if exists automation_script_page_object_refs_member_access on automation_script_page_object_refs;
create policy automation_script_page_object_refs_member_access on automation_script_page_object_refs for all using (
  exists (
    select 1 from automation_page_objects po
    join project_members pm on pm.project_id = po.project_id
    where po.id = automation_script_page_object_refs.page_object_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from automation_page_objects po
    join project_members pm on pm.project_id = po.project_id
    where po.id = automation_script_page_object_refs.page_object_id and pm.user_id = auth.uid()
  )
);

drop policy if exists automation_registry_conflicts_member_access on automation_registry_conflicts;
create policy automation_registry_conflicts_member_access on automation_registry_conflicts for all using (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_registry_conflicts.project_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_registry_conflicts.project_id and pm.user_id = auth.uid()
  )
);

drop policy if exists automation_suite_exports_member_access on automation_suite_exports;
create policy automation_suite_exports_member_access on automation_suite_exports for all using (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_suite_exports.project_id and pm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from project_members pm
    where pm.project_id = automation_suite_exports.project_id and pm.user_id = auth.uid()
  )
);

-- ----------------------------------------------------------------------------
-- Storage: bucket cho artifact cua SELF-HOSTED "Full run" (trace.zip, video.webm,
-- HTML report zip - xem lib/automation/playwright-test-runner.ts +
-- lib/automation/run-artifact-storage.ts). PRIVATE, object name convention giong
-- het automation-screenshots: '<test_case_id>/<run_id>/<kind>.<ext>', nen policy
-- dung chung logic tach test_case_id tu segment dau tien cua object name.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('automation-run-artifacts', 'automation-run-artifacts', false)
on conflict (id) do nothing;

create or replace function public.can_access_automation_run_artifact(object_name text)
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

drop policy if exists automation_run_artifacts_select on storage.objects;
create policy automation_run_artifacts_select on storage.objects for select using (
  bucket_id = 'automation-run-artifacts' and can_access_automation_run_artifact(name)
);

drop policy if exists automation_run_artifacts_insert on storage.objects;
create policy automation_run_artifacts_insert on storage.objects for insert with check (
  bucket_id = 'automation-run-artifacts' and can_access_automation_run_artifact(name)
);

drop policy if exists automation_run_artifacts_update on storage.objects;
create policy automation_run_artifacts_update on storage.objects for update using (
  bucket_id = 'automation-run-artifacts' and can_access_automation_run_artifact(name)
);

drop policy if exists automation_run_artifacts_delete on storage.objects;
create policy automation_run_artifacts_delete on storage.objects for delete using (
  bucket_id = 'automation-run-artifacts' and can_access_automation_run_artifact(name)
);

-- ----------------------------------------------------------------------------
-- Storage: bucket TAM cho AI Document Reader — file nguon (.docx/.pdf/anh)
-- duoc client upload TRUC TIEP tu browser vao day (xem
-- app/api/ai/documents/upload-url/route.ts), TRUOC KHI goi
-- /api/ai/documents/parse, de tranh gioi han CUNG 4.5MB request body cua Vercel
-- Serverless Function (loi "FUNCTION_PAYLOAD_TOO_LARGE" khi base64-encode ca
-- file nhet vao JSON body). Server tai file ve tu bucket nay va XOA ngay sau
-- khi doc xong (xem loadSourceBuffer() trong app/api/ai/documents/parse/route.ts)
-- — day CHI la vung dem tam thoi, khong phai luu tru lau dai.
--
-- Object name convention: '<project_id>/<uuid>.<ext>' — KHONG gan voi
-- test_case_id nhu automation-screenshots/automation-run-artifacts o tren, vi
-- buoc nay xay ra TRUOC KHI test case duoc generate (AI Document Reader la
-- Buoc 2 cua wizard, truoc Buoc "Generate"). Policy duoi day tach project_id ra
-- tu object name va doi chieu truc tiep voi project_members (khong can join
-- qua test_cases/test_case_sets nhu 2 bucket automation o tren).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('document-source-uploads', 'document-source-uploads', false, 26214400) -- 25MB, khop MAX_DOCUMENT_SOURCE_FILE_BYTES
on conflict (id) do nothing;

create or replace function public.can_access_project_document_upload(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from project_members pm
    where pm.project_id::text = split_part(object_name, '/', 1) and pm.user_id = auth.uid()
  );
$$;

drop policy if exists document_source_uploads_select on storage.objects;
create policy document_source_uploads_select on storage.objects for select using (
  bucket_id = 'document-source-uploads' and can_access_project_document_upload(name)
);

drop policy if exists document_source_uploads_insert on storage.objects;
create policy document_source_uploads_insert on storage.objects for insert with check (
  bucket_id = 'document-source-uploads' and can_access_project_document_upload(name)
);

drop policy if exists document_source_uploads_update on storage.objects;
create policy document_source_uploads_update on storage.objects for update using (
  bucket_id = 'document-source-uploads' and can_access_project_document_upload(name)
);

drop policy if exists document_source_uploads_delete on storage.objects;
create policy document_source_uploads_delete on storage.objects for delete using (
  bucket_id = 'document-source-uploads' and can_access_project_document_upload(name)
);