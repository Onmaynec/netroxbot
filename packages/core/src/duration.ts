const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
  w: 60 * 60 * 24 * 7
};

export function parseDurationSeconds(
  input: string,
  options?: {
    minSeconds?: number;
    maxSeconds?: number;
  }
): number | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, "");

  if (!normalized) {
    return null;
  }

  let total = 0;
  let cursor = 0;
  const matcher = /(\d+)([smhdw])/g;

  for (const match of normalized.matchAll(matcher)) {
    if (match.index !== cursor) {
      return null;
    }

    const value = Number(match[1]);
    const unit = match[2];

    if (!Number.isSafeInteger(value) || value < 0 || !unit) {
      return null;
    }

    total += value * (UNIT_SECONDS[unit] ?? 0);
    cursor = (match.index ?? 0) + match[0].length;
  }

  if (cursor !== normalized.length || total <= 0) {
    return null;
  }

  if (options?.minSeconds !== undefined && total < options.minSeconds) {
    return null;
  }

  if (options?.maxSeconds !== undefined && total > options.maxSeconds) {
    return null;
  }

  return total;
}

export function formatDurationSeconds(totalSeconds: number): string {
  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];

  const units = [
    ["нед", 60 * 60 * 24 * 7],
    ["д", 60 * 60 * 24],
    ["ч", 60 * 60],
    ["м", 60],
    ["с", 1]
  ] as const;

  for (const [label, seconds] of units) {
    const amount = Math.floor(remaining / seconds);

    if (amount > 0) {
      parts.push(`${amount}${label}`);
      remaining %= seconds;
    }
  }

  return parts.length > 0 ? parts.join(" ") : "0с";
}
