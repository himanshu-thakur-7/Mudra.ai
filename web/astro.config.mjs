import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

// Astro islands (React) + Tailwind v4. The FastAPI backend is proxied at /api
// in dev; in production Cloudflare Pages rewrites /api to the Worker/host.
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': 'http://localhost:8000',
      },
    },
  },
  server: { port: 4321 },
})
