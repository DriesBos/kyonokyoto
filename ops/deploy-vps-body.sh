# Sourced after verified fast-forward; inherits launcher fd 9 lock.

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
sudo -n install -m 0644 \
  ops/systemd/kyo-no-kyoto-storage-maintenance.service.example \
  /etc/systemd/system/kyo-no-kyoto-storage-maintenance.service
sudo -n install -m 0644 \
  ops/systemd/kyo-no-kyoto-storage-maintenance.timer.example \
  /etc/systemd/system/kyo-no-kyoto-storage-maintenance.timer
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
  kyo-no-kyoto-crawl@hong-kong.timer \
  kyo-no-kyoto-storage-maintenance.timer
sudo -n install -m 0755 "$repo/ops/deploy-vps.sh" /usr/local/bin/kyo-vps-deploy

echo "VPS deployed $(git rev-parse HEAD)"
sudo -n systemctl list-timers --all 'kyo-no-kyoto-crawl@*.timer' --no-pager
sudo -n systemctl list-timers --all kyo-no-kyoto-storage-maintenance.timer --no-pager
