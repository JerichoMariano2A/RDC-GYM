export function isMemberType(type) {
  const value = String(type || '')
  return value === 'Member' || (value.startsWith('Member') && !value.startsWith('Non-Member'))
}

export function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

export function liveDurationSeconds(timeInAt, now) {
  if (!timeInAt) return 0
  const start = new Date(timeInAt).getTime()
  const end = now instanceof Date ? now.getTime() : Date.now()
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function peso(amount) {
  return `₱${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function daysUntilExpiry(expires) {
  if (!expires) return null
  const end = new Date(`${expires}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((end - today) / 86400000)
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function monthStartISO() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
}
