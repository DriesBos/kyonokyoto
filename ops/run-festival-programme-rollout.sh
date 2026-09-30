#!/usr/bin/env bash
set -euo pipefail

repo=/srv/kyo-no-kyoto
rollout_dir=/var/lib/kyo-no-kyoto/rollouts
rollout_stamp="$rollout_dir/2026-10-festival-programme-v2"

if [[ -f "$rollout_stamp" ]]; then
  echo "Festival programme rollout already completed."
  exit 0
fi

sudo -n install -d -o ubuntu -g ubuntu "$rollout_dir"

export CRAWL4AI_PYTHON="$repo/apps/crawler/.venv/bin/python"
export CRAWL4_AI_BASE_DIRECTORY="$repo/apps/crawler/.cache"

node scripts/sync-sources.mjs --city=kyoto

sources=(
  ko-gei-kyoto
  curation-fair-kyoto
  art-collaboration-kyoto
  kyoto-youme-triennale
  kyoto-experiment
  art-rhizome-kyoto
  kyoto-modern-architecture-festival
)

review_count=0
for source in "${sources[@]}"; do
  echo
  echo "== Festival crawl: $source =="
  set +e
  node apps/crawler/src/run-once.mjs \
    --city=kyoto \
    --source="$source" \
    --trigger=manual
  crawl_status=$?
  set -e

  if ((crawl_status == 2)); then
    review_count=$((review_count + 1))
    echo "$source completed with review outcome."
    continue
  fi

  if ((crawl_status != 0)); then
    echo "$source failed with exit code $crawl_status." >&2
    exit "$crawl_status"
  fi
done

touch "$rollout_stamp"
echo
echo "Festival programme rollout completed with $review_count review outcome(s)."
