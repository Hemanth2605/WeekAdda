import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { completeRedirectSignIn } from './auth'
import './index.css'

const mount = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )

/*
 * A sign-in return is settled before anything mounts.
 *
 * Two reasons it cannot wait for the router. /auth/google is not a page — the
 * app would render it as one, and the visitor would watch a blank route while
 * the token was still in flight. And the first screen decides what to show
 * based on whether anyone is signed in; arriving with that answer after the
 * fact means rendering signed-out and correcting itself.
 *
 * Returns null immediately on every other URL, so this costs a microtask on a
 * normal load. A failure still mounts: the site works signed out.
 */
completeRedirectSignIn()
  .then((back) => {
    if (back) window.history.replaceState(null, '', back)
  })
  .catch(() => {})
  .finally(mount)
