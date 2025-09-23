export interface TokenInfo {
  address: string
  symbol: string
  decimals: number
  amount: number
}

export interface Transaction {
  hash: string
  timestamp: number
  status: string
  gas: number
  from: TokenInfo
  to: TokenInfo
  volumeUSD: number
}

export type PriceMap = Record<string, number>

export interface Wallet {
  address: string
  label: string
}
