import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PictureInPicture2 } from 'lucide-react'

/**
 * The site-wide floating mini player: a picture-in-picture slideshow of
 * whatever the page is showing — movie posters, cricket matches, reviews,
 * Adda posts. Each page hands it ready-made slides; slides with an `image`
 * render as a full-bleed poster, the rest as a text card.
 *
 * Two implementations behind one button:
 * - Document PiP (Chrome/Edge desktop): real DOM in the floating window, so a
 *   click on a slide opens its page on the site.
 * - Video PiP everywhere else (Android Chrome, Safari): slides drawn to a
 *   canvas streamed into a <video>. The window itself is not clickable — the
 *   browser's built-in "back to tab" control is the way home.
 * Browsers with neither API never see the button.
 */

export interface PipSlide {
  title: string
  /** Small gold all-caps eyebrow above the title ("1st T20I", "★ 4.2 / 5") */
  kicker?: string
  /** Gold supporting line (language · date · platform, verdict, author…) */
  sub?: string
  /** Dim body lines (scores, venue, review excerpt…) — card mode only */
  lines?: string[]
  /** Full-bleed image; when set the slide renders poster-style */
  image?: string | null
  /** Small round images shown above the title (team flags) — card mode only */
  badges?: string[]
  /** Site route a click on this slide opens */
  href: string
}

/** What the show is playing: the tab, and the week or source. */
export interface ReelContext {
  tab: string // "OTT India" | "Cricket" | "Reviews" | …
  detail: string // "This Week · 13 Jul – 19 Jul", "Fixtures", …
}

/** Offered on the end card: the adjacent weeks the show can move on to. */
export interface WeekJump {
  label: string // "This Week", "Last Week", "3 Weeks Ago", …
  dir: 'newer' | 'older'
  go: () => void
}

const hasDocPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window

function hasVideoPip(): boolean {
  if (typeof document === 'undefined') return false
  if (document.pictureInPictureEnabled) return true
  const v = document.createElement('video') as HTMLVideoElement & {
    webkitSupportsPresentationMode?: (mode: string) => boolean
  }
  return v.webkitSupportsPresentationMode?.('picture-in-picture') ?? false
}
const hasAnyPip = hasDocPip || hasVideoPip()

export const MAX_SLIDES = 40

