import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const sharedEnvPath = resolve(projectRoot, ".env");
const crawlerEnvPath = resolve(projectRoot, "apps/crawler/.env");
const hookName = process.argv.find((arg) => arg.startsWith("--name="))?.slice("--name=".length) ?? "Scheduled crawl deploy";

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

function upsertEnvValue(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(contents)) {
    return contents.replace(pattern, line);
  }

  const normalized = contents.endsWith("\n") ? contents : `${contents}\n`;
  return `${normalized}${line}\n`;
}

async function netlifyRequest(token, path, options = {}) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Netlify request failed (${response.status}) for ${path}: ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

const sharedEnvContents = await readFile(sharedEnvPath, "utf8");
const sharedEnv = parseEnvFile(sharedEnvContents);

const netlifyToken = process.env.NETLIFY_AUTH_TOKEN || sharedEnv.NETLIFY_AUTH_TOKEN;
const netlifySiteId = process.env.NETLIFY_SITE_ID || sharedEnv.NETLIFY_SITE_ID;

if (!netlifyToken || !netlifySiteId) {
  throw new Error("Missing NETLIFY_AUTH_TOKEN or NETLIFY_SITE_ID in .env or shell environment");
}

const existingHooks = await netlifyRequest(netlifyToken, `/sites/${netlifySiteId}/build_hooks`);
let buildHook = existingHooks.find((hook) => hook.title === hookName) ?? null;

if (!buildHook) {
  buildHook = await netlifyRequest(netlifyToken, `/sites/${netlifySiteId}/build_hooks`, {
    method: "POST",
    body: JSON.stringify({
      title: hookName,
      branch: "main",
    }),
  });
}

const crawlerEnvContents = await readFile(crawlerEnvPath, "utf8");
const updatedCrawlerEnv = upsertEnvValue(crawlerEnvContents, "NETLIFY_BUILD_HOOK_URL", buildHook.url);
await writeFile(crawlerEnvPath, updatedCrawlerEnv, "utf8");

console.log(
  JSON.stringify(
    {
      site_id: netlifySiteId,
      hook_id: buildHook.id,
      hook_name: buildHook.title,
      hook_url_written_to: crawlerEnvPath,
    },
    null,
    2
  )
);
