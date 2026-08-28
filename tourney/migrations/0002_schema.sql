create table if not exists tournaments (
  id              serial primary key,
  slug            text not null unique,
  name            text not null,
  description     text not null default '',
  format          text not null,
  status          text not null default 'registration',
  entry_fee_doge  numeric(12, 2) not null default 0,
  max_players     integer not null default 16,
  swiss_rounds    integer not null default 3,
  treasury        text not null,
  created_at      timestamptz not null default now()
);

create table if not exists entries (
  id              serial primary key,
  tournament_id   integer not null references tournaments(id) on delete cascade,
  handle          text not null,
  wallet          text not null default '',
  seed            integer,
  paid            boolean not null default false,
  invoice_code    text not null unique,
  amount_doge     numeric(12, 2) not null default 0,
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists entries_tournament_handle_idx
  on entries (tournament_id, lower(handle));
create index if not exists entries_tournament_id_idx on entries (tournament_id);

create table if not exists matches (
  id                serial primary key,
  tournament_id     integer not null references tournaments(id) on delete cascade,
  side              text not null,
  round             integer not null,
  position          integer not null,
  entry1_id         integer references entries(id) on delete set null,
  entry2_id         integer references entries(id) on delete set null,
  winner_id         integer references entries(id) on delete set null,
  score1            integer,
  score2            integer,
  status            text not null default 'pending',
  winner_next_id    integer,
  winner_next_slot  integer,
  loser_next_id     integer,
  loser_next_slot   integer
);

create index if not exists matches_tournament_id_idx on matches (tournament_id);
create unique index if not exists matches_slot_idx
  on matches (tournament_id, side, round, position);