/** Styles for the Document PiP window — self-contained, always house-dark. */
const PIP_CSS = `
  * { margin: 0; box-sizing: border-box; }
  body { background: #0d1017; color: #e8e6e1; font-family: system-ui, sans-serif;
         overflow: hidden; height: 100vh; }
  .reel { position: relative; width: 100%; height: 100%; cursor: pointer; }
  .reel > img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .meta { position: absolute; left: 0; right: 0; bottom: 0; padding: 44px 14px 12px;
          background: linear-gradient(transparent, rgba(5, 7, 11, 0.92)); }
  .meta .t { font-size: 17px; font-weight: 700; line-height: 1.25; }
  .meta .s { font-size: 12.5px; color: #d5b96b; margin-top: 4px; }
  .hint { font-size: 11px; color: #b9b5ac; margin-top: 6px; }
  .cardview { position: absolute; inset: 0; display: flex; flex-direction: column;
              justify-content: flex-start; gap: 9px; padding: 66px 16px 34px;
              background: radial-gradient(circle at 25% 0%, rgba(213, 185, 107, 0.14), transparent 60%),
                          #0d1017; }
  .cardview .badges { display: flex; gap: 12px; margin-bottom: 2px; }
  .cardview .badges img { width: 42px; height: 42px; border-radius: 50%;
                          object-fit: cover; border: 1px solid rgba(255, 255, 255, 0.3);
                          background: #1a1e28; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); }
  .cardview .c-k { font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
                   text-transform: uppercase; color: #d5b96b; }
  .cardview .c-t { font-size: 21px; font-weight: 800; line-height: 1.22;
                   font-family: Georgia, 'Times New Roman', serif; }
  .cardview .c-s { font-size: 13px; color: #e8cd82; line-height: 1.45; }
  .cardview .c-div { width: 40px; height: 2px; border-radius: 2px; margin: 4px 0;
                     background: rgba(213, 185, 107, 0.55); }
  .cardview .c-l { font-size: 12.5px; color: #b9b5ac; line-height: 1.6;
                   display: -webkit-box; -webkit-line-clamp: 9;
                   -webkit-box-orient: vertical; overflow: hidden; }
  .cardview .c-l > div + div { margin-top: 6px; }
  .cardview .hint { position: absolute; bottom: 12px; left: 18px; }
  .top { position: absolute; top: 0; left: 0; right: 0; z-index: 2; padding: 10px 12px 30px;
         background: linear-gradient(rgba(5, 7, 11, 0.88), rgba(5, 7, 11, 0)); }
  .top-row { display: flex; justify-content: space-between; align-items: center; }
  .brand { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #d5b96b; }
  .count { font-size: 11px; color: #b9b5ac; }
  .ctx { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
  .chip { font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
          background: rgba(213, 185, 107, 0.18); color: #e8cd82;
          border: 1px solid rgba(213, 185, 107, 0.4); }
  .chip.dim { background: rgba(5, 7, 11, 0.6); color: #cfccc4;
              border-color: rgba(255, 255, 255, 0.16); }
  .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 28px;
         height: 28px; border-radius: 50%; border: none; cursor: pointer; z-index: 3;
         display: flex; align-items: center; justify-content: center;
         background: rgba(5, 7, 11, 0.55); color: #e8e6e1; font-size: 18px;
         font-family: inherit; padding: 0 0 3px; }
  .nav:hover { background: rgba(5, 7, 11, 0.85); color: #d5b96b; }
  .nav.prev { left: 6px; }
  .nav.next { right: 6px; }
  .end { position: absolute; inset: 0; z-index: 4; display: none; flex-direction: column;
         align-items: center; justify-content: center; gap: 10px; padding: 20px;
         text-align: center; background: rgba(5, 7, 11, 0.84); cursor: default; }
  .end.show { display: flex; }
  .end .e-t { font-size: 14px; font-weight: 700; }
  .end .e-s { font-size: 12px; color: #b9b5ac; margin-bottom: 6px; }
  .end button { border: 1px solid rgba(213, 185, 107, 0.5); border-radius: 999px;
                background: rgba(213, 185, 107, 0.14); color: #e8cd82;
                font-size: 13px; font-family: inherit; padding: 8px 18px;
                cursor: pointer; }
  .end button:hover { background: rgba(213, 185, 107, 0.32); }
  .end .end-nav { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
                  margin-top: 2px; }
  .end .end-nav button { background: rgba(5, 7, 11, 0.6); color: #cfccc4;
                         border-color: rgba(255, 255, 255, 0.22); font-size: 12.5px;
                         padding: 7px 14px; }
  .end .end-nav button:hover { color: #e8cd82; border-color: rgba(213, 185, 107, 0.5); }
`

