export const MAX_TARGET_POINTS = 20

export function isValidPointTarget(target: unknown): target is number {
  return (
    typeof target === 'number' &&
    Number.isInteger(target) &&
    target >= 1 &&
    target <= MAX_TARGET_POINTS
  )
}

export function getRemainingVolumeUSD(
  totalVolumeUSD: number,
  targetPoints?: number | null,
): number | null {
  if (!isValidPointTarget(targetPoints) || !Number.isFinite(totalVolumeUSD) || totalVolumeUSD < 0) {
    return null
  }
  return Math.max(0, 2 ** targetPoints - totalVolumeUSD)
}

export function getRemainingTradeCount(
  remainingVolumeUSD: number | null,
  tradeAmountUSD?: number | null,
): number | null {
  if (
    remainingVolumeUSD === null ||
    !Number.isFinite(remainingVolumeUSD) ||
    remainingVolumeUSD < 0 ||
    typeof tradeAmountUSD !== 'number' ||
    !Number.isFinite(tradeAmountUSD) ||
    tradeAmountUSD <= 0
  ) {
    return null
  }
  const trades = remainingVolumeUSD / tradeAmountUSD / 4
  return Number.isFinite(trades) ? Math.ceil(trades) : null
}
