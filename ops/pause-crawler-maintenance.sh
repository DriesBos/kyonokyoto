#!/usr/bin/env bash
set -euo pipefail

if [[ ${CI:-} == true ]]; then
  echo "Skipping VPS maintenance hook in CI"
  exit 0
fi

is_duplicate_kyoto_cron() {
  awk '
    /^[[:space:]]*[0-9*\/,-]+[[:space:]]+3[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+/ &&
    /run-crawl-cycle\.mjs/ &&
    /--city=kyoto([[:space:]]|$)/ &&
    !/--trigger=scheduled([[:space:]]|$)/
  '
}

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
system_cron_files=(/etc/crontab)
shopt -s nullglob
system_cron_files+=(/etc/cron.d/*)
shopt -u nullglob

for cron_file in "${system_cron_files[@]}"; do
  [[ -f "$cron_file" ]] || continue
  if is_duplicate_kyoto_cron <"$cron_file" | grep -q .; then
    echo "Refusing maintenance: duplicate Kyoto crawl is in system cron $cron_file" >&2
    is_duplicate_kyoto_cron <"$cron_file" >&2
    exit 1
  fi
done

total=0
for target in ubuntu root; do
  cron_file="$temp_dir/$target"
  status=0
  if [[ "$target" == ubuntu ]]; then
    crontab -l >"$cron_file" 2>"$cron_file.err" || status=$?
  else
    sudo -n crontab -u root -l >"$cron_file" 2>"$cron_file.err" || status=$?
  fi
  if ((status != 0)); then
    if ! grep -q '^no crontab for ' "$cron_file.err"; then
      cat "$cron_file.err" >&2
      exit "$status"
    fi
    : >"$cron_file"
  fi
  count=$(is_duplicate_kyoto_cron <"$cron_file" | wc -l)
  total=$((total + count))
done

if ((total > 1)); then
  echo "Refusing maintenance: found $total duplicate Kyoto crawl lines" >&2
  exit 1
fi

if ((total == 1)); then
  for target in ubuntu root; do
    cron_file="$temp_dir/$target"
    count=$(is_duplicate_kyoto_cron <"$cron_file" | wc -l)
    ((count == 1)) || continue
    awk '
      !(/^[[:space:]]*[0-9*\/,-]+[[:space:]]+3[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+/ &&
        /run-crawl-cycle\.mjs/ &&
        /--city=kyoto([[:space:]]|$)/ &&
        !/--trigger=scheduled([[:space:]]|$)/)
    ' "$cron_file" >"$cron_file.filtered"
    if [[ "$target" == ubuntu ]]; then
      crontab "$cron_file.filtered"
    else
      sudo -n crontab -u root "$cron_file.filtered"
    fi
    echo "Removed duplicate daily Kyoto crawl from $target crontab"
  done
fi

sudo -n systemctl stop \
  kyo-no-kyoto-crawl@kyoto.timer \
  kyo-no-kyoto-crawl@osaka.timer \
  kyo-no-kyoto-crawl@tokyo.timer \
  kyo-no-kyoto-crawl@hong-kong.timer
echo "Crawler maintenance hook complete; duplicate cron count: $total"
