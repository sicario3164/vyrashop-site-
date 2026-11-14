-- 000-schema-complet.sql — VyraShop
--
-- À utiliser UNIQUEMENT si le projet Supabase a été supprimé et que tu en recrées un neuf.
-- (Si l'ancien projet pdprwoskbrsoojtanmze existe toujours, même en pause, ne lance rien :
--  il suffit de le « Restore » depuis le dashboard Supabase.)
--
-- Ordre : exécuter ce fichier, puis 001-rate-limiting.sql.
-- Dashboard Supabase → SQL Editor → New query → coller → Run.
--
-- Schéma reconstitué à partir des colonnes utilisées dans netlify/functions/*.js
-- et espace-membre/*.html. Tout est idempotent (« if not exists »).

-- ── Accès clients ──────────────────────────────────────────────────────────────
create table if not exists public.user_access (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users(id) on delete set null,
  email                  text not null unique,
  has_formation          boolean not null default false,
  has_shop               boolean not null default false,
  has_accompagnement     boolean not null default false,
  shop_login             text,   -- chiffré AES-256-GCM (ENCRYPTION_KEY)
  shop_password          text,   -- chiffré AES-256-GCM (ENCRYPTION_KEY)
  shop_notes             text,   -- chiffré AES-256-GCM (ENCRYPTION_KEY)
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_user_access_user_id on public.user_access (user_id);

alter table public.user_access enable row level security;

-- Le navigateur (clé anon + session utilisateur) lit uniquement SA ligne.
-- Toutes les écritures passent par les fonctions Netlify (clé service_role, qui ignore la RLS).
drop policy if exists "lecture de son propre acces" on public.user_access;
create policy "lecture de son propre acces" on public.user_access
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- ── Journal admin ──────────────────────────────────────────────────────────────
create table if not exists public.admin_logs (
  id           bigint generated always as identity primary key,
  action       text not null,
  target_email text,
  ip           text,
  created_at   timestamptz not null default now()
);
alter table public.admin_logs enable row level security;   -- aucune policy : service_role uniquement

-- ── Tentatives de connexion admin ──────────────────────────────────────────────
create table if not exists public.admin_attempts (
  id         bigint generated always as identity primary key,
  ip         text,
  success    boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.admin_attempts enable row level security; -- aucune policy : service_role uniquement
