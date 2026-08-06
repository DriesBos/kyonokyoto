#!/usr/bin/env bash
set -euo pipefail

repo=/srv/kyo-no-kyoto
lock=/run/lock/kyo-no-kyoto-crawl.lock
maintenance_marker=ops/crawl-maintenance-paused
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"

is_duplicate_kyoto_cron() {
  awk '
    /^[[:space:]]*[0-9*\/,-]+[[:space:]]+3[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+/ &&
    /run-crawl-cycle\.mjs/ &&
    (!/--city=/ || /--city=kyoto([[:space:]]|$)/) &&
    !/--trigger=scheduled([[:space:]]|$)/
  '
}

remove_duplicate_kyoto_cron() {
  local temp_dir target cron_file filtered count status total=0
  local -a system_cron_files

  temp_dir=$(mktemp -d)
  trap 'rm -rf "$temp_dir"' RETURN
  system_cron_files=(/etc/crontab)
  shopt -s nullglob
  system_cron_files+=(/etc/cron.d/*)
  shopt -u nullglob

  for cron_file in "${system_cron_files[@]}"; do
    [[ -f "$cron_file" ]] || continue
    count=$(is_duplicate_kyoto_cron <"$cron_file" | wc -l)
    if ((count > 0)); then
      echo "Refusing deploy: duplicate Kyoto crawl is in system cron $cron_file" >&2
      is_duplicate_kyoto_cron <"$cron_file" >&2
      return 1
    fi
  done

  for target in ubuntu root; do
    cron_file="$temp_dir/$target"
    if [[ "$target" == ubuntu ]]; then
      crontab -l >"$cron_file" 2>"$cron_file.err" || status=$?
    else
      sudo -n crontab -u root -l >"$cron_file" 2>"$cron_file.err" || status=$?
    fi
    if [[ ${status:-0} -ne 0 ]]; then
      if ! grep -q '^no crontab for ' "$cron_file.err"; then
        cat "$cron_file.err" >&2
        return "$status"
      fi
      : >"$cron_file"
    fi
    unset status

    count=$(is_duplicate_kyoto_cron <"$cron_file" | wc -l)
    total=$((total + count))
  done

  if ((total > 1)); then
    echo "Refusing deploy: found $total duplicate Kyoto crawl lines across user crontabs" >&2
    for target in ubuntu root; do
      is_duplicate_kyoto_cron <"$temp_dir/$target" >&2
    done
    return 1
  fi
  if ((total == 0)); then
    return 0
  fi

  for target in ubuntu root; do
    cron_file="$temp_dir/$target"
    count=$(is_duplicate_kyoto_cron <"$cron_file" | wc -l)
    ((count == 1)) || continue
    filtered="$temp_dir/$target.filtered"
    awk '
      !(/^[[:space:]]*[0-9*\/,-]+[[:space:]]+3[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*[[:space:]]+/ &&
        /run-crawl-cycle\.mjs/ &&
        (!/--city=/ || /--city=kyoto([[:space:]]|$)/) &&
        !/--trigger=scheduled([[:space:]]|$)/)
    ' "$cron_file" >"$filtered"
    if [[ "$target" == ubuntu ]]; then
      crontab "$filtered"
    else
      sudo -n crontab -u root "$filtered"
    fi
    echo "Removed duplicate daily Kyoto crawl from $target crontab"
    return 0
  done
}

exec 9>"$lock"
flock -w 3600 9

cd "$repo"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "VPS checkout is dirty; refusing deploy" >&2
  exit 1
fi

git fetch origin main
read -r ahead behind < <(git rev-list --left-right --count HEAD...origin/main)

if ((ahead > 0)); then
  echo "VPS main diverged from origin/main: ahead $ahead, behind $behind" >&2
  exit 1
fi

git merge --ff-only origin/main

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "VPS checkout does not match origin/main after deploy" >&2
  exit 1
fi

remove_duplicate_kyoto_cron

npm --prefix apps/crawler ci

requirements_hash=$(sha256sum apps/crawler/requirements.txt | cut -d' ' -f1)
requirements_stamp=apps/crawler/.venv/.requirements.sha256
if [[ ! -f "$requirements_stamp" ]] || [[ "$(<"$requirements_stamp")" != "$requirements_hash" ]]; then
  python3.12 -m venv apps/crawler/.venv
  apps/crawler/.venv/bin/pip install --disable-pip-version-check -r apps/crawler/requirements.txt
  CRAWL4_AI_BASE_DIRECTORY="$repo/apps/crawler/.cache" \
    apps/crawler/.venv/bin/crawl4ai-setup
  printf '%s\n' "$requirements_hash" >"$requirements_stamp"
fi

sudo -n install -m 0644 \
  ops/systemd/kyo-no-kyoto-crawl@.service.example \
  /etc/systemd/system/kyo-no-kyoto-crawl@.service
sudo -n install -m 0644 \
  ops/systemd/kyo-no-kyoto-crawl-failure@.service.example \
  /etc/systemd/system/kyo-no-kyoto-crawl-failure@.service
for city in kyoto osaka tokyo hong-kong; do
  sudo -n install -m 0644 \
    "ops/systemd/kyo-no-kyoto-crawl@${city}.timer.example" \
    "/etc/systemd/system/kyo-no-kyoto-crawl@${city}.timer"
done
sudo -n systemctl daemon-reload
if [[ -f "$maintenance_marker" ]]; then
  sudo -n systemctl disable --now \
    kyo-no-kyoto-crawl@kyoto.timer \
    kyo-no-kyoto-crawl@osaka.timer \
    kyo-no-kyoto-crawl@tokyo.timer \
    kyo-no-kyoto-crawl@hong-kong.timer
  echo "Crawler timers paused for maintenance"
else
  sudo -n systemctl enable --now \
    kyo-no-kyoto-crawl@kyoto.timer \
    kyo-no-kyoto-crawl@osaka.timer \
    kyo-no-kyoto-crawl@tokyo.timer \
    kyo-no-kyoto-crawl@hong-kong.timer
fi
sudo -n install -m 0755 "$repo/ops/deploy-vps.sh" /usr/local/bin/kyo-vps-deploy

echo "VPS deployed $(git rev-parse HEAD)"
sudo -n systemctl list-timers --all 'kyo-no-kyoto-crawl@*.timer' --no-pager
sudo -n systemctl is-enabled \
  kyo-no-kyoto-crawl@kyoto.timer \
  kyo-no-kyoto-crawl@osaka.timer \
  kyo-no-kyoto-crawl@tokyo.timer \
  kyo-no-kyoto-crawl@hong-kong.timer || true
sudo -n systemctl is-active \
  kyo-no-kyoto-crawl@kyoto.service \
  kyo-no-kyoto-crawl@osaka.service \
  kyo-no-kyoto-crawl@tokyo.service \
  kyo-no-kyoto-crawl@hong-kong.service || true
