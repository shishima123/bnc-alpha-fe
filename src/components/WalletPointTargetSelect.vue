<script setup lang="ts">
import { NSelect } from 'naive-ui'
import { MAX_TARGET_POINTS } from '../helpers/points.ts'

defineProps<{ modelValue?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const options = Array.from({ length: MAX_TARGET_POINTS }, (_, index) => ({
  label: `${index + 1} điểm`,
  value: index + 1,
}))
</script>

<template>
  <div @click.stop @keydown.stop>
    <n-select
      :value="modelValue ?? null"
      :options="options"
      size="small"
      clearable
      placeholder="Mốc điểm"
      @update:value="(value: number | null) => emit('update:modelValue', value)"
    />
  </div>
</template>
