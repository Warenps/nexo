create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  role text not null default 'client' check (role in ('admin', 'client')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and is_active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

create policy "Profiles are visible to their owner and active administrators"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id or (select public.is_admin()));

create policy "Active clients can update their own profile"
on public.profiles
for update
to authenticated
using (
  (select auth.uid()) = id
  and role = 'client'
  and is_active
  and (select public.is_active_user())
)
with check (
  (select auth.uid()) = id
  and role = 'client'
  and is_active
  and (select public.is_active_user())
);

create or replace function public.create_client_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'client')
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_client_profile() from public, anon, authenticated;

create trigger create_profile_for_new_auth_user
after insert on auth.users
for each row execute function public.create_client_profile();

comment on table public.profiles is
  'Public profile fields and authorization role. Public sign-up is always assigned the client role by a trusted database trigger.';
