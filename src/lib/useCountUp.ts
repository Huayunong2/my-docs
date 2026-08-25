import { useEffect, useRef, useState } from "react";

/**
 * 数字滚动动画：当 target 变化时，从上一个值缓动到新值。
 * 传入 null 表示无有效数字，直接归零且不动画。
 */
export function useCountUp(target: number | null, durationMs = 700): number {
  const [value, setValue] = useState(target ?? 0);
  const prevRef = useRef(target ?? 0);

  useEffect(() => {
    if (target == null) {
      prevRef.current = 0;
      setValue(0);
      return;
    }
    const from = prevRef.current;
    const to = target;
    if (from === to) return;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const v = Math.round(from + (to - from) * eased);
      setValue(v);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      prevRef.current = to;
    };
  }, [target, durationMs]);

  return value;
}
