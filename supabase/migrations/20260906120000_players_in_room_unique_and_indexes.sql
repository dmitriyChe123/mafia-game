-- ============================================================
-- players_in_room: UNIQUE(room_id, user_id) + indexes
--
-- ТЗ п.5 / п.21: players_in_room потребує
--   UNIQUE(room_id, user_id)
--   індекс по room_id
--   індекс по user_id
--
-- Безпечно для існуючих даних:
--   1) спочатку прибираємо можливі дублі
--      (лишаємо найранішій запис по joined_at)
--   2) додаємо UNIQUE constraint, якщо його ще нема
--   3) додаємо індекси, якщо їх ще нема
-- ============================================================

-- 1) Видаляємо дублікати (room_id, user_id), лишаючи найстарішу
--    за joined_at (а при рівності — за id) запис.
with ranked as (
    select
        id,
        room_id,
        user_id,
        row_number() over (
            partition by room_id, user_id
            order by joined_at asc, id asc
        ) as rn
    from public.players_in_room
)
delete from public.players_in_room p
using ranked r
where p.id = r.id
  and r.rn > 1;

-- 2) UNIQUE constraint (room_id, user_id)
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'players_in_room_room_id_user_id_key'
    ) then
        alter table public.players_in_room
            add constraint players_in_room_room_id_user_id_key
            unique (room_id, user_id);
    end if;
end $$;

-- 3) Індекси по room_id та user_id
create index if not exists idx_players_in_room_room_id
    on public.players_in_room (room_id);

create index if not exists idx_players_in_room_user_id
    on public.players_in_room (user_id);
