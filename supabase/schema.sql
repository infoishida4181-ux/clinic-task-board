create table if not exists public.task_types (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  chart_number_mode text not null check (chart_number_mode in ('required', 'optional', 'none')),
  default_due_type text not null default 'today',
  is_supply_related boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_type_id text references public.task_types(id) on delete set null,
  title text not null,
  chart_number text,
  memo text,
  due_date date,
  priority text not null default 'normal',
  status text not null default 'active' check (status in ('active', 'completed')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_task_types_updated_at on public.task_types;
create trigger set_task_types_updated_at
before update on public.task_types
for each row
execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

alter table public.task_types enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Users can select own task types" on public.task_types;
create policy "Users can select own task types"
on public.task_types for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own task types" on public.task_types;
create policy "Users can insert own task types"
on public.task_types for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own task types" on public.task_types;
create policy "Users can update own task types"
on public.task_types for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own task types" on public.task_types;
create policy "Users can delete own task types"
on public.task_types for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can select own tasks" on public.tasks;
create policy "Users can select own tasks"
on public.tasks for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks"
on public.tasks for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
on public.tasks for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own tasks" on public.tasks;
create policy "Users can delete own tasks"
on public.tasks for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists task_types_user_sort_idx on public.task_types (user_id, sort_order);
create index if not exists task_types_user_active_idx on public.task_types (user_id, active);
create index if not exists tasks_user_status_due_idx on public.tasks (user_id, status, due_date);
create index if not exists tasks_user_task_type_idx on public.tasks (user_id, task_type_id);
create index if not exists tasks_user_chart_number_idx on public.tasks (user_id, chart_number) where chart_number is not null;
