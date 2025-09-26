<script setup lang="ts">
import axiosInstance from '@/apis/http-common.ts'
import { ref } from 'vue'
import type { PriceMap, Transaction, Wallet } from '@/types/types'
import {
  useShortenAddress,
  bscScanTxUrl,
  closestPowerOfTwo,
  formatNumber,
  isValidBscAddress,
} from './helpers/ultils.ts'
import moment from 'moment'
import { useStorage } from '@vueuse/core'
import draggable from 'vuedraggable'
import { useToast } from 'primevue/usetoast'

const toast = useToast()

const volumeMultiplier = 1
const wallets = useStorage<Wallet[]>('wallets', [])
const transactionsByWallet = ref<Record<string, Transaction[]>>({})
const prices = ref<PriceMap>({})
const shouldShowWalletModal = ref(false)
const isLoadingResult = ref(false)

// popup chi tiết
const shouldShowHistoryDialog = ref(false)
const activeWalletAddress = ref<string | null>(null)

// 🆕 Thêm DatePicker state
const selectedDate = ref<Date>(new Date())

function openHistory(address: string) {
  activeWalletAddress.value = address
  shouldShowHistoryDialog.value = true
}

async function fetchDataAll() {
  if (wallets.value.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Thông báo',
      detail: 'Chưa có ví nào được lưu',
      life: 3000,
    })
    return
  }

  isLoadingResult.value = true
  try {
    const addresses = wallets.value.map((w) => w.address)
    // 🆕 Truyền date (dùng format YYYY-MM-DD)
    const res = await axiosInstance.get(`/api/transactions`, {
      params: {
        addresses: addresses.join(','),
        date: moment(selectedDate.value).format('YYYY-MM-DD'),
      },
    })

    transactionsByWallet.value = res.data
    await fetchPrices()
    await calculateVolume()
  } catch (err) {
    console.error('Fetch data error:', err)
    toast.add({
      severity: 'error',
      summary: 'Lỗi',
      detail: 'Không thể tải dữ liệu',
      life: 3000,
    })
  } finally {
    isLoadingResult.value = false
  }
}

const fetchPrices = async () => {
  try {
    const allSymbols = new Set<string>()
    allSymbols.add('BNB')
    Object.values(transactionsByWallet.value).forEach((txs) => {
      txs.forEach((tx) => {
        allSymbols.add(tx.from.symbol)
        allSymbols.add(tx.to.symbol)
      })
    })

    const priceMap: PriceMap = { USDT: 1 }
    const symbolsToFetch = Array.from(allSymbols).filter(
      (symbol) => symbol !== 'USDT' && !priceMap[symbol],
    )

    if (symbolsToFetch.length > 0) {
      const priceResults = await Promise.all(
        symbolsToFetch.map(async (symbol) => {
          try {
            const response = await fetch(
              `https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=USD`,
            )
            const data = await response.json()
            return { symbol, price: data.USD || 0 }
          } catch (err) {
            console.warn(`Failed to fetch price for ${symbol}:`, err)
            return { symbol, price: 0 }
          }
        }),
      )
      priceResults.forEach(({ symbol, price }) => {
        priceMap[symbol] = price
      })
    }

    prices.value = priceMap
  } catch (err) {
    console.error('Error fetching prices:', err)
  }
}

const calculateVolume = async () => {
  for (const [wallet, txs] of Object.entries(transactionsByWallet.value)) {
    transactionsByWallet.value[wallet] = txs.map((tx) => {
      let volumeUSD = 0
      if (tx.from.symbol === 'USDT') {
        volumeUSD = tx.from.amount
      } else if (tx.to.symbol === 'USDT') {
        volumeUSD = 0
      } else {
        const fromPrice = prices.value[tx.from.symbol] || 0
        const toPrice = prices.value[tx.to.symbol] || 0
        if (toPrice > 0) {
          volumeUSD = tx.to.amount * toPrice
        } else {
          volumeUSD = tx.from.amount * fromPrice
        }
      }
      return { ...tx, volumeUSD }
    })
  }
}

