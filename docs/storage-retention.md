# Storage retention

Crawler evidence is a temporary debug cache. Events, translations, and schedules
remain the website's durable content. These changes take effect after the database
migration and VPS deployment; this document is not proof of live deployment.

## Retention targets

- Keep one recent HTML/text payload per source and URL.
- Expire payloads seven days after their last fetch, including rows referenced
  by events. Referenced rows retain IDs, URLs, hashes, and metadata; their HTML
  and extracted text become null. Only unreferenced empty rows are deleted.
- Cap combined HTML/text at 150,000,000 UTF-8 bytes. This conservative logical
  budget excludes indexes, metadata, and PostgreSQL overhead; compressed disk
  usage is lower. Evict oldest evidence first during maintenance.
- Omit HTML/text when a single HTML snapshot exceeds 1,000,000 UTF-8 bytes.
  Extraction still uses the complete fetched page. Never truncate replay HTML.
- Retain detailed JSON crawl logs for 30 days.
- Stop accepting optional payloads and warn at 400 MB database size, leaving
  roughly 100 MB headroom. Event data remains writable.
- Run physical compaction only as a controlled one-off maintenance action. Do
  not schedule recurring `VACUUM FULL`.

## Operation and rollout

Apply the migration before deploying the new runner: the runner calls the
service-role-only `maintain_crawler_storage` RPC. The old `prune_raw_pages` RPC
remains compatible for the transition. After deployment, the crawler performs
maintenance after each city cycle. An independent persistent daily systemd timer
runs `node scripts/maintain-storage.mjs`, sharing the crawler's lock.

The job logs maintenance counts, payload bytes, and database bytes. It sends
warnings/failures through `CRAWL_ALERT_WEBHOOK_URL` when configured; otherwise
warnings are visible in the service journal. A healthy run sends no webhook.
Size warnings make the daily service fail so systemd also exposes the condition.

For initial cleanup, record database/table sizes and event/reference counts,
run maintenance, then verify event content and references remain unchanged.
If physical compaction is needed, first confirm disk headroom and a quiet
crawler window: `VACUUM FULL` rewrites and locks the table. Verify physical size
and public API health afterward. Do not automate this operation.

After deployment, verify the actual state on the VPS with the maintenance
service result, database size/payload queries, log retention, and the enabled
timer. Do not infer live state from this document or from example unit files.

This bounds diagnostic payload, not all future database growth. Event history,
source metadata, run summaries, indexes, and database overhead still need size
monitoring. Expired/omitted HTML cannot be replayed; live recrawling remains available.
