# Netlify plan limits

KyoNoKyoto is hosted on the Netlify **Personal plan** ($9/month). Plan all work to fit its
monthly credits, with headroom. Without auto recharge, the sites are paused once the credits run
out, until the next billing cycle.

| Item                                                              | Personal plan                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Credits                                                           | 1,000 / month                                                                |
| Production deploy                                                 | 15 credits per deploy (previews, branch deploys and failed deploys are free) |
| Web bandwidth (pages, images incl. Image CDN, function responses) | 20 credits per GB                                                            |
| Web requests (pages, functions, redirects, edge functions)        | 2 credits per 10,000 requests                                                |
| Compute (functions, ISR renders)                                  | 10 credits per GB-hour                                                       |
| Concurrent builds                                                 | 1                                                                            |
| Auto recharge (off by default)                                    | 500 credits for $5                                                           |

Free plan, for comparison: 300 credits, hard stop.

Source: [netlify.com/pricing](https://www.netlify.com/pricing/) and the
[credit-based plan docs](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/),
checked 2026-11-09.

## Before changing anything that touches Netlify

- Estimate the credits of the change: 1,000 credits is about 66 production deploys, 50 GB of
  bandwidth, or 5M requests a month, shared between them.
- Batch production deploys: each costs 15 credits (the netlify.toml `ignore` rule already skips
  crawler-only commits).
- Keep pages ISR/CDN-cached so visits don't run functions, and images small (Image CDN output
  counts as bandwidth).
