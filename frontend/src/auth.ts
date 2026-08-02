import { useSyncExternalStore } from 'react'

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
          const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${res.access_token}` },
          })
          const profile = ui.ok ? await ui.json() : {}
          const user: GoogleUser = {
            token: res.access_token,
            name: profile.name ?? '',
            email: profile.email ?? '',
            picture: profile.picture ?? '',
            exp: Math.floor(Date.now() / 1000) + Number(res.expires_in ?? 3600),
          }
          try {
            sessionStorage.setItem(STORE_KEY, JSON.stringify(user))
          } catch {
            // best-effort
          }
          setCurrentUser(user)
          done(user)
        } catch (err) {
          fail(err instanceof Error ? err : new Error('Sign-in failed'))
        }
      },
      error_callback: (err) => fail(new Error(err?.type || 'popup_closed')),
    })
    client.requestAccessToken()
  })
}
