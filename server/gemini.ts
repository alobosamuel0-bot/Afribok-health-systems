/**
 * Gemini client used by every clinical AI feature.
 *
 * The clinic holds a pool of API keys. Keys are rotated round-robin and a key
 * that answers 429/403/5xx is cooled down instead of being retried in a loop, so
 * one exhausted key never takes triage, OCR or the scribe offline while another
 * key still has quota.
 */

export interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

export interface GeminiInput {
  system?: string
  parts: GeminiPart[]
  json?: boolean
  temperature?: number
  maxOutputTokens?: number
}

export interface GeminiOutput {
  text: string
  model: string
  latencyMs: number
  keySlot: number
}

export class GeminiError extends Error {
  status: number | null
  code: string

  constructor(message: string, status: number | null = null, code = 'AI_UNAVAILABLE') {
    super(message)
    this.name = 'GeminiError'
    this.status = status
    this.code = code
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const DEFAULT_FALLBACK = 'gemini-3.6-flash'
const TIMEOUT_MS = 75_000
const COOLDOWN_MS = 60_000

function parseKeys(value: string | undefined): string[] {
  return (value || '')
    .split(/[,\s]+/)
    .map((key) => key.trim())
    .filter(Boolean)
}

export class GeminiClient {
  private keys: string[]
  private models: string[]
  private cooldownUntil: number[]
  private cursor = 0

  constructor(
    keys = parseKeys(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY),
    models = [process.env.GEMINI_MODEL || DEFAULT_MODEL, process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK],
  ) {
    this.keys = keys
    this.models = Array.from(new Set(models.filter(Boolean)))
    this.cooldownUntil = keys.map(() => 0)
  }

  get configured(): boolean {
    return this.keys.length > 0
  }

  get keyCount(): number {
    return this.keys.length
  }

  get model(): string {
    return this.models[0]
  }

  describe(): { configured: boolean; keys: number; models: string[]; availableKeys: number } {
    const now = Date.now()
    return {
      configured: this.configured,
      keys: this.keys.length,
      models: this.models,
      availableKeys: this.cooldownUntil.filter((until) => until <= now).length,
    }
  }

  private pickKey(): number | null {
    const now = Date.now()
    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const index = (this.cursor + offset) % this.keys.length
      if (this.cooldownUntil[index] <= now) {
        this.cursor = (index + 1) % this.keys.length
        return index
      }
    }
    return null
  }

  async generate(input: GeminiInput): Promise<GeminiOutput> {
    if (!this.configured) {
      throw new GeminiError(
        'No Gemini API key is configured on the clinic server. Set GEMINI_API_KEYS.',
        null,
        'AI_NOT_CONFIGURED',
      )
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: input.parts }],
      generationConfig: {
        temperature: input.temperature ?? 0.2,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.json ? { responseMimeType: 'application/json' } : {}),
      },
    }
    if (input.system) body.systemInstruction = { parts: [{ text: input.system }] }

    let lastError: GeminiError | null = null
    const attempts = this.keys.length * this.models.length

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const slot = this.pickKey()
      if (slot === null) {
        throw lastError ?? new GeminiError('Every Gemini API key is rate limited. Try again shortly.', 429, 'AI_RATE_LIMITED')
      }
      const model = this.models[attempt % this.models.length]
      const started = Date.now()

      try {
        const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.keys[slot],
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 400)
          const retryable = response.status === 429 || response.status === 403 || response.status >= 500
          lastError = new GeminiError(
            response.status === 429
              ? 'Gemini quota is exhausted for now.'
              : `Gemini returned ${response.status}.`,
            response.status,
            response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE',
          )
          if (retryable) {
            const retryAfter = Number(response.headers.get('retry-after'))
            this.cooldownUntil[slot] =
              Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : COOLDOWN_MS)
            console.warn(`[ai] key slot ${slot + 1} cooled down (${response.status}): ${detail}`)
            continue
          }
          if (response.status === 404) continue
          throw lastError
        }

        const payload = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
          promptFeedback?: { blockReason?: string }
        }
        const text = (payload.candidates?.[0]?.content?.parts ?? [])
          .map((part) => part.text ?? '')
          .join('')
          .trim()

        if (!text) {
          const blocked = payload.promptFeedback?.blockReason
          if (blocked) {
            throw new GeminiError(`The model refused this request (${blocked}).`, 400, 'AI_REFUSED')
          }
          lastError = new GeminiError('Gemini returned an empty answer.', null, 'AI_EMPTY')
          continue
        }

        return { text, model, latencyMs: Date.now() - started, keySlot: slot }
      } catch (error) {
        if (error instanceof GeminiError) {
          if (error.code === 'AI_REFUSED') throw error
          lastError = error
          continue
        }
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        lastError = new GeminiError(
          timedOut ? 'Gemini timed out.' : 'Could not reach Gemini.',
          null,
          timedOut ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
        )
      }
    }

    throw lastError ?? new GeminiError('Gemini did not answer.', null, 'AI_UNAVAILABLE')
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}
