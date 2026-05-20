"use client";
import { useState, useRef, useCallback, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { FiCamera, FiCheck, FiAlertCircle, FiUser, FiMail, FiShield, FiSliders, FiTrash2 } from 'react-icons/fi';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

// ── helpers ───────────────────────────────────────────────────────────────────

function Avatar({ src, initials }: { src?: string | null; initials: string }) {
  return src ? (
    <img src={src} alt="Profile" className="w-full h-full object-cover" />
  ) : (
    <span className="text-3xl font-bold text-[#2AAA8A] uppercase select-none">{initials}</span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, isLoaded } = useUser();

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName,  setLastName]  = useState(user?.lastName  ?? '');
  const [preview,   setPreview]   = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [status,    setStatus]    = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg,  setErrorMsg]  = useState('');

  // System settings state
  const [idleTimeout,        setIdleTimeout]        = useState(30);
  const [downtimeThreshold,  setDowntimeThreshold]  = useState(300);
  const [settingsSaving,     setSettingsSaving]      = useState(false);
  const [settingsStatus,     setSettingsStatus]      = useState<'idle' | 'success' | 'error'>('idle');
  const [clearConfirm,    setClearConfirm]    = useState(false);
  const [clearing,        setClearing]        = useState(false);
  const [clearStatus,     setClearStatus]     = useState<'idle' | 'success' | 'error'>('idle');

  const fileRef = useRef<HTMLInputElement>(null);

  // Load system settings on mount
  useEffect(() => {
    fetch(`${API_URL}/api/settings`)
      .then(r => r.json())
      .then(data => {
        if (data.idle_timeout_sec)        setIdleTimeout(Number(data.idle_timeout_sec));
        if (data.downtime_threshold_sec)  setDowntimeThreshold(Number(data.downtime_threshold_sec));
      })
      .catch(() => {});
  }, []);

  const handleSaveSystemSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsStatus('idle');
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idle_timeout_sec: idleTimeout, downtime_threshold_sec: downtimeThreshold }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSettingsStatus('success');
    } catch {
      setSettingsStatus('error');
    } finally {
      setSettingsSaving(false);
      setTimeout(() => setSettingsStatus('idle'), 3000);
    }
  }, [idleTimeout]);

  const handleClearDatabase = useCallback(async () => {
    setClearing(true);
    setClearStatus('idle');
    try {
      const res = await fetch(`${API_URL}/api/settings/clear-db`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clear');
      setClearStatus('success');
      setClearConfirm(false);
    } catch {
      setClearStatus('error');
    } finally {
      setClearing(false);
      setTimeout(() => setClearStatus('idle'), 4000);
    }
  }, []);

  const nameInitials = (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '');
  const initials = nameInitials || (user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() ?? '?');

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image must be under 5 MB');
      setStatus('error');
      return;
    }
    setImageFile(file);
    setPreview(URL.createObjectURL(file));
    setStatus('idle');
  }, []);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setStatus('idle');
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      if (imageFile) {
        await user.setProfileImage({ file: imageFile });
      }
      setStatus('success');
      setImageFile(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setErrorMsg(msg);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }, [user, firstName, lastName, imageFile]);

  if (!isLoaded) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-[#2AAA8A] border-t-transparent animate-spin" />
      </div>
    );
  }

  const role  = user?.publicMetadata?.role as string | undefined;
  const email = user?.primaryEmailAddress?.emailAddress ?? '';

  const avatarSrc = preview ?? user?.imageUrl;

  return (
    <div className="min-h-screen bg-background p-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Manage your profile and account</p>
      </motion.div>

      <div className="mt-6 max-w-xl space-y-4">

        {/* ── Profile photo ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">Profile Photo</p>

          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div className="relative group flex-shrink-0">
              <div className="w-20 h-20 rounded-full bg-[#2AAA8A]/10 border-2 border-[#2AAA8A]/20
                flex items-center justify-center overflow-hidden">
                <Avatar src={avatarSrc} initials={initials} />
              </div>
              {/* Overlay on hover */}
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center
                  opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <FiCamera className="w-5 h-5 text-white" />
              </button>
            </div>

            {/* Info + button */}
            <div className="flex-1">
              <p className="text-sm text-gray-700 font-medium mb-0.5">
                {preview ? 'New photo selected' : 'Upload a new photo'}
              </p>
              <p className="text-xs text-gray-400 mb-3">JPG, PNG or GIF — max 5 MB</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="px-4 py-2 bg-white dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] rounded-xl text-xs font-semibold
                  text-gray-700 dark:text-gray-300 hover:border-[#2AAA8A]/40 hover:text-[#2AAA8A] transition-all shadow-sm"
              >
                Choose File
              </button>
              {preview && (
                <button
                  onClick={() => { setPreview(null); setImageFile(null); }}
                  className="ml-2 px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </motion.div>

        {/* ── Name ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">Display Name</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1.5">First Name</label>
              <div className="relative">
                <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  value={firstName}
                  onChange={e => { setFirstName(e.target.value); setStatus('idle'); }}
                  placeholder="First name"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white placeholder-gray-400
                    focus:outline-none focus:bg-white dark:focus:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#444] transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1.5">Last Name</label>
              <div className="relative">
                <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  value={lastName}
                  onChange={e => { setLastName(e.target.value); setStatus('idle'); }}
                  placeholder="Last name"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white placeholder-gray-400
                    focus:outline-none focus:bg-white dark:focus:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#444] transition-all"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Read-only info ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">Account Info</p>

          <div className="space-y-3">
            {/* Email */}
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1.5">Email Address</label>
              <div className="relative">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  value={email}
                  readOnly
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-100 dark:border-[#2c2c2c] rounded-xl
                    text-gray-400 dark:text-gray-500 cursor-default select-none"
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Email cannot be changed here — contact your admin.</p>
            </div>

            {/* Role */}
            {role && (
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1.5">Role</label>
                <div className="relative">
                  <FiShield className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                  <input
                    type="text"
                    value={role.charAt(0).toUpperCase() + role.slice(1)}
                    readOnly
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-100 rounded-xl
                      text-gray-400 cursor-default capitalize select-none"
                  />
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── System Settings (admin only) ────────────────────────────── */}
        {role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.18 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-4">
              <FiSliders className="w-4 h-4 text-[#2AAA8A]" />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">System Settings</p>
            </div>

            <div className="space-y-5">
              {/* Idle Timeout */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">
                  Idle Timeout
                  <span className="ml-2 text-[#2AAA8A] font-bold">{idleTimeout}s</span>
                </label>
                <p className="text-[11px] text-gray-400 mb-2">
                  No new piece detections for this long → plant marked Idle. Changes apply on next inference restart.
                </p>
                <input
                  type="range" min={5} max={300} step={5}
                  value={idleTimeout}
                  onChange={e => setIdleTimeout(Number(e.target.value))}
                  className="w-full accent-[#2AAA8A]"
                />
                <div className="relative h-4 mt-0.5">
                  {([{l:'5s', p:0},{l:'60s', p:18.6},{l:'120s', p:39},{l:'300s', p:100}] as {l:string,p:number}[]).map(({l,p})=>(
                    <span key={l} className="absolute text-[10px] text-gray-400"
                      style={{ left:`${p}%`, transform: p===0?'none':p===100?'translateX(-100%)':'translateX(-50%)' }}>
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              {/* Downtime Threshold */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">
                  Downtime Threshold
                  <span className="ml-2 text-[#2AAA8A] font-bold">{downtimeThreshold}s</span>
                </label>
                <p className="text-[11px] text-gray-400 mb-2">
                  If a plant stays idle longer than this, it is classified as a Downtime event in reports.
                </p>
                <input
                  type="range" min={30} max={3600} step={30}
                  value={downtimeThreshold}
                  onChange={e => setDowntimeThreshold(Number(e.target.value))}
                  className="w-full accent-[#2AAA8A]"
                />
                <div className="relative h-4 mt-0.5">
                  {([{l:'30s', p:0},{l:'15m', p:24.7},{l:'30m', p:49.6},{l:'1h', p:100}] as {l:string,p:number}[]).map(({l,p})=>(
                    <span key={l} className="absolute text-[10px] text-gray-400"
                      style={{ left:`${p}%`, transform: p===0?'none':p===100?'translateX(-100%)':'translateX(-50%)' }}>
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              {settingsStatus !== 'idle' && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
                  settingsStatus === 'success'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-600'
                }`}>
                  {settingsStatus === 'success'
                    ? <><FiCheck className="w-3.5 h-3.5" /> Settings saved — changes will take effect on next inference restart</>
                    : <><FiAlertCircle className="w-3.5 h-3.5" /> Failed to save settings</>}
                </div>
              )}

              <button
                onClick={handleSaveSystemSettings}
                disabled={settingsSaving}
                className="px-5 py-2 bg-[#2AAA8A] hover:bg-[#249978] text-white text-xs font-semibold rounded-xl
                  disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {settingsSaving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Database Management (admin only) ─────────────────────────── */}
        {role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.22 }}
            className="bg-white dark:bg-[#1a1a1a] border border-red-100 dark:border-red-900/30 rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-4">
              <FiTrash2 className="w-4 h-4 text-red-500" />
              <p className="text-xs font-semibold text-red-400 uppercase tracking-widest">Database Management</p>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              Permanently deletes all piece count, metrics, sessions, and idle period data.
              This cannot be undone.
            </p>

            {clearStatus !== 'idle' && (
              <div className={`flex items-center gap-2 px-3 py-2 mb-3 rounded-xl text-xs font-medium border ${
                clearStatus === 'success'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {clearStatus === 'success'
                  ? <><FiCheck className="w-3.5 h-3.5" /> Database cleared successfully</>
                  : <><FiAlertCircle className="w-3.5 h-3.5" /> Failed to clear database</>}
              </div>
            )}

            {!clearConfirm ? (
              <button
                onClick={() => setClearConfirm(true)}
                className="px-5 py-2 border border-red-200 text-red-500 hover:bg-red-50 text-xs font-semibold rounded-xl transition-all"
              >
                Clear Database
              </button>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-600 font-medium flex-1">Are you sure? All data will be lost.</p>
                <button
                  onClick={() => setClearConfirm(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearDatabase}
                  disabled={clearing}
                  className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg
                    disabled:opacity-60 transition-all"
                >
                  {clearing ? 'Clearing…' : 'Yes, Clear All'}
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Status feedback ──────────────────────────────────────────── */}
        {status !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium border ${
              status === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-600'
            }`}
          >
            {status === 'success' ? (
              <><FiCheck className="w-4 h-4 flex-shrink-0" /> Profile updated successfully</>
            ) : (
              <><FiAlertCircle className="w-4 h-4 flex-shrink-0" /> {errorMsg}</>
            )}
          </motion.div>
        )}

        {/* ── Save button ──────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl font-semibold text-sm text-white
              bg-[#2AAA8A] hover:bg-[#249978] active:scale-[0.99]
              disabled:opacity-60 disabled:cursor-not-allowed
              transition-all shadow-sm hover:shadow-md"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Saving…
              </span>
            ) : 'Save Changes'}
          </button>
        </motion.div>

      </div>
    </div>
  );
}
