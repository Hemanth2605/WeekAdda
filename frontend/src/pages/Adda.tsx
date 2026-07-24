import { useEffect, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  HandHeart,
  Mail,
  MessageCircle,
  PenLine,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { api } from '../api'
import { authEnabled, refreshUser, signInWithGoogle, signOut, useGoogleUser } from '../auth'
import GoogleButton from '../components/GoogleButton'
import { usePageMeta } from '../seo'

interface ListingContact {
  name: string
  email: string
  whatsapp?: string
}

interface Listing {
  id: string
  ts: string
  author: string
  title: string
  details: string
  status: 'open' | 'closed'
  interestCount: number
  mine?: boolean
  interests?: Array<{ name: string; email: string; ts: string }>
  contact?: ListingContact
}

function timeAgo(ts: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function ContactPanel({ contact }: { contact: ListingContact }) {
  return (
    <div className="adda-contact">
      <ShieldCheck size={14} />
      <span>
        Contact <b>{contact.name}</b>:
      </span>
      <a href={`mailto:${contact.email}`}>
        <Mail size={13} /> {contact.email}
      </a>
      {contact.whatsapp && (
        <a
          href={`https://wa.me/${contact.whatsapp.replace(/^\+/, '')}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={13} /> WhatsApp
        </a>
      )}
    </div>
  )
}

function ListingCard({
  listing,
  index,
  onChanged,
}: {
  listing: Listing
  index: number
  onChanged: (l: Listing) => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [showInterests, setShowInterests] = useState(false)

  const respond = async () => {
    if (busy) return
    setBusy(true)
    setNote('')
    try {
      let token = refreshUser()?.token
      if (!token) token = (await signInWithGoogle()).token
      const res = await api<{ contact: ListingContact }>(`/adda/${listing.id}/interest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      onChanged({ ...listing, contact: res.contact, interestCount: listing.interestCount + (listing.contact ? 0 : 1) })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message !== 'popup_closed' && message !== 'popup_closed_by_user') {
        setNote(message || 'Could not respond — please try again')
      }
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    if (busy) return
    setBusy(true)
    try {
      const token = refreshUser()?.token
      if (!token) return
      await api(`/adda/${listing.id}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      onChanged({ ...listing, status: 'closed' })
    } catch {
      setNote('Could not close the listing — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="blog-card adda-card" style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}>
      <div className="blog-card-meta">
        <h2>{listing.title}</h2>
        <span className="blog-card-byline">
          {listing.author} {listing.mine && <span className="blog-you">You</span>} ·{' '}
          <CalendarDays size={12} /> {timeAgo(listing.ts)} · <Users size={12} />{' '}
          {listing.interestCount} interested
        </span>
      </div>
      <div className="blog-card-body">
        {listing.details.split(/\n+/).filter((p) => p.trim()).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="adda-card-foot">
        {listing.mine ? (
          <>
            <button
              className="genre-chip"
              onClick={() => setShowInterests((s) => !s)}
              disabled={(listing.interests?.length ?? 0) === 0}
            >
              {showInterests ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {listing.interests?.length
                ? `${listing.interests.length} responded — see who`
                : 'No responses yet'}
            </button>
            <button className="genre-chip adda-close" onClick={close} disabled={busy}>
              <X size={13} /> Mark as done
            </button>
          </>
        ) : listing.contact ? (
          <ContactPanel contact={listing.contact} />
        ) : (
          <span className="adda-respond">
            <button className="share-wa sm" onClick={respond} disabled={busy}>
              <HandHeart size={14} /> {busy ? 'One sec…' : "I'm interested"}
            </button>
            <small>Responding shares your name &amp; Gmail with the poster</small>
          </span>
        )}
      </div>
      {listing.mine && showInterests && listing.interests && listing.interests.length > 0 && (
        <ul className="adda-interest-list">
          {listing.interests.map((i) => (
            <li key={i.email}>
              <b>{i.name}</b>
              <a href={`mailto:${i.email}`}>
                <Mail size={12} /> {i.email}
              </a>
              <span>{timeAgo(i.ts)}</span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="post-rating-note">{note}</p>}
    </article>
  )
}

function AddaComposer({
  open,
  onClose,
  onPosted,
}: {
  open: boolean
  onClose: () => void
  onPosted: (l: Listing) => void
}) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [author, setAuthor] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const user = useGoogleUser()

  useEffect(() => {
    if (user) setAuthor((prev) => prev || user.name.slice(0, 40))
  }, [user])

  const post = () => {
    if (sending) return
    if (!title.trim()) return setError('Give your post a short title')
    if (details.trim().length < 10) return setError('Add a few words of detail')
    const token = refreshUser()?.token
    if (!token) return setError('Please sign in with Google to post')
    setError('')
    setSending(true)
    api<Listing>('/adda', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: title.trim(),
        details: details.trim(),
        author: author.trim(),
        whatsapp: whatsapp.trim(),
      }),
    })
      .then((listing) => {
        onPosted(listing)
        onClose()
        setTitle('')
        setDetails('')
        setWhatsapp('')
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes('sign in')) signOut()
        setError(err.message || 'Could not post right now — please try again')
      })
      .finally(() => setSending(false))
  }

  if (!open) return null

  return (
    <section className="blog-composer">
      <div className="blog-composer-head">
        <h2>
          <HandHeart size={17} /> Your post
        </h2>
        <button className="share-close" onClick={onClose} aria-label="Close composer">
          <X size={16} />
        </button>
      </div>
      <input
        className="blog-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder="Title — e.g. “Extra ticket for Saturday's show (face value)”"
      />
      <textarea
        className="blog-textarea"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder="The details — what, when, where, and anything a responder should know…"
      />
      <div className="blog-composer-foot adda-composer-foot">
        <input
          className="blog-input author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={40}
          placeholder="Display name"
        />
        <input
          className="blog-input author"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          maxLength={16}
          placeholder="WhatsApp (optional — your wish)"
        />
        {authEnabled && !user ? (
          <GoogleButton onError={setError} />
        ) : (
          <button className="share-wa sm" onClick={post} disabled={sending}>
            <Send size={14} /> {sending ? 'Posting…' : 'Post'}
          </button>
        )}
      </div>
      <p className="blog-signin-hint">
        Your Gmail is shared only with people who respond to your post (and theirs with you).
        WhatsApp is shown only if you add it.
      </p>
      {error && <p className="blog-error">{error}</p>}
    </section>
  )
}

export default function Adda() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const user = useGoogleUser()

  usePageMeta(
    'The Adda — Ask, Offer & Find Company | WeekAdda',
    'A community board for movie and cricket fans in India: spare tickets at face value, company for a show or match, honest asks. Free to read; respond with a Google sign-in.'
  )

  useEffect(() => {
    const token = user ? refreshUser()?.token : undefined
    api<{ listings: Listing[] }>('/adda', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((r) => setListings(r.listings))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  const visible = listings.filter((l) => l.status === 'open')

  return (
    <main>
      <section className="community-hero">
        <div className="community-hero-text">
          <span className="hero-eyebrow">
            <HandHeart size={13} /> The community board
          </span>
          <h1>The Adda</h1>
          <p>
            Ask, offer, find company — a spare ticket at face value, a movie plan that needs one
            more person, a question for fellow fans. Everyone can read; responding takes a Google
            sign-in, and contact details are shared only between the two of you.
          </p>
        </div>
        {!composerOpen && (
          <button className="community-cta" onClick={() => setComposerOpen(true)}>
            <PenLine size={18} /> Post to the adda
          </button>
        )}
      </section>

      <div className="blog-wrap">
        <AddaComposer
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onPosted={(l) => setListings((prev) => [l, ...prev])}
        />

        <p className="adda-rules">
          <ShieldCheck size={14} /> House rules: nothing illegal or against any service&apos;s
          terms — no account/subscription sharing, tickets at face value only. WeekAdda only
          connects people; verify before paying anyone.
        </p>

        {loading ? (
          <div className="blog-feed">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk blog-card-sk" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <HandHeart size={54} />
            <h3>The adda is quiet</h3>
            <p>Be the first — post a question, an offer, or a plan that needs company.</p>
          </div>
        ) : (
          <div className="blog-feed">
            {visible.map((listing, i) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                index={i}
                onChanged={(updated) =>
                  setListings((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
                }
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
