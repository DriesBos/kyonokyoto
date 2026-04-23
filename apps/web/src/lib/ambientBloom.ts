export type AmbientBloomNote = {
  id: number;
  note: string;
  frequency: number;
  velocity: number;
  loudness: number;
  duration: number;
  pan: number;
  viewportX: number;
  viewportY: number;
};

type AmbientBloomEngineOptions = {
  onNote?: (note: AmbientBloomNote) => void;
};

type AudioContextWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const scale = [
  { note: "A3", frequency: 220 },
  { note: "C4", frequency: 261.63 },
  { note: "D4", frequency: 293.66 },
  { note: "E4", frequency: 329.63 },
  { note: "G4", frequency: 392 },
  { note: "A4", frequency: 440 },
  { note: "C5", frequency: 523.25 },
  { note: "D5", frequency: 587.33 },
  { note: "E5", frequency: 659.25 },
  { note: "G5", frequency: 783.99 },
];

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const createAmbientBloomEngine = ({ onNote }: AmbientBloomEngineOptions = {}) => {
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let masterGain: GainNode | null = null;
  let delay: DelayNode | null = null;
  let delayFeedback: GainNode | null = null;
  let delayFilter: BiquadFilterNode | null = null;
  let dryGain: GainNode | null = null;
  let wetGain: GainNode | null = null;
  let timer = 0;
  let noteId = 0;
  let active = false;
  let frequencyData: Uint8Array | null = null;
  let timeDomainData: Uint8Array | null = null;

  const ensureContext = () => {
    if (context) return context;

    const AudioContextClass =
      window.AudioContext || (window as AudioContextWindow).webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("This browser does not support the Web Audio API.");
    }

    context = new AudioContextClass();
    masterGain = context.createGain();
    dryGain = context.createGain();
    wetGain = context.createGain();
    delay = context.createDelay(5);
    delayFeedback = context.createGain();
    delayFilter = context.createBiquadFilter();
    analyser = context.createAnalyser();

    masterGain.gain.value = 0;
    dryGain.gain.value = 0.78;
    wetGain.gain.value = 0.2;
    delay.delayTime.value = 0.46;
    delayFeedback.gain.value = 0.36;
    delayFilter.type = "lowpass";
    delayFilter.frequency.value = 1800;
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.88;

    delay.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayFilter.connect(wetGain);
    dryGain.connect(masterGain);
    wetGain.connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(context.destination);

    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    timeDomainData = new Uint8Array(analyser.fftSize);

    return context;
  };

  const chooseNote = () => {
    const index = Math.floor(Math.random() * scale.length);
    return scale[index];
  };

  const emitNote = () => {
    const audioContext = ensureContext();
    if (!active || !masterGain || !dryGain || !delay) return;

    const now = audioContext.currentTime;
    const selected = chooseNote();
    const velocity = randomBetween(0.32, 0.82);
    const duration = randomBetween(4.8, 8.4);
    const viewportX = randomBetween(0.1, 0.9);
    const viewportY = randomBetween(0.14, 0.86);
    const pan = clamp(viewportX * 2 - 1, -0.85, 0.85);
    const loudness = velocity * randomBetween(0.72, 1);

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const panner = audioContext.createStereoPanner();

    oscillator.type = Math.random() > 0.35 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(selected.frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.052 * velocity, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.pan.setValueAtTime(pan, now);

    oscillator.connect(gain);
    gain.connect(panner);
    panner.connect(dryGain);
    panner.connect(delay);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.12);

    onNote?.({
      id: noteId,
      note: selected.note,
      frequency: selected.frequency,
      velocity,
      loudness,
      duration,
      pan,
      viewportX,
      viewportY,
    });

    noteId += 1;
  };

  const scheduleNext = () => {
    if (!active) return;

    const delayMs = randomBetween(950, 2600);
    timer = window.setTimeout(() => {
      emitNote();
      scheduleNext();
    }, delayMs);
  };

  const start = async () => {
    const audioContext = ensureContext();
    active = true;

    if (audioContext.state !== "running") {
      await audioContext.resume();
    }

    if (masterGain) {
      const now = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(0.34, now, 0.42);
    }

    window.clearTimeout(timer);
    emitNote();
    scheduleNext();
  };

  const stop = async () => {
    if (!context) return;

    active = false;
    window.clearTimeout(timer);

    if (masterGain) {
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(0.0001, now, 0.28);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 520));

    if (!active && context.state === "running") {
      await context.suspend();
    }
  };

  const readLevels = () => {
    if (!analyser || !frequencyData || !timeDomainData) {
      return { volume: 0, low: 0, mid: 0, high: 0 };
    }

    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeDomainData);

    const bandAverage = (start: number, end: number) => {
      let total = 0;
      for (let index = start; index < end; index += 1) {
        total += frequencyData?.[index] ?? 0;
      }
      return total / Math.max(1, end - start) / 255;
    };

    let squareTotal = 0;
    for (const sample of timeDomainData) {
      const centered = (sample - 128) / 128;
      squareTotal += centered * centered;
    }

    return {
      volume: Math.sqrt(squareTotal / timeDomainData.length),
      low: bandAverage(0, 8),
      mid: bandAverage(8, 28),
      high: bandAverage(28, frequencyData.length),
    };
  };

  const dispose = async () => {
    active = false;
    window.clearTimeout(timer);

    if (context && context.state !== "closed") {
      await context.close();
    }

    context = null;
    analyser = null;
    masterGain = null;
    delay = null;
    delayFeedback = null;
    delayFilter = null;
    dryGain = null;
    wetGain = null;
    frequencyData = null;
    timeDomainData = null;
  };

  return {
    start,
    stop,
    readLevels,
    dispose,
    get active() {
      return active;
    },
  };
};
