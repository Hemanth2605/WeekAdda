import type { CricketMatch } from '../agent/cricketAgent'

// Fallback shown only if the ESPN sweep has never succeeded.
const m = (
  id: string, name: string, shortName: string, series: string, date: string,
  venue: string, state: 'pre' | 'post', statusDetail: string,
  teams: Array<{ name: string; abbreviation: string; score: string; winner: boolean }>
): CricketMatch => ({
  id: `sample-${id}`, name, shortName, series, seriesId: 'sample', date, venue,
  state, statusDetail, international: true, url: null, label: '1st ODI',
  teams: teams.map((t) => ({ ...t, logo: null })),
})

export const sampleMatches: CricketMatch[] = [
  m('1', 'India v Australia', 'IND v AUS', 'Sample Series', '2026-07-19T09:00Z',
    'Wankhede Stadium, Mumbai', 'post', 'Final',
    [
      { name: 'India', abbreviation: 'IND', score: '287/6', winner: true },
      { name: 'Australia', abbreviation: 'AUS', score: '284/9', winner: false },
    ]),
  m('2', 'England v South Africa', 'ENG v SA', 'Sample Series', '2026-07-25T10:00Z',
    "Lord's, London", 'pre', '',
    [
      { name: 'England', abbreviation: 'ENG', score: '', winner: false },
      { name: 'South Africa', abbreviation: 'SA', score: '', winner: false },
    ]),
]
