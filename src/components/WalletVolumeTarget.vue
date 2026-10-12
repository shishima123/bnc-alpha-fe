<script setup lang="ts">
import { computed } from 'vue'
import { NSkeleton, NText } from 'naive-ui'
import { getRemainingTradeCount, getRemainingVolumeUSD } from '../helpers/points.ts'
import { formatNumber } from '../helpers/ultils.ts'

const props = defineProps<{
  targetPoints: number
  totalVolumeUSD?: number
  tradeAmountUSD?: number | null
  loading?: boolean
}>()

const remainingVolumeUSD = computed(() =>
  props.totalVolumeUSD === undefined
    ? null
    : getRemainingVolumeUSD(props.totalVolumeUSD, props.targetPoints),
)
const remainingTradeCount = computed(() =>
  getRemainingTradeCount(remainingVolumeUSD.value, props.tradeAmountUSD),
)
const rawVolumeUSD = computed(() => {
  if (remainingVolumeUSD.value === null) return null
  const raw = remainingVolumeUSD.value / 4
  return raw === 0 ? 0 : raw + 3
})
</script>

<template>
  <div class="volume-target">
    <n-skeleton v-if="loading" text style="width: 100px; margin: 0 auto" />
    <n-text
      v-else-if="remainingVolumeUSD !== null"
      strong
      :type="remainingVolumeUSD === 0 ? 'success' : 'info'"
    >
      ${{ formatNumber(remainingVolumeUSD, { minimumFractionDigits: 2 }) }}
    </n-text>
    <n-text v-else depth="3" title="Kiểm tra ví để lấy dữ liệu khối lượng">—</n-text>
    <n-text depth="3" class="target-caption">
      {{ !loading && remainingVolumeUSD === 0 ? 'Đã đạt mốc' : 'Mốc' }} {{ targetPoints }} điểm
    </n-text>
    <n-text
      v-if="!loading && rawVolumeUSD !== null"
      class="target-detail"
      title="Khối lượng còn lại / 4, cộng thêm 3 khi kết quả lớn hơn 0"
    >
      Khối lượng raw: ${{ formatNumber(rawVolumeUSD, { minimumFractionDigits: 2 }) }}
    </n-text>
    <n-text
      v-if="!loading && remainingTradeCount !== null"
      class="target-detail"
      :type="remainingTradeCount === 0 ? 'success' : 'info'"
      title="Khối lượng còn thiếu / tiền mỗi trade / 4, làm tròn lên"
    >
      Còn {{ formatNumber(remainingTradeCount) }} lần
    </n-text>
  </div>
</template>

<style scoped>
.volume-target {
  font-variant-numeric: tabular-nums;
}
.target-caption {
  display: block;
  margin-top: 2px;
  font-size: 12px;
}
.target-detail {
  display: block;
  margin-top: 4px;
  font-size: 13px;
}
</style>
