import axios, { type AxiosInstance } from 'axios'
import versionData from '../../../version.json'

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
// NOTE: VITE_ prefixed env vars are embedded in the client bundle and visible
// in browser DevTools. This key only gates access to the backend API — it does
// NOT protect LLM provider secrets (those stay server-side only).
export const API_KEY: string = import.meta.env.VITE_API_KEY || ''
export const FRONTEND_URL: string = import.meta.env.VITE_FRONTEND_URL || window.location.origin
export const FRONTEND_VERSION: string = versionData.version

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY && { 'X-API-Key': API_KEY }),
  },
})
