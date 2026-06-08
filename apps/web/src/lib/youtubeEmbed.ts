type YouTubeEmbedOptions = {
  origin?: string;
};

export const buildYouTubeEmbedSrc = (videoId: string, options: YouTubeEmbedOptions = {}) => {
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

  if (options.origin) {
    params.set('origin', options.origin);
  }

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
};
