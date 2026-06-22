-- À exécuter dans Supabase : Dashboard > SQL Editor > New query > coller > Run.
-- Nécessaire pour que netlify/functions/_lib/rate-limit.js (F11) fonctionne réellement
-- en production. Sans cette table/fonction, le code "fail-open" (laisse passer les requêtes,
-- voir le commentaire dans rate-limit.js) plutôt que de planter le site.

create table if not exists rate_limit_counters (
  ip text not null,
  function_name text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (ip, function_name, window_start)
);

-- Index pour permettre un nettoyage périodique des vieilles fenêtres (optionnel, voir plus bas).
create index if not exists idx_rate_limit_counters_window on rate_limit_counters (window_start);

create or replace function rate_limit_check(
  p_ip text,
  p_function text,
  p_max int,
  p_window_minutes int
)
returns boolean
language plpgsql
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  -- Fenêtre fixe alignée sur l'horloge (ex: toutes les 5 minutes : 10:00, 10:05, 10:10…),
  -- pas une fenêtre glissante. Compromis assumé : un pic juste à cheval sur deux fenêtres
  -- peut autoriser un peu plus que p_max sur une courte période, mais en échange
  -- l'opération est atomique (une seule requête SQL) et élimine la race condition de
  -- l'ancien pattern "compter PUIS insérer" utilisé précédemment.
  v_window := to_timestamp(floor(extract(epoch from now()) / (p_window_minutes * 60)) * (p_window_minutes * 60));

  insert into rate_limit_counters (ip, function_name, window_start, count)
  values (p_ip, p_function, v_window, 1)
  on conflict (ip, function_name, window_start)
  do update set count = rate_limit_counters.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- Optionnel mais recommandé : purge automatique des fenêtres de plus de 24h pour que la
-- table ne grossisse pas indéfiniment. À programmer via Supabase > Database > Cron Jobs
-- (extension pg_cron), une fois par jour par exemple :
--
-- select cron.schedule('cleanup-rate-limit-counters', '0 4 * * *', $$
--   delete from rate_limit_counters where window_start < now() - interval '24 hours';
-- $$);
