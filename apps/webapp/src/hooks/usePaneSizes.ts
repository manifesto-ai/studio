import { useCallback, useEffect, useState } from "react";

export type PaneSizes = { readonly left: number; readonly right: number };

const MIN_LEFT = 280;
const MIN_RIGHT = 320;
const MIN_CENTER = 320;
const LAYOUT_STORAGE_KEY = "studio.layout.v2";
const DEFAULT_SIZES: PaneSizes = { left: 440, right: 400 };

export const PANE_LIMITS = { MIN_LEFT, MIN_RIGHT, MIN_CENTER, DEFAULT_SIZES };

export function usePaneSizes() {
  const [sizes, setSizes] = useState<PaneSizes>(() => loadSizes());

  useEffect(() => {
    saveSizes(sizes);
  }, [sizes]);

  const setLeft = useCallback((next: number, totalWidth: number) => {
    setSizes((s) => {
      const upper = Math.max(MIN_LEFT, totalWidth - s.right - MIN_CENTER);
      const clamped = clamp(next, MIN_LEFT, upper);
      return clamped === s.left ? s : { ...s, left: clamped };
    });
  }, []);
  const setRight = useCallback((next: number, totalWidth: number) => {
    setSizes((s) => {
      const upper = Math.max(MIN_RIGHT, totalWidth - s.left - MIN_CENTER);
      const clamped = clamp(next, MIN_RIGHT, upper);
      return clamped === s.right ? s : { ...s, right: clamped };
    });
  }, []);

  return { sizes, setSizes, setLeft, setRight };
}

function loadSizes(): PaneSizes {
  if (typeof window === "undefined") return DEFAULT_SIZES;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === null) return DEFAULT_SIZES;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PaneSizes).left === "number" &&
      typeof (parsed as PaneSizes).right === "number"
    ) {
      return parsed as PaneSizes;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SIZES;
}

function saveSizes(s: PaneSizes): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
