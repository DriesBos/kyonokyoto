# Figma MCP

Repo MCP settings live in `.mcp.json`.

Set `FIGMA_API_KEY` in the shell or app environment that launches the agent. Do not commit real tokens.

```zsh
export FIGMA_API_KEY="<figma-token>"
```

If the token lives in `apps/web/.env`, load it before launching the agent:

```zsh
set -a
source apps/web/.env
set +a
```

After changing the token or MCP config, restart the agent session and verify Figma auth with `whoami`.

For Figma-driven UI work:

1. Paste the exact Figma frame or layer URL.
2. Fetch design context for that node.
3. Fetch screenshot for visual reference.
4. Implement using this repo's Astro and Sass conventions.
