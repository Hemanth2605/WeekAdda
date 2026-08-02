/*
 * Finds responsive rules that never apply.
 *
 * A media query carries no specificity of its own, so a rule inside one loses
 * to any same-specificity rule that comes later — and is wrong only at widths
 * nobody develops at. There are two ways to lose, and this checks both:
 *
 *   1. to a LATER BASE RULE. `@media (max-width:720px) { .x { padding-left:
 *      20px } }` loses to a plain `.x { padding: … 42px … }` written further
 *      down. Bit .log-ticket-stub, .blog-wrap, .spotlight-head and
 *      .blog-input.author, where it was a live bug at phone widths.
 *
 *   2. to a LATER, BROADER MEDIA BLOCK. `@media (max-width:560px)` declared
 *      above `@media (max-width:1024px)` both match on a phone, and the 1024
 *      one wins. Bit the navbar and the floating buttons — there the newer
 *      1024px rules were the correct ones, so nothing looked wrong; the older
 *      phone rules were simply dead, claiming a layout that never happens.
 *
 * It reads the BUILT stylesheet on purpose. Source order is not the truth:
 * these files are concatenated and minified, and in every case so far the
 * source looked perfectly reasonable. Run `npm run build` first.
 *
 * Two things stop it crying wolf:
 *   - a rule that sets the SAME value changes nothing, so it is ignored (this
 *     is why .theme-toggle, which restates 36px/36px/12px, is silent, and why
 *     the navbar's identical `gap` was never reported);
 *   - shorthands are expanded, because `padding:` silently wipes an earlier
 *     `padding-left:` and comparing property names alone finds nothing.
 *
 * A finding is not always a bug — sometimes, as with the navbar, the later
 * rule is right and the earlier one should simply go. Either way the loser is
 * dead code that lies about what the page does.
 *
 * Exits 1 when it finds something, so it can gate a build.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')

/** Longhands each shorthand resets — enough of them to cover what we write. */
const SHORTHAND = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  font: ['font-size', 'font-family', 'font-weight', 'font-style', 'line-height'],
  background: ['background-color', 'background-image', 'background-position', 'background-size'],
  border: ['border-width', 'border-style', 'border-color'],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
  ],
  'grid-template': ['grid-template-columns', 'grid-template-rows', 'grid-template-areas'],
  'place-items': ['align-items', 'justify-items'],
  transition: ['transition-property', 'transition-duration'],
}
const COVERED_BY = {}
for (const [short, longs] of Object.entries(SHORTHAND)) {
  for (const l of longs) (COVERED_BY[l] ||= []).push(short)
}

