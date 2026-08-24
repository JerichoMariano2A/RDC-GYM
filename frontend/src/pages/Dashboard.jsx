import React from 'react'
import { getRole } from '../services/auth'
import { Navigate } from 'react-router-dom'

export default function Dashboard() {
  const role = getRole()
  if (role === 'admin') return <Navigate to="/admin" replace />
  if (role === 'staff') return <Navigate to="/staff" replace />
  return <Navigate to="/login" replace />
}
