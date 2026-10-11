<script setup lang="ts">
import { NInputNumber, NText } from 'naive-ui'

defineProps<{ modelValue?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
</script>

<template>
  <div @click.stop @keydown.stop>
    <n-text depth="3" style="display: block; font-size: 12px; margin-bottom: 4px">
      Tiền mỗi trade
    </n-text>
    <n-input-number
      :value="modelValue ?? null"
      :min="0.01"
      :show-button="false"
      size="small"
      clearable
      placeholder="Số tiền USD"
      @update:value="(value: number | null) => emit('update:modelValue', value)"
    >
      <template #prefix>$</template>
    </n-input-number>
  </div>
</template>
