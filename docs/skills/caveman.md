# Caveman

Ultra-compressed communication mode. ~75% token reduction. Full technical accuracy preserved.

Source: [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman)

## Levels

| Level | Behavior |
|-------|----------|
| **lite** | No filler/hedging. Keep articles + full sentences. |
| **full** | Drop articles, fragments OK, short synonyms. (default) |
| **ultra** | Abbreviate (DB/auth/req/res/fn), arrows for causality (X → Y). |
| **wenyan-lite/full/ultra** | Classical Chinese compression variants. |

## Controls

- Activate: `/caveman`, "talk like caveman", "less tokens"
- Switch level: `/caveman lite|full|ultra`
- Stop: "stop caveman" / "normal mode"

## Auto-clarity

Suspend for: security warnings, irreversible confirmations, ambiguous multi-step sequences. Resume after.

## Example

```
Before: "The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle."
After:  "New object ref each render. Inline object prop = new ref = re-render. Wrap in useMemo."
```
