<script setup lang="ts">
import axiosInstance from '@/apis/http-common.ts'
import { ref, computed, h } from 'vue'
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
import {
  NLayout,
  NLayoutHeader,
  NLayoutContent,
  NPageHeader,
  NAvatar,
  NCard,
  NDataTable,
  NButton,
  NInput,
  NModal,
  NTabs,
  NTabPane,
  NSwitch,
  NEmpty,
  NSkeleton,
  NDatePicker,
  NIcon,
  NSpace,
  NText,
  NForm,
  NFormItem,
  useMessage,
  useDialog,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import {
  SettingsOutline,
  FlashOutline,
  SyncOutline,
  RefreshOutline,
  WalletOutline,
  CreateOutline,
  TrashOutline,
  ReorderThreeOutline,
  ArrowForwardOutline,
  OpenOutline,
  FileTrayOutline,
} from '@vicons/ionicons5'

type ToastSeverity = 'success' | 'info' | 'warn' | 'error'

const message = useMessage()
const dialog = useDialog()

function notify(opts: { severity: ToastSeverity; summary: string; detail?: string }) {
  const type = opts.severity === 'warn' ? 'warning' : opts.severity
  const text = opts.detail ? `${opts.summary} · ${opts.detail}` : opts.summary
  message[type](text)
}

const wallets = useStorage<Wallet[]>('wallets', [])
const transactionsByWallet = ref<Record<string, Transaction[]>>({})
const prices = ref<PriceMap>({})
const shouldShowWalletModal = ref(false)
const isLoadingResult = ref(false)
const loadingWallets = ref<Set<string>>(new Set())
const shouldShowHistoryDialog = ref(false)
const activeWalletAddress = ref<string | null>(null)
const selectedDate = ref<string>(moment(new Date()).format('YYYY-MM-DD'))

const walletTab = ref<'list' | 'add' | 'import'>('list')

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

function isLoadingWallet(address: string) {
  return isLoadingResult.value || loadingWallets.value.has(address)
}

// Wallets shown on the main screen (hidden ones are filtered out)
const visibleWallets = computed(() => wallets.value.filter((w) => !w.hidden))

const totals = computed(() => {
  let withData = 0
  for (const w of visibleWallets.value) {
    if (hasData(w.address)) withData++
  }
  return { withData, total: visibleWallets.value.length }
})

function openHistory(address: string) {
  if (!hasData(address)) return
  activeWalletAddress.value = address
  shouldShowHistoryDialog.value = true
}

async function fetchDataAll() {
  if (wallets.value.length === 0) {
    notify({ severity: 'warn', summary: 'Thông báo', detail: 'Chưa có ví nào được lưu' })
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
    notify({
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
    notify({
      severity: 'error',
      summary: 'Lỗi',
      detail: err.response?.data?.message || 'Không thể lấy dữ liệu',
    })
  } finally {
    loadingWallets.value.delete(address)
  }
}

async function fetchDataMissingOnly() {
  const missingWallets = wallets.value
    .filter((w) => !hasData(w.address))
    .map((w) => w.address)

  if (missingWallets.length === 0) {
    notify({ severity: 'info', summary: 'Thông báo', detail: 'Tất cả ví đều đã có dữ liệu' })
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
    notify({
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
    notify({ severity: 'error', summary: 'Lỗi', detail: 'Ví không hợp lệ' })
    return
  }
  if (wallets.value.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
    notify({ severity: 'warn', summary: 'Thông báo', detail: 'Ví đã tồn tại' })
    return
  }
  const label = newWalletLabel.value.trim() || address
  wallets.value.push({ address, label })
  newWalletAddress.value = ''
  newWalletLabel.value = ''
  notify({ severity: 'success', summary: 'Đã thêm ví', detail: label })
}

function removeWallet(index: number) {
  wallets.value.splice(index, 1)
}

function clearAllWallets() {
  if (wallets.value.length === 0) return
  dialog.warning({
    title: 'Xóa tất cả',
    content: `Xóa toàn bộ ${wallets.value.length} ví khỏi danh sách?`,
    positiveText: 'Xóa',
    negativeText: 'Hủy',
    onPositiveClick: () => {
      wallets.value = []
      transactionsByWallet.value = {}
      notify({ severity: 'success', summary: 'Đã xóa', detail: 'Đã xóa toàn bộ danh sách ví' })
    },
  })
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
      notify({ severity: 'error', summary: 'Lỗi', detail: `Địa chỉ không hợp lệ: ${address}` })
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
    notify({ severity: 'success', summary: 'Thành công', detail: `Đã thêm ${addedCount} ví` })
  }
}

// --- Edit wallet ---
const shouldShowEditModal = ref(false)
const editingIndex = ref<number | null>(null)
const editAddress = ref('')
const editLabel = ref('')

function openEditWallet(index: number) {
  const w = wallets.value[index]
  if (!w) return
  editingIndex.value = index
  editAddress.value = w.address
  editLabel.value = w.label
  shouldShowEditModal.value = true
}

function saveEditWallet() {
  if (editingIndex.value === null) return
  const address = editAddress.value.trim()
  if (!address || !isValidBscAddress(address)) {
    notify({ severity: 'error', summary: 'Lỗi', detail: 'Ví không hợp lệ' })
    return
  }
  const dup = wallets.value.some(
    (w, i) => i !== editingIndex.value && w.address.toLowerCase() === address.toLowerCase(),
  )
  if (dup) {
    notify({ severity: 'warn', summary: 'Thông báo', detail: 'Ví đã tồn tại' })
    return
  }
  const current = wallets.value[editingIndex.value]
  const oldAddress = current.address
  const label = editLabel.value.trim() || address

  // Migrate fetched data if the address changed
  if (oldAddress !== address && transactionsByWallet.value[oldAddress]) {
    transactionsByWallet.value[address] = transactionsByWallet.value[oldAddress]
    delete transactionsByWallet.value[oldAddress]
  }

  wallets.value[editingIndex.value] = { ...current, address, label }
  shouldShowEditModal.value = false
  editingIndex.value = null
  notify({ severity: 'success', summary: 'Đã cập nhật ví', detail: label })
}

const hideRailStyle = ({ checked }: { checked: boolean }) =>
  checked ? { background: '#f0a020' } : {}

// --- Main wallet table ---
const mono = 'font-family: var(--n-font-family-mono, monospace);'

function numericCell(address: string, value: () => any) {
  if (isLoadingWallet(address)) return h(NSkeleton, { text: true, width: 60 })
  if (!hasData(address)) return h(NText, { depth: 3 }, { default: () => '—' })
  return value()
}

const columns = computed<DataTableColumns<Wallet>>(() => [
  {
    title: '#',
    key: 'index',
    width: 50,
    render: (_row, index) => index + 1,
  },
  {
    title: 'Ví',
    key: 'wallet',
    minWidth: 160,
    render: (row) =>
      h('div', { style: 'line-height:1.3' }, [
        h(
          'div',
          { style: 'font-weight:600; white-space:nowrap' },
          row.label,
        ),
        h(NText, { depth: 3, style: `font-size:12px;${mono}` }, () =>
          useShortenAddress(row.address),
        ),
      ]),
  },
  {
    title: 'Khối lượng',
    key: 'volume',
    align: 'right',
    width: 120,
    render: (row) =>
      numericCell(row.address, () =>
        h('strong', null, '$' + formatNumber(getWalletStats(row.address).totalVolumeUSD)),
      ),
  },
  {
    title: 'Điểm',
    key: 'points',
    align: 'right',
    width: 90,
    render: (row) =>
      numericCell(row.address, () =>
        h(NText, { type: 'success', strong: true }, () => getWalletStats(row.address).points),
      ),
  },
  {
    title: 'Phí',
    key: 'fee',
    align: 'right',
    width: 110,
    render: (row) =>
      numericCell(row.address, () => {
        const fee = getWalletStats(row.address).totalFee
        return h(NText, { type: fee >= 0 ? 'success' : 'error' }, () =>
          formatNumber(fee, { maximumFractionDigits: 4 }),
        )
      }),
  },
  {
    title: 'Giao dịch',
    key: 'txCount',
    align: 'right',
    width: 110,
    render: (row) =>
      numericCell(row.address, () => getWalletStats(row.address).transactionsCount),
  },
  {
    title: 'Thao tác',
    key: 'actions',
    align: 'right',
    width: 110,
    render: (row) =>
      h(NSpace, { justify: 'end', size: 4, wrap: false }, () => [
        h(
          NButton,
          {
            quaternary: true,
            circle: true,
            size: 'small',
            loading: loadingWallets.value.has(row.address),
            disabled: isLoadingWallet(row.address),
            title: 'Reload ví này',
            onClick: (e: MouseEvent) => {
              e.stopPropagation()
              fetchDataForWallet(row.address)
            },
          },
          { icon: () => h(NIcon, null, () => h(RefreshOutline)) },
        ),
        hasData(row.address) && !loadingWallets.value.has(row.address)
          ? h(
              NButton,
              {
                quaternary: true,
                circle: true,
                size: 'small',
                title: 'Chi tiết',
                onClick: (e: MouseEvent) => {
                  e.stopPropagation()
                  openHistory(row.address)
                },
              },
              { icon: () => h(NIcon, null, () => h(ArrowForwardOutline)) },
            )
          : null,
      ]),
  },
])

const rowProps = (row: Wallet) => ({
  style: hasData(row.address) ? 'cursor: pointer;' : undefined,
  onClick: () => openHistory(row.address),
})

// --- History (transactions) table ---
const historyData = computed(() =>
  activeWalletAddress.value ? transactionsByWallet.value[activeWalletAddress.value] || [] : [],
)

const historyColumns = computed<DataTableColumns<Transaction>>(() => [
  {
    title: '#',
    key: 'index',
    width: 50,
    render: (_row, index) => historyData.value.length - index,
  },
  {
    title: 'Hash',
    key: 'hash',
    width: 150,
    render: (row) =>
      h(NSpace, { size: 6, align: 'center', wrap: false }, () => [
        h(NText, { style: `font-size:12px;${mono}` }, () => useShortenAddress(row.hash)),
        h(
          'a',
          {
            href: bscScanTxUrl(row.hash),
            target: '_blank',
            rel: 'noopener',
            title: 'View on BscScan',
            style: 'display:inline-flex;color:inherit',
          },
          h(NIcon, { size: 14, depth: 3 }, () => h(OpenOutline)),
        ),
      ]),
  },
  {
    title: 'Thời gian',
    key: 'time',
    width: 130,
    render: (row) =>
      h(
        NText,
        {
          depth: 3,
          title: moment.unix(row.timestamp).local().format('YYYY-MM-DD HH:mm:ss'),
        },
        () => moment.unix(row.timestamp).fromNow(),
      ),
  },
  { title: 'From', key: 'from', width: 170, render: (row) => amountCell(row.from) },
  { title: 'To', key: 'to', width: 170, render: (row) => amountCell(row.to) },
  {
    title: 'Gas',
    key: 'gas',
    width: 150,
    render: (row) =>
      h('span', null, [
        h('span', null, row.gas),
        h(NText, { depth: 3, style: 'font-size:12px;margin-left:4px' }, () => 'BNB'),
      ]),
  },
])

function amountCell(token: Transaction['from']) {
  return h('div', { style: 'line-height:1.3' }, [
    h(NText, { type: 'success', strong: true }, () =>
      formatNumber(token.amount, { maximumFractionDigits: 6 }),
    ),
    h(
      'div',
      { style: 'font-size:12px;display:flex;gap:6px;margin-top:2px' },
      [
        h('span', null, token.symbol),
        h(NText, { depth: 3, style: mono }, () => useShortenAddress(token.address)),
      ],
    ),
  ])
}
</script>

<template>
  <n-layout style="min-height: 100vh">
    <n-layout-header bordered class="app-header">
      <n-page-header class="page-header" title="Web3 Wallet Tracker">
        <template #avatar>
          <n-avatar color="#10b981" style="color: #06241b; font-weight: 700">α</n-avatar>
        </template>
        <template #subtitle>
          <span class="header-subtitle">Binance Alpha · BSC</span>
        </template>
        <template #extra>
          <n-space align="center" :size="8" class="header-actions">
            <n-date-picker
              v-model:formatted-value="selectedDate"
              value-format="yyyy-MM-dd"
              type="date"
              class="header-date"
            />
            <n-button secondary @click="shouldShowWalletModal = true">
              <template #icon>
                <n-icon><SettingsOutline /></n-icon>
              </template>
              Quản lý ví
            </n-button>
            <n-button type="info" :disabled="isLoadingResult" @click="fetchDataMissingOnly">
              <template #icon>
                <n-icon><FlashOutline /></n-icon>
              </template>
              KT Ví Còn Lại
            </n-button>
            <n-button type="primary" :loading="isLoadingResult" @click="fetchDataAll">
              <template #icon>
                <n-icon><SyncOutline /></n-icon>
              </template>
              Kiểm tra
            </n-button>
          </n-space>
        </template>
      </n-page-header>
    </n-layout-header>

    <n-layout-content class="app-content">
      <n-space vertical :size="16">
        <n-text v-if="totals.total > 0" depth="2">
          Đã có dữ liệu:
          <n-text type="success" strong>{{ totals.withData }}</n-text>
          / <n-text strong>{{ totals.total }}</n-text> ví
        </n-text>

        <n-card v-if="totals.total === 0">
          <n-empty description="Chưa có ví nào" size="large" style="padding: 48px 0">
            <template #icon>
              <n-icon><WalletOutline /></n-icon>
            </template>
            <template #extra>
              <n-button type="primary" @click="shouldShowWalletModal = true">Thêm ví</n-button>
            </template>
          </n-empty>
        </n-card>

        <n-card v-else :bordered="false" content-style="padding: 0" style="overflow: hidden">
          <n-data-table
            :columns="columns"
            :data="visibleWallets"
            :row-key="(row: Wallet) => row.address"
            :row-props="rowProps"
            :bordered="false"
            :scroll-x="760"
            :max-height="650"
          />
        </n-card>
      </n-space>
    </n-layout-content>

    <!-- History dialog -->
    <n-modal
      v-model:show="shouldShowHistoryDialog"
      preset="card"
      title="Chi tiết giao dịch"
      :style="{ width: '90vw', maxWidth: '900px' }"
      header-style="padding: 16px 20px;"
      content-style="background-color: #f0f2f5; padding: 16px 20px; max-height: 70vh; overflow-y: auto;"
    >
      <n-card :bordered="false" content-style="padding: 0" style="overflow: hidden">
        <n-data-table
          :columns="historyColumns"
          :data="historyData"
          :row-key="(row: Transaction) => row.hash"
          :bordered="false"
          :scroll-x="720"
          :max-height="500"
        />
      </n-card>
    </n-modal>

    <!-- Wallet management dialog with tabs -->
    <n-modal
      v-model:show="shouldShowWalletModal"
      preset="card"
      title="Quản lý địa chỉ ví"
      :style="{ width: '90vw', maxWidth: '700px' }"
      header-style="padding: 16px 20px;"
      content-style="background-color: #f0f2f5; padding: 16px 20px; max-height: 70vh; overflow-y: auto;"
      footer-style="padding: 12px 20px;"
    >
      <n-tabs v-model:value="walletTab" type="line" animated>
        <!-- Tab: List -->
        <n-tab-pane name="list" :tab="`Danh sách (${wallets.length})`">
          <n-space vertical :size="12">
            <n-space v-if="wallets.length > 0" justify="end">
              <n-button size="small" type="error" tertiary @click="clearAllWallets">
                <template #icon>
                  <n-icon><TrashOutline /></n-icon>
                </template>
                Xóa tất cả
              </n-button>
            </n-space>

            <draggable
              v-if="wallets.length > 0"
              tag="div"
              :list="wallets"
              item-key="address"
              handle=".drag-handle"
            >
              <template #item="{ element, index }">
                <n-card size="small" style="margin-bottom: 8px" content-style="padding: 12px">
                  <n-space align="center" justify="space-between" :wrap="false">
                    <div style="min-width: 0">
                      <n-space align="baseline" :size="6" :wrap="false">
                        <n-text depth="3">{{ index + 1 }}.</n-text>
                        <n-text strong>{{ element.label }}</n-text>
                      </n-space>
                      <div style="font-size: 12px; margin-top: 4px">
                        <n-text depth="3" style="font-family: monospace">
                          {{ element.address }}
                        </n-text>
                      </div>
                    </div>
                    <n-space align="center" :size="6" :wrap="false">
                      <n-switch
                        size="small"
                        :value="element.hidden ?? false"
                        :rail-style="hideRailStyle"
                        :title="
                          element.hidden
                            ? 'Đang ẩn khỏi màn hình chính'
                            : 'Đang hiện ở màn hình chính'
                        "
                        @update:value="(v: boolean) => (element.hidden = v)"
                      />
                      <n-button
                        quaternary
                        circle
                        size="small"
                        title="Sửa ví"
                        @click="openEditWallet(index)"
                      >
                        <template #icon>
                          <n-icon><CreateOutline /></n-icon>
                        </template>
                      </n-button>
                      <n-button
                        quaternary
                        circle
                        size="small"
                        class="drag-handle"
                        style="cursor: grab"
                        title="Kéo để sắp xếp"
                      >
                        <template #icon>
                          <n-icon><ReorderThreeOutline /></n-icon>
                        </template>
                      </n-button>
                      <n-button
                        quaternary
                        circle
                        size="small"
                        type="error"
                        title="Xóa"
                        @click="removeWallet(index)"
                      >
                        <template #icon>
                          <n-icon><TrashOutline /></n-icon>
                        </template>
                      </n-button>
                    </n-space>
                  </n-space>
                </n-card>
              </template>
            </draggable>

            <n-empty
              v-else
              description="Chưa có ví nào trong danh sách"
              style="padding: 40px 0"
            >
              <template #icon>
                <n-icon><FileTrayOutline /></n-icon>
              </template>
              <template #extra>
                <n-button size="small" text type="primary" @click="walletTab = 'add'">
                  Thêm ví đầu tiên →
                </n-button>
              </template>
            </n-empty>
          </n-space>
        </n-tab-pane>

        <!-- Tab: Add -->
        <n-tab-pane name="add" tab="Thêm ví">
          <n-form @submit.prevent="addWallet">
            <n-form-item label="Địa chỉ ví">
              <n-input v-model:value="newWalletAddress" placeholder="0x..." />
            </n-form-item>
            <n-form-item label="Ghi chú (tùy chọn)">
              <n-input
                v-model:value="newWalletLabel"
                placeholder="VD: Ví chính"
                @keyup.enter="addWallet"
              />
            </n-form-item>
            <n-button type="primary" block @click="addWallet">Thêm ví</n-button>
          </n-form>
        </n-tab-pane>

        <!-- Tab: Import -->
        <n-tab-pane name="import" tab="Import Hàng loạt">
          <n-space vertical :size="12">
            <n-text depth="3" style="font-size: 13px">
              Nhập nhiều ví, mỗi dòng theo format:
              <n-text code>0xABC..., Label</n-text>
            </n-text>
            <n-input
              v-model:value="batchImportText"
              type="textarea"
              :rows="8"
              placeholder="0xB2AD50f4AB1B7A9DB6069ca4761E6d250BA146E3, TK1&#10;0x5246AcC8e6993F881638FE82164d50eFCFa9fb1E, TK2"
            />
            <n-button type="primary" block @click="batchImportWallets">Import</n-button>
          </n-space>
        </n-tab-pane>
      </n-tabs>

      <template #footer>
        <n-space justify="end">
          <n-button @click="shouldShowWalletModal = false">Hoàn Thành</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Edit wallet dialog -->
    <n-modal
      v-model:show="shouldShowEditModal"
      preset="card"
      title="Sửa ví"
      :style="{ width: '90vw', maxWidth: '500px' }"
      header-style="padding: 16px 20px;"
      content-style="background-color: #f0f2f5; padding: 16px 20px;"
      footer-style="padding: 12px 20px;"
    >
      <n-form @submit.prevent="saveEditWallet">
        <n-form-item label="Địa chỉ ví">
          <n-input v-model:value="editAddress" placeholder="0x..." />
        </n-form-item>
        <n-form-item label="Ghi chú (tùy chọn)">
          <n-input
            v-model:value="editLabel"
            placeholder="VD: Ví chính"
            @keyup.enter="saveEditWallet"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="shouldShowEditModal = false">Hủy</n-button>
          <n-button type="primary" @click="saveEditWallet">Lưu</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-layout>
</template>

<style scoped>
.app-header {
  padding: 14px 24px;
  position: sticky;
  top: 0;
  z-index: 10;
}
.app-content {
  padding: 24px;
}
.header-date {
  width: 150px;
}

/* Let the page-header row wrap so controls drop below the title on narrow screens */
.page-header :deep(.n-page-header__main) {
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: center;
}
.page-header :deep(.n-page-header__header) {
  flex: 1 1 auto;
  min-width: 0;
}

@media (max-width: 768px) {
  .app-header {
    padding: 12px 16px;
  }
  .app-content {
    padding: 16px;
  }
  .header-subtitle {
    display: none;
  }
  .header-actions {
    width: 100%;
  }
  .header-actions :deep(.n-button) {
    flex: 1 1 auto;
  }
  .header-date {
    flex: 1 1 100%;
    width: 100%;
  }
}
</style>
