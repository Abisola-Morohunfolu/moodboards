-- Read-only daily beta report. Alert if pending media is >15 minutes old or any
-- failed media appears; include trash in retained-byte accounting.
select status, count(*) as assets, coalesce(sum(bytes), 0) as retained_original_bytes,
       count(*) filter (where status = 'pending' and created_at < now() - interval '15 minutes') as stalled
from assets group by status;
select b.created_by as account_id, coalesce(sum(a.bytes), 0) as retained_original_bytes
from boards b join assets a on a.board_id = b.id
group by b.created_by having sum(a.bytes) > 1073741824;
select board_id, count(*) as active_items from items where deleted_at is null
group by board_id having count(*) > 200;
select pg_database_size(current_database()) as database_bytes;
select count(*) as active_accounts from users where deleted_at is null;
