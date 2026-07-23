import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { normalizeCity } from '../data/sources/source-config.mjs';
import {
  cycleStatus,
  normalizeCrawlTriggerType,
  parseGitDivergence,
} from './crawl-cycle-utils.mjs';

const projectRoot = process.cwd();
const crawlerEnvPath = resolve(projectRoot, 'apps/crawler/.env');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function runStep(label, cmd, args, options = {}) {
  console.log(`\n== ${label} ==`);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...options.env,
      },
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(0);
        return;
      }

      if (options.allowFailure) {
        console.warn(`${label} reported exit code ${code ?? 'unknown'}; continuing.`);
        resolvePromise(code ?? 1);
        return;
      }

      rejectPromise(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });

    child.on('error', rejectPromise);
  });
}

function captureCommand(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${result.status ?? 'unknown'}): ${result.stderr.trim()}`,
    );
  }

  return result.stdout.trim();
}

async function updateCheckout() {
  const dirty = captureCommand('git', ['status', '--porcelain']);
  if (dirty) throw new Error('VPS checkout is dirty; refusing automated update');

  const branch = captureCommand('git', ['branch', '--show-current']);
  if (branch !== 'main')
    throw new Error(`VPS checkout must be on main, found ${branch || 'detached'}`);

  await runStep('Fetch latest code', 'git', ['fetch', 'origin', 'main']);
  const divergence = parseGitDivergence(
    captureCommand('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main']),
  );

  if (divergence.ahead) {
    throw new Error(
      `VPS main diverged from origin/main: ahead ${divergence.ahead}, behind ${divergence.behind}`,
    );
  }

  if (divergence.behind) {
    await runStep('Fast-forward main', 'git', ['merge', '--ff-only', 'origin/main']);
  }

  const commit = captureCommand('git', ['rev-parse', 'HEAD']);
  const originCommit = captureCommand('git', ['rev-parse', 'origin/main']);
  if (commit !== originCommit)
    throw new Error('VPS checkout does not match origin/main after update');

  return commit;
}

async function postStatus(url, payload) {
  if (!url) return;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Crawler status webhook failed (${response.status})`);
}

const envContents = await readFile(crawlerEnvPath, 'utf8');
const env = parseEnv(envContents);

const skipSync = hasFlag('--skip-sync');
const skipCrawl = hasFlag('--skip-crawl');
const skipUpdate = hasFlag('--skip-update');
const strictTranslations = hasFlag('--strict-translations');
const genericLimit = getArg('generic-limit', '6');
const triggerType = normalizeCrawlTriggerType(getArg('trigger', 'manual'));
const city = normalizeCity(getArg('city', 'kyoto'));
if (!city) {
  throw new Error(`Unsupported source city "${getArg('city')}"`);
}
const heartbeatUrl = env.CRAWL_HEARTBEAT_URL ?? null;
const alertWebhookUrl = env.CRAWL_ALERT_WEBHOOK_URL ?? null;
let currentStep = 'initialize';
let commit = 'unknown';

try {
  currentStep = 'update_checkout';
  commit = skipUpdate ? captureCommand('git', ['rev-parse', 'HEAD']) : await updateCheckout();

  if (!skipSync) {
    currentStep = 'sync_sources';
    await runStep('Sync sources', 'node', ['scripts/sync-sources.mjs', `--city=${city}`]);
  }

  let crawlExitCode = 0;
  if (!skipCrawl) {
    currentStep = 'crawl_sources';
    crawlExitCode = await runStep(
      'Crawl all sources',
      'node',
      [
        'apps/crawler/src/run-once.mjs',
        '--source=all',
        `--city=${city}`,
        `--generic-limit=${genericLimit}`,
        `--trigger=${triggerType}`,
      ],
      { allowFailure: true },
    );
  }

  currentStep = 'check_translations';
  const translationsPassed =
    (await runStep(
      'Check translations',
      'npm',
      ['--prefix', 'apps/crawler', 'run', 'translations:check'],
      { allowFailure: true },
    )) === 0;

  const status = cycleStatus({ crawlExitCode, translationsPassed });
  const reasons = [
    ...(crawlExitCode === 2 ? ['source crawl review outcomes'] : []),
    ...(crawlExitCode !== 0 && crawlExitCode !== 2 ? ['source crawl failures'] : []),
    ...(!translationsPassed ? ['missing translations'] : []),
  ];
  const payload = {
    status,
    city,
    commit,
    reasons,
    timestamp: new Date().toISOString(),
  };

  currentStep = 'report_status';
  await postStatus(status === 'success' ? heartbeatUrl : alertWebhookUrl, payload);
  console.log(`\n${city} crawl cycle ${status}.`);

  if (status === 'failed' || (strictTranslations && !translationsPassed)) {
    process.exitCode = 2;
  }
} catch (error) {
  await postStatus(alertWebhookUrl, {
    status: 'failed',
    city,
    commit,
    step: currentStep,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  }).catch((reportError) => console.error(reportError));
  throw error;
}
