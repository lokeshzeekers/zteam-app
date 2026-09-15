import { useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

function EyeToggle({ show, onClick }) {
  return (
    <button type="button" className="eye-toggle" onClick={onClick} tabIndex={-1}>
      {show ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a20.4 20.4 0 0 1-3.22 4.36M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({ name: user.name, email: user.email, phone: user.phone || '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setProfileErr(''); setProfileMsg(''); setSavingProfile(true);
    try {
      const { data } = await api.put('/api/auth/profile', form);
      updateUser(data.user);
      setProfileMsg('Profile updated.');
    } catch (err) {
      setProfileErr(err?.response?.data?.error || 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwErr(''); setPwMsg('');
    if (pw.newPassword !== pw.confirmPassword) return setPwErr('New passwords do not match');
    if (pw.newPassword.length < 6) return setPwErr('New password must be at least 6 characters');
    setSavingPw(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPwMsg('Password changed successfully.');
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwErr(err?.response?.data?.error || 'Could not change password');
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="panel">
      <h2>My Profile</h2>

      <form className="profile-form" onSubmit={saveProfile}>
        <h3>Personal details</h3>
        {profileErr && <div className="auth-error">{profileErr}</div>}
        {profileMsg && <div className="callout">{profileMsg}</div>}
        <label>Full name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>Email</label>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <label>Phone number</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <div className="muted small">Position &amp; department are managed by your admin.</div>
        <button type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</button>
      </form>

      <form className="profile-form" onSubmit={savePassword}>
        <h3>Change password</h3>
        {pwErr && <div className="auth-error">{pwErr}</div>}
        {pwMsg && <div className="callout">{pwMsg}</div>}
        <label>Current password</label>
        <div className="password-field">
          <input type={showCur ? 'text' : 'password'} value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <EyeToggle show={showCur} onClick={() => setShowCur((s) => !s)} />
        </div>
        <label>New password</label>
        <div className="password-field">
          <input type={showNew ? 'text' : 'password'} value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
          <EyeToggle show={showNew} onClick={() => setShowNew((s) => !s)} />
        </div>
        <label>Confirm new password</label>
        <div className="password-field">
          <input type={showNew ? 'text' : 'password'} value={pw.confirmPassword}
            onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} required />
        </div>
        <button type="submit" disabled={savingPw}>{savingPw ? 'Updating...' : 'Update password'}</button>
      </form>
    </div>
  );
}
