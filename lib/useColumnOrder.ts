"use client";

import { useState, useEffect, useCallback } from "react";

// Shared column drag-to-reorder behavior for the Dashboard and batch tables —
// each page keeps its own column definitions/rendering, this just owns the
// order array (persisted per page under its own storageKey) and the native
// HTML5 drag-and-drop handlers to rearrange it.
export function useColumnOrder<K extends string>(storageKey: string, keys: K[]) {
  const [order, setOrder] = useState<K[]>(keys);
  const [dragKey, setDragKey] = useState<K | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as K[] | null;
      if (saved && saved.length) {
        const known = saved.filter((k) => keys.includes(k));
        const missing = keys.filter((k) => !known.includes(k));
        setOrder([...known, ...missing]);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const onDragStart = useCallback((key: K) => (e: React.DragEvent) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onDrop = useCallback((key: K) => (e: React.DragEvent) => {
    e.preventDefault();
    setOrder((prev) => {
      if (!dragKey || dragKey === key) return prev;
      const next = [...prev];
      const from = next.indexOf(dragKey);
      const to = next.indexOf(key);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragKey);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setDragKey(null);
  }, [dragKey, storageKey]);

  return { order, dragKey, onDragStart, onDragOver, onDrop };
}
