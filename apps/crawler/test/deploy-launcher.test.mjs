import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const launcherSource = await readFile(join(root, 'ops/deploy-vps.sh'), 'utf8');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kyo-vps-deploy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const remote = join(dir, 'origin.git');
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  await mkdir(join(repo, 'ops'), { recursive: true });
  await mkdir(bin);
  git(dir, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'remote', 'add', 'origin', remote);
  const launcher = launcherSource
    .replace('repo=/srv/kyo-no-kyoto', 'repo=' + repo)
    .replace('lock=/run/lock/kyo-no-kyoto-crawl.lock', 'lock=' + join(dir, 'crawl.lock'));
  const body = (marker) => `printf '%s\\n' '${marker}' >> '${log}'
if [[ -x /usr/bin/flock ]]; then
  if /usr/bin/flock -n "$lock" true; then printf '%s\\n' lock-free >> '${log}'; else printf '%s\\n' lock-held >> '${log}'; fi
elif [[ -w /dev/fd/9 ]]; then
  printf '%s\\n' fd9-open >> '${log}'
fi
`;
  await writeFile(join(repo, 'ops/deploy-vps.sh'), launcher);
  await writeFile(join(repo, 'ops/deploy-vps-body.sh'), body('old'));
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'old launcher');
  git(repo, 'push', '-u', 'origin', 'main');
  const updater = join(dir, 'updater');
  git(dir, 'clone', '--branch', 'main', remote, updater);
  git(updater, 'config', 'user.email', 'test@example.com');
  git(updater, 'config', 'user.name', 'Test');
  await writeFile(join(updater, 'ops/deploy-vps-body.sh'), body('new'));
  git(updater, 'add', 'ops/deploy-vps-body.sh');
  git(updater, 'commit', '-m', 'new body');
  git(updater, 'push', 'origin', 'main');
  await writeFile(
    join(bin, 'flock'),
    `#!/bin/sh
printf '%s\\n' flock >> '${log}'
if [ -x /usr/bin/flock ]; then exec /usr/bin/flock "$@"; fi
exit 0
`,
  );
  await chmod(join(bin, 'flock'), 0o755);
  const installed = join(dir, 'installed-launcher');
  await writeFile(installed, launcher);
  await chmod(installed, 0o755);
  return { dir, repo, bin, installed, log };
}

function run(fx) {
  return spawnSync(fx.installed, [], {
    cwd: fx.repo,
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

test('launcher runs fetched deployment body once on first invocation', async (t) => {
  const fx = await fixture(t);
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
  const calls = (await readFile(fx.log, 'utf8')).trim().split('\n');
  assert.equal(calls.filter((entry) => entry === 'new').length, 1);
  assert.equal(calls.filter((entry) => entry === 'old').length, 0);
  assert.equal(calls.filter((entry) => entry === 'flock').length, 1);
  assert.ok(calls.includes(process.platform === 'linux' ? 'lock-held' : 'fd9-open'));
});

test('launcher stops before payload when checkout is dirty', async (t) => {
  const fx = await fixture(t);
  await writeFile(join(fx.repo, 'dirty.txt'), 'dirty\\n');
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.equal((await readFile(fx.log, 'utf8')).trim(), 'flock');
});
