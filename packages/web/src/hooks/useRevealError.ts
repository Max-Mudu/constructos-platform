import { useEffect, useRef } from 'react';

/**
 * Brings a form's error banner into view when a save fails.
 *
 * The delivery, labour and attendance forms show the API's refusal in a
 * banner above the form, while the Save button sits at the bottom. On a phone
 * (and on the long delivery forms on any screen) the banner is off-screen when
 * the user presses Save, so a refused save looked like a button that did
 * nothing. Attach the returned ref to an element wrapping the banner: each
 * time `message` becomes non-empty it is scrolled into view and focused, so
 * keyboard and screen-reader users land on it too.
 */
export function useRevealError<T extends HTMLElement = HTMLDivElement>(message: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!message) return;
    const el = ref.current;
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }, [message]);
  return ref;
}
