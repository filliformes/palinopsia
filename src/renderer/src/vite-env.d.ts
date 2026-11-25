/// <reference types="vite/client" />
// Brings in Vite's ambient module declarations : `*?raw` (ISF shader sources),
// `*?url`, `import.meta.env`, etc.

// electron.vite.config.ts base64Asset : a file's bytes as a base64 string
declare module '*?base64' {
  const b64: string
  export default b64
}
