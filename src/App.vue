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

function handleClickOutside(e: MouseEvent) {
  if (checkBtnRef.value && !checkBtnRef.value.contains(e.target as Node)) {
    showCheckMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))

const walletWithDataCount = computed(
  () =>
    wallets.value.filter((w) => (transactionsByWallet.value[w.address]?.length || 0) > 0).length,
)
const totalWalletCount = computed(() => wallets.value.length)

function openHistory(address: string) {
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
    .filter(
      (w) =>
        !transactionsByWallet.value[w.address] ||
        transactionsByWallet.value[w.address].length === 0,
    )
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
      detail: `Đã thêm ${addedCount} ví từ batch import`,
      life: 2000,
    })
  }
}
</script>

<template>
  <main class="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
    <!-- Header -->
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <div>
        <h1
          class="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400 bg-clip-text text-transparent"
        >
          Thống kê Binance Alpha
        </h1>
        <p class="text-sm text-zinc-500 mt-1">Theo dõi khối lượng và điểm Alpha theo ngày</p>
      </div>

      <div class="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
        <!-- Date input -->
        <div class="relative">
          <i
            class="pi pi-calendar absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none"
          ></i>
          <input
            type="date"
            v-model="selectedDate"
            class="w-full sm:w-auto bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition"
          />
        </div>

        <!-- Manage wallet -->
        <button
          @click="shouldShowWalletModal = true"
          class="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-xl px-4 py-2 text-sm text-zinc-100 transition"
        >
          <i class="pi pi-cog text-sm"></i>
          <span>Quản lý ví</span>
        </button>

        <!-- Check split button -->
        <div ref="checkBtnRef" class="relative flex">
          <button
            @click="fetchDataAll"
            :disabled="isLoadingResult"
            class="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-900 font-semibold rounded-l-xl px-4 py-2 text-sm transition shadow-lg shadow-emerald-500/20"
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
            class="flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-900 rounded-r-xl px-2.5 py-2 border-l border-emerald-700 transition"
            aria-label="More options"
          >
            <i class="pi pi-chevron-down text-xs"></i>
          </button>

          <!-- Dropdown -->
          <transition name="dropdown">
            <div
              v-if="showCheckMenu"
              class="absolute right-0 top-full mt-2 w-72 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-30"
            >
              <button
                @click="fetchDataMissingOnly"
                class="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-700 transition text-left"
              >
                <i class="pi pi-filter text-emerald-400 text-sm"></i>
                <span>Chỉ kiểm tra ví chưa có kết quả</span>
              </button>
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- Summary pill -->
    <div
      v-if="totalWalletCount > 0"
      class="inline-flex items-center gap-2 bg-zinc-800/50 border border-zinc-700 px-3.5 py-1.5 rounded-full text-sm text-zinc-300 mb-6 backdrop-blur"
    >
      <i class="pi pi-chart-bar text-emerald-400 text-sm"></i>
      <span>
        Đã có dữ liệu:
        <span class="font-semibold text-emerald-400">{{ walletWithDataCount }}</span>
        <span class="text-zinc-500 mx-0.5">/</span>
        <span class="font-semibold text-zinc-100">{{ totalWalletCount }}</span> ví
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-if="totalWalletCount === 0"
      class="flex flex-col items-center justify-center py-20 text-center"
    >
      <div
        class="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-4"
      >
        <i class="pi pi-wallet text-2xl text-zinc-600"></i>
      </div>
      <h3 class="text-lg font-semibold text-zinc-200 mb-1">Chưa có ví nào</h3>
      <p class="text-sm text-zinc-500 mb-4">Thêm ví đầu tiên để bắt đầu theo dõi</p>
      <button
        @click="shouldShowWalletModal = true"
        class="bg-emerald-500 hover:bg-emerald-400 text-zinc-900 font-semibold rounded-xl px-5 py-2.5 text-sm transition"
      >
        Thêm ví
      </button>
    </div>

    <!-- Wallet grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="wallet in wallets"
        :key="wallet.address"
        class="group relative bg-zinc-800/50 border border-zinc-700 hover:border-zinc-600 rounded-2xl p-5 backdrop-blur transition shadow-lg shadow-black/20 hover:shadow-emerald-500/5"
      >
        <!-- Card glow on hover -->
        <div
          class="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition bg-gradient-to-br from-emerald-500/[0.04] to-transparent"
        ></div>

        <!-- Title row -->
        <div class="relative flex justify-between items-center mb-4">
          <h2 class="font-semibold text-zinc-100 truncate pr-2">
            {{ wallet.label }}
          </h2>
          <button
            @click="fetchDataForWallet(wallet.address)"
            :disabled="isLoadingResult || loadingWallets.has(wallet.address)"
            class="text-zinc-500 hover:text-emerald-400 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed w-8 h-8 rounded-lg flex items-center justify-center transition shrink-0"
            title="Reload ví này"
          >
            <i
              class="pi pi-refresh text-sm"
              :class="{ 'animate-spin': loadingWallets.has(wallet.address) }"
            ></i>
          </button>
        </div>

        <!-- Loading state -->
        <div
          v-if="isLoadingResult || loadingWallets.has(wallet.address)"
          class="relative grid grid-cols-2 gap-4"
        >
          <div v-for="i in 4" :key="i" class="text-center">
            <div class="h-7 mx-auto w-20 rounded-md bg-zinc-700 animate-pulse"></div>
            <div class="h-3 mt-2 mx-auto w-14 rounded bg-zinc-700/60 animate-pulse"></div>
          </div>
        </div>

        <!-- Data -->
        <div
          v-else-if="(transactionsByWallet[wallet.address]?.length || 0) > 0"
          class="relative grid grid-cols-2 gap-4"
        >
          <div class="text-center">
            <div class="text-2xl font-bold text-zinc-100">
              ${{ formatNumber(getWalletStats(wallet.address).totalVolumeUSD) }}
            </div>
            <div class="text-xs text-zinc-500 mt-0.5">Khối lượng</div>
          </div>
          <div class="text-center">
            <div
              class="text-2xl font-bold"
              :class="
                getWalletStats(wallet.address).totalFee >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              "
            >
              {{ formatNumber(getWalletStats(wallet.address).totalFee) }}
            </div>
            <div class="text-xs text-zinc-500 mt-0.5">Phí</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-emerald-400">
              {{ getWalletStats(wallet.address).points }}
            </div>
            <div class="text-xs text-zinc-500 mt-0.5">Điểm</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-zinc-100">
              {{ getWalletStats(wallet.address).transactionsCount }}
            </div>
            <div class="text-xs text-zinc-500 mt-0.5">Số lần</div>
          </div>
          <div class="col-span-2 flex justify-center mt-1">
            <button
              @click="openHistory(wallet.address)"
              class="text-xs text-zinc-300 hover:text-emerald-400 bg-zinc-700/50 hover:bg-zinc-600 border border-zinc-700 hover:border-zinc-600 rounded-lg px-3 py-1.5 transition flex items-center gap-1.5"
            >
              <i class="pi pi-list text-[10px]"></i>
              Chi tiết
            </button>
          </div>
        </div>

        <!-- Empty -->
        <div
          v-else
          class="relative flex flex-col items-center justify-center text-zinc-600 h-28 gap-2"
        >
          <i class="pi pi-database text-2xl"></i>
          <p class="text-xs">Chưa có dữ liệu giao dịch</p>
        </div>
      </div>
    </div>

    <!-- History dialog -->
    <AppModal v-model:visible="shouldShowHistoryDialog" title="Chi tiết giao dịch" width="56rem">
      <div v-if="activeWalletAddress" class="overflow-x-auto -mx-1">
        <table class="w-full text-sm min-w-[640px]">
          <thead>
            <tr class="text-left text-xs text-zinc-500 uppercase tracking-wide">
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
              class="border-t border-zinc-700 hover:bg-zinc-700/30 transition"
            >
              <td class="px-3 py-3 text-zinc-500">
                {{ transactionsByWallet[activeWalletAddress].length - i }}
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs text-zinc-300">{{
                    useShortenAddress(tx.hash)
                  }}</span>
                  <a
                    :href="bscScanTxUrl(tx.hash)"
                    target="_blank"
                    rel="noopener"
                    class="text-zinc-500 hover:text-emerald-400 transition"
                    title="View on BscScan"
                  >
                    <i class="pi pi-external-link text-[10px]"></i>
                  </a>
                </div>
              </td>
              <td
                class="px-3 py-3 whitespace-nowrap text-zinc-300"
                :title="moment.unix(tx.timestamp).local().format('YYYY-MM-DD HH:mm:ss')"
              >
                {{ moment.unix(tx.timestamp).fromNow() }}
              </td>
              <td class="px-3 py-3">
                <div class="leading-tight">
                  <p class="font-semibold text-emerald-400">
                    {{ formatNumber(tx.from.amount, { maximumFractionDigits: 6 }) }}
                  </p>
                  <p class="text-xs text-zinc-400 mt-0.5">
                    <span class="mr-1.5">{{ tx.from.symbol }}</span>
                    <span class="font-mono text-zinc-600">{{
                      useShortenAddress(tx.from.address)
                    }}</span>
                  </p>
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="leading-tight">
                  <p class="font-semibold text-emerald-400">
                    {{ formatNumber(tx.to.amount, { maximumFractionDigits: 6 }) }}
                  </p>
                  <p class="text-xs text-zinc-400 mt-0.5">
                    <span class="mr-1.5">{{ tx.to.symbol }}</span>
                    <span class="font-mono text-zinc-600">{{
                      useShortenAddress(tx.to.address)
                    }}</span>
                  </p>
                </div>
              </td>
              <td class="px-3 py-3 whitespace-nowrap">
                <span class="text-zinc-300">{{ tx.gas }}</span>
                <span class="text-xs text-zinc-600 ml-1">BNB</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppModal>

    <!-- Wallet management dialog -->
    <AppModal v-model:visible="shouldShowWalletModal" title="Quản lý ví" width="42rem">
      <!-- Add wallet -->
      <section class="bg-zinc-900/60 border border-zinc-700 rounded-xl p-4 mb-4">
        <h3 class="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
          <i class="pi pi-plus-circle text-emerald-400 text-sm"></i>
          Thêm ví
        </h3>
        <div class="flex flex-col gap-2 mb-3">
          <input
            v-model="newWalletAddress"
            placeholder="Địa chỉ ví (0x...)"
            class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition"
          />
          <input
            v-model="newWalletLabel"
            placeholder="Ghi chú (tùy chọn)"
            class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition"
            @keyup.enter="addWallet"
          />
        </div>
        <button
          @click="addWallet"
          class="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-900 font-semibold rounded-lg py-2 text-sm transition"
        >
          Thêm
        </button>
      </section>

      <!-- Batch import -->
      <section class="bg-zinc-900/60 border border-zinc-700 rounded-xl p-4 mb-4">
        <h3 class="text-sm font-semibold text-zinc-200 mb-2 flex items-center gap-2">
          <i class="pi pi-upload text-sky-400 text-sm"></i>
          Batch Import
        </h3>
        <p class="text-xs text-zinc-500 mb-2">
          Mỗi dòng theo format:
          <code class="text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded">0xABC..., Label</code>
        </p>
        <textarea
          v-model="batchImportText"
          rows="5"
          class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 transition mb-3 font-mono resize-y"
          placeholder="0xB2AD50f4AB1B7A9DB6069ca4761E6d250BA146E3, TK1&#10;0x5246AcC8e6993F881638FE82164d50eFCFa9fb1E, TK2"
        ></textarea>
        <button
          @click="batchImportWallets"
          class="w-full bg-sky-500 hover:bg-sky-400 text-zinc-900 font-semibold rounded-lg py-2 text-sm transition"
        >
          Import
        </button>
      </section>

      <!-- List -->
      <section class="bg-zinc-900/60 border border-zinc-700 rounded-xl p-4">
        <h3 class="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
          <i class="pi pi-list text-zinc-400 text-sm"></i>
          Danh sách ví ({{ wallets.length }})
        </h3>
        <draggable
          v-if="wallets.length > 0"
          tag="ul"
          :list="wallets"
          class="flex flex-col gap-2"
          handle=".handle"
          item-key="address"
        >
          <template #item="{ element, index }">
            <li
              class="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5"
            >
              <div class="flex items-center gap-3 min-w-0">
                <i
                  class="pi pi-arrows-alt handle text-zinc-600 hover:text-zinc-300 cursor-grab active:cursor-grabbing text-sm shrink-0"
                ></i>
                <div class="min-w-0">
                  <p class="font-semibold text-zinc-100 text-sm truncate">
                    {{ element.label }}
                  </p>
                  <p class="text-xs font-mono text-zinc-500 truncate">
                    {{ useShortenAddress(element.address) }}
                  </p>
                </div>
              </div>
              <button
                @click="wallets.splice(index, 1)"
                class="text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 w-8 h-8 rounded-lg flex items-center justify-center transition shrink-0"
                title="Xóa"
              >
                <i class="pi pi-trash text-sm"></i>
              </button>
            </li>
          </template>
        </draggable>
        <p v-else class="text-xs text-zinc-500 text-center py-4">Chưa có ví nào</p>
      </section>

      <template #footer>
        <button
          @click="shouldShowWalletModal = false"
          class="w-full sm:w-auto bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg px-5 py-2 text-sm font-medium transition"
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
