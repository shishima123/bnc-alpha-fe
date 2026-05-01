<script setup lang="ts">
import axiosInstance from '@/apis/http-common.ts'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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
import { useToast } from '@/composables/useToast'
import AppToast from '@/components/AppToast.vue'
import AppModal from '@/components/AppModal.vue'

const { add: addToast } = useToast()

const wallets = useStorage<Wallet[]>('wallets', [])
const transactionsByWallet = ref<Record<string, Transaction[]>>({})
const prices = ref<PriceMap>({})
const shouldShowWalletModal = ref(false)
const isLoadingResult = ref(false)
const loadingWallets = ref<Set<string>>(new Set())
const shouldShowHistoryDialog = ref(false)
const activeWalletAddress = ref<string | null>(null)
const selectedDate = ref<string>(moment(new Date()).format('YYYY-MM-DD'))

const showCheckMenu = ref(false)
const checkBtnRef = ref<HTMLDivElement | null>(null)
const walletTab = ref<'list' | 'add' | 'import'>('list')

function handleClickOutside(e: MouseEvent) {
  if (checkBtnRef.value && !checkBtnRef.value.contains(e.target as Node)) {
    showCheckMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))

function getWalletStats(address: string) {
  const txs = transactionsByWallet.value[address] || []
  const totalVolumeUSD = txs.reduce((total, tx) => total + (tx as any).volumeUSD, 0)
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

function hasData(address: string) {
  return (transactionsByWallet.value[address]?.length || 0) > 0
}

const totals = computed(() => {
  let volume = 0
  let points = 0
  let txCount = 0
  let withData = 0
  for (const w of wallets.value) {
    const s = getWalletStats(w.address)
    volume += s.totalVolumeUSD
    points += s.points
    txCount += s.transactionsCount
    if (hasData(w.address)) withData++
  }
  return { volume, points, txCount, withData, total: wallets.value.length }
})

function openHistory(address: string) {
  if (!hasData(address)) return
  activeWalletAddress.value = address
  shouldShowHistoryDialog.value = true
}

async function fetchDataAll() {
  showCheckMenu.value = false
  if (wallets.value.length === 0) {
    addToast({ severity: 'warn', summary: 'Thông báo', detail: 'Chưa có ví nào được lưu' })
    return
  }
  transactionsByWallet.value = {}
  isLoadingResult.value = true
  try {
    const addresses = wallets.value.map((w) => w.address)
    const res = await axiosInstance.get(`/api/transactions`, {
      params: { addresses: addresses.join(','), date: selectedDate.value },
    })
    transactionsByWallet.value = res.data
    await fetchPrices()
    await calculateVolume()
  } catch (err: any) {
    console.error('Fetch data error:', err)
    addToast({
      severity: 'error',
      summary: 'Lỗi',
      detail: err.response?.data?.message || 'Không thể lấy dữ liệu',
    })
  } finally {
    isLoadingResult.value = false
  }
}

async function fetchDataForWallet(address: string) {
  loadingWallets.value.add(address)
  try {
    const res = await axiosInstance.get(`/api/transactions`, {
      params: { addresses: address, date: selectedDate.value },
    })
    transactionsByWallet.value[address] = res.data[address] || []
    await fetchPrices()
    await calculateVolume()
  } catch (err: any) {
    console.error(`Fetch error for ${address}:`, err)
    addToast({
      severity: 'error',
      summary: 'Lỗi',
      detail: err.response?.data?.message || 'Không thể lấy dữ liệu',
    })
  } finally {
    loadingWallets.value.delete(address)
  }
}

async function fetchDataMissingOnly() {
  showCheckMenu.value = false
  const missingWallets = wallets.value
    .filter((w) => !hasData(w.address))
    .map((w) => w.address)

  if (missingWallets.length === 0) {
    addToast({ severity: 'info', summary: 'Thông báo', detail: 'Tất cả ví đều đã có dữ liệu' })
    return
  }

  missingWallets.forEach((addr) => loadingWallets.value.add(addr))
  try {
    const res = await axiosInstance.get(`/api/transactions`, {
      params: { addresses: missingWallets.join(','), date: selectedDate.value },
    })
    for (const [addr, data] of Object.entries(res.data)) {
      transactionsByWallet.value[addr] = data as Transaction[]
    }
    await fetchPrices()
    await calculateVolume()
  } catch (err: any) {
    console.error('Fetch missing data error:', err)
    addToast({
      severity: 'error',
      summary: 'Lỗi',
      detail: err.response?.data?.message || 'Không thể lấy dữ liệu',
    })
  } finally {
    missingWallets.forEach((addr) => loadingWallets.value.delete(addr))
  }
}

const fetchPrices = async () => {
  try {
    const response = await fetch(
      'https://min-api.cryptocompare.com/data/price?fsym=BNB&tsyms=USD',
    )
    const data = await response.json()
    prices.value = { USDT: 1, BNB: data.USD || 0 }
  } catch (err) {
    console.error('Error fetching prices:', err)
  }
}

const calculateVolume = async () => {
  for (const [wallet, txs] of Object.entries(transactionsByWallet.value)) {
    transactionsByWallet.value[wallet] = txs.map((tx) => {
      const volumeUSD = tx.from.symbol === 'USDT' ? tx.from.amount : 0
      return { ...tx, volumeUSD }
    })
  }
}

const newWalletAddress = ref('')
const newWalletLabel = ref('')

function addWallet() {
  const address = newWalletAddress.value.trim()
  if (!address || !isValidBscAddress(address)) {
    addToast({ severity: 'error', summary: 'Lỗi', detail: 'Ví không hợp lệ' })
    return
  }
  if (wallets.value.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
    addToast({ severity: 'warn', summary: 'Thông báo', detail: 'Ví đã tồn tại' })
    return
  }
  const label = newWalletLabel.value.trim() || address
  wallets.value.push({ address, label })
  newWalletAddress.value = ''
  newWalletLabel.value = ''
  addToast({ severity: 'success', summary: 'Đã thêm ví', detail: label, life: 1500 })
}

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
      addToast({ severity: 'error', summary: 'Lỗi', detail: `Địa chỉ không hợp lệ: ${address}` })
      return
    }
    if (wallets.value.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
      console.warn(`Skip duplicate address: ${address}`)
      return
    }
    wallets.value.push({ address, label: label || address })
    addedCount++
  })

  batchImportText.value = ''
  if (addedCount > 0) {
    addToast({
      severity: 'success',
      summary: 'Thành công',
      detail: `Đã thêm ${addedCount} ví`,
      life: 2000,
    })
  }
}
</script>

