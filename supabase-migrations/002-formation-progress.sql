-- 002-formation-progress.sql — progression des élèves dans la formation.
-- À exécuter une fois : Supabase Dashboard > SQL Editor > New query > coller > Run.
--
-- Une ligne par élément terminé : une leçon (ex. « m1-3 ») ou un quiz (ex. « quiz-m1 »).
-- Écrit uniquement par la fonction Netlify « formation » (clé service_role).
-- Tant que cette table n'existe pas, la progression reste enregistrée dans le navigateur
-- de l'élève (la page fonctionne quand même).

create table if not exists public.formation_progress (
  email    text not null,
  item     text not null,
  done_at  timestamptz not null default now(),
  primary key (email, item)
);

alter table public.formation_progress enable row level security;  -- aucune policy : service_role uniquement
