import type { Release, OttRelease } from '../agent/releaseAgent'

// Sample data shown until a TMDB_API_KEY is configured — titles are fictional.
const r = (
  id: string, title: string, language: string, languageLabel: string,
  releaseDate: string, overview: string, rating: number, votes: number
): Release => ({
  id: `sample-${id}`, title, originalTitle: title, language, languageLabel,
  releaseDate, overview, poster: null, rating, votes,
})

export const sampleReleases: Release[] = [
  // ---- Hindi ----
  r('h1', 'Dilliwale Returns', 'hi', 'Hindi', '2026-07-17', 'A retired conman is pulled back for one last heist — his daughter\'s wedding budget.', 7.4, 812),
  r('h2', 'Aakhri Station', 'hi', 'Hindi', '2026-07-03', 'On the last train out of a flooding town, nine strangers discover one of them is not meant to leave.', 8.1, 1543),
  r('h3', 'Rangbaaz 2', 'hi', 'Hindi', '2026-06-26', 'The sequel to the action hit — Vikram returns to a city that has forgotten his name but not his debts.', 6.9, 2210),
  r('h4', 'Chandni Raat', 'hi', 'Hindi', '2026-08-14', 'A wedding singer and a classical purist are forced to co-write a film score in fourteen nights.', 0, 0),
  r('h5', 'Operation Saffron', 'hi', 'Hindi', '2026-09-04', 'A RAW analyst uncovers a leak that traces back to her own training batch.', 0, 0),
  // ---- Telugu ----
  r('t1', 'Rudra Veena', 'te', 'Telugu', '2026-07-10', 'A temple musician\'s forbidden raga awakens a village\'s buried history.', 8.4, 3120),
  r('t2', 'Gunshot', 'te', 'Telugu', '2026-06-19', 'A rookie constable becomes an overnight legend after a viral arrest — but the video hides a second shooter.', 7.2, 1876),
  r('t3', 'Palnadu Express', 'te', 'Telugu', '2026-08-07', 'Two rival bus operators race for one route, one bride, and the pride of Palnadu.', 0, 0),
  r('t4', 'Simham 2', 'te', 'Telugu', '2026-08-27', 'The lion returns. Bigger arena, older enemies, one final roar.', 0, 0),
  // ---- Tamil ----
  r('ta1', 'Kadal Kadhai', 'ta', 'Tamil', '2026-07-14', 'A fisherman\'s son maps the sea his father drowned in — and finds what the tide brought back.', 8.0, 2650),
  r('ta2', 'Vettai Nagar', 'ta', 'Tamil', '2026-06-28', 'In a city of hunters, an honest auto driver becomes the most wanted witness.', 7.5, 1980),
  r('ta3', 'Theeyavan', 'ta', 'Tamil', '2026-09-11', 'An arson investigator with burn scars chases a firestarter who leaves poems in the ash.', 0, 0),
  // ---- Malayalam ----
  r('m1', 'Mazhavil', 'ml', 'Malayalam', '2026-07-08', 'After the monsoon washes out the only road, a village doctor and a skeptical engineer must deliver a baby — and a bridge.', 8.6, 1420),
  r('m2', 'Nishabdam Veedu', 'ml', 'Malayalam', '2026-08-21', 'A hearing-impaired architect restores an ancestral home that refuses to stay silent.', 0, 0),
  // ---- Kannada ----
  r('k1', 'Bengaluru Diaries', 'kn', 'Kannada', '2026-07-11', 'Four flatmates, one startup, zero salaries — a comedy about the city that never logs off.', 7.1, 940),
  r('k2', 'Kalladka', 'kn', 'Kannada', '2026-08-28', 'A stone-carver\'s son returns from the city to finish the temple his father left incomplete.', 0, 0),
  // ---- Bengali ----
  r('b1', 'Shesh Chithi', 'bn', 'Bengali', '2026-07-04', 'A postmaster in the Sundarbans delivers a letter forty years late — and reopens three lives.', 8.2, 760),
  // ---- Marathi ----
  r('mr1', 'Waari', 'mr', 'Marathi', '2026-07-16', 'Three generations of one family walk the pilgrimage that once split them apart.', 8.3, 655),
  // ---- Punjabi ----
  r('p1', 'Pind da Munda', 'pa', 'Punjabi', '2026-07-12', 'A Canada-returned son inherits his grandfather\'s farm — and his grandfather\'s feuds.', 6.8, 512),
  // ---- English ----
  r('e1', 'The Cartographer', 'en', 'English', '2026-07-18', 'A dying mapmaker discovers a street that appears on no map — and on every one of her dreams.', 7.9, 5230),
  r('e2', 'Neon Tide', 'en', 'English', '2026-07-02', 'A storm-chasing journalist gets trapped in a coastal city the night the ocean starts glowing.', 7.0, 4110),
  r('e3', 'Late Checkout', 'en', 'English', '2026-06-24', 'A hotel night auditor realizes the guest in room 404 checked in eleven years ago — and never aged.', 7.6, 3875),
  r('e4', 'Halcyon', 'en', 'English', '2026-08-13', 'The first crew to return from a generation ship finds Earth has moved on — without them.', 0, 0),
  r('e5', 'The Understudy', 'en', 'English', '2026-09-24', 'When Broadway\'s biggest star vanishes mid-run, her understudy inherits the role — and the reason she ran.', 0, 0),
  // ---- Korean ----
  r('ko1', 'Midnight Ramyun', 'ko', 'Korean', '2026-07-09', 'A 24-hour noodle shop becomes neutral ground for two rival gangs — until the owner retires.', 8.0, 2980),
  r('ko2', 'Glass Garden 2', 'ko', 'Korean', '2026-08-19', 'The greenhouse reopens. So does the case everyone thought was closed.', 0, 0),
  // ---- Japanese ----
  r('j1', 'Paper Trains', 'ja', 'Japanese', '2026-07-05', 'An origami master folds one train each day for the station where his son was last seen.', 8.5, 2140),
  r('j2', 'Summer Static', 'ja', 'Japanese', '2026-08-06', 'Two teens repair a rooftop radio that only broadcasts one summer — 1999.', 0, 0),
  // ---- Spanish ----
  r('s1', 'La Función', 'es', 'Spanish', '2026-07-15', 'A traveling circus arrives at a town where no one has laughed in seven years.', 7.7, 1690),
  r('s2', 'Mar Adentro del Norte', 'es', 'Spanish', '2026-09-03', 'A lighthouse keeper\'s logbook predicts shipwrecks that haven\'t happened yet.', 0, 0),
]

