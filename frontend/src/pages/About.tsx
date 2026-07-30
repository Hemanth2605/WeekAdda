import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarRange, Film, Trophy, Feather, HandHeart, Linkedin } from 'lucide-react'
import { usePageMeta } from '../seo'

const LINKEDIN = 'https://www.linkedin.com/in/hemanth-mareedu-a69271116/'

export default function About() {
  // Must stay identical to routeMeta['/about'] in backend/src/seo.ts — the
  // Worker writes those into the HTML and this overwrites them on mount, so
  // the two disagreeing means one URL advertising two titles. They did.
  usePageMeta(
    'About WeekAdda — Founded by Hemanth Mareedu',
    'WeekAdda was founded by Hemanth Mareedu, a software engineer and lifelong movie and cricket fan — weekly movie releases, OTT arrivals and cricket in one place.'
  )

  return (
    <main className="movie-page about-page">
      <Link className="movie-back" to="/movies">
        <ArrowLeft size={15} /> Back to releases
      </Link>

      <div className="about-card">
        <span className="hero-eyebrow">
          <CalendarRange size={13} /> About WeekAdda
        </span>
        <h1>The week&apos;s entertainment, in one place</h1>
        <p>
          Keeping up used to mean hopping between apps and clickbait sites: which movies released
          this week, what just landed on OTT, when the next match starts. <b>WeekAdda</b>, live
          since July 2026, answers all of it on one clean page — free, no account needed,
          refreshed automatically every morning by its own agents.
        </p>
        <ul className="about-features">
          <li>
            <Film size={16} />
            <span>
              <b>Movies &amp; OTT</b> — new releases in Telugu, Hindi, Tamil, Malayalam, Kannada,
              English and 12+ languages; daily OTT arrivals on Netflix, Prime Video, JioHotstar,
              Sony LIV, ZEE5 and Aha; upcoming theatre and digital release dates — browsable week
              by week, 13 weeks back.
            </span>
          </li>
          <li>
            <Trophy size={16} />
            <span>
              <b>Cricket</b> — upcoming fixtures with date, time and venue for every international
              series, and completed results week by week.
            </span>
          </li>
          <li>
            <Feather size={16} />
            <span>
              <b>Reviews</b> — honest verdicts from people who actually watched, each tagged to
              the film or match it is about and rated out of five. Anyone can read; writing or
              rating needs just a Google sign-in.
            </span>
          </li>
          <li>
            <HandHeart size={16} />
            <span>
              <b>The Adda</b> — a community board to ask, offer and find company: a spare ticket
              at face value, a movie plan that needs one more person, an honest question for
              fellow fans. Free to read; when you respond, contact details are shared only
              between the two of you.
            </span>
          </li>
        </ul>
      </div>

      <div className="about-card founder-card">
        <span className="hero-eyebrow">Founder</span>
        <div className="founder-row">
          <img className="founder-photo" src="/founder.jpg" alt="Hemanth Mareedu" />
          <div>
            <h2>Hemanth Mareedu</h2>
            {/* Says it outright, and matches the pre-render sentence: the
                markup calls him the founder, so the page a reader sees has to
                as well — and "founded by" is the phrasing the question uses */}
            <p>
              <strong>WeekAdda was founded by Hemanth Mareedu</strong>, who built and runs it
              single-handedly.
            </p>
            <p>
              Software engineer with 10+ years of experience, lifelong movie and cricket fan, and
              an enthusiast for building new things that are genuinely helpful to people —
              WeekAdda is exactly that. If you have feedback, an idea, or just want to talk
              movies or cricket, say hi.
            </p>
            <a className="about-connect" href={LINKEDIN} target="_blank" rel="noopener noreferrer">
              <Linkedin size={16} /> Connect on LinkedIn
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
