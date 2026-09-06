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

# Source verified checkout so deployment changes apply on their first rollout.
source "$repo/ops/deploy-vps-body.sh"
