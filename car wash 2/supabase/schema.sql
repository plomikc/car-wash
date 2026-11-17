create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  vehicle_type text not null,
  wash_package text not null,
  customer_name text not null,
  customer_email text not null,
  city text not null,
  requested_date date not null,
  requested_time time not null,
  customer_message text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approving', 'confirmed', 'rejected')),
  calendar_event_id text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_requests_pending_created
  on public.booking_requests (created_at desc)
  where status = 'pending';

create index if not exists booking_requests_ip_created
  on public.booking_requests (ip_hash, created_at desc);

create unique index if not exists booking_requests_unique_claimed_slot
  on public.booking_requests (requested_date, requested_time)
  where status = 'approving';

create table if not exists public.google_calendar_credentials (
  id smallint primary key check (id = 1),
  refresh_token text not null,
  connected_email text not null,
  updated_at timestamptz not null default now()
);

alter table public.booking_requests enable row level security;
alter table public.google_calendar_credentials enable row level security;

revoke all on public.booking_requests from anon, authenticated;
revoke all on public.google_calendar_credentials from anon, authenticated;
grant all on public.booking_requests to service_role;
grant all on public.google_calendar_credentials to service_role;
