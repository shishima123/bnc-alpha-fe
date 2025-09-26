/* eslint-disable no-console */

import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('Có phiên bản mới, bạn muốn tải lại không?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('Ứng dụng đã sẵn sàng hoạt động offline.')
  },
})
