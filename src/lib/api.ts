import type { DuplicateCandidate } from '@shared/types'

export class ApiError extends Error {
  status: number
  code?: string
  candidates?: DuplicateCandidate[]

  constructor(message: string, status: number, code?: string, candidates?: DuplicateCandidate[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.candidates = candidates
  }
}

export class NetworkError extends Error {
  constructor(message = 'The Afribok server is unreachable. Your work stays saved on this device.') {
    super(message)
    this.name = 'NetworkError'
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(20000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new NetworkError('The server did not respond. Your work stays saved on this device.')
    }
    throw new NetworkError()
  }

  if (response.status === 204) return undefined as T

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const body = (payload ?? {}) as {
      error?: string
      code?: string
      candidates?: DuplicateCandidate[]
    }
    throw new ApiError(
      body.error || `Request failed (${response.status}).`,
      response.status,
      body.code,
      body.candidates,
    )
  }

  return payload as T
}
