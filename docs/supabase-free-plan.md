# Supabase Free plan limits

KyoNoKyoto runs on the Supabase **Free plan**. Plan all work to stay within these limits, with
headroom. Going over gets the whole project blocked until the next billing cycle (the 22nd).

| Resource                              | Free limit                              | Scope       |
| ------------------------------------- | --------------------------------------- | ----------- |
| Database size                         | 500 MB                                  | per project |
| File storage                          | 1 GB                                    | per org     |
| Max upload size                       | 50 MB                                   | per file    |
| Egress (uncached: API, database)      | 5 GB / month                            | per org     |
| Cached egress (Storage files via CDN) | 5 GB / month                            | per org     |
| Monthly active users                  | 50,000                                  | per org     |
| Edge Function invocations             | 500,000 / month                         | per org     |
| Realtime                              | 2M messages, 200 concurrent connections | per org     |
| Storage image transformations         | not available                           |             |
| Log ingestion                         | 1 GB / month                            | per org     |

Source: [supabase.com/pricing](https://supabase.com/pricing), checked 2026-11-08.
Usage: [dashboard](https://supabase.com/dashboard/org/hfntokzgkcidqjjifrzk/usage).

## Before changing anything that touches Supabase

- Estimate the monthly egress, storage and database growth of the change, and keep the total
  well under the limits.
- Every Netlify Image CDN fetch of a Supabase-hosted file counts as cached egress, and so does
  every cache miss, format variant and warm request.
