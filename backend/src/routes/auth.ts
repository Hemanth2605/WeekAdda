import { Router, Request, Response } from 'express'

/**
 * Redirect sign-in's code exchange — local-dev twin of the Worker's
 * /api/auth/google.
 *
 * The popup flow used everywhere else cannot report back to an installed iOS
 * app: the picker opens in Safari, a separate context with no opener, so the
 * app is never told anything. A top-level redirect stays inside the app, but
 * comes home with an authorization *code*, and Google will only trade a code
 * for a token when the client secret comes with it. A secret cannot live in a
 * bundle, so the trade happens server-side — here and in worker.ts, which must
 * stay the same shape.
 *
 * Nothing is stored. The token goes straight back to the page that asked, which
 * is where the popup flow already keeps it; this adds a way to obtain a
 * session, not a new place one lives.
 *
 * Without GOOGLE_CLIENT_SECRET it answers 501 and the app keeps the popup
 * everywhere — the same keyless fallback the rest of the backend uses.
 */
const router = Router()

router.post('/google', async (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return res.status(501).json({ error: 'Redirect sign-in is not configured' })
  }

  const { code, redirectUri } = (req.body ?? {}) as { code?: string; redirectUri?: string }
  if (!code || !redirectUri) return res.status(400).json({ error: 'Bad request' })

  /*
   * The redirect_uri must be ours, in both halves — host and path.
   *
   * Checking only the path is not a check: it let evil.example/auth/google
   * through, and the only thing that stopped our secret being spent against
   * someone else's URI was Google's own policy refusing it. Do not rely on
   * that; it is their safety net, not ours.
   *
   * This route is the local twin of the Worker's, which compares against its
   * own origin. It cannot do the same — in dev the app is on 5173 and the API
   * on 4000, so they legitimately differ — so it takes the other route to the
   * same place: this only ever serves a developer's own machine.
   */
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    return res.status(400).json({ error: 'Bad request' })
  }
  const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (!localHost || parsed.pathname !== '/auth/google') {
    return res.status(400).json({ error: 'Bad request' })
  }

  try {
    const upstream = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: parsed.toString(),
        grant_type: 'authorization_code',
      }),
    })
    const data = (await upstream.json()) as {
      access_token?: string
      expires_in?: number
      error_description?: string
    }
    if (!upstream.ok || !data.access_token) {
      return res.status(400).json({ error: data.error_description || 'Sign-in failed' })
    }
    // A credential in transit is never cached, by us or by anything in front
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({ accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 })
  } catch {
    res.status(502).json({ error: 'Sign-in failed' })
  }
})

export default router
