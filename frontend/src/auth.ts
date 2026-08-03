import { useSyncExternalStore } from 'react'
import { isApplePortable, isStandalone } from './device'

/**
 * Google sign-in for publishing blog posts (Google Identity Services).
 *
 * Browsing WeekAdda never needs an account — this is only invoked by the blog
 * composer. When VITE_GOOGLE_CLIENT_ID is not configured (e.g. keyless local
 * dev), `authEnabled` is false and publishing works exactly as before.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          disableAutoSelect(): void
        }
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (res: { access_token?: string; expires_in?: number; error?: string }) => void
            error_callback?: (err: { type?: string }) => void
          }): { requestAccessToken(): void }
        }
      }
    }
  }
}

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
const STORE_KEY = 'weekadda-google'

export const authEnabled = Boolean(CLIENT_ID)

export interface GoogleUser {
  token: string
  name: string
  email: string
  picture: string
  exp: number // unix seconds
}

function isFresh(user: GoogleUser | null): user is GoogleUser {
  return Boolean(user && user.exp * 1000 > Date.now() + 30_000)
}

export function getStoredUser(): GoogleUser | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    const user = raw ? (JSON.parse(raw) as GoogleUser) : null
    return isFresh(user) ? user : null
  } catch {
    return null
  }
}

// One shared auth state for the whole app (navbar + blog composer): sign in
// anywhere, signed in everywhere.
let currentUser: GoogleUser | null = getStoredUser()
const subscribers = new Set<() => void>()

function setCurrentUser(user: GoogleUser | null) {
  currentUser = user
  subscribers.forEach((notify) => notify())
}

/** React hook: the signed-in Google user, kept in sync across components. */
export function useGoogleUser(): GoogleUser | null {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify)
      return () => subscribers.delete(notify)
    },
    () => currentUser
  )
}

/** Drop an expired session (e.g. discovered at publish time). */
export function refreshUser(): GoogleUser | null {
  const fresh = getStoredUser()
  if (Boolean(fresh) !== Boolean(currentUser) || fresh?.token !== currentUser?.token) {
    setCurrentUser(fresh)
  }
  return fresh
}

export function signOut() {
  try {
    sessionStorage.removeItem(STORE_KEY)
  } catch {
    // best-effort
  }
  window.google?.accounts.id.disableAutoSelect()
  setCurrentUser(null)
}

let gisLoading: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google sign-in'))
      document.head.appendChild(script)
    })
  }
  return gisLoading
}

/**
 * Thrown when the visitor came back to the page and Google had told us
 * nothing. Distinct from `popup_closed`, which Google reports itself and which
 * means the visitor deliberately dismissed the picker: this one means we never
 * heard, which on an installed iOS app is the normal outcome and worth
 * explaining rather than swallowing.
 */
export const SIGNIN_UNREACHABLE = 'signin_unreachable'

/**
 * Turn a raw access token into the signed-in user, and remember them.
 *
 * Both sign-in routes end here — the popup's callback and the redirect's
 * return — so there is one definition of what being signed in means, and no
 * chance of the two drifting into storing subtly different things.
 */
async function adoptToken(accessToken: string, expiresIn: number): Promise<GoogleUser> {
  const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const profile = ui.ok ? await ui.json() : {}
  const user: GoogleUser = {
    token: accessToken,
    name: profile.name ?? '',
    email: profile.email ?? '',
    picture: profile.picture ?? '',
    exp: Math.floor(Date.now() / 1000) + Number(expiresIn || 3600),
  }
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(user))
  } catch {
    // best-effort
  }
  setCurrentUser(user)
  return user
}

// ---------------------------------------------------------------- redirect flow

const REDIRECT_PATH = '/auth/google'
const STATE_KEY = 'weekadda-oauth-state'
/** Where the visitor was when they signed in, so they land back on it. */
const RETURN_KEY = 'weekadda-oauth-return'
/** Set when a return came home empty, so the page can say so once. */
const FAILED_KEY = 'weekadda-oauth-failed'

/**
 * Whether the last redirect sign-in came back without a session — read once and
 * cleared, so it is reported by whichever button mounts first and not again.
 *
 * Without this a failed exchange is indistinguishable from never having tried:
 * the visitor leaves for Google, comes back, and is simply still signed out.
 * That is the same silence that made the popup look like a broken button, and
 * it is worth a sentence.
 */
export function takeRedirectSignInError(): boolean {
  try {
    const failed = sessionStorage.getItem(FAILED_KEY) === '1'
    if (failed) sessionStorage.removeItem(FAILED_KEY)
    return failed
  } catch {
    return false
  }
}

/**
 * Sign in by leaving the page rather than by opening one.
 *
 * A popup cannot report back to an installed iOS app — it opens in Safari, a
 * separate context with no opener — so the app is never told anything and the
 * button waits forever. A top-level redirect has no such problem: it is the
 * same window throughout, and it comes home to our own origin.
 *
 * Used only where the popup cannot work. Desktop and Android keep the popup:
 * it is proven, it does not throw the page away mid-visit, and a second auth
 * path exists here because one platform needs it, not because it is better.
 */
