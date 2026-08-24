import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Staff from './pages/Staff'
import { getToken, getRole } from './services/auth'

function Protected({ children, allowedRoles }) {
  const token = getToken()
  const role = getRole()
  if (!token) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(role)) return <div className="forbidden">Forbidden</div>
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={<Protected><Dashboard /></Protected>}
      />
      <Route
        path="/admin"
        element={<Protected allowedRoles={["admin"]}><Admin /></Protected>}
      />
      <Route
        path="/staff"
        element={<Protected allowedRoles={["staff","admin"]}><Staff /></Protected>}
      />
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
