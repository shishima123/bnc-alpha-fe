import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getBuyVolumeUSD, getStablecoinNetAmount } from '../src/helpers/transactions.ts'
import type { Transaction } from '../src/types/types'

const buy: Transaction = {
  hash: '0x1f63804bb7841ab7be0bed99834a9bb9f9a664bed8cfe5cee0ba32543ea61b82',
  timestamp: 1791607712,
  status: 'success',
  gas: 0.00002007051273084,
  from: {
    address: '0xcE24439F2D9C6a2289F741120FE202248B666666',
    symbol: 'U',
    decimals: 18,
    amount: 1050.98711809,
  },
  to: {
    address: '0x1D80392D12CAAaF9E333Bb0bb7f021eaCf297Fe6',
    symbol: 'pPOLY',
    decimals: 18,
    amount: 62.04306619433397,
  },
}
const sell: Transaction = {
  ...buy,
  from: buy.to,
  to: { ...buy.from, amount: 1050.9362730610223 },
}

test('U buys use the decimal amount and support the 4x multiplier', () => {
  assert.equal(getBuyVolumeUSD(buy), 1050.98711809)
  assert.equal(getBuyVolumeUSD(buy, 4), 4203.94847236)
})

test('USDT buys still count, including normalized symbols', () => {
  for (const symbol of ['USDT', ' usdt ', ' u ', 'USDC', ' usdc ']) {
    assert.equal(getBuyVolumeUSD({ ...buy, from: { ...buy.from, symbol } }), buy.from.amount)
  }
})

test('selling back to U does not double-count buy volume', () => {
  assert.equal(getBuyVolumeUSD(sell, 4), 0)
  assert.equal(
    [buy, sell].reduce((sum, tx) => sum + getBuyVolumeUSD(tx), 0),
    buy.from.amount,
  )
})

test('U round-trip fees include the stablecoin loss; USDT still works', () => {
  const netAmount = [buy, sell].reduce((sum, tx) => sum + getStablecoinNetAmount(tx), 0)
  assert.ok(Math.abs(netAmount - -0.0508450289777) < 1e-9)
  assert.equal(
    getStablecoinNetAmount({ ...buy, from: { ...buy.from, symbol: 'USDT' } }),
    -buy.from.amount,
  )
})

test('failed transactions contribute neither volume nor stablecoin balance', () => {
  for (const status of ['failed', 'pending']) {
    assert.equal(getBuyVolumeUSD({ ...buy, status }, 4), 0)
    assert.equal(getStablecoinNetAmount({ ...buy, status }), 0)
  }
})

test('non-stablecoin trades and stablecoin conversions have no buy volume', () => {
  assert.equal(getBuyVolumeUSD({ ...buy, from: { ...buy.from, symbol: 'BNB' } }), 0)
  assert.equal(getBuyVolumeUSD({ ...buy, to: { ...buy.to, symbol: 'USDT' } }), 0)
})

test('USDC round trips count buy volume, apply 4x, and include stablecoin loss', () => {
  const usdcBuy = { ...buy, from: { ...buy.from, symbol: 'USDC' } }
  const usdcSell = { ...sell, to: { ...sell.to, symbol: 'USDC' } }
  assert.equal(getBuyVolumeUSD(usdcBuy, 4), buy.from.amount * 4)
  assert.equal(getBuyVolumeUSD(usdcSell, 4), 0)
  const netAmount = [usdcBuy, usdcSell].reduce((sum, tx) => sum + getStablecoinNetAmount(tx), 0)
  assert.ok(Math.abs(netAmount - -0.0508450289777) < 1e-9)
  assert.equal(getBuyVolumeUSD({ ...buy, to: { ...buy.to, symbol: 'USDC' } }), 0)
})
