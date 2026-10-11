import { useEffect, useState } from "react";
import { Plus, Users, ShieldCheck, KeyRound, Pencil, RefreshCw, X, Eye, EyeOff } from "lucide-react";
import { accountRequest } from "./auth";
import type { UserAccount, UserRole } from "./auth";
import "./users.css";
const roleLabel = (role: UserRole) => ({ owner: "Admin", editor: "Editor", member: "Member" })[role];
const fresh = () => ({ username: "", name: "", password: "", role: "member" as UserRole });
export default function UsersPage({ admin, notify, onAccountChange }: {
  admin: UserAccount; notify: (text: string, error?: boolean) => void;
  onAccountChange: (account: UserAccount) => void;
}) {
  const [users, setUsers] = useState<UserAccount[]>([]), [draft, setDraft] = useState(fresh);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [edit, setEdit] = useState<UserAccount | null>(null), [reset, setReset] = useState<UserAccount | null>(null), [newPassword, setNewPassword] = useState("");
  const refresh = async () => {
    setLoading(true); setError("");
    try { setUsers((await accountRequest<{ accounts: UserAccount[] }>({ action: "list" })).accounts); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const save = async (body: Record<string, unknown>, success: string) => {
    setBusy(true); setError("");
    try {
      const result = await accountRequest<{ account?: UserAccount }>(body);
      if (result.account?.id === admin.id) onAccountChange(result.account);
      await refresh(); notify(success); return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const roleSelect = (value: UserRole, change: (value: UserRole) => void, disabled = false) => (
    <label className="field"><span>Access role</span><select value={value} disabled={disabled} onChange={(e) => change(e.target.value as UserRole)}>
      <option value="member">Member · generate emails</option><option value="editor">Editor · import and generate</option><option value="owner">Admin · manage all users</option>
    </select></label>
  );
  return <div className="users-layout">
    {error && <div className="notice user-error" role="alert">{error}</div>}
    <section className="card user-create">
      <div className="user-card-title"><span className="user-icon"><Plus size={21} /></span><div><h3>Create user</h3><p>Give your team a username and password.</p></div></div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (await save({ action: "create", ...draft }, `User ${draft.username.toUpperCase()} created`)) { setDraft(fresh()); setShowPassword(false); }
      }}>
        <label className="field"><span>Username</span><input autoComplete="off" required minLength={2} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,31}" placeholder="e.g. SBM01" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value.toUpperCase() })} /><small>2–32 letters, numbers, dots, underscores or hyphens.</small></label>
        <label className="field"><span>Display name</span><input autoComplete="off" required maxLength={120} placeholder="Team member’s name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="field"><span>Password</span><span className="password-input"><input autoComplete="new-password" type={showPassword ? "text" : "password"} required minLength={4} maxLength={128} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /><button type="button" className="icon-button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span><small>At least 4 characters. Share it with the user yourself.</small></label>
        {roleSelect(draft.role, (role) => setDraft({ ...draft, role }))}
        <div className="user-helper"><ShieldCheck size={17} /><span>No email address or confirmation needed.</span></div>
        <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create user"}<Plus size={16} /></button>
      </form>
    </section>
    <section className="card user-list">
      <div className="user-list-heading"><div><h3><Users size={19} /> Workspace users <span className="badge neutral">{users.length}</span></h3><p>Manage access and reset passwords from one place.</p></div><button className="icon-button" aria-label="Refresh users" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={18} /></button></div>
      {loading ? <p className="user-loading">Loading users…</p> : <div className="table-scroll"><table className="users-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
        <td><strong>{user.username}</strong>{user.id === admin.id && <small className="user-you">You</small>}<span className="user-name">{user.name}</span></td>
        <td>{roleLabel(user.role)}</td><td><span className={`badge ${user.active ? "success" : "neutral"}`}>{user.active ? "Active" : "Disabled"}</span></td>
        <td><div className="user-actions"><button className="icon-button" disabled={busy} aria-label={`Edit ${user.username}`} onClick={() => { setEdit({ ...user }); setReset(null); setNewPassword(""); }}><Pencil size={16} /></button><button className="icon-button" disabled={busy} aria-label={`Reset password for ${user.username}`} onClick={() => { setReset(user); setEdit(null); setNewPassword(""); }}><KeyRound size={16} /></button><button className="button text user-status-button" disabled={busy || user.id === admin.id} onClick={() => void save({ action: "update", id: user.id, name: user.name, role: user.role, active: !user.active }, `User ${user.active ? "disabled" : "enabled"}`)}>{user.active ? "Disable" : "Enable"}</button></div></td>
      </tr>)}</tbody></table></div>}
      {(edit || reset) && <div className="user-editor">
        <div className="user-editor-heading"><h3>{edit ? `Edit ${edit.username}` : `Reset password · ${reset!.username}`}</h3><button className="icon-button" disabled={busy} aria-label="Cancel user changes" onClick={() => { setEdit(null); setReset(null); setNewPassword(""); }}><X size={18} /></button></div>
        {edit ? <form onSubmit={async (e) => { e.preventDefault(); if (await save({ action: "update", id: edit.id, name: edit.name, role: edit.role, active: edit.active }, "User updated")) setEdit(null); }}>
          <label className="field"><span>Display name</span><input required maxLength={120} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          {roleSelect(edit.role, (role) => setEdit({ ...edit, role }), edit.id === admin.id)}
          <button className="button" disabled={busy} type="submit">Save changes</button>
        </form> : <form onSubmit={async (e) => { e.preventDefault(); if (await save({ action: "password", id: reset!.id, password: newPassword }, "Password updated")) { setReset(null); setNewPassword(""); } }}>
          <label className="field"><span>New password</span><input type="password" autoComplete="new-password" required minLength={4} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
          <p className="tiny">Share the new password directly with this user.</p><button className="button" disabled={busy} type="submit">Update password</button>
        </form>}
      </div>}
    </section>
  </div>;
}
