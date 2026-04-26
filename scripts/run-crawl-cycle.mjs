import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = process.cwd();
const crawlerEnvPath = resolve(projectRoot, "apps/crawler/.env");

function parseEnvFile(contents) {
  const env = {};

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

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

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ...options.env,
      },
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${label} failed with exit code ${code ?? "unknown"}`));
    });

    child.on("error", rejectPromise);
  });
}

const envContents = await readFile(crawlerEnvPath, "utf8");
const env = parseEnvFile(envContents);

const skipSync = hasFlag("--skip-sync");
const skipCrawl = hasFlag("--skip-crawl");
const skipDeploy = hasFlag("--skip-deploy");
const genericLimit = getArg("generic-limit", "6");
const buildHookUrl = env.NETLIFY_BUILD_HOOK_URL ?? env.WEB_REDEPLOY_HOOK_URL ?? null;

await runStep("Pull latest code", "git", ["pull", "--ff-only"]);

if (!skipSync) {
  await runStep("Sync sources", "node", ["scripts/sync-sources.mjs"]);
}

if (!skipCrawl) {
  await runStep("Crawl all sources", "node", [
    "apps/crawler/src/run-once.mjs",
    "--source=all",
    `--generic-limit=${genericLimit}`,
  ]);
}

if (!skipDeploy) {
  if (!buildHookUrl) {
    throw new Error(
      "Missing NETLIFY_BUILD_HOOK_URL (or WEB_REDEPLOY_HOOK_URL) in apps/crawler/.env"
    );
  }

  console.log("\n== Trigger Netlify rebuild ==");
  const response = await fetch(buildHookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trigger: "scheduled-crawl",
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Netlify build hook failed (${response.status}): ${errorText}`);
  }

  console.log(`Triggered rebuild: ${response.status}`);
}

console.log("\nCrawl cycle complete.");
