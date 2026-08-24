import axios from 'axios'

const API = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

const axiosInstance = axios.create({
  baseURL: API,
})

axiosInstance.interceptors.request.use(config => {
  const token = localStorage.getItem('rdc_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export async function login(username, password){
  const res = await axiosInstance.post('/auth/login', { username, password })
  return res.data
}

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

export async function fetchAuditLogs(params){
  const res = await axiosInstance.get('/data/audit-logs', { params })
  return res.data
}

export async function fetchReports(){
  const res = await axiosInstance.get('/data/reports')
  return res.data
}

export function setToken(t){ localStorage.setItem('rdc_token', t) }
export function getToken(){ return localStorage.getItem('rdc_token') }
export function setRole(r){ localStorage.setItem('rdc_role', r) }
export function getRole(){ return localStorage.getItem('rdc_role') }
export function logout(){ localStorage.removeItem('rdc_token'); localStorage.removeItem('rdc_role') }
