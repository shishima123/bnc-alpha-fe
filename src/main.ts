import './assets/main.css'
import 'primeicons/primeicons.css'

import { createApp } from 'vue'
import App from './App.vue'
import './registerServiceWorker'

const app = createApp(App)
app.mount('#app')
