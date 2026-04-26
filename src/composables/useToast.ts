import { ref } from 'vue'

export type ToastSeverity = 'success' | 'info' | 'warn' | 'error'

export interface ToastItem {
  id: number
  severity: ToastSeverity
  summary: string
  detail?: string
  life: number
}

const toasts = ref<ToastItem[]>([])
let nextId = 0

export function useToast() {
  const add = (toast: {
    severity: ToastSeverity
    summary: string
    detail?: string
    life?: number
  }) => {
    const id = nextId++
    const life = toast.life ?? 3000
    toasts.value.push({
      id,
      severity: toast.severity,
      summary: toast.summary,
      detail: toast.detail,
      life,
    })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, life)
  }

  const remove = (id: number) => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, add, remove }
}
