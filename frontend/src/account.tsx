import {createContext, useContext, useEffect, useState, type ReactNode} from 'react'

export type User = {id: string; name: string; email: string}
export type SavedAttempt = {attempt_id: string; item_id: string; score: number; matched: boolean; hold_frames: number; feedback: string; created_at?: string}
export type Progress = {completed: string[]; total_attempts: number; average: number|null; best: number|null; recent: SavedAttempt[]; items: {_id: string; count: number; best: number; average: number; first: number; latest: number; completed: boolean}[]}
const base = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

export async function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: {'Content-Type': 'application/json', 'X-Sign-Client': 'web'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  })
  const data = await response.json()
  if (!response.ok) {
    const detail = data.detail
    throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((entry: {msg: string}) => entry.msg).join(' ') : 'Unable to complete the request.')
  }
  return data as T
}

const Context = createContext<{user: User|null; loading: boolean; setUser: (user: User|null)=>void}>({user:null, loading:true, setUser:()=>{}})
export const useAccount = () => useContext(Context)
export function AccountProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<User|null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(()=>{void accountRequest<User>('auth/me').then(setUser).catch(()=>setUser(null)).finally(()=>setLoading(false))}, [])
  return <Context.Provider value={{user, setUser, loading}}>{children}</Context.Provider>
}
