// Optional ambient sound: a quiet, slowly breathing drone synthesised with Web Audio (no audio files). It never starts
// on its own: only an explicit user press starts it, and the same control stops it. Nothing in the app depends on it.
import { useCallback, useEffect, useRef, useState } from "react";

interface Drone {
  context: AudioContext;
  master: GainNode;
  stop: () => void;
}

const VOLUME = 0.05;

function startDrone(): Drone | null {
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined" ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  const master = context.createGain();
  master.gain.value = 0;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  filter.Q.value = 0.4;
  filter.connect(master);
  master.connect(context.destination);

  // A low open fifth with a soft octave; slight detuning gives slow beating instead of a static tone.
  const voices = [55, 82.41, 110.3, 164.6].map((frequency, i) => {
    const osc = context.createOscillator();
    osc.type = i < 2 ? "sine" : "triangle";
    osc.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = i < 2 ? 0.5 : 0.12;
    osc.connect(gain).connect(filter);
    osc.start();
    return osc;
  });
  // The filter opens and closes over about twenty seconds.
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 260;
  lfo.connect(lfoDepth).connect(filter.frequency);
  lfo.start();

  const now = context.currentTime;
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(VOLUME, now + 2.5);

  return {
    context,
    master,
    stop: () => {
      const t = context.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.6);
      window.setTimeout(() => {
        for (const v of voices) v.stop();
        lfo.stop();
        void context.close();
      }, 700);
    },
  };
}

/** `on` reflects whether the drone is actually playing; `available` is false where Web Audio does not exist. */
export function useAmbientSound(): { on: boolean; available: boolean; toggle: () => void } {
  const drone = useRef<Drone | null>(null);
  const [on, setOn] = useState(false);
  const available = typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);

  const toggle = useCallback(() => {
    if (drone.current) {
      drone.current.stop();
      drone.current = null;
      setOn(false);
      return;
    }
    const started = startDrone();
    drone.current = started;
    setOn(started !== null);
  }, []);

  useEffect(() => () => drone.current?.stop(), []);
  return { on, available, toggle };
}