function findStylesheet() {
  if (!fs.existsSync(DIST)) return null
  const css = fs.readdirSync(DIST).filter((f) => f.endsWith('.css'))
  if (css.length === 0) return null
  // Largest, in case a page ever ships its own small sheet
  return css
    .map((f) => path.join(DIST, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
}

/** `a:1;b:2` -> Map(a->1, b->2); a repeat inside one rule keeps the last. */
function declarations(body) {
  const out = new Map()
  for (const part of body.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    if (!/^[a-z-]+$/.test(prop)) continue // skips `--custom` and junk
    out.set(prop, part.slice(i + 1).trim().replace(/\s+/g, ' '))
  }
  return out
}

/** Every rule inside a media block, as selector -> declarations (last wins). */
function rulesIn(body) {
  const out = new Map()
  const r = /([^{}]+)\{([^{}]*)\}/g
  let x
  while ((x = r.exec(body))) {
    for (const sel of x[1].split(',')) {
      const s = sel.trim()
      if (!s) continue
      out.set(s, new Map([...(out.get(s) ?? []), ...declarations(x[2])]))
    }
  }
  return out
}

const file = findStylesheet()
if (!file) {
  console.error('No built stylesheet in frontend/dist/assets — run `npm run build` first.')
  process.exit(2)
}
const css = fs.readFileSync(file, 'utf8')

// @media blocks, located by brace matching rather than by regex alone
const media = []
const open = /@media[^{]*\{/g
let m
while ((m = open.exec(css))) {
  let j = m.index + m[0].length
  let depth = 1
  while (j < css.length && depth > 0) {
    if (css[j] === '{') depth++
    else if (css[j] === '}') depth--
    j++
  }
  media.push({
    start: m.index,
    end: j,
    cond: m[0].slice(0, -1).trim(),
    body: css.slice(m.index + m[0].length, j - 1),
  })
  open.lastIndex = j
}
const insideMedia = (off) => media.some((b) => off >= b.start && off < b.end)

// Every top-level rule, per selector, in source order
const baseRules = new Map()
const rule = /([^{}@]+)\{([^{}]*)\}/g
while ((m = rule.exec(css))) {
  if (insideMedia(m.index)) continue
  for (const sel of m[1].split(',')) {
    const s = sel.trim()
    if (!s) continue
    if (!baseRules.has(s)) baseRules.set(s, [])
    baseRules.get(s).push({ off: m.index, decls: declarations(m[2]) })
  }
}

const findings = []
for (const block of media) {
  const inner = /([^{}]+)\{([^{}]*)\}/g
  let r
  while ((r = inner.exec(block.body))) {
    for (const sel of r[1].split(',')) {
      const s = sel.trim()
      if (!s) continue
      // Only base rules written AFTER this block can override it
      const later = (baseRules.get(s) ?? []).filter((b) => b.off >= block.end)
      if (later.length === 0) continue
      const winning = new Map()
      for (const b of later) for (const [p, v] of b.decls) winning.set(p, v)

      const lost = []
      for (const [prop, value] of declarations(r[2])) {
        const direct = winning.get(prop)
        if (direct !== undefined) {
          if (direct !== value) lost.push({ prop, wanted: value, got: direct })
          continue // identical value: the override changes nothing
        }
        const shorthand = (COVERED_BY[prop] ?? []).find((sh) => winning.has(sh))
        if (shorthand) lost.push({ prop, wanted: value, got: `${shorthand}: ${winning.get(shorthand)}` })
      }
      if (lost.length) findings.push({ sel, cond: block.cond, lost })
    }
  }
}

/*
 * (2) A narrower max-width block declared above a broader one. Both match on a
 * phone, equal specificity, so the broader one — written later — wins. Blocks
 * carrying a min-width are bands rather than nesting, and are left alone.
 */
const width = (cond) => {
  if (/min-width/.test(cond)) return null
  const m = cond.match(/max-width:\s*(\d+)px/)
  return m ? +m[1] : null
}
const banded = media
  .map((b) => ({ ...b, max: width(b.cond), rules: rulesIn(b.body) }))
  .filter((b) => b.max !== null)

const stale = []
for (let i = 0; i < banded.length; i++) {
  for (let j = i + 1; j < banded.length; j++) {
    if (!(banded[i].max < banded[j].max)) continue // only narrow-before-broad
    for (const [sel, props] of banded[i].rules) {
      const later = banded[j].rules.get(sel)
      if (!later) continue
      for (const [p, v] of props) {
        const lv = later.get(p)
        if (lv !== undefined && lv !== v) {
          stale.push({ sel, prop: p, at: banded[i].max, wanted: v, by: banded[j].max, got: lv })
        }
      }
    }
  }
}

console.log(`css-shadow: ${path.basename(file)}`)
if (findings.length === 0 && stale.length === 0) {
  console.log('  no responsive rules are overridden by a later rule.')
  process.exit(0)
}
if (findings.length) {
  console.log(`\n  ${findings.length} rule(s) beaten by a later BASE rule:\n`)
  for (const f of findings) {
    console.log(`  ${f.sel}   ${f.cond}`)
    for (const l of f.lost) console.log(`      ${l.prop}: ${l.wanted}   overridden by   ${l.got}`)
    console.log('')
  }
}
if (stale.length) {
  console.log(`\n  ${stale.length} rule(s) beaten by a later, BROADER media block:\n`)
  for (const s of stale) {
    console.log(`  ${s.sel}   {${s.prop}}`)
    console.log(`      max-width:${s.at}px wants ${s.wanted}`)
    console.log(`      but max-width:${s.by}px, written later, wins with ${s.got}\n`)
  }
}
console.log('  Move the declaration below the rule it must beat, or delete it if the')
console.log('  later one is the right answer — then check the built file again.')
process.exit(1)
