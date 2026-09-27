import {useEffect, useRef, useState, type FormEvent} from 'react'
import {LogIn, LogOut, X, UserRound} from 'lucide-react'
import {accountRequest, useAccount, type User} from '../account'

export default function AccountMenu() {
  const {user, loading, setUser} = useAccount()
  const dialog = useRef<HTMLDialogElement>(null)
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(()=>{const open=()=>dialog.current?.showModal(); window.addEventListener('sign-open-account',open); return()=>window.removeEventListener('sign-open-account',open)},[])
  const submit = async(event: FormEvent<HTMLFormElement>)=>{
    event.preventDefault(); setBusy(true); setError('')
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      const body = {email: values.get('email'), password: values.get('password'), ...(register?{name:values.get('name')}:{})}
      setUser(await accountRequest<User>(`auth/${register?'register':'login'}`,body))
      form.reset(); dialog.current?.close()
    } catch(cause) {setError(cause instanceof Error?cause.message:'Connection failed. Try again.')}
    finally {setBusy(false)}
  }
  const logout = async()=>{
    setBusy(true); setError('')
    try {await accountRequest('auth/logout',{});setUser(null);dialog.current?.close()}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not sign out.')}
    finally{setBusy(false)}
  }
  return <>
    <button className="secondary-button account-trigger" disabled={loading} onClick={()=>{setError('');dialog.current?.showModal()}}><UserRound size={16}/>{loading?'Loading account…':user?.name??'Sign in'}</button>
    <dialog ref={dialog} className="account-dialog" aria-labelledby="account-title">
      <button className="round-control account-close" aria-label="Close account" disabled={busy} onClick={()=>dialog.current?.close()}><X size={18}/></button>
      <h2 id="account-title">{user?'Your account':register?'Create your SIGN account':'Welcome back'}</h2>
      {user?<><p>{user.name}</p><p>{user.email}</p><button className="secondary-button" disabled={busy} onClick={()=>void logout()}><LogOut size={16}/> Sign out</button></>:<>
        <form onSubmit={event=>void submit(event)}>
          {register&&<label>Name<input name="name" autoComplete="name" required maxLength={80}/></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
          <label>Password<input name="password" type="password" autoComplete={register?'new-password':'current-password'} required minLength={12} maxLength={128}/></label>
          {register&&<p className="account-hint">Use at least 12 characters. Your account saves lesson progress and practice results. Camera recordings are not uploaded.</p>}
          <button className="primary-button" disabled={busy}><LogIn size={16}/>{busy?'Please wait…':register?'Create account':'Sign in'}</button>
        </form>
        <button className="account-switch" disabled={busy} onClick={()=>{setRegister(!register);setError('')}}>{register?'Already have an account? Sign in':'New here? Create an account'}</button>
      </>}
      {error&&<p role="alert" className="inline-error">{error}</p>}
    </dialog>
  </>
}
