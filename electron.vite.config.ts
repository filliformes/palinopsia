import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import type { Plugin } from 'vite'

// `import x from 'file.wasm?base64'` : the file's bytes as a base64 string, inside the
// bundle. The LAZ decoder (laz-perf) runs in the Model's inline worker, where no file
// beside the app can be fetched; its WebAssembly travels in the worker this way.
function base64Asset(): Plugin {
  return {
    name: 'opsia-base64-asset',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith('?base64')) return null
      const r = await this.resolve(id.slice(0, -'?base64'.length), importer, { skipSelf: true })
      return r ? '\0base64:' + r.id : null
    },
    load(id) {
      if (!id.startsWith('\0base64:')) return null
      return `export default ${JSON.stringify(readFileSync(id.slice('\0base64:'.length)).toString('base64'))}`
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // the USB input's capture process (macOS) is a utility process of its own
        input: { index: resolve('src/main/index.ts'), avcaptureWorker: resolve('src/main/avcaptureWorker.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), base64Asset()],
    worker: { plugins: () => [base64Asset()] },
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
})
