import { useEffect, useState } from 'react'
import { Check, Copy, Instagram, MessageCircle, Send, Twitter, X } from 'lucide-react'
import { trackClick } from '../api'
import { SHARE_EVENT, SharePayload } from '../share'

/**
 * Desktop fallback for sharing: phones use the OS share sheet (see share.ts),
 * everything else gets this chooser. Mounted once in App; opened via SHARE_EVENT.
 */
export default function ShareSheet() {
  const [payload, setPayload] = useState<SharePayload | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onShare = (e: Event) => {
      setCopied(false)
      setPayload((e as CustomEvent<SharePayload>).detail)
    }
    window.addEventListener(SHARE_EVENT, onShare)
    return () => window.removeEventListener(SHARE_EVENT, onShare)
  }, [])

  useEffect(() => {
    if (!payload) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPayload(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [payload])

  if (!payload) return null

  const track = (platform: string) =>
    trackClick({
      kind: 'share',
      platform,
      titleId: payload.titleId,
      title: payload.title,
      language: payload.language,
    })

  const openApp = (platform: string, href: string) => {
    track(platform)
    window.open(href, '_blank', 'noopener,noreferrer')
    setPayload(null)
  }

  const fullText = `${payload.body}\n${payload.url}`

  const copy = () => {
    navigator.clipboard
      .writeText(fullText)
      .then(() => {
        track('Copy')
        setCopied(true)
        setTimeout(() => setPayload(null), 900)
      })
      .catch(() => {})
  }

  return (
    <div className="share-overlay" onClick={() => setPayload(null)}>
      <div className="share-sheet" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <div className="share-sheet-head">
          <h3>Share via</h3>
          <button className="share-close" onClick={() => setPayload(null)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="share-options">
          <button
            className="share-opt wa"
            onClick={() => openApp('WhatsApp', `https://wa.me/?text=${encodeURIComponent(fullText)}`)}
          >
            <MessageCircle size={22} />
            WhatsApp
          </button>
          <button
            className="share-opt tg"
            onClick={() =>
              openApp(
                'Telegram',
                `https://t.me/share/url?url=${encodeURIComponent(payload.url)}&text=${encodeURIComponent(payload.body)}`
              )
            }
          >
            <Send size={22} />
            Telegram
          </button>
          <button
            className="share-opt tw"
            onClick={() =>
              openApp(
                'X',
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(payload.body.replace(/\*/g, ''))}&url=${encodeURIComponent(payload.url)}`
              )
            }
          >
            <Twitter size={22} />X
          </button>
          <button
            className="share-opt ig"
            onClick={() => {
              // Instagram has no web share endpoint — copy the message first,
              // then open the DM composer for pasting
              navigator.clipboard.writeText(fullText).catch(() => {})
              openApp('Instagram', 'https://www.instagram.com/direct/new/')
            }}
          >
            <Instagram size={22} />
            Instagram
          </button>
          <button className="share-opt cp" onClick={copy}>
            {copied ? <Check size={22} /> : <Copy size={22} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="share-note">Instagram copies the message for you — just paste it in a DM or story.</p>
      </div>
    </div>
  )
}
