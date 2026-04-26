<script setup lang="ts">
import { useToast, type ToastSeverity } from '@/composables/useToast'

const { toasts, remove } = useToast()

const config: Record<
  ToastSeverity,
  { icon: string; bg: string; border: string; text: string; iconColor: string }
> = {
  success: {
    icon: 'pi-check-circle',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    text: 'text-emerald-100',
    iconColor: 'text-emerald-400',
  },
  error: {
    icon: 'pi-times-circle',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/40',
    text: 'text-rose-100',
    iconColor: 'text-rose-400',
  },
  warn: {
    icon: 'pi-exclamation-triangle',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    text: 'text-amber-100',
    iconColor: 'text-amber-400',
  },
  info: {
    icon: 'pi-info-circle',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/40',
    text: 'text-sky-100',
    iconColor: 'text-sky-400',
  },
}
</script>

<template>
  <div
    class="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-96 pointer-events-none"
  >
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto rounded-xl border backdrop-blur-md shadow-2xl px-4 py-3 flex items-start gap-3"
        :class="[config[t.severity].bg, config[t.severity].border, config[t.severity].text]"
      >
        <i
          class="pi mt-0.5 text-lg"
          :class="[config[t.severity].icon, config[t.severity].iconColor]"
        ></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm">{{ t.summary }}</div>
          <div v-if="t.detail" class="text-xs opacity-80 mt-0.5 break-words">
            {{ t.detail }}
          </div>
        </div>
        <button
          class="opacity-60 hover:opacity-100 transition"
          @click="remove(t.id)"
          aria-label="Close"
        >
          <i class="pi pi-times text-xs"></i>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  transform: translateX(20px);
  opacity: 0;
}
.toast-leave-to {
  transform: translateX(20px);
  opacity: 0;
}
.toast-move {
  transition: transform 0.25s ease;
}
</style>