function getWalletStats(address: string) {
  const txs = transactionsByWallet.value[address] || []

  const totalVolumeUSD =
    txs.reduce((total, tx) => total + (tx as any).volumeUSD, 0) * volumeMultiplier
  const points = closestPowerOfTwo(totalVolumeUSD)
  const gasFeeBNB = txs.reduce((sum, tx) => sum + tx.gas, 0)
  const gasFeeUSDT = gasFeeBNB * (prices.value['BNB'] || 0)

  let sent = 0
  let received = 0
  txs.forEach((tx) => {
    if (tx.status !== 'success') return
    if (tx.from.symbol === 'USDT') sent += tx.from.amount
    if (tx.to.symbol === 'USDT') received += tx.to.amount
  })

  const usdtFee = received - sent
  const totalFee = usdtFee - gasFeeUSDT
  const transactionsCount = txs.length

  return { totalVolumeUSD, points, gasFeeBNB, gasFeeUSDT, totalFee, transactionsCount }
}

const newWalletAddress = ref('')
const newWalletLabel = ref('')

function addWallet() {
  const address = newWalletAddress.value
  if (!address || !isValidBscAddress(address)) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Ví không hợp lệ',
      life: 3000,
    })
    return
  }

  // bỏ qua nếu ví đã tồn tại
  if (wallets.value.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
    toast.add({
      severity: 'warn',
      summary: 'Thông báo',
      detail: 'Ví đã tồn tại',
      life: 3000,
    })
    return
  }

  let label = newWalletLabel.value || address
  wallets.value.push({ address, label })
  newWalletAddress.value = ''
  newWalletLabel.value = ''
}

// batch import
const batchImportText = ref('')
function batchImportWallets() {
  const lines = batchImportText.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

  let addedCount = 0
  lines.forEach((line) => {
    const [address, label] = line.split(',').map((s) => s.trim())
    if (!isValidBscAddress(address)) {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: `Địa chỉ không hợp lệ: ${address}`,
        life: 3000,
      })
      return
    }

    if (wallets.value.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
      console.warn(`Skip duplicate address: ${address}`)
      return
    }

    wallets.value.push({
      address,
      label: label || address,
    })
    addedCount++
  })

  batchImportText.value = ''

  if (addedCount > 0) {
    toast.add({
      severity: 'success',
      summary: 'Thành công',
      detail: `Đã thêm ${addedCount} ví từ batch import`,
      life: 2000,
    })
  }
}
</script>

