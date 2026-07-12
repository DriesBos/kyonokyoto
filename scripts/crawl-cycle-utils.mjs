export function parseGitDivergence(value) {
  const [ahead, behind] = String(value ?? '')
    .trim()
    .split(/\s+/)
    .map(Number);

  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    throw new Error(`Could not parse Git divergence: ${value}`);
  }

  return { ahead, behind };
}

export function cycleStatus({ crawlPassed, translationsPassed }) {
  return crawlPassed && translationsPassed ? 'success' : 'degraded';
}
