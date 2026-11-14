// Many routes answer with a `debug` object beside their data (which cache
// answered, the upstream address, a sign-in's details): for the development
// debug menu. The page never reads it, so production answers go without.
import type { RequestHandler } from 'express'

export function withoutDebugField(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('debug' in body)) return body
  const { debug: _debug, ...rest } = body as Record<string, unknown>
  return rest
}

export function dropDebugFields(): RequestHandler {
  return (_req, res, next) => {
    const json = res.json.bind(res)
    res.json = (body) => json(withoutDebugField(body))
    next()
  }
}
