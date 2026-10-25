import React, { useCallback, useEffect, useRef, useState } from 'react';

const SEEN_KEY = 'playing-god.intro-seen';
/** The whole sequence: the first light swells, then the name arrives. Any click or key ends it at once. */
export const INTRO_MS = 3200;
const LEAVE_MS = 600;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether to open with the entry sequence: once per browser, never under automation or in unit tests (it would sit on
 * top of the controls being driven), and never when the reader asked for reduced motion.
 */
export function shouldShowIntro(): boolean {
  if (import.meta.env.MODE === 'test') return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return storage()?.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

function rememberSeen(): void {
  try {
    storage()?.setItem(SEEN_KEY, '1');
  } catch {
    // Private windows may refuse storage: the sequence then simply shows again next time.
  }
}

/**
 * "Let there be light": a short, skippable opening over the real, already-loading workspace. It plays no sound and
 * holds nothing back: the simulation underneath loads and works while it runs.
 */
export const EntrySequence: React.FC<{ onDone: () => void; durationMs?: number }> = ({ onDone, durationMs = INTRO_MS }) => {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    rememberSeen();
    setLeaving(true);
    window.setTimeout(onDone, LEAVE_MS);
  }, [onDone]);

  useEffect(() => {
    const timer = window.setTimeout(finish, durationMs);
    const onKey = () => finish();
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [durationMs, finish]);

  return (
    <div className="pg-intro" data-testid="entry-sequence" data-leaving={leaving} onClick={finish} role="dialog" aria-label="Playing God" aria-modal="false">
      <div className="pg-intro__light" aria-hidden="true" />
      <div className="pg-intro__text">
        <p className="pg-intro__title">Playing God</p>
        <p className="pg-intro__line">Let there be light.</p>
      </div>
      <button type="button" className="pg-intro__skip" onClick={(e) => { e.stopPropagation(); finish(); }}>
        Enter the universe
      </button>
    </div>
  );
};
