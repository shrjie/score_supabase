export const TEACHER_EMAIL = import.meta.env.VITE_TEACHER_EMAIL || 'admin@teachers.grade.local'
export const STUDENT_EMAIL_DOMAIN = import.meta.env.VITE_STUDENT_EMAIL_DOMAIN || 'students.grade.local'
export const DEFAULT_CLASS = import.meta.env.VITE_DEFAULT_CLASS || ''
export const TEACHER_DOMAIN = String(TEACHER_EMAIL).split('@')[1] || 'teachers.grade.local'