<template>
  <!-- Sticky top bar -->
  <header
    class="sticky top-0 z-30 bg-slate-800/80 backdrop-blur-md border-b border-slate-700"
  >
    <div
      class="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-3"
    >
      <div class="flex items-center gap-2.5 min-w-0 mr-auto">
        <div
          class="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-900 shadow-lg shadow-emerald-500/20 shrink-0"
        >
          α
        </div>
        <div class="min-w-0">
          <h1 class="font-semibold text-slate-100 text-sm sm:text-base leading-tight">
            Web3 Wallet Tracker
          </h1>
          <p class="text-xs text-slate-400 hidden sm:block leading-tight">
            Binance Alpha · BSC
          </p>
        </div>
      </div>

      <!-- Date -->
      <div class="relative">
        <i
          class="pi pi-calendar absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none"
        ></i>
        <input
          type="date"
          v-model="selectedDate"
          class="bg-slate-700/60 border border-slate-600 rounded-lg pl-9 pr-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition"
        />
      </div>

      <!-- Manage -->
      <button
        @click="shouldShowWalletModal = true"
        class="flex items-center justify-center gap-2 bg-slate-700/60 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 rounded-lg px-3 py-2 text-sm text-slate-100 transition"
        title="Quản lý ví"
      >
        <i class="pi pi-cog text-sm"></i>
        <span class="hidden sm:inline">Quản lý ví</span>
      </button>

      <!-- Run split button -->
      <div ref="checkBtnRef" class="relative flex">
        <button
          @click="fetchDataAll"
          :disabled="isLoadingResult"
          class="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 font-semibold rounded-l-lg px-3 py-2 text-sm transition shadow-lg shadow-emerald-500/20"
        >
          <i
            class="pi pi-sync text-sm"
            :class="{ 'animate-spin': isLoadingResult }"
          ></i>
          <span>Kiểm tra</span>
        </button>
        <button
          @click="showCheckMenu = !showCheckMenu"
          :disabled="isLoadingResult"
          class="flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 rounded-r-lg px-2 py-2 border-l border-emerald-700 transition"
          aria-label="More options"
        >
          <i class="pi pi-chevron-down text-xs"></i>
        </button>

        <transition name="dropdown">
          <div
            v-if="showCheckMenu"
            class="absolute right-0 top-full mt-2 w-72 bg-slate-700 border border-slate-600 rounded-xl shadow-2xl overflow-hidden z-30"
          >
            <button
              @click="fetchDataMissingOnly"
              class="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-600 transition text-left"
            >
              <i class="pi pi-filter text-emerald-400 text-sm"></i>
              <span>Chỉ kiểm tra ví chưa có kết quả</span>
            </button>
          </div>
        </transition>
      </div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 sm:px-6 py-6">

    <!-- Summary pill -->
    <div
      v-if="totals.total > 0"
      class="inline-flex items-center gap-2 bg-slate-700/60 border border-slate-600 px-3.5 py-1.5 rounded-full text-sm text-slate-300 mb-6"
    >
      <i class="pi pi-chart-bar text-emerald-400 text-sm"></i>
      <span>
        Đã có dữ liệu:
        <span class="font-semibold text-emerald-400 tabular-nums">{{ totals.withData }}</span>
        <span class="text-slate-400 mx-0.5">/</span>
        <span class="font-semibold text-slate-100 tabular-nums">{{ totals.total }}</span> ví
      </span>
    </div>

    <!-- Empty -->
    <div
      v-if="totals.total === 0"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <div
        class="w-16 h-16 rounded-2xl bg-slate-700/60 border border-slate-600 flex items-center justify-center mb-4"
      >
        <i class="pi pi-wallet text-2xl text-slate-500"></i>
      </div>
      <h3 class="text-lg font-semibold text-slate-200 mb-1">Chưa có ví nào</h3>
      <p class="text-sm text-slate-400 mb-5">Thêm ví đầu tiên để bắt đầu theo dõi</p>
      <button
        @click="shouldShowWalletModal = true"
        class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded-xl px-5 py-2.5 text-sm transition"
      >
        Thêm ví
      </button>
    </div>

    <!-- Wallet table -->
    <div
      v-if="totals.total > 0"
      class="bg-slate-700/40 border border-slate-600 rounded-xl overflow-hidden shadow-lg shadow-black/20"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[760px]">
          <thead class="bg-slate-800/60">
            <tr class="text-left text-[11px] text-slate-400 uppercase tracking-wider">
              <th class="px-3 py-2.5 font-medium w-10">#</th>
              <th class="px-3 py-2.5 font-medium">Ví</th>
              <th class="px-3 py-2.5 font-medium text-right">Khối lượng</th>
              <th class="px-3 py-2.5 font-medium text-right">Điểm</th>
              <th class="px-3 py-2.5 font-medium text-right">Phí</th>
              <th class="px-3 py-2.5 font-medium text-right">Giao dịch</th>
              <th class="px-3 py-2.5 font-medium w-24 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(wallet, idx) in wallets"
              :key="wallet.address"
              class="border-t border-slate-600/60 transition"
              :class="{
                'hover:bg-slate-600/30 cursor-pointer': hasData(wallet.address),
              }"
              @click="openHistory(wallet.address)"
            >
              <td class="px-3 py-3 text-slate-400 tabular-nums">{{ idx + 1 }}</td>
              <td class="px-3 py-3">
                <div class="leading-tight min-w-0">
                  <p class="font-semibold text-slate-100 text-sm truncate">
                    {{ wallet.label }}
                  </p>
                  <p class="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                    {{ useShortenAddress(wallet.address) }}
                  </p>
                </div>
              </td>

              <!-- Loading row -->
              <template v-if="isLoadingResult || loadingWallets.has(wallet.address)">
                <td class="px-3 py-3 text-right">
                  <div class="h-4 w-20 ml-auto rounded bg-slate-600 animate-pulse"></div>
                </td>
                <td class="px-3 py-3 text-right">
                  <div class="h-4 w-10 ml-auto rounded bg-slate-600 animate-pulse"></div>
                </td>
                <td class="px-3 py-3 text-right">
                  <div class="h-4 w-12 ml-auto rounded bg-slate-600 animate-pulse"></div>
                </td>
                <td class="px-3 py-3 text-right">
                  <div class="h-4 w-8 ml-auto rounded bg-slate-600 animate-pulse"></div>
                </td>
              </template>

              <!-- Data row -->
              <template v-else-if="hasData(wallet.address)">
                <td class="px-3 py-3 text-right font-semibold text-slate-100 tabular-nums">
                  ${{ formatNumber(getWalletStats(wallet.address).totalVolumeUSD) }}
                </td>
                <td class="px-3 py-3 text-right font-semibold text-emerald-400 tabular-nums">
                  {{ getWalletStats(wallet.address).points }}
                </td>
                <td
                  class="px-3 py-3 text-right tabular-nums font-medium"
                  :class="
                    getWalletStats(wallet.address).totalFee >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  "
                >
                  {{ formatNumber(getWalletStats(wallet.address).totalFee) }}
                </td>
                <td class="px-3 py-3 text-right text-slate-300 tabular-nums">
                  {{ getWalletStats(wallet.address).transactionsCount }}
                </td>
              </template>

              <!-- Empty row -->
              <template v-else>
                <td colspan="4" class="px-3 py-3 text-center text-slate-500 text-xs">
                  <i class="pi pi-database text-sm mr-1"></i>
                  Chưa có dữ liệu
                </td>
              </template>

              <td class="px-3 py-3 text-right">
                <div class="flex items-center justify-end gap-1">
                  <button
                    @click.stop="fetchDataForWallet(wallet.address)"
                    :disabled="isLoadingResult || loadingWallets.has(wallet.address)"
                    class="text-slate-400 hover:text-emerald-400 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed w-8 h-8 rounded-lg flex items-center justify-center transition"
                    title="Reload ví này"
                  >
                    <i
                      class="pi pi-refresh text-sm"
                      :class="{ 'animate-spin': loadingWallets.has(wallet.address) }"
                    ></i>
                  </button>
                  <button
                    v-if="hasData(wallet.address) && !loadingWallets.has(wallet.address)"
                    @click.stop="openHistory(wallet.address)"
                    class="text-slate-400 hover:text-emerald-400 hover:bg-slate-600 w-8 h-8 rounded-lg flex items-center justify-center transition"
                    title="Chi tiết"
                  >
                    <i class="pi pi-arrow-right text-sm"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- History dialog -->
    <AppModal v-model:visible="shouldShowHistoryDialog" title="Chi tiết giao dịch" width="56rem">
      <div v-if="activeWalletAddress" class="overflow-x-auto -mx-1">
        <table class="w-full text-sm min-w-[640px]">
          <thead>
            <tr class="text-left text-[11px] text-slate-400 uppercase tracking-wider">
              <th class="px-3 py-2 font-medium w-10">#</th>
              <th class="px-3 py-2 font-medium">Hash</th>
              <th class="px-3 py-2 font-medium">Thời gian</th>
              <th class="px-3 py-2 font-medium">From</th>
              <th class="px-3 py-2 font-medium">To</th>
              <th class="px-3 py-2 font-medium">Gas</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(tx, i) in transactionsByWallet[activeWalletAddress]"
              :key="tx.hash"
              class="border-t border-slate-600 hover:bg-slate-600/30 transition"
            >
              <td class="px-3 py-3 text-slate-400 tabular-nums">
                {{ transactionsByWallet[activeWalletAddress].length - i }}
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs text-slate-300">{{
                    useShortenAddress(tx.hash)
                  }}</span>
                  <a
                    :href="bscScanTxUrl(tx.hash)"
                    target="_blank"
                    rel="noopener"
                    class="text-slate-400 hover:text-emerald-400 transition"
                    title="View on BscScan"
                  >
                    <i class="pi pi-external-link text-[10px]"></i>
                  </a>
                </div>
              </td>
              <td
                class="px-3 py-3 whitespace-nowrap text-slate-300"
                :title="moment.unix(tx.timestamp).local().format('YYYY-MM-DD HH:mm:ss')"
              >
                {{ moment.unix(tx.timestamp).fromNow() }}
              </td>
              <td class="px-3 py-3">
                <div class="leading-tight">
                  <p class="font-semibold text-emerald-400 tabular-nums">
                    {{ formatNumber(tx.from.amount, { maximumFractionDigits: 6 }) }}
                  </p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    <span class="mr-1.5">{{ tx.from.symbol }}</span>
                    <span class="font-mono text-slate-500">{{
                      useShortenAddress(tx.from.address)
                    }}</span>
                  </p>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="leading-tight">
                  <p class="font-semibold text-emerald-400 tabular-nums">
                    {{ formatNumber(tx.to.amount, { maximumFractionDigits: 6 }) }}
                  </p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    <span class="mr-1.5">{{ tx.to.symbol }}</span>
                    <span class="font-mono text-slate-500">{{
                      useShortenAddress(tx.to.address)
                    }}</span>
                  </p>
                </div>
              </td>
              <td class="px-3 py-3 whitespace-nowrap">
                <span class="text-slate-300 tabular-nums">{{ tx.gas }}</span>
                <span class="text-xs text-slate-500 ml-1">BNB</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppModal>

    <!-- Wallet management dialog with tabs -->
    <AppModal v-model:visible="shouldShowWalletModal" title="Quản lý địa chỉ ví" width="44rem">
      <!-- Tabs (pinned outside scroll area) -->
      <template #sub-header>
        <div
          class="flex gap-1 border-b border-slate-600 px-5 sm:px-6 overflow-x-auto shrink-0 overflow-y-hidden"
        >
          <button
            @click="walletTab = 'list'"
            :class="[
              'px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition',
              walletTab === 'list'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-300',
            ]"
          >
            Danh sách ({{ wallets.length }})
          </button>
          <button
            @click="walletTab = 'add'"
            :class="[
              'px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition',
              walletTab === 'add'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-300',
            ]"
          >
            Thêm ví
          </button>
          <button
            @click="walletTab = 'import'"
            :class="[
              'px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition',
              walletTab === 'import'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-300',
            ]"
          >
            Import Hàng loạt
          </button>
        </div>
      </template>

      <!-- Tab: List -->
      <div v-if="walletTab === 'list'">
        <draggable
          v-if="wallets.length > 0"
          tag="ul"
          :list="wallets"
          class="flex flex-col gap-2"
          item-key="address"
        >
          <template #item="{ element, index }">
            <li
              class="group flex items-center justify-between bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-slate-500 rounded-xl px-4 py-3 cursor-grab active:cursor-grabbing transition"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <span class="text-slate-400 text-sm font-medium tabular-nums shrink-0">
                    {{ index + 1 }}.
                  </span>
                  <p class="font-semibold text-slate-100 text-sm truncate">
                    {{ element.label }}
                  </p>
                </div>
                <p class="text-xs font-mono text-slate-400 truncate mt-1 ml-5">
                  {{ element.address }}
                </p>
              </div>
              <button
                @click.stop="wallets.splice(index, 1)"
                class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 w-8 h-8 rounded-lg flex items-center justify-center transition shrink-0 ml-2"
                title="Xóa"
              >
                <i class="pi pi-trash text-sm"></i>
              </button>
            </li>
          </template>
        </draggable>
        <div
          v-else
          class="flex flex-col items-center justify-center py-12 text-center text-slate-400"
        >
          <i class="pi pi-inbox text-3xl mb-3 text-slate-500"></i>
          <p class="text-sm">Chưa có ví nào trong danh sách</p>
          <button
            @click="walletTab = 'add'"
            class="mt-4 text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
          >
            Thêm ví đầu tiên →
          </button>
        </div>
      </div>

      <!-- Tab: Add -->
      <div v-else-if="walletTab === 'add'" class="flex flex-col gap-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1.5 font-medium">Địa chỉ ví</label>
          <input
            v-model="newWalletAddress"
            placeholder="0x..."
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition font-mono"
          />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1.5 font-medium">
            Ghi chú <span class="text-slate-500">(tùy chọn)</span>
          </label>
          <input
            v-model="newWalletLabel"
            placeholder="VD: Ví chính"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition"
            @keyup.enter="addWallet"
          />
        </div>
        <button
          @click="addWallet"
          class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded-lg py-2.5 text-sm transition mt-1"
        >
          Thêm ví
        </button>
      </div>

      <!-- Tab: Import -->
      <div v-else-if="walletTab === 'import'" class="flex flex-col gap-3">
        <p class="text-xs text-slate-400">
          Nhập nhiều ví, mỗi dòng theo format:
          <code class="text-slate-300 bg-slate-700 px-1.5 py-0.5 rounded font-mono">
            0xABC..., Label
          </code>
        </p>
        <textarea
          v-model="batchImportText"
          rows="8"
          class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition font-mono resize-y"
          placeholder="0xB2AD50f4AB1B7A9DB6069ca4761E6d250BA146E3, TK1&#10;0x5246AcC8e6993F881638FE82164d50eFCFa9fb1E, TK2"
        ></textarea>
        <button
          @click="batchImportWallets"
          class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded-lg py-2.5 text-sm transition"
        >
          Import
        </button>
      </div>

      <template #footer>
        <button
          @click="shouldShowWalletModal = false"
          class="w-full sm:w-auto bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg px-5 py-2 text-sm font-medium transition"
        >
          Hoàn Thành
        </button>
      </template>
    </AppModal>

    <AppToast />
  </main>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
