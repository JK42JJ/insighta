import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { visualizer } from "rollup-plugin-visualizer";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/',
    server: {
      host: "::",
      port: 8081,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
        '/health': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        // 2026-04-22 (Phase 2 re-scoped): switched from 'prompt' to
        // 'autoUpdate' so newly-deployed JS bundles take over on the
        // user's next navigation instead of waiting for an explicit
        // "Reload" prompt that users never accept. This was the root
        // cause of `wizard-stream` receiving 0 prod calls after the
        // 2026-04-21 wizard redesign deploy — users stayed on the old
        // cached bundle that still hit the 21-28s legacy path.
        //
        // `autoUpdate` writes a SKIP_WAITING message to the new worker
        // when it activates; the worker registration snippet in main.tsx
        // scopes the takeover to page navigations so a user typing into
        // the wizard is not reloaded mid-session.
        registerType: 'autoUpdate',
        includeAssets: ['vite.svg'],
        manifest: {
          name: 'Insighta',
          short_name: 'Insighta',
          description: 'Organize, annotate, and gain insights from your saved content',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // 2026-04-22 (Phase 2 re-scoped): removed the `/api/*`
          // StaleWhileRevalidate runtime cache. Serving stale API
          // responses is incorrect for mandala-create / wizard-stream
          // / card endpoints — users were seeing stale recommendations
          // and creation responses. Fonts stay cached because they are
          // immutable binary assets.
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
      mode === 'analyze' && visualizer({
        open: true,
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@app": path.resolve(__dirname, "./src/app"),
        "@pages": path.resolve(__dirname, "./src/pages"),
        "@widgets": path.resolve(__dirname, "./src/widgets"),
        "@features": path.resolve(__dirname, "./src/features"),
        "@entities": path.resolve(__dirname, "./src/entities"),
        "@shared": path.resolve(__dirname, "./src/shared"),
      },
    },
    optimizeDeps: {
      include: ['react-error-boundary', '@rive-app/react-canvas'],
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': [
              '@radix-ui/react-alert-dialog',
              '@radix-ui/react-avatar',
              '@radix-ui/react-collapsible',
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-label',
              '@radix-ui/react-scroll-area',
              '@radix-ui/react-select',
              '@radix-ui/react-separator',
              '@radix-ui/react-slot',
              '@radix-ui/react-switch',
              '@radix-ui/react-toast',
              '@radix-ui/react-toggle-group',
              '@radix-ui/react-tooltip',
            ],
            'query-vendor': ['@tanstack/react-query'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
            'dnd-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
            'motion-vendor': ['framer-motion'],
            'utils-vendor': ['date-fns', 'class-variance-authority', 'clsx', 'tailwind-merge', 'zod'],
          },
        },
      },
    },
  };
});
