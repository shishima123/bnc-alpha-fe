import type { TokenInfo, Transaction } from '../types/types'

// Quote stablecoins are valued at $1, as in the existing USDT calculation.
export function isUsdStablecoin(token: TokenInfo): boolean {
  return ['USDT', 'USDC', 'U'].includes(token.symbol.trim().toUpperCase())
}

export function getBuyVolumeUSD(tx: Transaction, multiplier = 1): number {
  if (tx.status !== 'success' || !isUsdStablecoin(tx.from) || isUsdStablecoin(tx.to)) {
    return 0 
  }
  return tx.from.amount * multiplier
}

export function getStablecoinNetAmount(tx: Transaction): number {
  if (tx.status !== 'success') return 0
  const sent = isUsdStablecoin(tx.from) ? tx.from.amount : 0
  const received = isUsdStablecoin(tx.to) ? tx.to.amount : 0
  return received - sent
}
