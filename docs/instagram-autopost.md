# Instagram auto poster

One Instagram post a day, picked from the site's events, drawn as an event card, and posted
through the Instagram Graph API. Nothing is posted that Dries hasn't ticked on the Socials tab.

## How it works

1. **Propose** (`/dev/socials/`, local dev and preview builds only; the "socials" header button).
   `apps/web-next/src/lib/socialPosts.ts` scores each event of the city:
   - starts this week (today + 6 days): +3
   - ends this week: +3
   - image quality: crawler AI score 1-10 scaled to 0-4, +1 if the AI found it clean, plus the
     `/dev/images` rating (-2..+2). Images narrower than 800 px: -2.
   - left out: venues without an Instagram handle (source config `"instagram"`, see
     `scripts/find-instagram-handles.mjs`), events without an image, images rated -2, beta
     sources, permanent listings.
     The best show as the finished post, with the caption (editable) and a "box inset / box flush"
     switch.
2. **Approve**: tick "post this". The browser calls the Supabase RPC `social_approve`, which checks
   the socials passphrase and stores the post in `social_posts` (status `approved`, with the
   layout). Untick calls `social_cancel`. The passphrase is asked once and kept in that browser's
   localStorage.
3. **Publish** (VPS, `kyo-no-kyoto-social.timer`, daily 18:00 JST):
   `apps/crawler/src/social-publish.mjs` takes the approved post whose event ends soonest, marks
   posts of ended events `expired`, downloads the event image, renders the 1080 x 1350 JPEG,
   uploads it to `event-media/social/<id>.jpg`, publishes it (create container → `media_publish`),
   marks the row `published` and deletes the upload again.
   On an error the row becomes `failed` with the message (shown under "Recent" on the tab).

## The post

`packages/shared/social-post.mjs`, after Figma frames 646:2451 (inset) and 646:2458 (flush): the
event-card box (city colour, 6 px lines, 96 px depth, faces 8% / 14% city colour) with the photo at
its own ratio across the full content width, then the meta (venue + dates, uppercase, 49 px) and
the title (70 px), GT Walsheim drawn as glyph paths. The box is as tall as its content and sits
at the top, like the event list rows; "inset" keeps 48 px around it, "flush" touches the top, left
and right edges. The photo is never cropped: its ratio decides how much text fits.

What fits (`layoutSocialPost`): meta + title if the box still fits the post, else the title only,
else the meta only. With a two-line meta and title that is roughly: photo ratio (height / width)
up to 0.8 → meta + title, up to 1.05 → title, up to 1.08 → meta, taller → not proposed. Photos
wider than 2:1 are not proposed either. Titles longer than 3 lines end in "…"; text with
characters GT Walsheim lacks (Japanese) is left out.

Events that have started and end within 6 days get a **LAST WEEK!** pill at the photo's top-right
(city colour, like the site's card badge). The publisher decides this on the day it posts, from
the stored start and end dates.

## Caption

Like the event card: title, dates, venue (`@handle` when the source has `"instagram": "<handle>"`
in `data/sources/<city>-sources.json`, else the venue name), then `#category #subcategories
#venuename` from the event's filter tags.

## One-time setup

1. **Database**: apply `supabase/migrations/20261110040000_social_posts.sql`, then set the
   passphrase in the SQL editor:
   ```sql
   insert into private.social_settings (passphrase_hash)
   values (extensions.crypt('<long passphrase>', extensions.gen_salt('bf')))
   on conflict (id) do update set passphrase_hash = excluded.passphrase_hash;
   ```
2. **Instagram**: the account must be a Professional (Business or Creator) account.
3. **Meta app** (developers.facebook.com → Create app → use case "Manage messaging & content on
   Instagram", i.e. _Instagram API with Instagram login_). Add the Instagram account as a tester /
   in "Generate access tokens", with permissions `instagram_business_basic` and
   `instagram_business_content_publish`. Generate a token there; it is long-lived (60 days) and
   the publisher refreshes it weekly.
   Posting to your own account works while the app stays in development mode; no App Review needed.
4. **VPS** `apps/crawler/.env` (on the VPS via SSH, `/srv/kyo-no-kyoto/apps/crawler/.env`):
   ```
   INSTAGRAM_USER_ID=<the Instagram professional account id, shown with the token>
   INSTAGRAM_ACCESS_TOKEN=<long-lived token>
   # optional: INSTAGRAM_API_VERSION=v23.0, INSTAGRAM_TOKEN_FILE=apps/crawler/.instagram-token.json
   ```
   The refreshed token is written to `apps/crawler/.instagram-token.json` (gitignored).
5. Deploy (merge to main). The deploy installs and enables the timer. Until step 4 is done each
   run just logs "Instagram not configured".

## Checking

- Dry run on the VPS (repo root `/srv/kyo-no-kyoto`): `node apps/crawler/src/social-publish.mjs --dry-run`
  renders the next post to `apps/crawler/.social-preview/<id>.jpg` and prints the caption; nothing
  is uploaded, posted or changed.
- Post now: `sudo systemctl start kyo-no-kyoto-social.service`, then `journalctl -u kyo-no-kyoto-social -n 20`.
- Timer: `systemctl list-timers kyo-no-kyoto-social.timer`.

## Limits

- Instagram allows 100 API posts per 24 h; we post 1.
- Supabase: one ~300 KB upload a day, deleted after posting. Reads of `social_posts` are tiny.
- Venue images: the venues agreed to be listed on the site; check that covers Instagram reposts.