const o = (
  id: string, title: string, language: string, languageLabel: string,
  releaseDate: string, overview: string, rating: number, votes: number,
  platforms: string[], week: number, contentType: 'movie' | 'series' = 'movie'
): OttRelease => ({ ...r(id, title, language, languageLabel, releaseDate, overview, rating, votes), platforms, week, contentType })

export const sampleOtt: OttRelease[] = [
  o('ott1', 'Aakhri Station', 'hi', 'Hindi', '2026-07-18', 'The theatrical hit arrives on streaming — nine strangers, one flooding town, one train.', 8.1, 1543, ['Netflix'], 0),
  o('ott2', 'Gunshot', 'te', 'Telugu', '2026-07-17', 'The viral-arrest thriller lands on Aha after its theatrical run.', 7.2, 1876, ['Aha', 'Amazon Prime Video'], 0),
  o('ott3', 'Vettai Nagar', 'ta', 'Tamil', '2026-07-16', 'The honest auto driver\'s story streams now.', 7.5, 1980, ['JioHotstar'], 0),
  o('ott4', 'Mazhavil', 'ml', 'Malayalam', '2026-07-20', 'The monsoon drama everyone talked about, now streaming.', 8.6, 1420, ['Sony LIV'], 0),
  o('ott5', 'Late Checkout', 'en', 'English', '2026-07-19', 'The room-404 mystery checks in to streaming.', 7.6, 3875, ['Netflix', 'Amazon Prime Video'], 0),
  o('ott6', 'Shesh Chithi', 'bn', 'Bengali', '2026-07-11', 'The Sundarbans letter drama arrives on ZEE5.', 8.2, 760, ['ZEE5'], 1),
  o('ott7', 'Midnight Ramyun', 'ko', 'Korean', '2026-07-09', 'The noodle-shop standoff streams across India.', 8.0, 2980, ['Netflix'], 1),
  o('ott8', 'Bengaluru Diaries', 'kn', 'Kannada', '2026-07-04', 'The startup comedy logs on to streaming.', 7.1, 940, ['Amazon Prime Video'], 2),
  o('ott9', 'Crown of Ashes', 'te', 'Telugu', '2026-07-17', 'The 1940s royal-court drama premieres — all 8 episodes.', 8.3, 1120, ['JioHotstar'], 0, 'series'),
  o('ott10', 'Nightshade Stories', 'hi', 'Hindi', '2026-07-19', 'Four standalone psychological thrillers, one anthology.', 7.8, 860, ['Netflix'], 0, 'series'),
]

export const sampleOttUpcoming: OttRelease[] = [
  o('ottu1', 'Rudra Veena', 'te', 'Telugu', '2026-08-07', 'The temple-musician hit arrives on streaming after its theatrical run.', 8.4, 3120, ['Aha'], -1),
  o('ottu2', 'Kadal Kadhai', 'ta', 'Tamil', '2026-08-14', 'The fisherman\'s-son drama comes to streaming.', 8.0, 2650, ['Netflix'], -1),
  o('ottu3', 'The Cartographer', 'en', 'English', '2026-08-21', 'The unmapped street opens to every screen.', 7.9, 5230, ['Amazon Prime Video'], -1),
  o('ottu4', 'Glass Garden 2', 'ko', 'Korean', '2026-08-19', 'The greenhouse reopens — series premiere.', 0, 0, ['Netflix'], -1, 'series'),
  o('ottu5', 'Waari', 'mr', 'Marathi', '2026-08-28', 'The pilgrimage drama streams soon — platform to be announced.', 8.3, 655, [], -1),
]
