'use client';

import { useEffect, useState } from 'react';
import { layoutSocialPost, socialPostSvg } from '../../../../../../packages/shared/social-post.mjs';
import styles from './page.module.sass';

type SocialLayout = 'inset' | 'flush';
type MeasuredText = {
  meta: { lines: number } | null;
  metaPaths: string[];
  title: { lines: number } | null;
  titlePaths: string[];
};

export type SocialItem = {
  eventId: string;
  title: string;
  venue: string;
  date: string;
  score: number;
  reasons: string[];
  imageUrl: string;
  previewSrc: string;
  startDate: string | null;
  endDate: string | null;
  caption: string;
  layouts: Record<SocialLayout, MeasuredText>;
  skipReason: string | null;
};

export type SocialPostRow = {
  id: string;
  event_id: string;
  event_title: string;
  layout: SocialLayout;
  caption: string;
  status: 'approved' | 'published' | 'failed' | 'cancelled' | 'expired';
  event_end_date: string | null;
  created_at: string;
  published_at: string | null;
  error: string | null;
};

const PASSPHRASE_KEY = 'kyo_socials_passphrase';
const LAYOUT_KEY = 'kyo_socials_layout';
const LIVE = new Set(['approved', 'published']);
const LAYOUTS: SocialLayout[] = ['inset', 'flush'];

const fitLabel = (fit: { showMeta: boolean; showTitle: boolean }) =>
  fit.showMeta && fit.showTitle ? 'meta + title' : fit.showTitle ? 'title only' : 'meta only';

// The post as the publisher renders it (same SVG), with the photo loaded by the browser.
function SocialPreview({
  item,
  layout,
  color,
  onFit,
}: {
  item: SocialItem;
  layout: SocialLayout;
  color: string;
  onFit: (fit: string | null, reason: string | null) => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setFailed(true);
    image.src = item.previewSrc;
  }, [item.previewSrc]);

  const text = item.layouts[layout];
  const result = size
    ? layoutSocialPost({
        layout,
        imageWidth: size.width,
        imageHeight: size.height,
        meta: text.meta,
        title: text.title,
      })
    : null;
  const fit = result?.ok ? fitLabel(result) : null;
  const reason = failed ? 'image did not load' : result && !result.ok ? result.reason : null;

  useEffect(() => onFit(fit, reason), [fit, reason, onFit]);

  if (!result?.ok) {
    return (
      <figure className={styles.preview} data-empty>
        <figcaption>{reason ?? 'loading…'}</figcaption>
      </figure>
    );
  }
  const svg = socialPostSvg(result, {
    color,
    imageHref: item.previewSrc,
    metaPaths: text.metaPaths,
    titlePaths: text.titlePaths,
  });
  return (
    <figure className={styles.preview}>
      <div className={styles.svg} dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}

function SocialCard({
  item,
  layout,
  color,
  live,
  busy,
  caption,
  onCaption,
  onToggle,
}: {
  item: SocialItem;
  layout: SocialLayout;
  color: string;
  live: SocialPostRow | undefined;
  busy: boolean;
  caption: string;
  onCaption: (value: string) => void;
  onToggle: (checked: boolean, fits: boolean) => void;
}) {
  const [fit, setFit] = useState<{ label: string | null; reason: string | null }>({
    label: null,
    reason: item.skipReason,
  });
  const published = live?.status === 'published';
  const shownLayout = live?.layout ?? layout;
  return (
    <article className={styles.item} data-approved={Boolean(live)}>
      <SocialPreview
        item={item}
        layout={shownLayout}
        color={color}
        onFit={(label, reason) =>
          setFit((current) =>
            current.label === label && current.reason === reason ? current : { label, reason },
          )
        }
      />
      <label className={styles.approve}>
        <input
          type="checkbox"
          checked={Boolean(live)}
          disabled={published || busy || (!live && !fit.label)}
          onChange={(event) => onToggle(event.target.checked, Boolean(fit.label))}
        />
        {published
          ? 'posted'
          : live
            ? `queued (${live.layout})`
            : fit.label
              ? 'post this'
              : "can't post"}
      </label>
      <p className={styles.meta}>
        {item.score} pts · {item.reasons.join(' · ') || 'no points'}
        {fit.label ? ` · card: ${fit.label}` : fit.reason ? ` · ${fit.reason}` : ''}
      </p>
      <textarea
        className={styles.caption}
        value={live ? live.caption : caption}
        readOnly={Boolean(live)}
        rows={7}
        maxLength={2200}
        onChange={(event) => onCaption(event.target.value)}
      />
    </article>
  );
}

