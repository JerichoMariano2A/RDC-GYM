import axios from 'axios'

const API = import.meta.env.DEV ? 'http://localhost:4000' : 'https://rdc-gym-backend-z2di.onrender.com'

const axiosInstance = axios.create({
  baseURL: API,
})

axiosInstance.interceptors.request.use(config => {
  const token = localStorage.getItem('rdc_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

axiosInstance.interceptors.response.use(
  res => res,
  err => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('rdc_token')
      localStorage.removeItem('rdc_role')
      localStorage.removeItem('rdc_username')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export async function login(username, password){
  const res = await axiosInstance.post('/auth/login', { username, password })
  return res.data
}

export async function fetchMyProfile(){
  const res = await axiosInstance.get('/data/profile')
  return res.data
}

export async function updateMyName(fullName){
  const res = await axiosInstance.put('/data/profile/name', { fullName })
  return res.data
}

export async function uploadMyPhoto(imageData, fileName){
  const res = await axiosInstance.post('/data/profile/photo', { imageData, fileName })
  return res.data
}

export async function removeMyPhoto(){
  const res = await axiosInstance.delete('/data/profile/photo')
  return res.data
}

export async function fetchMyPhoto(userId){
  const res = await axiosInstance.get(`/data/profile/photo/${userId}`, { responseType: 'blob' })
  return res.data
}

export async function changeUsername(username, currentPassword){
  const res = await axiosInstance.put('/data/profile/username', { username, currentPassword })
  return res.data
}

export async function changePassword(currentPassword, newPassword, confirmPassword){
  const res = await axiosInstance.put('/data/profile/password', { currentPassword, newPassword, confirmPassword })
  return res.data
}

export function getTheme(){ return localStorage.getItem('rdc_theme') === 'dark' ? 'dark' : 'light' }
export function storeTheme(theme){ localStorage.setItem('rdc_theme', theme) }
export function applyTheme(theme){
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  storeTheme(theme)
}
export function getUsername(){ return localStorage.getItem('rdc_username') || '' }
export function storeUsername(u){ localStorage.setItem('rdc_username', u || '') }

export async function fetchRealtimeClients(){
  const res = await axiosInstance.get('/data/clients/realtime')
  return res.data
}

export async function createClient(payload){
  const res = await axiosInstance.post('/data/clients', payload)
  return res.data
}

export async function createMembership(payload){
  const res = await axiosInstance.post('/data/memberships', payload)
  return res.data
}

export async function editMembership(id, payload){
  const res = await axiosInstance.put(`/data/memberships/${id}`, payload)
  return res.data
}

export async function deleteMembership(id){
  const res = await axiosInstance.delete(`/data/memberships/${id}`)
  return res.data
}

export async function incrementCoachingSession(id){
  const res = await axiosInstance.patch(`/data/memberships/${id}/sessions`)
  return res.data
}

export async function undoCoachingSession(id){
  const res = await axiosInstance.patch(`/data/memberships/${id}/sessions`, { action: 'undo' })
  return res.data
}

export async function collectMembershipBalance(id, paymentMethod){
  const res = await axiosInstance.patch(`/data/memberships/${id}/collect-balance`, { paymentMethod })
  return res.data
}

export async function incrementClientSession(id){
  const res = await axiosInstance.patch(`/data/clients/${id}/sessions`)
  return res.data
}

export async function undoClientSession(id){
  const res = await axiosInstance.patch(`/data/clients/${id}/sessions`, { action: 'undo' })
  return res.data
}

export async function collectClientBalance(id, paymentMethod){
  const res = await axiosInstance.patch(`/data/clients/${id}/collect-balance`, { paymentMethod })
  return res.data
}

export async function biometricScan(payload){
  const res = await axiosInstance.post('/data/biometric-scan', payload)
  return res.data
}

export async function fetchMemberships(params){
  const res = await axiosInstance.get('/data/memberships', { params })
  return res.data
}

export async function fetchStaff(){
  const res = await axiosInstance.get('/data/staff')
  return res.data
}

export async function createStaff(payload){
  const res = await axiosInstance.post('/data/staff', payload)
  return res.data
}

export async function deleteStaff(id){
  const res = await axiosInstance.delete(`/data/staff/${id}`)
  return res.data
}

export async function updateStaff(id, payload){
  const res = await axiosInstance.put(`/data/staff/${id}`, payload)
  return res.data
}

export async function fetchAuditLogs(params){
  const res = await axiosInstance.get('/data/audit-logs', { params })
  return res.data
}

export async function checkoutClient(id){
  const res = await axiosInstance.post(`/data/clients/${id}/checkout`)
  return res.data
}

export async function collectClientPayment(id){
  const res = await axiosInstance.patch(`/data/clients/${id}/payment`)
  return res.data
}

export async function fetchPromoMeta(){
  const res = await axiosInstance.get('/data/promo/meta')
  return res.data
}

export async function fetchPromoImage(){
  const res = await axiosInstance.get('/data/promo/image', { responseType: 'blob' })
  return res.data
}

export async function uploadPromo(imageData, fileName){
  const res = await axiosInstance.post('/data/promo', { imageData, fileName })
  return res.data
}

export async function deletePromo(){
  await axiosInstance.delete('/data/promo')
}

export async function setMembershipStatus(id, status){
  const res = await axiosInstance.patch(`/data/memberships/${id}/status`, { status })
  return res.data
}

export async function fetchReports(){
  const res = await axiosInstance.get('/data/reports')
  return res.data
}

export async function fetchSalesReport(params){
  const res = await axiosInstance.get('/data/reports/sales', { params })
  return res.data
}

export async function fetchReportsDashboard(params){
  const res = await axiosInstance.get('/data/reports/dashboard', { params })
  return res.data
}

export function setToken(t){ localStorage.setItem('rdc_token', t) }
export function getToken(){ return localStorage.getItem('rdc_token') }
export function setRole(r){ localStorage.setItem('rdc_role', r) }
export function getRole(){ return localStorage.getItem('rdc_role') }
export function logout(){
  localStorage.removeItem('rdc_token')
  localStorage.removeItem('rdc_role')
  localStorage.removeItem('rdc_username')
}

export async function fetchFingerprintStatus(){
  const res = await axiosInstance.get('/data/fingerprint/status')
  return res.data
}

export async function connectFingerprint(port, options = {}){
  const res = await axiosInstance.post('/data/fingerprint/connect', { port, ...options })
  return res.data
}

export function createFingerprintEventSource(token) {
  const tokenValue = token || localStorage.getItem('rdc_token')
  const url = `${axiosInstance.defaults.baseURL}/data/fingerprint/events?token=${encodeURIComponent(tokenValue || '')}`
  const eventSource = new EventSource(url)
  return eventSource
}

export async function disconnectFingerprint(){
  const res = await axiosInstance.post('/data/fingerprint/disconnect')
  return res.data
}

export async function enrollFingerprint(memberId){
  const res = await axiosInstance.post('/data/fingerprint/enroll', { member_id: memberId })
  return res.data
}

export async function requestDoorEnroll(memberId){
  const res = await axiosInstance.post('/esp/enroll-request', { member_id: memberId })
  return res.data
}

export async function fetchEnrollStatus(memberId){
  const res = await axiosInstance.get(`/data/fingerprint/enroll-status/${memberId}`)
  return res.data
}

export async function removeFingerprint(memberId){
  const res = await axiosInstance.delete(`/data/fingerprint/${memberId}`)
  return res.data
}

export async function startFingerprintScan(){
  const res = await axiosInstance.get('/data/fingerprint/scan-start')
  return res.data
}

export async function stopFingerprintScan(){
  const res = await axiosInstance.get('/data/fingerprint/scan-stop')
  return res.data
}

export async function fetchClientDisplayEvent(){
  const res = await axiosInstance.get('/data/client-display')
  return res.data
}

export async function clearClientDisplayEvent(){
  const res = await axiosInstance.get('/data/client-display/clear')
  return res.data
}
