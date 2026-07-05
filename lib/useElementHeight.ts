"use client";

import { useEffect, useRef, useState } from "react";

// Measures a sticky element's rendered height so a second sticky element
// below it (e.g. a table's <thead>) can offset its own `top` by that amount
// instead of a hardcoded pixel guess that drifts whenever the toolbar's
// content wraps or changes.
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // contentRect excludes padding/border — use getBoundingClientRect (border-box,
    // matches what's actually visually occupied) so the offset lines up exactly
    // with the bottom edge of a padded toolbar.
    const observer = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}