export default function PipShow({
  slides,
  context,
  rotateMs = 2500,
  weekJumps,
  noun = 'items',
}: {
  slides: PipSlide[]
  context: ReelContext
  /** Auto-advance pace; Reviews/Adda use 3000 so there is time to read */
  rotateMs?: number
  weekJumps?: WeekJump[]
  /** For the end card: "…· 12 films" / "matches" / "reviews" */
  noun?: string
}) {
  const navigate = useNavigate()
  const [active, setActive] = useState(false)
  /** Set when the browser turned PiP down, so the button can say so briefly. */
  const [unavailable, setUnavailable] = useState(false)
  const openingRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  // Latest props for the open PiP window (its closures outlive this render),
  // and a hook the window registers so a slides/context change re-skins it live
  const slidesRef = useRef<PipSlide[]>([])
  const contextRef = useRef(context)
  const weekJumpsRef = useRef(weekJumps)
  const pipUpdateRef = useRef<(() => void) | null>(null)

  // Whatever window is floating when the component goes away, take it down too
  useEffect(() => () => cleanupRef.current?.(), [])

  slidesRef.current = slides
  contextRef.current = context
  weekJumpsRef.current = weekJumps

  // When the page's data or context genuinely changes (new week loaded, tab
  // switched), restart the open slideshow on the new slides. Keyed on content,
  // not object identity — `context` is a fresh literal every render.
  const ctxKey = `${context.tab}|${context.detail}`
  useEffect(() => {
    pipUpdateRef.current?.()
  }, [slides, ctxKey])

  if (!hasAnyPip || slides.length === 0) return null

  async function openDocPip() {
    const pipWin: globalThis.Window = await (
      window as unknown as {
        documentPictureInPicture: {
          requestWindow: (opts: { width: number; height: number }) => Promise<globalThis.Window>
        }
      }
    ).documentPictureInPicture.requestWindow({ width: 200, height: 340 })

    let show = slidesRef.current
    const doc = pipWin.document
    doc.title = `WeekAdda · ${context.tab}`
    const style = doc.createElement('style')
    style.textContent = PIP_CSS
    doc.head.appendChild(style)
    const root = doc.createElement('div')
    root.className = 'reel'
    doc.body.appendChild(root)

    let timer: number | undefined
    const cleanup = () => {
      if (timer !== undefined) pipWin.clearInterval(timer)
      timer = undefined
      cleanupRef.current = null
      pipUpdateRef.current = null
      setActive(false)
      if (!pipWin.closed) pipWin.close()
    }
    cleanupRef.current = cleanup
    pipWin.addEventListener('pagehide', cleanup)
    setActive(true)

    // Poster mode: full-bleed image + bottom meta
    const img = doc.createElement('img')
    img.alt = ''
    const meta = doc.createElement('div')
    meta.className = 'meta'
    const title = doc.createElement('div')
    title.className = 't'
    const sub = doc.createElement('div')
    sub.className = 's'
    const hint = doc.createElement('div')
    hint.className = 'hint'
    hint.textContent = 'Click to open on WeekAdda'
    meta.append(title, sub, hint)

    // Card mode: badges + title + gold sub + dim lines on a dark card
    const card = doc.createElement('div')
    card.className = 'cardview'
    const cardBadges = doc.createElement('div')
    cardBadges.className = 'badges'
    const cardKicker = doc.createElement('div')
    cardKicker.className = 'c-k'
    const cardTitle = doc.createElement('div')
    cardTitle.className = 'c-t'
    const cardSub = doc.createElement('div')
    cardSub.className = 'c-s'
    const cardDivider = doc.createElement('div')
    cardDivider.className = 'c-div'
    const cardLines = doc.createElement('div')
    cardLines.className = 'c-l'
    const cardHint = doc.createElement('div')
    cardHint.className = 'hint'
    cardHint.textContent = 'Click to open on WeekAdda'
    card.append(cardBadges, cardKicker, cardTitle, cardSub, cardDivider, cardLines, cardHint)

    // Top bar: brand + counter, then chips naming the tab and week this
    // slideshow is showing — the window must make sense on its own
    const top = doc.createElement('div')
    top.className = 'top'
    const topRow = doc.createElement('div')
    topRow.className = 'top-row'
    const brand = doc.createElement('div')
    brand.className = 'brand'
    brand.textContent = 'WeekAdda'
    const count = doc.createElement('div')
    count.className = 'count'
    topRow.append(brand, count)
    const ctxRow = doc.createElement('div')
    ctxRow.className = 'ctx'
    const tabChip = doc.createElement('span')
    tabChip.className = 'chip'
    tabChip.textContent = context.tab
    const detailChip = doc.createElement('span')
    detailChip.className = 'chip dim'
    detailChip.textContent = context.detail
    ctxRow.append(tabChip, detailChip)
    top.append(topRow, ctxRow)
    root.append(img, card, top, meta)

    // End card: shown when the auto-advance has played every slide
    const end = doc.createElement('div')
    end.className = 'end'
    end.addEventListener('click', (e) => e.stopPropagation())

    let i = 0
    const render = () => {
      const s = show[i]
      if (s.image) {
        img.style.display = ''
        meta.style.display = ''
        card.style.display = 'none'
        img.src = s.image
        title.textContent = s.title
        sub.textContent = s.sub ?? ''
      } else {
        img.style.display = 'none'
        meta.style.display = 'none'
        card.style.display = 'flex'
        cardBadges.innerHTML = ''
        for (const b of s.badges ?? []) {
          const bi = doc.createElement('img')
          bi.src = new URL(b, window.location.origin).href
          bi.alt = ''
          cardBadges.appendChild(bi)
        }
        cardBadges.style.display = s.badges?.length ? 'flex' : 'none'
        cardKicker.textContent = s.kicker ?? ''
        cardKicker.style.display = s.kicker ? '' : 'none'
        cardTitle.textContent = s.title
        cardSub.textContent = s.sub ?? ''
        cardSub.style.display = s.sub ? '' : 'none'
        cardDivider.style.display = s.lines?.length ? '' : 'none'
        cardLines.innerHTML = ''
        for (const line of s.lines ?? []) {
          const p = doc.createElement('div')
          p.textContent = line
          cardLines.appendChild(p)
        }
      }
      count.textContent = `${i + 1} / ${show.length}`
      const next = show[(i + 1) % show.length]
      if (next.image) new Image().src = next.image
    }
    const showEnd = () => {
      if (timer !== undefined) pipWin.clearInterval(timer)
      timer = undefined
      end.innerHTML = ''
      const t = doc.createElement('div')
      t.className = 'e-t'
      t.textContent = 'That’s a wrap 🎬'
      const s = doc.createElement('div')
      s.className = 'e-s'
      const ctx = contextRef.current
      s.textContent = `${ctx.tab} · ${ctx.detail} · ${show.length} ${noun}`
      end.append(t, s)
      const again = doc.createElement('button')
      again.textContent = '↻ Play again'
      again.addEventListener('click', () => {
        i = 0
        render()
        end.classList.remove('show')
        startTimer()
      })
      end.appendChild(again)
      // Week jumps sit in a row laid out like the page's own week pager:
      // older to the left (‹), newer to the right (›) — time flows rightward
      const jumps = [...(weekJumpsRef.current ?? [])].sort((a) => (a.dir === 'older' ? -1 : 1))
      if (jumps.length) {
        const row = doc.createElement('div')
        row.className = 'end-nav'
        for (const jump of jumps) {
          const btn = doc.createElement('button')
          btn.textContent = jump.dir === 'newer' ? `${jump.label} ›` : `‹ ${jump.label}`
          btn.addEventListener('click', () => {
            // Moves the page itself to that week; the slides prop changes when
            // it loads and the update hook below restarts the show on it
            end.innerHTML = ''
            const wait = doc.createElement('div')
            wait.className = 'e-s'
            wait.textContent = `Loading ${jump.label}…`
            end.appendChild(wait)
            jump.go()
          })
          row.appendChild(btn)
        }
        end.appendChild(row)
      }
      end.classList.add('show')
    }
    const startTimer = () => {
      if (timer !== undefined) pipWin.clearInterval(timer)
      timer = pipWin.setInterval(() => {
        // The loop is done once the last slide has had its full turn —
        // stop and ask, rather than silently starting over
        if (i >= show.length - 1) showEnd()
        else {
          i += 1
          render()
        }
      }, rotateMs)
    }
    // Manual arrows; a step also restarts the auto-advance clock, so the slide
    // someone chose is not swapped out from under them a beat later
    const step = (delta: number) => {
      i = (i + delta + show.length) % show.length
      render()
      startTimer()
    }
    for (const [cls, glyph, delta] of [
      ['prev', '‹', -1],
      ['next', '›', 1],
    ] as const) {
      const btn = doc.createElement('button')
      btn.className = `nav ${cls}`
      btn.textContent = glyph
      btn.title = delta < 0 ? 'Previous' : 'Next'
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        step(delta)
      })
      root.appendChild(btn)
    }
    root.appendChild(end)

    // The page moved to another week/tab (possibly via the end card): restart
    // the show on whatever it now displays, and re-label the header to match
    pipUpdateRef.current = () => {
      if (pipWin.closed) return
      show = slidesRef.current
      const ctx = contextRef.current
      doc.title = `WeekAdda · ${ctx.tab}`
      tabChip.textContent = ctx.tab
      detailChip.textContent = ctx.detail
      end.classList.remove('show')
      if (show.length === 0) {
        if (timer !== undefined) pipWin.clearInterval(timer)
        timer = undefined
        end.innerHTML = ''
        const empty = doc.createElement('div')
        empty.className = 'e-s'
        empty.textContent = `Nothing to show in ${ctx.tab} · ${ctx.detail}`
        end.appendChild(empty)
        end.classList.add('show')
        return
      }
      i = 0
      render()
      startTimer()
    }

    render()
    startTimer()

    root.addEventListener('click', () => {
      const s = show[i]
      if (!s) return
      // Say so in the floating window: the click landed, the tab is moving.
      // Without this the only feedback is the window vanishing.
      hint.textContent = `Opening ${s.title}…`
      cardHint.textContent = `Opening ${s.title}…`
      // Route the tab BEFORE taking the window down — tearing down the PiP
      // document mid-click must never race the navigation that click asked for
      navigate(s.href)
      try {
        window.focus()
      } catch {
        // best effort — the browser may keep focus where it is
      }
      // Closing hands focus back to the opener tab, now on the film's page
      cleanup()
    })
  }

  async function openVideoPip() {
    const show = slidesRef.current
    const canvas = document.createElement('canvas')
    canvas.width = 360
    canvas.height = 600
    const ctx = canvas.getContext('2d')
    // Throw rather than return: everything in here reports failure through the
    // caller, and a bare `return` was one of two ways this could give up
    // without saying anything at all
    if (!ctx) throw new Error('no 2d context')

    const paintMessage = (text: string) => {
      ctx.fillStyle = '#0d1017'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#b9b5ac'
      ctx.font = '22px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)
      ctx.textAlign = 'left'
    }
    paintMessage('WeekAdda')

    /*
     * The other silent way out. Safari has been late and patchy on
     * HTMLCanvasElement.captureStream, and calling a method that is not there
     * throws a TypeError from this line — above the try below, so it sailed
     * past every piece of reporting and reached the caller as nothing at all.
     * That is the shape of "the button does nothing": not a refusal, an
     * exception thrown before anything was watching.
     */
    if (typeof canvas.captureStream !== 'function') {
      throw new Error('canvas.captureStream is unavailable')
    }
    const stream = canvas.captureStream()
    const video = document.createElement('video') as HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: string) => void
      webkitPresentationMode?: string
    }
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    Object.assign(video.style, {
      position: 'fixed',
      bottom: '0',
      right: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.appendChild(video)

    let timer: number | undefined
    const cleanup = () => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
      cleanupRef.current = null
      setActive(false)
      stream.getTracks().forEach((t) => t.stop())
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('previoustrack', null)
          navigator.mediaSession.setActionHandler('nexttrack', null)
        } catch {
          // same browsers that could not set them
        }
        navigator.mediaSession.metadata = null
      }
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture().catch(() => {})
      }
      if (video.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode?.('inline')
      }
      video.remove()
    }

    /*
     * The two APIs want opposite things, so they no longer share a path.
     *
     * Chromium's requestPictureInPicture() rejects on a video with no metadata,
     * so it has to wait for some. WebKit's webkitSetPresentationMode() must be
     * called inside the click that asked for it, and `await video.play()` spends
     * that gesture — after which Safari refuses, silently. Sharing one sequence
     * meant whichever browser was second in the `if` got the wrong one, and on
     * an iPad that read as a button that does nothing at all.
     *
     * WebKit also reports refusal by doing nothing rather than by throwing, so
     * entering is confirmed rather than assumed; a mini player that never opened
     * must not leave the button saying "Close mini player".
     */
    const webkitPip =
      !video.requestPictureInPicture && typeof video.webkitSetPresentationMode === 'function'
    try {
      if (webkitPip) {
        // Deliberately not awaited: playback can catch up, the gesture cannot
        video.play().catch(() => {})
        video.webkitSetPresentationMode!('picture-in-picture')
        const entered = await new Promise<boolean>((resolve) => {
          const settle = () => {
            if (video.webkitPresentationMode === 'picture-in-picture') {
              video.removeEventListener('webkitpresentationmodechanged', settle)
              window.clearTimeout(timeout)
              resolve(true)
            }
          }
          const timeout = window.setTimeout(() => {
            video.removeEventListener('webkitpresentationmodechanged', settle)
            resolve(video.webkitPresentationMode === 'picture-in-picture')
          }, 1500)
          video.addEventListener('webkitpresentationmodechanged', settle)
        })
        if (!entered) throw new Error('picture-in-picture refused')
      } else if (video.requestPictureInPicture) {
        await video.play()
        if (video.readyState < 1) {
          await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }))
        }
        await video.requestPictureInPicture()
      } else {
        throw new Error('no PiP')
      }
    } catch (err) {
      // Tear the video down, then let the caller do the telling — there is one
      // place that reports, so there is no path that can forget to
      cleanup()
      throw err
    }
    cleanupRef.current = cleanup
    setActive(true)
    video.addEventListener('leavepictureinpicture', cleanup)
    video.addEventListener('webkitpresentationmodechanged', () => {
      if (video.webkitPresentationMode === 'inline') cleanup()
    })

    // Word-wrap helper for card text; ellipsises the last permitted line
    const wrap = (text: string, maxW: number, maxLines: number): string[] => {
      const words = text.split(/\s+/)
      const lines: string[] = []
      let cur = ''
      for (const w of words) {
        const attempt = cur ? `${cur} ${w}` : w
        if (ctx.measureText(attempt).width <= maxW) {
          cur = attempt
        } else {
          if (cur) lines.push(cur)
          cur = w
          if (lines.length === maxLines) break
        }
      }
      if (cur && lines.length < maxLines) lines.push(cur)
      if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
        lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`
      }
      return lines
    }

    // Brand, counter and context pill along the top of every frame
    const drawChrome = (index: number) => {
      const cw = canvas.width
      const tg = ctx.createLinearGradient(0, 0, 0, 118)
      tg.addColorStop(0, 'rgba(5,7,11,0.88)')
      tg.addColorStop(1, 'rgba(5,7,11,0)')
      ctx.fillStyle = tg
      ctx.fillRect(0, 0, cw, 118)
      ctx.fillStyle = '#d5b96b'
      ctx.font = '700 16px system-ui, sans-serif'
      ctx.fillText('WeekAdda', 16, 30)
      ctx.fillStyle = '#b9b5ac'
      ctx.font = '16px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${index + 1} / ${show.length}`, cw - 16, 30)
      ctx.textAlign = 'left'
      const c = contextRef.current
      const label = `${c.tab} · ${c.detail}`
      ctx.font = '600 15px system-ui, sans-serif'
      const pillW = Math.min(ctx.measureText(label).width + 24, cw - 32)
      ctx.fillStyle = 'rgba(5,7,11,0.65)'
      ctx.strokeStyle = 'rgba(213,185,107,0.45)'
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(16, 44, pillW, 28, 14)
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillRect(16, 44, pillW, 28)
      }
      ctx.fillStyle = '#e8cd82'
      ctx.fillText(label, 28, 63, cw - 56)
    }

    const drawPoster = (s: PipSlide, image: HTMLImageElement, index: number) => {
      const cw = canvas.width
      const ch = canvas.height
      ctx.fillStyle = '#0d1017'
      ctx.fillRect(0, 0, cw, ch)
      // cover-fit the poster
      const scale = Math.max(cw / image.width, ch / image.height)
      const w = image.width * scale
      const h = image.height * scale
      ctx.drawImage(image, (cw - w) / 2, (ch - h) / 2, w, h)
      // bottom gradient + text
      const grad = ctx.createLinearGradient(0, ch - 170, 0, ch)
      grad.addColorStop(0, 'rgba(5,7,11,0)')
      grad.addColorStop(1, 'rgba(5,7,11,0.95)')
      ctx.fillStyle = grad
      ctx.fillRect(0, ch - 170, cw, 170)
      ctx.fillStyle = '#e8e6e1'
      ctx.font = '700 24px system-ui, sans-serif'
      let name = s.title
      while (name.length > 3 && ctx.measureText(name).width > cw - 32) {
        name = name.slice(0, -2)
      }
      ctx.fillText(name === s.title ? name : `${name}…`, 16, ch - 52)
      ctx.fillStyle = '#d5b96b'
      ctx.font = '17px system-ui, sans-serif'
      ctx.fillText(s.sub ?? '', 16, ch - 26)
      drawChrome(index)
    }

    const drawCard = (s: PipSlide, index: number, badgeImgs: HTMLImageElement[] = []) => {
      const cw = canvas.width
      const ch = canvas.height
      ctx.fillStyle = '#0d1017'
      ctx.fillRect(0, 0, cw, ch)
      const glow = ctx.createRadialGradient(cw * 0.25, 0, 0, cw * 0.25, 0, ch * 0.7)
      glow.addColorStop(0, 'rgba(213,185,107,0.14)')
      glow.addColorStop(1, 'rgba(213,185,107,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, cw, ch)
      // Top-anchored: content starts right under the header chrome, with the
      // heading big — empty space belongs at the bottom, not around a blob
      // floating in the middle
      let y = 128
      if (badgeImgs.length) {
        let x = 20
        for (const im of badgeImgs) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(x + 22, y - 8 + 22, 22, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(im, x, y - 8, 44, 44)
          ctx.restore()
          ctx.beginPath()
          ctx.arc(x + 22, y - 8 + 22, 22, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'
          ctx.stroke()
          x += 56
        }
        y += 60
      }
      if (s.kicker) {
        ctx.fillStyle = '#d5b96b'
        ctx.font = '700 15px system-ui, sans-serif'
        for (const line of wrap(s.kicker.toUpperCase(), cw - 40, 2)) {
          ctx.fillText(line, 20, y)
          y += 22
        }
        y += 8
      }
      ctx.fillStyle = '#e8e6e1'
      ctx.font = '800 30px Georgia, serif'
      for (const line of wrap(s.title, cw - 40, 3)) {
        ctx.fillText(line, 20, y)
        y += 38
      }
      y += 2
      if (s.sub) {
        ctx.fillStyle = '#e8cd82'
        ctx.font = '18px system-ui, sans-serif'
        for (const line of wrap(s.sub, cw - 40, 2)) {
          ctx.fillText(line, 20, y)
          y += 26
        }
      }
      if (s.lines?.length) {
        ctx.fillStyle = 'rgba(213,185,107,0.55)'
        ctx.fillRect(20, y - 6, 50, 3)
        y += 18
      }
      ctx.fillStyle = '#b9b5ac'
      ctx.font = '16px system-ui, sans-serif'
      for (const bodyLine of s.lines ?? []) {
        for (const line of wrap(bodyLine, cw - 40, 5)) {
          if (y > ch - 56) break
          ctx.fillText(line, 20, y)
          y += 24
        }
        y += 6
      }
      ctx.fillStyle = '#b9b5ac'
      ctx.font = '13px system-ui, sans-serif'
      ctx.fillText('weekadda.com', 20, ch - 24)
      drawChrome(index)
    }

    let i = 0
    const render = () => {
      const s = show[i]
      const at = i
      if (s.image) {
        const image = new Image()
        image.crossOrigin = 'anonymous' // a tainted canvas would kill the stream
        image.onload = () => {
          if (at === i) drawPoster(s, image, at)
        }
        image.onerror = () => {
          if (at === i) drawCard(s, at)
        }
        // The page shows the same posters as plain <img>, so the browser may
        // hold a non-CORS cached copy that a crossOrigin request then trips
        // over — a marker param makes this a distinct, CORS-clean fetch
        image.src = `${s.image}${s.image.includes('?') ? '&' : '?'}pip=1`
      } else {
        // Text first, then the badges (team flags) pop in as they load
        drawCard(s, at)
        const wanted = (s.badges ?? []).slice(0, 2)
        const loaded: HTMLImageElement[] = []
        for (const src of wanted) {
          const im = new Image()
          im.crossOrigin = 'anonymous'
          im.onload = () => {
            loaded.push(im)
            if (at === i) drawCard(s, at, loaded)
          }
          im.src = new URL(src, window.location.origin).href
        }
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: s.title,
          artist: s.sub ?? s.lines?.[0] ?? '',
          album: `WeekAdda · ${context.tab} · ${context.detail}`,
          artwork: s.image ? [{ src: s.image }] : [],
        })
      }
    }
    const startTimer = () => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = window.setInterval(() => {
        i = (i + 1) % show.length
        render()
      }, rotateMs)
    }
    const step = (delta: number) => {
      i = (i + delta + show.length) % show.length
      render()
      startTimer()
    }
    // The video PiP surface takes no custom buttons, but the media-session
    // handlers put the browser's own ⏮ ⏭ controls on the floating window
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('previoustrack', () => step(-1))
        navigator.mediaSession.setActionHandler('nexttrack', () => step(1))
      } catch {
        // an older browser that knows mediaSession but not these actions
      }
    }
    render()
    startTimer()
  }

  async function toggle() {
    if (cleanupRef.current) {
      cleanupRef.current()
      return
    }
    if (openingRef.current) return
    openingRef.current = true
    try {
      if (hasDocPip) await openDocPip()
      else await openVideoPip()
    } catch {
      // The single place a failure is reported, whatever went wrong and however
      // early. A button that does nothing at all is the one outcome that leaves
      // someone tapping it twice and concluding the site is broken.
      setActive(false)
      setUnavailable(true)
      window.setTimeout(() => setUnavailable(false), 4000)
    } finally {
      openingRef.current = false
    }
  }

  return (
    <button
      className="reel-btn"
      onClick={toggle}
      title={
        unavailable
          ? 'This browser turned the floating window down'
          : "What's on this page plays one by one in a small floating window — click anything there to open it"
      }
    >
      <span className="reel-ico">
        <PictureInPicture2 size={15} />
      </span>
      <span className="reel-label">
        {unavailable ? 'Not supported here' : active ? 'Close mini player' : 'Mini player'}
      </span>
    </button>
  )
}
