/*
 * Finds responsive rules that never apply.
 *
 * A media query carries no specificity of its own, so `@media (max-width:720px)
 * { .x { padding-left: 20px } }` loses to a plain `.x { padding: … 42px … }`
 * written further down the file. Nothing warns about it: the stylesheet is
 * valid, the rule is right there in the source, and it is wrong only on a phone
 * — which is where nobody is looking. It has bitten this codebase four times
 * (the log ticket's stub padding, .blog-wrap, .spotlight-head,
 * .blog-input.author), so it is checked rather than remembered.
 *
 * It reads the BUILT stylesheet on purpose. Source order is not the truth:
 * these files are concatenated and minified, and in every case so far the
 * source looked perfectly reasonable. Run `npm run build` first.
 *
 * Two things stop it crying wolf:
 *   - a base rule that sets the SAME value changes nothing, so it is ignored
 *     (this is why .theme-toggle, which restates 36px/36px/12px, is silent);
 *   - shorthands are expanded, because `padding:` silently wipes an earlier
 *     `padding-left:` and comparing property names alone finds nothing.
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

console.log(`css-shadow: ${path.basename(file)}`)
if (findings.length === 0) {
  console.log('  no responsive rules are overridden by a later base rule.')
  process.exit(0)
}
console.log(`\n  ${findings.length} rule(s) never apply — a later base rule of equal specificity wins:\n`)
for (const f of findings) {
  console.log(`  ${f.sel}   ${f.cond}`)
  for (const l of f.lost) console.log(`      ${l.prop}: ${l.wanted}   overridden by   ${l.got}`)
  console.log('')
}
console.log('  Fix by moving the declaration below the rule it must beat, not by')
console.log('  reordering the source — check the built file again afterwards.')
process.exit(1)
