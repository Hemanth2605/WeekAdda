import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { usePageMeta } from '../seo'

/** Plain-language privacy policy — what WeekAdda collects, why, who sees it. */
export default function Privacy() {
  usePageMeta(
    'Privacy Policy | WeekAdda',
    'What WeekAdda collects, why, and who can see it — in plain language. Browsing needs no account; Google sign-in is used only for posting, rating and the Adda.'
  )

  return (
    <main className="movie-page about-page">
      <Link className="movie-back" to="/movies">
        <ArrowLeft size={15} /> Back to releases
      </Link>
      <div className="about-card privacy-card">
        <span className="hero-eyebrow">
          <ShieldCheck size={13} /> Privacy policy
        </span>
        <h1>Your data on WeekAdda, in plain language</h1>
        <p className="privacy-updated">Effective 25 July 2026</p>

        <h2>Browsing needs nothing</h2>
        <p>
          You can read everything on WeekAdda — movies, OTT arrivals, cricket, reviews, the Adda
          — without an account. We don&apos;t use tracking cookies or ad trackers. To count
          visitors, your browser stores one random id (a meaningless string) in its own local
          storage; it contains nothing about you and you can clear it anytime from your browser
          settings.
        </p>

        <h2>What Google sign-in shares with us</h2>
        <p>
          Signing in with Google is needed only to publish a review, rate one, or post /
          respond on the Adda. Google shares your <b>name, email address and profile photo</b> —
          nothing else. We verify every action with Google directly, and we never see your
          password.
        </p>

        <h2>What we store, and why</h2>
        <ul>
          <li>
            <b>Reviews &amp; ratings</b> — stored with your email so reviews are accountable and
            each account rates once. Readers see only your chosen display name, never your email.
          </li>
          <li>
            <b>Adda listings &amp; responses</b> — stored with your email; a WhatsApp number is
            stored only if you choose to add one.
          </li>
          <li>
            <b>Outbound clicks</b> (Watch / Book buttons) — recorded with the title, time and the
            anonymous visitor id, plus your email if you were signed in. Used only for aggregate
            statistics like unique visitors and popular titles.
          </li>
        </ul>

        <h2>Who can see your details</h2>
        <p>
          Your email is <b>never shown publicly</b> anywhere on the site or its APIs. The single
          deliberate exception is the Adda: when you click &quot;I&apos;m interested&quot; on a
          listing, your name and email are shared with that poster, and theirs with you — that
          mutual introduction is the feature&apos;s whole purpose, and it happens only between
          the two of you. WhatsApp numbers are shown the same way, and only if the poster added
          one. We never sell or share data with advertisers.
        </p>

        <h2>Where it lives</h2>
        <p>
          Data is stored in Supabase (database) and served via Cloudflare. Google handles
          sign-in. Movie and cricket information comes from public sources (TMDB, ESPN) — no
          personal data of yours is ever sent to them.
        </p>

        <h2>Your choices</h2>
        <p>
          Sign out anytime from the navbar. Adda listings leave the board when you close them or
          after 30 days. To have a post, rating, listing or your account data removed, contact
          the maintainer via the <Link to="/about">About page</Link> and it will be deleted.
        </p>

        <p className="privacy-note">
          If this policy changes, the update appears on this page with a new effective date.
        </p>
      </div>
    </main>
  )
}
