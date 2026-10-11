import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getRemainingTradeCount,
  getRemainingVolumeUSD,
  isValidPointTarget,
} from '../src/helpers/points.ts'

test('the 18-point target requires $127,374.17 more from the example volume', () => {
  const remaining = getRemainingVolumeUSD(134769.83, 18)
  assert.notEqual(remaining, null)
  assert.equal(remaining!.toFixed(2), '127374.17')
})

test('meeting or exceeding a target never produces a negative remaining volume', () => {
  assert.equal(getRemainingVolumeUSD(262144, 18), 0)
  assert.equal(getRemainingVolumeUSD(300000, 18), 0)
  // A rounded displayed point count must not cause the target to be marked reached early.
  assert.equal(getRemainingVolumeUSD(200000, 18), 62144)
})

test('a checked wallet with no trades needs the full target volume', () => {
  assert.equal(getRemainingVolumeUSD(0, 18), 262144)
})

test('wallets without an enabled target do not have a remaining volume', () => {
  assert.equal(getRemainingVolumeUSD(134769.83), null)
  assert.equal(getRemainingVolumeUSD(134769.83, null), null)
})

test('invalid targets and volumes are rejected', () => {
  for (const target of [0, -1, 18.5, 21, 53, NaN, Infinity]) {
    assert.equal(isValidPointTarget(target), false)
    assert.equal(getRemainingVolumeUSD(0, target), null)
  }
  for (const target of ['18', undefined, null]) {
    assert.equal(isValidPointTarget(target), false)
  }
  for (const volume of [-1, NaN, Infinity]) {
    assert.equal(getRemainingVolumeUSD(volume, 18), null)
  }
  assert.equal(isValidPointTarget(1), true)
  assert.equal(isValidPointTarget(20), true)
})

test('remaining trades follow the requested 4x example', () => {
  assert.equal(getRemainingTradeCount(4096, 1024), 1)
  assert.equal(getRemainingTradeCount(8192, 1024), 2)
  assert.equal(getRemainingTradeCount(getRemainingVolumeUSD(134769.83, 18), 1024), 32)
})

test('partial trades round up so the target can be reached', () => {
  assert.equal(getRemainingTradeCount(4097, 1024), 2)
  assert.equal(getRemainingTradeCount(1, 1024), 1)
  assert.equal(getRemainingTradeCount(1.01, 0.25), 2)
})

test('an achieved target needs no more trades', () => {
  assert.equal(getRemainingTradeCount(0, 1024), 0)
})

test('missing or invalid inputs do not produce a trade count', () => {
  for (const amount of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(getRemainingTradeCount(4096, amount), null)
  }
  for (const remaining of [null, -1, NaN, Infinity]) {
    assert.equal(getRemainingTradeCount(remaining, 1024), null)
  }
})
