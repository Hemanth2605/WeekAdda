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
 * Open Google's account-picker popup (token flow, so we can use our own
 * styled button) and sign the whole app in. Must be called from a click
 * handler so the popup isn't blocked. Rejects with 'popup_closed' when the
 * user dismisses the popup.
 */
export async function signInWithGoogle(): Promise<GoogleUser> {
  if (!authEnabled) throw new Error('Google sign-in is not configured')
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'openid email profile',
      callback: async (res) => {
        if (!res.access_token) return reject(new Error(res.error || 'Sign-in failed'))
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
          resolve(user)
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Sign-in failed'))
        }
      },
      error_callback: (err) => reject(new Error(err?.type || 'popup_closed')),
    })
    client.requestAccessToken()
  })
}
