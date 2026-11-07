import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** A panel width the person drags, kept between launches. */
export function usePanelWidth(key: string, initial: number, min: number, max: number): [number, (w: number) => void] {
  const clamp = useCallback((w: number) => Math.round(Math.min(max, Math.max(min, w))), [min, max]);
  const [width, setWidthState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved ? clamp(saved) : initial;
    } catch {
      return initial;
    }
  });
  const setWidth = useCallback(
    (w: number) => {
      const next = clamp(w);
      setWidthState(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Only a remembered layout.
      }
    },
    [key, clamp],
  );
  return [width, setWidth];
}

/**
 * A vertical drag handle between two panels. `side` says which panel it sizes: "left" grows as the handle moves right,
 * "right" grows as it moves left. Double-click restores the default width.
 */
export function Resizer({ width, onWidth, side, defaultWidth, label }: { width: number; onWidth: (w: number) => void; side: "left" | "right"; defaultWidth: number; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    onWidth(start.current.w + (side === "left" ? dx : -dx));
  };
  const end = () => {
    start.current = null;
    setDragging(false);
  };

  return (
    <div
      className={`resizer ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (drag; double-click to reset)`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onWidth(defaultWidth)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") onWidth(width + (side === "left" ? -step : step));
        if (e.key === "ArrowRight") onWidth(width + (side === "left" ? step : -step));
      }}
    />
  );
}
