import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
    sourcemap: false,
    // esbuild is the default minifier and does NOT mangle property names by
    // accident, but does drop dead code (incl. our console.log calls thanks
    // to the `drop` flag below). Faster than terser, comparable size.
    minify: 'esbuild',
    // Use esbuild for CSS minification too — avoids needing the optional
    // `lightningcss` peer-dependency which isn't installed in production.
    cssMinify: 'esbuild',
    target: 'es2020', // smaller bundle than es2015 since modern browsers all support es2020
    rollupOptions: {
      output: {
        // Stable chunk names so service-worker cache invalidation works correctly
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'lucide': ['lucide-react'],
          'lottie': ['@lottiefiles/react-lottie-player'],
          'query':   ['@tanstack/react-query'],
          'helmet':  ['react-helmet-async'],
        },
      },
    },
  },
  esbuild: {
    // Strip console.log/debug/info + debugger statements from production
    // bundles. We KEEP console.warn + console.error since they surface real
    // bugs to telemetry.
    drop: ['debugger'],
    pure: ['console.log', 'console.debug', 'console.info', 'console.table'],
    // ⚠️ DO NOT enable `mangleProps` globally — it rewrites property names
    // across ALL bundled code (including node_modules), which breaks React's
    // internal reflection (`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`)
    // that libraries like react-query use to read `ReactCurrentOwner` /
    // `ReactCurrentDispatcher`. Symptom in production:
    //   "Cannot read properties of undefined (reading 'ReactCurrentOwner')"
  },
  plugins: [
    react(),
    tsconfigPaths(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
