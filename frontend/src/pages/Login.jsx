import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, setToken, setRole } from '../services/auth'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError(null)
    try {
      const res = await login(username, password)
      setToken(res.token)
      setRole(res.role)
      if (res.role === 'admin') navigate('/admin')
      else navigate('/dashboard')
    } catch (err) {
      const status = err.response?.status
      const backendError = err.response?.data?.error
      if (status === 401) {
        setError('Invalid username or password')
      } else if (status === 500) {
        setError('The server could not process the request. Please try again later.')
      } else if (backendError) {
        setError(backendError)
      } else if (err.code === 'ERR_NETWORK') {
        setError('Unable to reach the server. Make sure the backend is running on port 4000.')
      } else {
        setError(err.message || 'Login failed')
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-card login-card-brand">
        <img src="/logo.png" alt="RDC GYM" className="logo" />
        <h2>Sign in</h2>
        <form onSubmit={submit}>
          <label>Username</label>
          <input value={username} onChange={e=>setUsername(e.target.value)} />
          <label>Password</label>
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e=>setPassword(e.target.value)}
            />
            <button
              type="button"
              className={showPassword ? 'password-toggle show' : 'password-toggle'}
              onClick={() => setShowPassword(prev => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <span className="eye-icon" aria-hidden="true"></span>
            </button>
          </div>
          <button type="submit">Sign in</button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  )
}
