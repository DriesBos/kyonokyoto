# Sourced after verified fast-forward; inherits launcher fd 9 lock.

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack pnpm install --frozen-lockfile --filter kyo-no-kyoto-crawler

requirements_hash=$(sha256sum apps/crawler/requirements.txt | cut -d' ' -f1)
requirements_stamp=apps/crawler/.venv/.requirements.sha256
if [[ ! -f "$requirements_stamp" ]] || [[ "$(<"$requirements_stamp")" != "$requirements_hash" ]]; then
  python3.12 -m venv apps/crawler/.venv
  apps/crawler/.venv/bin/pip install --disable-pip-version-check -r apps/crawler/requirements.txt
  CRAWL4_AI_BASE_DIRECTORY="$repo/apps/crawler/.cache" \
    apps/crawler/.venv/bin/crawl4ai-setup
  printf '%s\n' "$requirements_hash" >"$requirements_stamp"
fi

# Timers count from activation (OnActiveSec/OnUnitActiveSec). Only rewrite unit
# files and reload systemd when a unit actually changed, so a push to main never
# re-arms or shifts the regular crawl cadence. `enable --now` is a no-op for
# timers that are already active.
units_changed=0
install_unit() {
  if ! cmp -s "$1" "$2"; then
    sudo -n install -m 0644 "$1" "$2"
    units_changed=1
  fi
}
install_unit \
  ops/systemd/kyo-no-kyoto-crawl@.service.example \
  /etc/systemd/system/kyo-no-kyoto-crawl@.service
install_unit \
  ops/systemd/kyo-no-kyoto-crawl-failure@.service.example \
  /etc/systemd/system/kyo-no-kyoto-crawl-failure@.service
install_unit \
  ops/systemd/kyo-no-kyoto-storage-maintenance.service.example \
  /etc/systemd/system/kyo-no-kyoto-storage-maintenance.service
install_unit \
  ops/systemd/kyo-no-kyoto-storage-maintenance.timer.example \
  /etc/systemd/system/kyo-no-kyoto-storage-maintenance.timer
install_unit \
  ops/systemd/kyo-no-kyoto-social.service.example \
  /etc/systemd/system/kyo-no-kyoto-social.service
install_unit \
  ops/systemd/kyo-no-kyoto-social.timer.example \
  /etc/systemd/system/kyo-no-kyoto-social.timer
for city in kyoto osaka tokyo hong-kong; do
  install_unit \
    "ops/systemd/kyo-no-kyoto-crawl@${city}.timer.example" \
    "/etc/systemd/system/kyo-no-kyoto-crawl@${city}.timer"
done
if ((units_changed)); then
  sudo -n systemctl daemon-reload
fi
sudo -n systemctl enable --now \
  kyo-no-kyoto-crawl@kyoto.timer \
  kyo-no-kyoto-crawl@osaka.timer \
  kyo-no-kyoto-crawl@tokyo.timer \
  kyo-no-kyoto-crawl@hong-kong.timer \
  kyo-no-kyoto-storage-maintenance.timer \
  kyo-no-kyoto-social.timer

sudo -n install -m 0755 "$repo/ops/deploy-vps.sh" /usr/local/bin/kyo-vps-deploy

echo "VPS deployed $(git rev-parse HEAD)"
sudo -n systemctl list-timers --all 'kyo-no-kyoto-crawl@*.timer' --no-pager
sudo -n systemctl list-timers --all kyo-no-kyoto-storage-maintenance.timer --no-pager
sudo -n systemctl list-timers --all kyo-no-kyoto-social.timer --no-pager