export default function SocialsBoard({
  city,
  color,
  items,
  posts: initialPosts,
  supabase,
}: {
  city: string;
  color: string;
  items: SocialItem[];
  posts: SocialPostRow[];
  supabase: { url: string; key: string };
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<SocialLayout>('inset');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LAYOUT_KEY);
      if (stored === 'inset' || stored === 'flush') setLayout(stored);
    } catch {
      // storage blocked: default layout
    }
  }, []);

  const chooseLayout = (next: SocialLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // fine
    }
  };

  const livePostFor = (eventId: string) =>
    posts.find((post) => post.event_id === eventId && LIVE.has(post.status));

  const passphrase = (forget = false) => {
    let stored: string | null = null;
    try {
      if (forget) window.localStorage.removeItem(PASSPHRASE_KEY);
      stored = window.localStorage.getItem(PASSPHRASE_KEY);
    } catch {
      // storage blocked: ask every time
    }
    if (stored) return stored;
    const entered = window.prompt('Socials passphrase');
    if (entered) {
      try {
        window.localStorage.setItem(PASSPHRASE_KEY, entered);
      } catch {
        // fine, ask again next time
      }
    }
    return entered;
  };

  const rpc = async (name: string, body: Record<string, unknown>) => {
    const response = await fetch(`${supabase.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: supabase.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.message ?? `${name} failed (${response.status})`;
      throw Object.assign(new Error(message), { wrongPassphrase: /passphrase/i.test(message) });
    }
    return json as SocialPostRow;
  };

  const toggle = async (item: SocialItem, checked: boolean, fits: boolean) => {
    setError(null);
    if (checked && !fits) return;
    const secret = passphrase();
    if (!secret) return;
    setBusy(item.eventId);
    try {
      if (checked) {
        const row = await rpc('social_approve', {
          passphrase: secret,
          post: {
            city,
            event_id: item.eventId,
            event_title: item.title,
            venue: item.venue,
            event_date_text: item.date,
            layout,
            image_url: item.imageUrl,
            caption: captions[item.eventId] ?? item.caption,
            event_start_date: item.startDate,
            event_end_date: item.endDate,
          },
        });
        setPosts((current) => [row, ...current]);
      } else {
        const live = livePostFor(item.eventId);
        if (!live) return;
        const row = await rpc('social_cancel', { passphrase: secret, post_id: live.id });
        setPosts((current) => current.map((post) => (post.id === row.id ? row : post)));
      }
    } catch (caught) {
      const failure = caught as Error & { wrongPassphrase?: boolean };
      if (failure.wrongPassphrase) passphrase(true);
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  };

  const queue = posts
    .filter((post) => post.status === 'approved')
    .sort(
      (left, right) =>
        (left.event_end_date ?? '9999').localeCompare(right.event_end_date ?? '9999') ||
        left.created_at.localeCompare(right.created_at),
    );
  const history = posts.filter((post) => post.status !== 'approved').slice(0, 10);

  return (
    <>
      <div className={styles.layouts} role="group" aria-label="Post layout">
        {LAYOUTS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={layout === option}
            onClick={() => chooseLayout(option)}
          >
            {option === 'inset' ? 'box inset' : 'box flush'}
          </button>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <section className={styles.queue}>
        <h2>Queue ({queue.length})</h2>
        {queue.length === 0 && <p className={styles.note}>Nothing approved yet.</p>}
        <ol>
          {queue.map((post) => (
            <li key={post.id}>
              {post.event_title}
              {post.event_end_date ? ` · ends ${post.event_end_date}` : ''}
            </li>
          ))}
        </ol>
        {history.length > 0 && (
          <>
            <h2>Recent</h2>
            <ul>
              {history.map((post) => (
                <li key={post.id}>
                  {post.status}: {post.event_title}
                  {post.published_at ? ` · ${post.published_at.slice(0, 10)}` : ''}
                  {post.error ? ` · ${post.error}` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className={styles.grid}>
        {items.map((item) => (
          <SocialCard
            key={item.eventId}
            item={item}
            layout={layout}
            color={color}
            live={livePostFor(item.eventId)}
            busy={busy === item.eventId}
            caption={captions[item.eventId] ?? item.caption}
            onCaption={(value) => setCaptions((current) => ({ ...current, [item.eventId]: value }))}
            onToggle={(checked, fits) => toggle(item, checked, fits)}
          />
        ))}
      </section>
    </>
  );
}
