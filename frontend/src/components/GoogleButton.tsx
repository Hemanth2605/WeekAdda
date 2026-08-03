import { useEffect, useState } from 'react'
import {
  SIGNIN_UNREACHABLE,
  signInNeedsRedirect,
  signInWithGoogle,
  startRedirectSignIn,
  takeRedirectSignInError,
} from '../auth'

/** Official multicolor Google "G" — the one part that must stay original. */
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

interface Props {
  small?: boolean
  onError?: (message: string) => void
}

/** Google sign-in button in WeekAdda's own style (official logo, our chrome). */
export default function GoogleButton({ small, onError }: Props) {
  const [busy, setBusy] = useState(false)

  /*
   * A redirect sign-in that came home empty. The visitor left for Google, came
   * back, and is still signed out — which without a word looks exactly like
   * never having tried. Read once and cleared, so it is said by whichever
   * button mounts first and not repeated by the others on the page.
   */
  useEffect(() => {
    if (takeRedirectSignInError()) {
      onError?.('Sign-in did not complete. Please try again.')
    }
    // once, on mount — the flag is consumed by the read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const click = () => {
    if (busy) return
    // Where a popup cannot report back, leave the page instead of opening one.
    // Nothing after this runs — the browser is already on its way to Google.
    if (signInNeedsRedirect) {
      setBusy(true)
      return startRedirectSignIn()
    }
    setBusy(true)
    signInWithGoogle()
      .catch((err: Error) => {
        // Dismissing the popup isn't an error worth reporting
        if (err.message === 'popup_closed' || err.message === 'popup_closed_by_user') return
        /*
         * Google never reported back. In an installed iOS app that is not a
         * fault to apologise for, it is the expected outcome — the picker opens
         * in Safari, which cannot talk to the app it was launched from — and
         * the visitor needs the way round it, not "please try again".
         */
        /*
         * No special case for the installed app any more: it takes the redirect
         * above and never reaches here, so a message about it would be for a
         * situation that can no longer arise. A failed *redirect* is reported
         * on the way back in instead — see the effect below.
         */
        onError?.(
          err.message === SIGNIN_UNREACHABLE
            ? 'Sign-in did not complete — the Google window closed without answering.'
            : 'Could not sign in with Google — please try again'
        )
      })
      .finally(() => setBusy(false))
  }

  return (
    <button
      className={`google-btn${small ? ' sm' : ''}`}
      onClick={click}
      disabled={busy}
      aria-label="Sign in with Google"
    >
      <GoogleG size={small ? 15 : 18} />
      <span className="google-btn-label">{busy ? 'Signing in…' : 'Sign in with Google'}</span>
    </button>
  )
}