<template>
  <main class="max-w-6xl mx-auto px-4 py-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
      <h1 class="text-2xl font-bold text-gray-800 w-full sm:w-auto">Thống kê Binance Alpha</h1>

      <div class="flex flex-col sm:flex-row w-full sm:w-auto gap-2">
        <!-- DatePicker -->
        <DatePicker
          v-model="selectedDate"
          dateFormat="yy-mm-dd"
          showIcon
          class="w-full sm:w-auto"
        />

        <!-- Button group -->
        <div class="flex w-full sm:w-auto gap-2">
          <Button
            icon="pi pi-cog"
            label="Quản lý ví"
            @click="shouldShowWalletModal = true"
            class="w-1/2 sm:w-auto p-button-outlined p-button-secondary"
          />
          <Button
            icon="pi pi-sync"
            label="Kiểm tra"
            @click="fetchDataAll"
            class="w-1/2 sm:w-auto p-button-success"
          />
        </div>
      </div>
    </div>

    <!-- Wallet cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="wallet in wallets"
        :key="wallet.address"
        class="bg-white rounded-2xl shadow p-4 flex flex-col justify-between hover:shadow-md transition"
      >
        <!-- Title -->
        <h2 class="font-semibold text-blue-600 mb-3">{{ wallet.label }}</h2>

        <!-- Loading Skeleton -->
        <div v-if="isLoadingResult" class="grid grid-cols-2 gap-4">
          <div class="flex flex-col items-center justify-center">
            <Skeleton width="6rem" height="28px" />
            <div class="text-xs text-gray-400 mt-1">Khối lượng</div>
          </div>
          <div class="flex flex-col items-center justify-center">
            <Skeleton width="5rem" height="28px" />
            <div class="text-xs text-gray-400 mt-1">Phí</div>
          </div>
          <div class="flex flex-col items-center justify-center">
            <Skeleton width="4rem" height="28px" />
            <div class="text-xs text-gray-400 mt-1">Điểm</div>
          </div>
          <div class="flex flex-col items-center justify-center">
            <Skeleton width="3rem" height="28px" />
            <div class="text-xs text-gray-400 mt-1">Số lần</div>
          </div>
        </div>

        <!-- Nếu có dữ liệu -->
        <div
          v-else-if="(transactionsByWallet[wallet.address]?.length || 0) > 0"
          class="grid grid-cols-2 gap-4"
        >
          <div class="text-center">
            <div class="text-xl font-bold">
              ${{ formatNumber(getWalletStats(wallet.address).totalVolumeUSD) }}
            </div>
            <div class="text-xs text-gray-500">Khối lượng</div>
          </div>
          <div class="text-center">
            <div
              :class="[
                'text-xl font-bold',
                getWalletStats(wallet.address).totalFee >= 0 ? 'text-green-600' : 'text-red-500',
              ]"
            >
              {{ formatNumber(getWalletStats(wallet.address).totalFee) }}
            </div>
            <div class="text-xs text-gray-500">Phí</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-green-600">
              {{ getWalletStats(wallet.address).points }}
            </div>
            <div class="text-xs text-gray-500">Điểm</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-gray-800">
              {{ getWalletStats(wallet.address).transactionsCount }}
            </div>
            <div class="text-xs text-gray-500">Số lần</div>
          </div>
          <div class="col-span-2 flex justify-center mt-2">
            <Button
              label="Chi tiết"
              severity="secondary"
              variant="outlined"
              size="small"
              @click="openHistory(wallet.address)"
            />
          </div>
        </div>

        <!-- Nếu chưa có dữ liệu -->
        <div v-else class="flex flex-col items-center justify-center text-gray-400 h-24">
          <i class="pi pi-database text-3xl mb-2"></i>
          <p class="text-sm">Chưa có dữ liệu giao dịch</p>
        </div>
      </div>
    </div>

    <!-- Popup chi tiết -->
    <Dialog
      v-model:visible="shouldShowHistoryDialog"
      modal
      header="Chi tiết giao dịch"
      :style="{ width: '70vw' }"
      :breakpoints="{ '1199px': '90vw', '575px': '100vw' }"
    >
      <DataTable
        v-if="activeWalletAddress"
        :value="transactionsByWallet[activeWalletAddress]"
        tableStyle="min-width: 50rem"
        :rowHover="true"
      >
        <Column header="#" style="width: 50px">
          <template #body="slotProps">
            {{ transactionsByWallet[activeWalletAddress].length - slotProps.index }}
          </template>
        </Column>
        <Column field="hash" header="Hash">
          <template #body="slotProps">
            <div class="flex items-center">
              {{ useShortenAddress(slotProps.data.hash) }}
              <Button
                icon="pi pi-external-link"
                variant="text"
                severity="secondary"
                size="small"
                :href="bscScanTxUrl(slotProps.data.hash)"
                target="_blank"
                as="a"
                rel="noopener"
                title="Check in BscScan"
              />
            </div>
          </template>
        </Column>
        <Column field="timestamp" header="Time">
          <template #body="slotProps">
            <p
              v-tooltip.top="{
                value: moment.unix(slotProps.data.timestamp).local().format('YYYY-MM-DD HH:mm:ss'),
                pt: { text: 'text-sm' },
              }"
              class="whitespace-nowrap"
            >
              {{ moment.unix(slotProps.data.timestamp).fromNow() }}
            </p>
          </template>
        </Column>
        <Column field="from.address" header="From">
          <template #body="slotProps">
            <div>
              <p class="text-green-600 font-bold">{{ slotProps.data.from.amount }}</p>
              <p>
                <span class="mr-2">{{ slotProps.data.from.symbol }}</span>
                <span class="text-sm text-gray-400">{{
                  useShortenAddress(slotProps.data.from.address)
                }}</span>
              </p>
            </div>
          </template>
        </Column>
        <Column field="to.address" header="To">
          <template #body="slotProps">
            <div>
              <p class="text-green-600 font-bold">{{ slotProps.data.to.amount }}</p>
              <p>
                <span class="mr-2">{{ slotProps.data.to.symbol }}</span>
                <span class="text-sm text-gray-400">{{
                  useShortenAddress(slotProps.data.to.address)
                }}</span>
              </p>
            </div>
          </template>
        </Column>
        <Column field="gas" header="Gas">
          <template #body="slotProps">
            <p>{{ slotProps.data.gas }} <span class="text-sm text-gray-400">BNB</span></p>
          </template>
        </Column>
      </DataTable>
    </Dialog>

    <!-- Modal quản lý ví -->
    <Dialog
      v-model:visible="shouldShowWalletModal"
      modal
      header="Quản lý ví"
      :style="{ width: '50rem' }"
      :breakpoints="{ '1199px': '75vw', '575px': '90vw' }"
    >
      <!-- Thêm ví thủ công -->
      <Card class="mb-3">
        <template #title>Thêm ví</template>
        <template #content>
          <div class="flex flex-col gap-2 mb-4">
            <InputText placeholder="Địa chỉ ví (0x...)" v-model="newWalletAddress" />
            <InputText placeholder="Ghi chú (Tùy chọn)" v-model="newWalletLabel" />
          </div>
          <div class="flex justify-center">
            <Button type="button" label="Thêm" class="w-24" @click="addWallet" />
          </div>
        </template>
      </Card>

      <!-- Batch Import -->
      <Card class="mb-3">
        <template #title>Batch Import</template>
        <template #content>
          <p class="text-sm text-gray-500 mb-2">
            Nhập nhiều địa chỉ, mỗi dòng theo format:
            <br />
            <code>0xABC..., Label</code>
          </p>
          <Textarea
            v-model="batchImportText"
            autoResize
            rows="5"
            class="w-full mb-3"
            placeholder="0xB2AD50f4AB1B7A9DB6069ca4761E6d250BA146E3, TK1&#10;0x5246AcC8e6993F881638FE82164d50eFCFa9fb1E, TK2"
          />
          <div class="flex justify-center">
            <Button type="button" label="Import" class="w-24" @click="batchImportWallets" />
          </div>
        </template>
      </Card>

      <!-- Danh sách ví -->
      <Card class="mb-3">
        <template #title>
          <span>Danh sách ví ({{ wallets.length }})</span>
        </template>
        <template #content>
          <draggable
            tag="ul"
            :list="wallets"
            class="list-group"
            handle=".handle"
            item-key="address"
          >
            <template #item="{ element, index }">
              <li class="list-group-item">
                <Card class="mb-2 !my-[5px]" :pt="{ body: { class: '!py-1' } }">
                  <template #content>
                    <div class="flex justify-between items-center">
                      <div class="flex items-center">
                        <i class="pi pi-arrows-alt handle mr-4"></i>
                        <div>
                          <p class="font-bold">{{ element.label }}</p>
                          <p class="text-xs text-gray-600">
                            {{ useShortenAddress(element.address) }}
                          </p>
                        </div>
                      </div>
                      <i class="pi pi-trash text-red-500" @click="wallets.splice(index, 1)"></i>
                    </div>
                  </template>
                </Card>
              </li>
            </template>
          </draggable>
        </template>
      </Card>

      <div class="flex justify-end gap-2">
        <Button
          type="button"
          label="Hoàn Thành"
          severity="secondary"
          fluid
          @click="shouldShowWalletModal = false"
        />
      </div>
    </Dialog>

    <Toast />
  </main>
</template>

<style>
.v-enter-active,
.v-leave-active {
  transition: opacity 0.5s ease;
}
.v-enter-from,
.v-leave-to {
  opacity: 0;
}
</style>
