export const useShortenAddress = (address: string, start: number = 6, end: number = 4): string => {
  if (!address) return ''

  // Nếu độ dài address quá ngắn thì trả nguyên
  if (address.length <= start + end) {
    return address
  }

  return `${address.slice(0, start)}...${address.slice(-end)}`
}

export const closestPowerOfTwo = (num: number): number => {
  if (num <= 0) return 0

  return Math.round(Math.log2(num))
}

export const formatNumber = (value: number, options = {}) => {
  if (value == null || isNaN(value)) return '0'

  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    ...options, // cho phép override khi cần
  })
}

export const bscScanAddressUrl = (hash: string) => {
  return `https://bscscan.com/address/${hash}`
}

export const bscScanTxUrl = (hash: string) => {
  return `https://bscscan.com/tx/${hash}`
}

export const isValidBscAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}
