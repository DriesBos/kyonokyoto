export type YouTubeEmbed = { type: 'youtube'; url: string; videoId: string };

export const youtubeVideoIdFromUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (url.hostname.endsWith('youtube.com')) return url.searchParams.get('v');
  } catch {
    return null;
  }
  return null;
};

export const normalizeYouTubeEmbeds = (embeds: unknown): YouTubeEmbed[] =>
  (Array.isArray(embeds) ? embeds : [])
    .map((embed) => {
      if (!embed || typeof embed !== 'object') return null;
      const value = embed as { type?: unknown; url?: unknown; video_id?: unknown };
      if (value.type !== 'youtube' || typeof value.url !== 'string') return null;
      const videoId =
        typeof value.video_id === 'string' ? value.video_id : youtubeVideoIdFromUrl(value.url);
      return videoId ? { type: 'youtube' as const, url: value.url, videoId } : null;
    })
    .filter((embed): embed is YouTubeEmbed => embed !== null);

export const buildYouTubeEmbedSrc = (videoId: string, origin?: string) => {
  const params = new URLSearchParams({
    autoplay: '0',
    mute: '1',
    controls: '0',
    loop: '1',
    playlist: videoId,
    playsinline: '1',
    disablekb: '1',
    enablejsapi: '1',
    fs: '0',
    rel: '0',
    iv_load_policy: '3',
  });
  if (origin) params.set('origin', origin);
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
};
