<script setup lang="ts">
import { watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title?: string
  width?: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

watch(
  () => props.visible,
  (v) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = v ? 'hidden' : ''
  },
)

function close() {
  emit('update:visible', false)
}

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
</script>

<template>
  <transition name="modal">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @keydown="handleKey"
      tabindex="-1"
    >
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="close" />
      <div
        class="relative w-full bg-zinc-800/95 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        :style="{ maxWidth: width || '40rem' }"
      >
        <header
          class="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-zinc-700 shrink-0"
        >
          <h2 class="text-base sm:text-lg font-semibold text-zinc-100">
            {{ title }}
          </h2>
          <button
            class="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition rounded-lg w-8 h-8 flex items-center justify-center"
            @click="close"
            aria-label="Close"
          >
            <i class="pi pi-times text-sm"></i>
          </button>
        </header>
        <div class="overflow-y-auto px-5 sm:px-6 py-5">
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-zinc-700 shrink-0"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: transform 0.25s ease;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: translateY(8px) scale(0.98);
}
</style>
