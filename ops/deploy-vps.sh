#!/usr/bin/env bash
set -euo pipefail

repo=/srv/kyo-no-kyoto
lock=/run/lock/kyo-no-kyoto-crawl.lock
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"

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
sudo -n systemctl enable --now \
  kyo-no-kyoto-crawl@kyoto.timer \
  kyo-no-kyoto-crawl@osaka.timer \
  kyo-no-kyoto-crawl@tokyo.timer \
  kyo-no-kyoto-crawl@hong-kong.timer
sudo -n install -m 0755 "$repo/ops/deploy-vps.sh" /usr/local/bin/kyo-vps-deploy

echo "VPS deployed $(git rev-parse --short HEAD)"
