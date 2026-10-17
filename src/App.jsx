import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth.jsx'
import TitleProvider from './lib/title.jsx'
import StudentPage from './pages/StudentPage.jsx'
import TeacherPage from './pages/TeacherPage.jsx'

export default function App() {
  return (
    <AuthProvider>
      <TitleProvider>
        <Routes>
          <Route path="/" element={<StudentPage />} />
          <Route path="/teacher" element={<TeacherPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TitleProvider>
    </AuthProvider>
  )
}
