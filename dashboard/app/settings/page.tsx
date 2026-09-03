"use client";
import { useState, useRef, useCallback, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { FiCamera, FiCheck, FiAlertCircle, FiUser, FiMail, FiShield, FiSliders, FiTrash2, FiCalendar, FiPlus, FiCoffee, FiTarget } from 'react-icons/fi';
import { API_URL } from '../../lib/constants';
import { getDashboardAccess } from '../../lib/access';

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
  const { getToken } = useAuth();

  // Admin-only mutations are sent with the Clerk session token so the
  // backend can verify the caller's role independently of the UI.
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const role = getDashboardAccess(user?.publicMetadata).role ?? undefined;

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
  const [shiftStart,         setShiftStart]         = useState('07:00');
  const [shiftEnd,           setShiftEnd]           = useState('17:00');
  const [breakStartWeekday,  setBreakStartWeekday]  = useState('13:00');
  const [breakEndWeekday,    setBreakEndWeekday]    = useState('14:00');
  const [breakStartFriday,   setBreakStartFriday]   = useState('13:00');
  const [breakEndFriday,     setBreakEndFriday]     = useState('14:30');
  const [weeklyOffDays,      setWeeklyOffDays]      = useState<string[]>(['Sun']);
  const [settingsSaving,     setSettingsSaving]      = useState(false);
  const [settingsStatus,     setSettingsStatus]      = useState<'idle' | 'success' | 'error'>('idle');
  const [clearConfirm,    setClearConfirm]    = useState(false);
  const [clearing,        setClearing]        = useState(false);
  const [clearStatus,     setClearStatus]     = useState<'idle' | 'success' | 'error'>('idle');

  // Holidays state
  const [holidays,           setHolidays]            = useState<{date: string; description: string}[]>([]);
  const [newHolidayDate,     setNewHolidayDate]      = useState('');
  const [newHolidayDesc,     setNewHolidayDesc]      = useState('');
  const [holidayBusy,        setHolidayBusy]         = useState(false);
  const [holidayStatus,      setHolidayStatus]       = useState<'idle' | 'success' | 'error'>('idle');

  // Plant Targets state
  const [targets,         setTargets]        = useState<{id: number; unit: string; from_date: string; daily_target: number}[]>([]);
  const [newTargetUnit,   setNewTargetUnit]  = useState('ALL');
  const [newTargetDate,   setNewTargetDate]  = useState('');
  const [newTargetValue,  setNewTargetValue] = useState('');
  const [targetBusy,      setTargetBusy]     = useState(false);
  const [targetStatus,    setTargetStatus]   = useState<'idle' | 'success' | 'error'>('idle');

  // Email Configuration state
  const [recipients,         setRecipients]          = useState<{id: number; name: string; email: string; role: string; allocated_plants: string | null}[]>([]);
  const [newRecName,         setNewRecName]          = useState('');
  const [newRecEmail,        setNewRecEmail]         = useState('');
  const [newRecRole,         setNewRecRole]          = useState('MANAGER');
  const [newRecPlants,       setNewRecPlants]        = useState<string[]>([]);
  const [recBusy,            setRecBusy]             = useState(false);
  const [recStatus,          setRecStatus]           = useState<'idle' | 'success' | 'error'>('idle');
  const [testEmailAddress,   setTestEmailAddress]    = useState('');
  const [testEmailStatus,    setTestEmailStatus]     = useState<'idle' | 'success' | 'error'>('idle');
  const [dispatchingSummary, setDispatchingSummary]  = useState(false);
  const [dispatchStatus,     setDispatchStatus]     = useState<'idle' | 'success' | 'error'>('idle');
  const [dispatchMsg,        setDispatchMsg]        = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  // Load system settings + holidays on mount
  useEffect(() => {
    fetch(`${API_URL}/api/settings`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data.idle_timeout_sec)        setIdleTimeout(Number(data.idle_timeout_sec));
        if (data.downtime_threshold_sec)  setDowntimeThreshold(Number(data.downtime_threshold_sec));
        if (data.shift_start)             setShiftStart(data.shift_start);
        if (data.shift_end)               setShiftEnd(data.shift_end);
        if (data.break_start_weekday)     setBreakStartWeekday(data.break_start_weekday);
        if (data.break_end_weekday)       setBreakEndWeekday(data.break_end_weekday);
        if (data.break_start_friday)      setBreakStartFriday(data.break_start_friday);
        if (data.break_end_friday)        setBreakEndFriday(data.break_end_friday);
        if (typeof data.weekly_off_days === 'string') {
          const parsed = data.weekly_off_days
            .split(',')
            .map((d: string) => d.trim())
            .filter(Boolean);
          setWeeklyOffDays(parsed.length ? parsed : ['Sun']);
        }
      })
      .catch(() => {});
    fetch(`${API_URL}/api/settings/holidays`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(setHolidays)
      .catch(() => {});
    fetch(`${API_URL}/api/settings/targets`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(setTargets)
      .catch(() => {});
  }, []);

  const loadRecipients = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/settings/email-recipients`, { headers, cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRecipients(data);
      }
    } catch (e) {}
  }, [authHeaders]);

  useEffect(() => {
    if (role === 'admin') {
      loadRecipients();
    }
  }, [role, loadRecipients]);

  const handleSaveSystemSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsStatus('idle');
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          idle_timeout_sec:       idleTimeout,
          downtime_threshold_sec: downtimeThreshold,
          shift_start:            shiftStart,
          shift_end:              shiftEnd,
          break_start_weekday:    breakStartWeekday,
          break_end_weekday:      breakEndWeekday,
          break_start_friday:     breakStartFriday,
          break_end_friday:       breakEndFriday,
          weekly_off_days:        weeklyOffDays.join(','),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSettingsStatus('success');
    } catch {
      setSettingsStatus('error');
    } finally {
      setSettingsSaving(false);
      setTimeout(() => setSettingsStatus('idle'), 3000);
    }
  }, [idleTimeout, downtimeThreshold, shiftStart, shiftEnd, breakStartWeekday, breakEndWeekday, breakStartFriday, breakEndFriday, weeklyOffDays, authHeaders]);

  const handleAddHoliday = useCallback(async () => {
    if (!newHolidayDate) return;
    setHolidayBusy(true);
    setHolidayStatus('idle');
    try {
      const res = await fetch(`${API_URL}/api/settings/holidays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ date: newHolidayDate, description: newHolidayDesc }),
      });
      if (!res.ok) throw new Error('Failed');
      const refreshed = await fetch(`${API_URL}/api/settings/holidays`, { cache: 'no-store' }).then(r => r.json());
      setHolidays(refreshed);
      setNewHolidayDate('');
      setNewHolidayDesc('');
      setHolidayStatus('success');
    } catch {
      setHolidayStatus('error');
    } finally {
      setHolidayBusy(false);
      setTimeout(() => setHolidayStatus('idle'), 3000);
    }
  }, [newHolidayDate, newHolidayDesc, authHeaders]);

  const handleAddTarget = useCallback(async () => {
    if (!newTargetDate || !newTargetValue) return;
    setTargetBusy(true); setTargetStatus('idle');
    try {
      const res = await fetch(`${API_URL}/api/settings/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ unit: newTargetUnit, from_date: newTargetDate, daily_target: parseInt(newTargetValue) }),
      });
      if (!res.ok) throw new Error('Failed');
      const refreshed = await fetch(`${API_URL}/api/settings/targets`, { cache: 'no-store' }).then(r => r.json());
      setTargets(refreshed);
      setNewTargetDate(''); setNewTargetValue('');
      setTargetStatus('success');
    } catch { setTargetStatus('error'); }
    finally { setTargetBusy(false); setTimeout(() => setTargetStatus('idle'), 3000); }
  }, [newTargetUnit, newTargetDate, newTargetValue, authHeaders]);

  const handleDeleteTarget = useCallback(async (id: number) => {
    setTargetBusy(true);
    try {
      await fetch(`${API_URL}/api/settings/targets/${id}`, { method: 'DELETE', headers: await authHeaders() });
      setTargets(prev => prev.filter(t => t.id !== id));
    } catch { setTargetStatus('error'); setTimeout(() => setTargetStatus('idle'), 3000); }
    finally { setTargetBusy(false); }
  }, [authHeaders]);

  const handleDeleteHoliday = useCallback(async (date: string) => {
    setHolidayBusy(true);
    try {
      await fetch(`${API_URL}/api/settings/holidays/${date}`, { method: 'DELETE', headers: await authHeaders() });
      setHolidays(prev => prev.filter(h => h.date !== date));
    } catch {
      setHolidayStatus('error');
      setTimeout(() => setHolidayStatus('idle'), 3000);
    } finally {
      setHolidayBusy(false);
    }
  }, [authHeaders]);

  const handleClearDatabase = useCallback(async () => {
    setClearing(true);
    setClearStatus('idle');
    try {
      const res = await fetch(`${API_URL}/api/settings/clear-db`, { method: 'POST', headers: await authHeaders() });
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

  const handleAddRecipient = async () => {
    if (!newRecName || !newRecEmail) return;
    setRecBusy(true);
    setRecStatus('idle');
    try {
      const headers = await authHeaders();
      const plantsCsv = newRecRole === 'MANAGER' ? newRecPlants.join(',') : null;
      const res = await fetch(`${API_URL}/api/settings/email-recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: newRecName,
          email: newRecEmail,
          role: newRecRole,
          allocated_plants: plantsCsv
        })
      });
      if (res.ok) {
        setRecStatus('success');
        setNewRecName('');
        setNewRecEmail('');
        setNewRecPlants([]);
        loadRecipients();
        setTimeout(() => setRecStatus('idle'), 3000);
      } else {
        setRecStatus('error');
        setTimeout(() => setRecStatus('idle'), 3000);
      }
    } catch (e) {
      setRecStatus('error');
      setTimeout(() => setRecStatus('idle'), 3000);
    } finally {
      setRecBusy(false);
    }
  };

  const handleDeleteRecipient = async (id: number) => {
    setRecBusy(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/settings/email-recipients/${id}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        loadRecipients();
      }
    } catch (e) {
    } finally {
      setRecBusy(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress) return;
    setTestEmailStatus('idle');
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/reports/send-test-email?to_email=${encodeURIComponent(testEmailAddress)}`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        setTestEmailStatus('success');
        setTestEmailAddress('');
        setTimeout(() => setTestEmailStatus('idle'), 4000);
      } else {
        setTestEmailStatus('error');
        setTimeout(() => setTestEmailStatus('idle'), 4000);
      }
    } catch (e) {
      setTestEmailStatus('error');
      setTimeout(() => setTestEmailStatus('idle'), 4000);
    }
  };

  const handleDispatchSummary = async () => {
    setDispatchingSummary(true);
    setDispatchStatus('idle');
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/reports/send-daily-summary`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        const data = await res.json();
        setDispatchMsg(`Reports dispatched successfully! (${data.sent || 0} sent, ${data.failed || 0} failed)`);
        setDispatchStatus('success');
      } else {
        const err = await res.json().catch(() => ({}));
        setDispatchMsg(err.detail || 'Failed to dispatch summary reports');
        setDispatchStatus('error');
      }
    } catch (e) {
      setDispatchMsg('Failed to connect to backend server');
      setDispatchStatus('error');
    } finally {
      setDispatchingSummary(false);
      setTimeout(() => setDispatchStatus('idle'), 5000);
    }
  };

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

              {/* Shift Hours */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">Shift Hours</label>
                <p className="text-[11px] text-gray-400 mb-2">
                  Idle time and downtime are only counted within these hours. Outside shift, the system monitors but does not record idle/downtime.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Shift Start</label>
                    <input
                      type="time"
                      value={shiftStart}
                      onChange={e => setShiftStart(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                        text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Shift End</label>
                    <input
                      type="time"
                      value={shiftEnd}
                      onChange={e => setShiftEnd(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                        text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Break Times */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1 flex items-center gap-1.5">
                  <FiCoffee className="w-3.5 h-3.5 text-[#2AAA8A]" /> Break Times
                </label>
                <p className="text-[11px] text-gray-400 mb-2">
                  Break time is excluded from idle-time accumulation. Friday has a different window by default.
                  Inference picks up changes within a few minutes — no restart needed.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Weekday Break Start (Mon–Thu, Sat, Sun)</label>
                    <input
                      type="time"
                      value={breakStartWeekday}
                      onChange={e => setBreakStartWeekday(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                        text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Weekday Break End</label>
                    <input
                      type="time"
                      value={breakEndWeekday}
                      onChange={e => setBreakEndWeekday(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                        text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Friday Break Start</label>
                    <input
                      type="time"
                      value={breakStartFriday}
                      onChange={e => setBreakStartFriday(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                        text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Friday Break End</label>
                    <input
                      type="time"
                      value={breakEndFriday}
                      onChange={e => setBreakEndFriday(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                        text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Weekly Off Days */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">Weekly Off Days</label>
                <p className="text-[11px] text-gray-400 mb-2">
                  On these weekdays, every plant is treated as off — no piece counting, no active time, no idle time.
                  Floor View shows them as &ldquo;Offline &middot; Day Off&rdquo;. Evaluated once when the inference starts.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => {
                    const checked = weeklyOffDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setWeeklyOffDays(prev =>
                          prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
                        )}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                          checked
                            ? 'bg-[#2AAA8A] border-[#2AAA8A] text-white'
                            : 'bg-gray-50 dark:bg-[#111111] border-gray-200 dark:border-[#2c2c2c] text-gray-600 dark:text-gray-300 hover:border-[#2AAA8A]/40'
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
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

        {/* ── Holidays (admin only) ────────────────────────────────────── */}
        {role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-4">
              <FiCalendar className="w-4 h-4 text-[#2AAA8A]" />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Holidays</p>
            </div>

            <p className="text-[11px] text-gray-400 mb-4">
              On a holiday, the inference does not write piece counts, active time, or idle time.
              Status indicators stay live. Inference checks this list periodically — no restart needed.
            </p>

            {/* Add new holiday */}
            <div className="grid grid-cols-12 gap-2 mb-3">
              <input
                type="date"
                value={newHolidayDate}
                onChange={e => setNewHolidayDate(e.target.value)}
                className="col-span-4 px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                  text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
              />
              <input
                type="text"
                placeholder="Description (e.g. Eid ul-Fitr)"
                value={newHolidayDesc}
                onChange={e => setNewHolidayDesc(e.target.value)}
                className="col-span-6 px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                  text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#2AAA8A] transition-all"
              />
              <button
                onClick={handleAddHoliday}
                disabled={!newHolidayDate || holidayBusy}
                className="col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 bg-[#2AAA8A] hover:bg-[#249978] text-white text-xs font-semibold rounded-xl
                  disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <FiPlus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            {holidayStatus !== 'idle' && (
              <div className={`flex items-center gap-2 px-3 py-2 mb-3 rounded-xl text-xs font-medium border ${
                holidayStatus === 'success'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {holidayStatus === 'success'
                  ? <><FiCheck className="w-3.5 h-3.5" /> Holiday saved</>
                  : <><FiAlertCircle className="w-3.5 h-3.5" /> Failed</>}
              </div>
            )}

            {/* Existing holidays */}
            {holidays.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No holidays configured.</p>
            ) : (
              <div className="border border-gray-100 dark:border-[#2c2c2c] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-[#111111]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                      <th className="px-3 py-2 w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
                    {holidays.map(h => (
                      <tr key={h.date} className="hover:bg-gray-50 dark:hover:bg-[#111111]">
                        <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{h.date}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{h.description || <span className="text-gray-400 italic">—</span>}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleDeleteHoliday(h.date)}
                            disabled={holidayBusy}
                            className="text-red-500 hover:text-red-600 disabled:opacity-50"
                            title="Remove"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Plant Targets (admin only) ────────────────────────────────── */}
        {role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.21 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-4">
              <FiTarget className="w-4 h-4 text-[#2AAA8A]" />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Plant Targets</p>
            </div>

            <p className="text-[11px] text-gray-400 mb-4">
              Set daily piece targets per plant, effective from a chosen date. A plant-specific target
              takes priority over an &ldquo;All Plants&rdquo; target. The most recent applicable entry is used
              when generating reports.
            </p>

            {/* Add new target */}
            <div className="grid grid-cols-12 gap-2 mb-3">
              <select
                value={newTargetUnit}
                onChange={e => setNewTargetUnit(e.target.value)}
                className="col-span-3 px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                  text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
              >
                <option value="ALL">All Plants</option>
                {['SP-01','SP-02','SP-03','SP-04','SP-05','SP-06'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                type="date"
                value={newTargetDate}
                onChange={e => setNewTargetDate(e.target.value)}
                className="col-span-3 px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                  text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
              />
              <input
                type="number"
                placeholder="Daily target (pcs)"
                value={newTargetValue}
                onChange={e => setNewTargetValue(e.target.value)}
                min={1}
                className="col-span-4 px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                  text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#2AAA8A] transition-all"
              />
              <button
                onClick={handleAddTarget}
                disabled={!newTargetDate || !newTargetValue || targetBusy}
                className="col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 bg-[#2AAA8A] hover:bg-[#249978] text-white text-xs font-semibold rounded-xl
                  disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <FiPlus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            {targetStatus !== 'idle' && (
              <div className={`flex items-center gap-2 px-3 py-2 mb-3 rounded-xl text-xs font-medium border ${
                targetStatus === 'success'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {targetStatus === 'success'
                  ? <><FiCheck className="w-3.5 h-3.5" /> Target saved</>
                  : <><FiAlertCircle className="w-3.5 h-3.5" /> Failed to save target</>}
              </div>
            )}

            {/* Existing targets */}
            {targets.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No targets configured. Reports use the default of 1,500 pcs/day.</p>
            ) : (
              <div className="border border-gray-100 dark:border-[#2c2c2c] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-[#111111]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Plant</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">From Date</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Daily Target</th>
                      <th className="px-3 py-2 w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
                    {targets.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-[#111111]">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                          {t.unit === 'ALL' ? <span className="text-[#2AAA8A]">All Plants</span> : t.unit}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t.from_date}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">
                          {t.daily_target.toLocaleString()} pcs
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleDeleteTarget(t.id)}
                            disabled={targetBusy}
                            className="text-red-500 hover:text-red-600 disabled:opacity-50"
                            title="Remove"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Email Configuration (admin only) ─────────────────────────── */}
        {role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.22 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm space-y-6"
          >
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FiMail className="w-4 h-4 text-[#2AAA8A]" />
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Email Configuration</p>
              </div>
              <p className="text-[11px] text-gray-400">
                Configure recipients for daily production summary emails. Managers receive summaries for their allocated plants only, while Directors receive master summaries + copies of manager emails.
              </p>
            </div>

            {/* Form to add recipient */}
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-[#111111] rounded-2xl border border-gray-100 dark:border-[#2c2c2c]">
              <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Add New Recipient</p>
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={newRecName}
                  onChange={e => setNewRecName(e.target.value)}
                  className="col-span-4 px-3 py-2 text-xs bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                />
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={newRecEmail}
                  onChange={e => setNewRecEmail(e.target.value)}
                  className="col-span-5 px-3 py-2 text-xs bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                />
                <select
                  value={newRecRole}
                  onChange={e => {
                    setNewRecRole(e.target.value);
                    if (e.target.value === 'DIRECTOR') setNewRecPlants([]);
                  }}
                  className="col-span-3 px-3 py-2 text-xs bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                >
                  <option value="MANAGER">Manager</option>
                  <option value="DIRECTOR">Director</option>
                </select>
              </div>

              {newRecRole === 'MANAGER' && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">Allocated Plants</label>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {['SP-01','SP-02','SP-03','SP-04','SP-05','SP-06'].map(p => (
                      <label key={p} className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRecPlants.includes(p)}
                          onChange={e => {
                            if (e.target.checked) setNewRecPlants([...newRecPlants, p]);
                            else setNewRecPlants(newRecPlants.filter(x => x !== p));
                          }}
                          className="rounded border-gray-300 dark:border-[#2c2c2c] text-[#2AAA8A] focus:ring-[#2AAA8A]"
                        />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={handleAddRecipient}
                  disabled={!newRecName || !newRecEmail || recBusy}
                  className="inline-flex items-center gap-1 px-4 py-2 bg-[#2AAA8A] hover:bg-[#249978] text-white text-xs font-semibold rounded-xl
                    disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <FiPlus className="w-3.5 h-3.5" /> Save Recipient
                </button>
              </div>

              {recStatus !== 'idle' && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
                  recStatus === 'success'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-600'
                }`}>
                  {recStatus === 'success'
                    ? <><FiCheck className="w-3.5 h-3.5" /> Recipient saved successfully</>
                    : <><FiAlertCircle className="w-3.5 h-3.5" /> Failed to save recipient</>}
                </div>
              )}
            </div>

            {/* Test Email & Manual Dispatch utilities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-[#111111] rounded-2xl border border-gray-100 dark:border-[#2c2c2c] space-y-3">
                <div>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Test SMTP Configuration</p>
                  <p className="text-[10px] text-gray-400">Send a connection test email to verify SMTP host settings.</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="test@example.com"
                    value={testEmailAddress}
                    onChange={e => setTestEmailAddress(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                      text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all"
                  />
                  <button
                    onClick={handleSendTestEmail}
                    disabled={!testEmailAddress}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-[#252525] dark:hover:bg-[#2e2e2e] text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-xl
                      disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    Send Test Email
                  </button>
                </div>
                {testEmailStatus !== 'idle' && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
                    testEmailStatus === 'success'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-600'
                  }`}>
                    {testEmailStatus === 'success'
                      ? <><FiCheck className="w-3.5 h-3.5" /> Test email sent successfully!</>
                      : <><FiAlertCircle className="w-3.5 h-3.5" /> Failed to send test email. Check server log.</>}
                  </div>
                )}
              </div>

              <div className="p-4 bg-gray-50 dark:bg-[#111111] rounded-2xl border border-gray-100 dark:border-[#2c2c2c] space-y-3 flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Manual Report Dispatch</p>
                  <p className="text-[10px] text-gray-400">Trigger immediate dispatch of today&apos;s full production reports to all configured recipients.</p>
                </div>
                <button
                  onClick={handleDispatchSummary}
                  disabled={dispatchingSummary}
                  className="w-full py-2 bg-[#0c2340] hover:bg-[#13325b] text-white text-xs font-semibold rounded-xl
                    disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {dispatchingSummary ? 'Dispatching Reports…' : 'Dispatch Today\'s Summary Now'}
                </button>
                {dispatchStatus !== 'idle' && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
                    dispatchStatus === 'success'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-600'
                  }`}>
                    {dispatchStatus === 'success'
                      ? <><FiCheck className="w-3.5 h-3.5" /> {dispatchMsg}</>
                      : <><FiAlertCircle className="w-3.5 h-3.5" /> {dispatchMsg}</>}
                  </div>
                )}
              </div>
            </div>

            {/* List of existing recipients */}
            <div>
              <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">Configured Recipients</p>
              {recipients.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No report recipients configured.</p>
              ) : (
                <div className="border border-gray-100 dark:border-[#2c2c2c] rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-[#111111]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Allocated Plants</th>
                        <th className="px-3 py-2 w-12" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
                      {recipients.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-[#111111]">
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{r.name}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{r.email}</td>
                          <td className="px-3 py-2 font-semibold">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${
                              r.role === 'DIRECTOR'
                                ? 'bg-purple-50 text-purple-600 border border-purple-100'
                                : 'bg-blue-50 text-blue-600 border border-blue-100'
                            }`}>
                              {r.role}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                            {r.role === 'DIRECTOR' ? (
                              <span className="text-[#2AAA8A] font-semibold">All Plants</span>
                            ) : (
                              r.allocated_plants || <span className="text-red-400 italic">None</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleDeleteRecipient(r.id)}
                              disabled={recBusy}
                              className="text-red-500 hover:text-red-600 disabled:opacity-50"
                              title="Delete"
                            >
                              <FiTrash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
