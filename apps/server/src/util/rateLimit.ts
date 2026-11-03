/**
 * Fixed-length sliding window limiter. Returns false when the caller has
 * already consumed the allowance for the current window.
 */
export function consumeSlidingWindow(
  eventTimes: number[],
  now: number,
  windowMs: number,
  maxEvents: number,
): boolean {
  while (eventTimes.length > 0 && now - (eventTimes[0] ?? now) >= windowMs) {
    eventTimes.shift();
  }

  if (eventTimes.length >= maxEvents) {
    return false;
  }

  eventTimes.push(now);
  return true;
}
