import { Routes, Route, Navigate } from 'react-router-dom'
import Releases from './pages/Releases'
import MovieDetail from './pages/MovieDetail'
import Cricket from './pages/Cricket'
import Blog from './pages/Blog'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ShareSheet from './components/ShareSheet'

export default function App() {
  return (
    <>
      <Navbar />
      <ShareSheet />
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<Releases />} />
        <Route path="/movie/:id" element={<MovieDetail />} />
        <Route path="/movie/:id/:slug" element={<MovieDetail />} />
        <Route path="/cricket" element={<Cricket />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="*" element={<Navigate to="/movies" replace />} />
      </Routes>
      <Footer />
    </>
  )
}
