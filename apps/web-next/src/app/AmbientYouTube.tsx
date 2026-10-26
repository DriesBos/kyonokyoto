'use client';

import { useEffect, useRef, useState } from 'react';
import { buildYouTubeEmbedSrc } from '@/lib/youtubeEmbed';

// Port of apps/web scripts/youtubeAmbient.ts: card videos load near the viewport and play
// muted while at least half visible. Every visible video plays (apps/web played one at a time).

type YouTubePlayer = { mute: () => void; playVideo: () => void; pauseVideo: () => void };
type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: { events?: { onReady?: (event: { target: YouTubePlayer }) => void } },
  ) => YouTubePlayer;
};
type AmbientYouTubeWindow = Window &
  typeof globalThis & {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  };

const apiSrc = 'https://www.youtube.com/iframe_api';
const loadRootMargin = '900px 0px';
const playThreshold = 0.5;

let apiPromise: Promise<YouTubeApi> | null = null;

const loadYouTubeApi = () => {
  const ambientWindow = window as AmbientYouTubeWindow;
  if (ambientWindow.YT?.Player) return Promise.resolve(ambientWindow.YT);
  apiPromise ??= new Promise<YouTubeApi>((resolve) => {
    const previousReady = ambientWindow.onYouTubeIframeAPIReady;
    ambientWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (ambientWindow.YT?.Player) resolve(ambientWindow.YT);
    };
    if (document.querySelector(`script[src="${apiSrc}"]`)) return;
    const script = document.createElement('script');
    script.src = apiSrc;
    script.async = true;
    document.head.append(script);
  });
  return apiPromise;
};

export function AmbientYouTube({
  videoId,
  title,
  className,
}: {
  videoId: string;
  title: string;
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  // Set the src only once the frame nears the viewport.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setSrc(buildYouTubeEmbedSrc(videoId, window.location.origin));
      },
      { rootMargin: loadRootMargin },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [videoId]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !src) return;

    let player: YouTubePlayer | null = null;
    let ready = false;
    let visible = false;
    let disposed = false;

    const sync = () => {
      if (!player || !ready) return;
      if (visible) {
        player.mute();
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    };

    void loadYouTubeApi().then((api) => {
      if (disposed) return;
      new api.Player(frame, {
        events: {
          onReady: (event) => {
            if (disposed) return;
            player = event.target;
            ready = true;
            player.mute();
            sync();
          },
        },
      });
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > playThreshold);
        sync();
      },
      { threshold: [0, playThreshold, 0.75, 1] },
    );
    observer.observe(frame);

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [src]);

  return (
    <iframe
      ref={frameRef}
      className={className}
      data-event-card-part="media-embed"
      src={src ?? undefined}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      tabIndex={-1}
    />
  );
}
