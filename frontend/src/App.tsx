import { Routes, Route, Navigate } from 'react-router-dom'
import Releases from './pages/Releases'
import Cricket from './pages/Cricket'
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
        <Route path="/cricket" element={<Cricket />} />
        <Route path="*" element={<Navigate to="/movies" replace />} />
      </Routes>
      <Footer />
    </>
  )
}
