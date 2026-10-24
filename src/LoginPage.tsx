import { useState } from "react";
import { Cloud, Monitor, ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
export default function LoginPage({ username, password, remember, busy, message, error, configured, session, onUsername, onPassword, onRemember, onLogin, onLocal, onContinue }: {
  username: string; password: string; remember: boolean; busy: boolean; message: string; error?: string;
  configured: boolean; session: boolean; onUsername: (v: string) => void; onPassword: (v: string) => void;
  onRemember: (v: boolean) => void; onLogin: () => void; onLocal: () => void; onContinue: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return <main className="login-page">
    <section className="login-card" aria-label="Workspace login">
      <div className="login-logo"><img src="/icon.svg" alt="" width="44" height="44"/><span>Rx Mail Studio<small>SFE ANALYZER</small></span></div>
      {error && <div className="login-error" role="alert">{error}</div>}
      <form onSubmit={e => { e.preventDefault(); if (session && !password) onContinue(); else onLogin(); }} aria-label="Cloud sign in">
        <label className="field"><span>Username</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-label="Username" value={username} required={!session} minLength={2} maxLength={32} onChange={e => onUsername(e.target.value)}/></label>
        <label className="field"><span>Password</span><span className="login-password"><input name="password" autoComplete="current-password" aria-label="Password" type={visible ? "text" : "password"} value={password} required={!session} minLength={4} maxLength={128} onChange={e => onPassword(e.target.value)}/><button type="button" className="icon-button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
        <label className="login-remember"><input type="checkbox" checked={remember} onChange={e => onRemember(e.target.checked)}/><span>Save username and password</span></label>
        <button type="submit" className="button login-primary" disabled={busy || !configured}>{busy ? <><LoaderCircle size={18} className="login-spinner"/>{message || "Connecting…"}</> : <><Cloud size={18}/>Sign in<ArrowRight size={17}/></>}</button>
      </form>
      {!configured && <p className="login-help">Cloud connection is unavailable. You can use device memory below.</p>}
      <div className="login-divider"><span>or</span></div>
      <button className="button secondary login-device" onClick={onLocal}><Monitor size={19}/><span>Use Device Memory<small>Open data saved on this device. No cloud login.</small></span><ArrowRight size={17}/></button>
    </section>
  </main>;
}
