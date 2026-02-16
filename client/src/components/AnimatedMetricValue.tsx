import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clamp, getAnimationDuration, getDampedProgress, roundForPrecision } from '../utils/animation';

interface AnimatedMetricValueProps {
  value: number;
  format: (value: number) => string;
  precision?: number;
}

export function AnimatedMetricValue({ value, format, precision = 0 }: AnimatedMetricValueProps) {
  const safeTarget = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [displayValue, setDisplayValue] = useState<number>(() => roundForPrecision(safeTarget, precision));
  const [isAnimating, setIsAnimating] = useState(false);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [rollDurationMs, setRollDurationMs] = useState(260);
  const rafRef = useRef<number | null>(null);
  const displayedRef = useRef<number>(roundForPrecision(safeTarget, precision));
  const lastTargetAtRef = useRef<number | null>(null);

  useEffect(() => {
    displayedRef.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    const target = roundForPrecision(safeTarget, precision);
    const from = displayedRef.current;
    const delta = Math.abs(target - from);
    const now = performance.now();
    const updateGapMs = lastTargetAtRef.current === null ? null : now - lastTargetAtRef.current;
    lastTargetAtRef.current = now;
    const duration = getAnimationDuration(delta, precision, updateGapMs);
    const nextRollDuration = clamp(Math.round(duration * 0.72), 220, 900);
    setRollDurationMs(nextRollDuration);

    if (delta === 0 || duration === 0) {
      setIsAnimating(false);
      setDisplayValue(target);
      displayedRef.current = target;
      return;
    }

    setDirection(target >= from ? 'up' : 'down');
    setIsAnimating(true);

    const startTime = performance.now();
    const tick = (frameNow: number) => {
      const t = Math.min((frameNow - startTime) / duration, 1);
      const eased = getDampedProgress(t, delta, precision);
      const nextValue = roundForPrecision(from + (target - from) * eased, precision);

      if (nextValue !== displayedRef.current) {
        displayedRef.current = nextValue;
        setDisplayValue(nextValue);
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayedRef.current = target;
        setDisplayValue((prev) => (prev === target ? prev : target));
        setIsAnimating(false);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [safeTarget, precision]);

  const metricStyle = {
    '--metric-roll-duration': `${rollDurationMs}ms`
  } as CSSProperties;

  return (
    <div
      className={`metric-value metric-value-animated ${isAnimating ? `is-animating is-${direction}` : ''}`}
      style={metricStyle}
    >
      {format(displayValue)}
    </div>
  );
}
