import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cityConfigFor, cityConfigs, dateOnlyInTimeZone } from '@/lib/cities';
import { fetchCityEvents } from '@/lib/cityEvents';
import { supabaseEnv } from '@/lib/env';
import { eventMediaDeliveryUrl } from '@/lib/mediaDelivery';
import { socialFont } from '@/lib/socialFont';
import { rankSocialCandidates, SOCIALS_ENABLED, socialCaption } from '@/lib/socialPosts';
import {
  layoutSocialPost,
  measureSocialBadge,
  measureSocialPostText,
  SOCIAL_LAYOUTS,
} from '../../../../../../packages/shared/social-post.mjs';
import SocialsBoard, { type SocialItem, type SocialPostRow } from './SocialsBoard';
import styles from './page.module.sass';

// Socials tab (local + preview builds only): the best Instagram candidates of a city, rendered as
// the post. Ticking one stores it in Supabase social_posts (passphrase-checked RPC); the VPS
// publisher renders the same post and posts one approved post a day. See
// docs/instagram-autopost.md.
export const metadata: Metadata = {
  title: 'socials | dev',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

// Ranked candidates looked at; those whose image can't make a post are listed separately.
const CANDIDATE_LIMIT = 24;

const fetchPosts = async (city: string): Promise<SocialPostRow[] | null> => {
  const { url, key } = supabaseEnv();
  if (!url || !key) return null;
  const endpoint = new URL('/rest/v1/social_posts', url);
  endpoint.search = new URLSearchParams({
    select:
      'id,event_id,event_title,layout,caption,status,event_end_date,created_at,published_at,error',
    city: `eq.${city}`,
    order: 'created_at.desc',
    limit: '100',
  }).toString();
  const response = await fetch(endpoint, { headers: { apikey: key }, cache: 'no-store' });
  // 404 until the social_posts migration is applied
  return response.ok ? ((await response.json()) as SocialPostRow[]) : null;
};

export default async function SocialsPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  if (!SOCIALS_ENABLED) notFound();
  const city = cityConfigFor((await searchParams).city ?? 'kyoto') ?? cityConfigs[0];
  const today = dateOnlyInTimeZone(new Date(), city.timeZone);
  const [events, posts, font] = await Promise.all([
    fetchCityEvents({ city: city.slug, locale: 'en' }),
    fetchPosts(city.slug),
    socialFont(),
  ]);

  const items: SocialItem[] = rankSocialCandidates(events, today)
    .slice(0, CANDIDATE_LIMIT)
    .map((candidate) => {
      const { event } = candidate;
      const text = {
        venue: event.institution || event.venue,
        date: event.date,
        title: event.title,
      };
      const layouts = Object.fromEntries(
        Object.keys(SOCIAL_LAYOUTS).map((layout) => [
          layout,
          measureSocialPostText(font, text, layout),
        ]),
      ) as SocialItem['layouts'];
      // known image size: decide here; unknown: the preview measures the loaded image
      const known = candidate.imageWidth && candidate.imageHeight;
      const verdict = known
        ? layoutSocialPost({
            layout: 'inset',
            imageWidth: candidate.imageWidth,
            imageHeight: candidate.imageHeight,
            meta: layouts.inset.meta,
            title: layouts.inset.title,
          })
        : null;
      return {
        eventId: event.id,
        title: event.title,
        venue: text.venue ?? '',
        date: event.date,
        score: candidate.score,
        reasons: candidate.reasons,
        imageUrl: candidate.imageUrl,
        previewSrc: eventMediaDeliveryUrl(candidate.imageUrl) ?? candidate.imageUrl,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        lastWeek: candidate.lastWeek,
        caption: socialCaption(event),
        layouts,
        skipReason: verdict && !verdict.ok ? verdict.reason : null,
      };
    });

  const { url, key } = supabaseEnv();

  return (
    <main className={styles.main}>
      <h1>Socials</h1>
      <nav className={styles.cities}>
        {cityConfigs.map((option) => (
          <Link
            key={option.slug}
            href={`/dev/socials/?city=${option.slug}`}
            aria-current={option.slug === city.slug ? 'page' : undefined}
          >
            {option.label}
          </Link>
        ))}
        <Link href={`/${city.slug}/`}>Back to {city.label}</Link>
      </nav>
      <p className={styles.note}>
        Best Instagram candidates this week ({today} + 6 days), only from venues with an Instagram
        handle (source config &quot;instagram&quot;). Points: starts this week +3, ends this week
        +3, image quality up to +7 (AI score, clean, your /dev/images rating). The card shows meta +
        title when both fit under the photo, else the title, else the meta; images wider than 2:1 or
        taller than 5:4 are skipped. Tick a post to queue it: the VPS posts one a day at 18:00,
        soonest-ending first, and drops posts whose event has ended.
      </p>
      {posts === null && (
        <p className={styles.error}>
          The social_posts table is missing: apply supabase/migrations/*_social_posts.sql first.
        </p>
      )}
      <SocialsBoard
        city={city.slug}
        color={city.themeColor}
        badge={measureSocialBadge(font)}
        items={items}
        posts={posts ?? []}
        supabase={{ url: url ?? '', key: key ?? '' }}
      />
    </main>
  );
}