export const signInNeedsRedirect = isStandalone && isApplePortable

/** Cryptographically random, so a returning code can be tied to our own start. */
function newState(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Leave for Google. Nothing after this runs — the page is on its way out. */
export function startRedirectSignIn(): void {
  const state = newState()
  try {
    sessionStorage.setItem(STATE_KEY, state)
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search)
  } catch {
    // A browser refusing storage cannot complete this flow; the state check
    // below will fail closed rather than accept an unverifiable code
  }
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', CLIENT_ID)
  auth.searchParams.set('redirect_uri', location.origin + REDIRECT_PATH)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('state', state)
  // Without this Google returns no refresh-free consent for a returning user
  auth.searchParams.set('prompt', 'select_account')
  location.assign(auth.toString())
}

/**
 * Called once on boot at /auth/google. Trades the code for a token through the
 * Worker — the exchange needs the client secret, which is why it cannot happen
 * here — and returns where the visitor was when they left.
 *
 * Returns null when this is not a sign-in return, so boot can ignore it.
 */
export async function completeRedirectSignIn(): Promise<string | null> {
  if (location.pathname !== REDIRECT_PATH) return null
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const state = params.get('state')

  let expected: string | null = null
  let back = '/'
  try {
    expected = sessionStorage.getItem(STATE_KEY)
    back = sessionStorage.getItem(RETURN_KEY) || '/'
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    // handled by the mismatch below
  }

  const failed = () => {
    try {
      sessionStorage.setItem(FAILED_KEY, '1')
    } catch {
      // then it goes unreported; the button is still there to try again
    }
    return back
  }

  // A code we did not ask for is not a sign-in, it is someone else's. Fail
  // closed and simply go home rather than spend the exchange on it. Not
  // reported: nobody here started a sign-in, so there is nothing to explain.
  if (!code || !state || !expected || state !== expected) return back

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: location.origin + REDIRECT_PATH }),
    })
    if (!res.ok) return failed()
    const { accessToken, expiresIn } = (await res.json()) as {
      accessToken: string
      expiresIn: number
    }
    await adoptToken(accessToken, expiresIn)
  } catch {
    return failed()
  }
  return back
}

/**
 * Open Google's account-picker popup (token flow, so we can use our own
 * styled button) and sign the whole app in. Must be called from a click
 * handler so the popup isn't blocked. Rejects with 'popup_closed' when the
 * user dismisses the popup, or SIGNIN_UNREACHABLE when it never reported back.
 */
export async function signInWithGoogle(): Promise<GoogleUser> {
  if (!authEnabled) throw new Error('Google sign-in is not configured')
  await loadGis()
  return new Promise((resolve, reject) => {
    /*
     * Google settles this by calling one of its two callbacks. Installed on an
     * iOS Home Screen it calls neither: the popup opens in Safari, a separate
     * context with no opener back to the app, so whatever the visitor does
     * there — sign in, give up, close it — nothing is ever reported here. The
     * promise hangs, the button stays "Signing in…", and only killing the app
     * clears it.
     *
     * So coming back to the app is treated as an answer in itself. If we are
     * visible again and still hold no token, the popup went somewhere we cannot
     * hear from. The grace period is for the ordinary case, where a desktop
     * popup closing and its callback arriving are the same moment and the
     * callback must be allowed to win.
     */
    let settled = false
    let grace: ReturnType<typeof setTimeout> | undefined

    const stop = () => {
      settled = true
      clearTimeout(grace)
      clearTimeout(ceiling)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
    }
    const done = (user: GoogleUser) => {
      if (settled) return
      stop()
      resolve(user)
    }
    const fail = (err: Error) => {
      if (settled) return
      stop()
      reject(err)
    }

    function onBack() {
      if (settled || document.visibilityState !== 'visible') return
      clearTimeout(grace)
      grace = setTimeout(() => fail(new Error(SIGNIN_UNREACHABLE)), 1500)
    }

    // Last resort, for a browser that reports neither a callback nor a return.
    // Long enough to read a consent screen; short enough to not be forever.
    const ceiling = setTimeout(() => fail(new Error('popup_closed')), 3 * 60 * 1000)

    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)

    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'openid email profile',
      callback: async (res) => {
        if (!res.access_token) return fail(new Error(res.error || 'Sign-in failed'))
        try {
          done(await adoptToken(res.access_token, Number(res.expires_in ?? 3600)))
        } catch (err) {
          fail(err instanceof Error ? err : new Error('Sign-in failed'))
        }
      },
      error_callback: (err) => fail(new Error(err?.type || 'popup_closed')),
    })
    client.requestAccessToken()
  })
}
