/** Thrown for any failed API request. `status` is the HTTP status (0 when the request never got an answer). */
export class ElysiumApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message)
    this.name = 'ElysiumApiError'
  }
}

export type HttpOptions = {
  /** Base URL, e.g. https://api.elysiumswap.finance. */
  baseUrl: string
  /** Per-request timeout in milliseconds (default 10 000). */
  timeoutMs?: number
  /** A fetch implementation (default: the global fetch). */
  fetch?: typeof fetch
}

export function createHttp({ baseUrl, timeoutMs = 10_000, fetch: f }: HttpOptions) {
  const base = baseUrl.replace(/\/+$/, '')
  const doFetch = f ?? globalThis.fetch
  if (!doFetch) throw new Error('no fetch available: pass one in the options (Node 18+ has it built in)')

  return async function get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    const url = `${base}${path}${qs ? `?${qs}` : ''}`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? `timed out after ${timeoutMs} ms` : (e as Error).message
      throw new ElysiumApiError(`GET ${path}: ${msg}`, 0, path)
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      let detail = ''
      try {
        detail = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // not JSON
      }
      throw new ElysiumApiError(`GET ${path}: HTTP ${res.status}${detail ? ` (${detail})` : ''}`, res.status, path)
    }
    return (await res.json()) as T
  }
}

export type Get = ReturnType<typeof createHttp>
