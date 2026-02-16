export function roundForPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0;
  if (precision <= 0) return Math.round(value);
  return Number(value.toFixed(precision));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getAnimationDuration(delta: number, precision: number, updateGapMs: number | null): number {
  if (delta <= 0) return 0;
  let baseDuration = 0;

  if (precision > 0) {
    if (delta < 0.2) baseDuration = 420;
    else if (delta < 5) baseDuration = 640;
    else if (delta < 20) baseDuration = 840;
    else baseDuration = 1050;
  } else {
    if (delta < 10) baseDuration = 360;
    else if (delta < 1000) baseDuration = 620;
    else if (delta < 100000) baseDuration = 920;
    else baseDuration = 1200;
  }

  if (updateGapMs !== null) {
    const cadenceCap = clamp(Math.round(updateGapMs * 0.9), 240, 1400);
    return Math.min(baseDuration, cadenceCap);
  }
  return baseDuration;
}

export function getDampedProgress(t: number, delta: number, precision: number): number {
  const progress = clamp(t, 0, 1);
  const deltaScale = precision > 0 ? clamp(delta / 20, 0, 1) : clamp(delta / 5000, 0, 1);
  const damping = 8.8 - (deltaScale * 2.2);
  const angular = 10.5 + (deltaScale * 4.5);
  const raw = 1 - (Math.exp(-damping * progress) * Math.cos(angular * progress));
  const maxOvershootUnits = precision > 0 ? 0.08 : clamp(delta * 0.02, 1, 2400);
  const maxProgress = 1 + (delta > 0 ? (maxOvershootUnits / delta) : 0);
  return clamp(raw, 0, maxProgress);
}
