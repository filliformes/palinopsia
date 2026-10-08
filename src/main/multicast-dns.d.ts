// Minimal typings for `multicast-dns` (only the bits the dataflou node uses).
declare module 'multicast-dns' {
  interface Mdns {
    on(event: string, cb: (...args: never[]) => void): void
    query(q: unknown, rinfo?: unknown): void
    respond(r: unknown, rinfo?: unknown): void
    destroy(cb?: () => void): void
  }
  export default function makeMdns(opts?: Record<string, unknown>): Mdns
}
