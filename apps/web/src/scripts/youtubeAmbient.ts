type YouTubePlayer = {
  mute: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
};

type YouTubePlayerEvent = {
  target: YouTubePlayer;
};

type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events?: {
        onReady?: (event: YouTubePlayerEvent) => void;
      };
    },
  ) => YouTubePlayer;
};

type AmbientYouTubeWindow = Window &
  typeof globalThis & {
    YT?: YouTubeApi;
    __ambientYouTubeBound?: boolean;
    __ambientYouTubeApiPromise?: Promise<YouTubeApi>;
    __ambientYouTubeLoadObservers?: IntersectionObserver[];
    __ambientYouTubePlayObservers?: IntersectionObserver[];
    onYouTubeIframeAPIReady?: () => void;
  };

type AmbientEmbedState = {
  frame: HTMLIFrameElement;
  loaded: boolean;
  binding: boolean;
  player: YouTubePlayer | null;
  ready: boolean;
  visible: boolean;
};

const embedSelector = '[data-youtube-ambient]';
const frameSelector = '[data-youtube-frame]';
const eventsSectionSelector = '[data-events-section]';
const loadRootMargin = '900px 0px';
const playThreshold = 0.5;
const apiSrc = 'https://www.youtube.com/iframe_api';

const ambientWindow = window as AmbientYouTubeWindow;
const embedStates = new WeakMap<HTMLElement, AmbientEmbedState>();
let activeEmbed: HTMLElement | null = null;

const getEmbeds = () =>
  Array.from(document.querySelectorAll(embedSelector)).filter(
    (embed): embed is HTMLElement => embed instanceof HTMLElement,
  );

const getScrollRoot = (embed: HTMLElement) => {
  const root = embed.closest(eventsSectionSelector);
  return root instanceof HTMLElement ? root : null;
};

const loadYouTubeApi = () => {
  if (ambientWindow.YT?.Player) return Promise.resolve(ambientWindow.YT);
  if (ambientWindow.__ambientYouTubeApiPromise) return ambientWindow.__ambientYouTubeApiPromise;

  ambientWindow.__ambientYouTubeApiPromise = new Promise<YouTubeApi>((resolve) => {
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

  return ambientWindow.__ambientYouTubeApiPromise;
};

const stateFor = (embed: HTMLElement) => {
  const existing = embedStates.get(embed);
  if (existing) return existing;

  const frame = embed.querySelector(frameSelector);
  if (!(frame instanceof HTMLIFrameElement)) return null;

  const nextState: AmbientEmbedState = {
    frame,
    loaded: Boolean(frame.getAttribute('src')),
    binding: false,
    player: null,
    ready: false,
    visible: false,
  };
  embedStates.set(embed, nextState);
  return nextState;
};

const pauseEmbed = (embed: HTMLElement) => {
  const state = stateFor(embed);
  if (!state?.player) return;
  state.player.pauseVideo();
  embed.dataset.youtubePlaying = 'false';
};

const playEmbed = (embed: HTMLElement) => {
  const state = stateFor(embed);
  if (!state?.player || !state.ready || !state.visible) return;

  if (activeEmbed && activeEmbed !== embed) {
    pauseEmbed(activeEmbed);
  }

  state.player.mute();
  state.player.playVideo();
  embed.dataset.youtubePlaying = 'true';
  activeEmbed = embed;
};

const syncPlayback = (embed: HTMLElement) => {
  const state = stateFor(embed);
  if (!state) return;

  if (state.visible) {
    playEmbed(embed);
    return;
  }

  pauseEmbed(embed);
  if (activeEmbed === embed) activeEmbed = null;
};

const loadEmbed = async (embed: HTMLElement) => {
  const state = stateFor(embed);
  if (!state || state.player || state.binding) return;

  const src = state.frame.dataset.youtubeSrc;
  if (!state.loaded) {
    if (!src) return;

    state.loaded = true;
    embed.dataset.youtubeLoaded = 'true';
    state.frame.src = src;
  }

  state.binding = true;
  const api = await loadYouTubeApi();
  state.binding = false;
  if (state.player) return;

  state.player = new api.Player(state.frame, {
    events: {
      onReady: (event) => {
        state.player = event.target;
        state.ready = true;
        event.target.mute();
        embed.dataset.youtubeReady = 'true';
        syncPlayback(embed);
      },
    },
  });
};

const rebuildObservers = () => {
  ambientWindow.__ambientYouTubeLoadObservers?.forEach((observer) => observer.disconnect());
  ambientWindow.__ambientYouTubePlayObservers?.forEach((observer) => observer.disconnect());
  ambientWindow.__ambientYouTubeLoadObservers = [];
  ambientWindow.__ambientYouTubePlayObservers = [];

  getEmbeds().forEach((embed) => {
    const state = stateFor(embed);
    if (!state) return;

    const root = getScrollRoot(embed);
    const loadObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          if (entry.target instanceof HTMLElement) void loadEmbed(entry.target);
        });
      },
      {
        root,
        rootMargin: loadRootMargin,
        threshold: 0,
      },
    );

    const playObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!(entry.target instanceof HTMLElement)) return;
          const targetState = stateFor(entry.target);
          if (!targetState) return;

          targetState.visible = entry.isIntersecting && entry.intersectionRatio > playThreshold;
          if (targetState.visible) void loadEmbed(entry.target);
          syncPlayback(entry.target);
        });
      },
      {
        root,
        threshold: [0, playThreshold, 0.75, 1],
      },
    );

    if (state.loaded) {
      void loadEmbed(embed);
    } else {
      loadObserver.observe(embed);
    }

    playObserver.observe(embed);
    ambientWindow.__ambientYouTubeLoadObservers?.push(loadObserver);
    ambientWindow.__ambientYouTubePlayObservers?.push(playObserver);
  });
};

export const initAmbientYouTubeEmbeds = () => {
  if (ambientWindow.__ambientYouTubeBound) return;

  let rebuildFrame = 0;
  const scheduleRebuild = () => {
    if (rebuildFrame) window.cancelAnimationFrame(rebuildFrame);
    rebuildFrame = window.requestAnimationFrame(() => {
      rebuildFrame = 0;
      rebuildObservers();
    });
  };

  rebuildObservers();
  document.addEventListener('astro:page-load', scheduleRebuild);
  document.addEventListener('event-filter:updated', scheduleRebuild);
  window.addEventListener('resize', scheduleRebuild);
  ambientWindow.__ambientYouTubeBound = true;
};
