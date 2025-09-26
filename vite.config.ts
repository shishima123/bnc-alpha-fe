import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import Components from 'unplugin-vue-components/vite'
import { PrimeVueResolver } from '@primevue/auto-import-resolver'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    Components({
      resolvers: [PrimeVueResolver()],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Binance Alpha Point',
        short_name: 'Alpha Point',
        description: 'Ứng dụng Binance Alpha Point',
        theme_color: '#42b883',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: './assets/icons/android-icon-36x36.png',
            sizes: '36x36',
            type: 'image/png',
          },
          {
            src: './assets/icons/android-icon-48x48.png',
            sizes: '48x48',
            type: 'image/png',
          },
          {
            src: './assets/icons/android-icon-72x72.png',
            sizes: '72x72',
            type: 'image/png',
          },
          {
            src: './assets/icons/android-icon-96x96.png',
            sizes: '96x96',
            type: 'image/png',
          },
          {
            src: './assets/icons/android-icon-144x144.png',
            sizes: '144x144',
            type: 'image/png',
          },
          {
            src: './assets/icons/android-icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  base: '/bnc-alpha-fe/',
})
