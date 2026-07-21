"use client";
import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import {
  FiUserPlus, FiTrash2, FiMail, FiUser, FiCheck, FiAlertCircle, FiLock,
  FiSmartphone, FiMonitor, FiEdit2, FiX,
} from 'react-icons/fi';
import Unauthorized from '../../components/Unauthorized';
import { PLANTS } from '../../lib/constants';
import { getDashboardAccess, type DashboardRole, type MobileRole } from '../../lib/access';
import type { PlantId } from '../../types';

interface DashboardGrant { enabled: boolean; role: DashboardRole | null; }
interface MobileGrant { enabled: boolean; role: MobileRole | null; plant: PlantId | null; }

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  dashboard: DashboardGrant;
  mobile: MobileGrant;
  createdAt: number;
}

// ── Access-grant editor — shared by the Create form and the per-row editor ──
interface AccessState {
  dashboardEnabled: boolean;
  dashboardRole: DashboardRole;
  mobileEnabled: boolean;
  mobileRole: MobileRole;
  mobilePlant: PlantId | '';
}

function defaultAccessState(): AccessState {
  return { dashboardEnabled: true, dashboardRole: 'supervisor', mobileEnabled: false, mobileRole: 'user', mobilePlant: '' };
}

function accessStateFromUser(u: AdminUser): AccessState {
  return {
    dashboardEnabled: u.dashboard.enabled,
    dashboardRole:    u.dashboard.role ?? 'supervisor',
    mobileEnabled:    u.mobile.enabled,
    mobileRole:       u.mobile.role ?? 'user',
    mobilePlant:      u.mobile.plant ?? '',
  };
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-[#2AAA8A]' : 'bg-gray-300 dark:bg-[#2c2c2c]'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

// Rule A: Dashboard role -> Admin defaults Mobile to enabled+admin, unless the
// admin already touched the mobile controls in this same form session.
// Rule B: Dashboard Admin and Mobile User (plant-scoped) can never both be
// true — enforced here by disabling the option that would create the clash.
function AccessFields({ state, setState, mobileTouchedRef }: {
  state: AccessState;
  setState: (s: AccessState) => void;
  mobileTouchedRef: React.MutableRefObject<boolean>;
}) {
  const dashboardAdminDisabled = state.mobileEnabled && state.mobileRole === 'user';
  const mobileUserDisabled     = state.dashboardEnabled && state.dashboardRole === 'admin';

  const onDashboardToggle = (enabled: boolean) => setState({ ...state, dashboardEnabled: enabled });

  const onDashboardRole = (role: DashboardRole) => {
    let next: AccessState = { ...state, dashboardRole: role };
    if (role === 'admin' && !mobileTouchedRef.current) {
      next = { ...next, mobileEnabled: true, mobileRole: 'admin', mobilePlant: '' };
    }
    setState(next);
  };

  const onMobileToggle = (enabled: boolean) => {
    mobileTouchedRef.current = true;
    setState({ ...state, mobileEnabled: enabled });
  };

  const onMobileRole = (role: MobileRole) => {
    mobileTouchedRef.current = true;
    setState({ ...state, mobileRole: role, mobilePlant: role === 'admin' ? '' : state.mobilePlant });
  };

  const onMobilePlant = (plant: PlantId) => {
    mobileTouchedRef.current = true;
    setState({ ...state, mobilePlant: plant });
  };

  const selectCls = "px-2 py-1.5 text-xs bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-lg "
    + "text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] capitalize";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c]">
        <div className="flex items-center gap-2 min-w-0">
          <FiMonitor className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Dashboard access</span>
        </div>
        <div className="flex items-center gap-2">
          {state.dashboardEnabled && (
            <select value={state.dashboardRole} onChange={e => onDashboardRole(e.target.value as DashboardRole)} className={selectCls}>
              <option value="supervisor">Supervisor</option>
              <option value="admin" disabled={dashboardAdminDisabled}
                title={dashboardAdminDisabled ? "A plant-scoped Mobile User can't be Dashboard Admin" : undefined}>
                Admin
              </option>
            </select>
          )}
          <Toggle checked={state.dashboardEnabled} onChange={onDashboardToggle} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c]">
        <div className="flex items-center gap-2 min-w-0">
          <FiSmartphone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Mobile user</span>
        </div>
        <div className="flex items-center gap-2">
          {state.mobileEnabled && (
            <>
              <select value={state.mobileRole} onChange={e => onMobileRole(e.target.value as MobileRole)} className={selectCls}>
                <option value="user" disabled={mobileUserDisabled}
                  title={mobileUserDisabled ? "A Dashboard Admin can't be a plant-scoped Mobile User" : undefined}>
                  User
                </option>
                <option value="admin">Admin</option>
              </select>
              {state.mobileRole === 'user' && (
                <select value={state.mobilePlant} onChange={e => onMobilePlant(e.target.value as PlantId)} className={selectCls}>
                  <option value="">Select plant…</option>
                  {PLANTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </>
          )}
          <Toggle checked={state.mobileEnabled} onChange={onMobileToggle} />
        </div>
      </div>
    </div>
  );
}

function DashboardBadge({ d }: { d: DashboardGrant }) {
  if (!d.enabled) return <span className="text-[10px] text-gray-400 italic">Off</span>;
  return (
    <span className={`capitalize px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
      d.role === 'admin'
        ? 'bg-[#2AAA8A]/10 border-[#2AAA8A]/25 text-[#2AAA8A]'
        : 'bg-gray-100 dark:bg-[#252525] border-gray-200 dark:border-[#2c2c2c] text-gray-500 dark:text-gray-400'
    }`}>
      {d.role}
    </span>
  );
}

function MobileBadge({ m }: { m: MobileGrant }) {
  if (!m.enabled) return <span className="text-[10px] text-gray-400 italic">Off</span>;
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
      {m.role === 'admin' ? 'Admin · All plants' : `User · ${m.plant}`}
    </span>
  );
}

export default function Users() {
  const { user, isLoaded } = useUser();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Create-user form state
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [access,    setAccess]    = useState<AccessState>(defaultAccessState());
  const createMobileTouched = useRef(false);
  const [creating,  setCreating]  = useState(false);
  const [createStatus, setCreateStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [createError, setCreateError]   = useState('');

  // Row action state
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAccess, setEditAccess] = useState<AccessState>(defaultAccessState());
  const editMobileTouched = useRef(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load users');
      setUsers(await res.json());
    } catch {
      setRowError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = useCallback(async () => {
    if (!email || !password) return;
    setCreating(true);
    setCreateStatus('idle');
    setCreateError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName, lastName, email, password,
          dashboard: { enabled: access.dashboardEnabled, role: access.dashboardRole },
          mobile: { enabled: access.mobileEnabled, role: access.mobileRole, plant: access.mobilePlant || null },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create user');
      setFirstName(''); setLastName(''); setEmail(''); setPassword('');
      setAccess(defaultAccessState());
      createMobileTouched.current = false;
      setCreateStatus('success');
      await loadUsers();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
      setCreateStatus('error');
    } finally {
      setCreating(false);
      setTimeout(() => setCreateStatus('idle'), 4000);
    }
  }, [firstName, lastName, email, password, access, loadUsers]);

  const startEdit = useCallback((u: AdminUser) => {
    setEditingId(u.id);
    setEditAccess(accessStateFromUser(u));
    editMobileTouched.current = false;
    setRowError('');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    setSavingEdit(true);
    setRowError('');
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dashboard: { enabled: editAccess.dashboardEnabled, role: editAccess.dashboardRole },
          mobile: { enabled: editAccess.mobileEnabled, role: editAccess.mobileRole, plant: editAccess.mobilePlant || null },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to update access');
      setUsers(prev => prev.map(u => u.id === id ? { ...u, dashboard: data.dashboard, mobile: data.mobile } : u));
      setEditingId(null);
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Failed to update access');
    } finally {
      setSavingEdit(false);
    }
  }, [editAccess]);

  const handleDelete = useCallback(async (id: string) => {
    setBusyId(id);
    setRowError('');
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to delete user');
      setUsers(prev => prev.filter(u => u.id !== id));
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }, []);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
      </div>
    );
  }

  if (getDashboardAccess(user?.publicMetadata).role !== 'admin') {
    return <Unauthorized />;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
          Users
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Create accounts and manage dashboard + mobile access</p>
      </motion.div>

      <div className="mt-6 max-w-2xl space-y-4">

        {/* ── Create User ──────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <FiUserPlus className="w-4 h-4 text-[#2AAA8A]" />
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Create User</p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1.5">First Name</label>
              <div className="relative">
                <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
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
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Last name"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white placeholder-gray-400
                    focus:outline-none focus:bg-white dark:focus:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#444] transition-all"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1.5">Email</label>
              <div className="relative">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white placeholder-gray-400
                    focus:outline-none focus:bg-white dark:focus:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#444] transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1.5">Temporary Password</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                    text-gray-900 dark:text-white placeholder-gray-400
                    focus:outline-none focus:bg-white dark:focus:bg-[#1a1a1a] focus:border-gray-400 dark:focus:border-[#444] transition-all"
                />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-gray-500 font-medium mb-1.5">Access</label>
            <AccessFields state={access} setState={setAccess} mobileTouchedRef={createMobileTouched} />
          </div>

          {createStatus !== 'idle' && (
            <div className={`flex items-center gap-2 px-3 py-2 mb-3 rounded-xl text-xs font-medium border ${
              createStatus === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-600'
            }`}>
              {createStatus === 'success'
                ? <><FiCheck className="w-3.5 h-3.5" /> User created</>
                : <><FiAlertCircle className="w-3.5 h-3.5" /> {createError}</>}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!email || !password || creating}
            className="px-5 py-2 bg-[#2AAA8A] hover:bg-[#249978] text-white text-xs font-semibold rounded-xl
              disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </motion.div>

        {/* ── Existing Users ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-6 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <FiUser className="w-4 h-4 text-[#2AAA8A]" />
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">All Users</p>
          </div>

          {rowError && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-xl text-xs font-medium border bg-red-50 border-red-200 text-red-600">
              <FiAlertCircle className="w-3.5 h-3.5" /> {rowError}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-gray-400 italic">Loading…</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No users found.</p>
          ) : (
            <div className="border border-gray-100 dark:border-[#2c2c2c] rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-[#111111]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Dashboard</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Mobile</th>
                    <th className="px-3 py-2 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
                  {users.map(u => {
                    const isSelf = u.id === user?.id;
                    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
                    const isEditing = editingId === u.id;
                    return (
                      <Fragment key={u.id}>
                        <tr className="hover:bg-gray-50 dark:hover:bg-[#111111]">
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                            {name}{isSelf && <span className="ml-1.5 text-[10px] text-gray-400">(you)</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{u.email}</td>
                          <td className="px-3 py-2"><DashboardBadge d={u.dashboard} /></td>
                          <td className="px-3 py-2"><MobileBadge m={u.mobile} /></td>
                          <td className="px-3 py-2 text-right">
                            {confirmDeleteId === u.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-[10px] text-red-500 font-medium">Delete?</span>
                                <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-gray-500 hover:text-gray-700 font-medium">
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleDelete(u.id)}
                                  disabled={busyId === u.id}
                                  className="text-[10px] text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-lg font-semibold disabled:opacity-60"
                                >
                                  Yes
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-3">
                                <button
                                  onClick={() => isEditing ? cancelEdit() : startEdit(u)}
                                  className="text-gray-400 hover:text-[#2AAA8A] disabled:opacity-40"
                                  title={isEditing ? 'Close' : 'Edit access'}
                                >
                                  {isEditing ? <FiX className="w-3.5 h-3.5" /> : <FiEdit2 className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(u.id)}
                                  disabled={busyId === u.id || isSelf}
                                  title={isSelf ? "You can't delete your own account" : 'Delete user'}
                                  className="text-red-500 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <FiTrash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isEditing && (
                          <tr className="bg-gray-50/60 dark:bg-[#111111]/60">
                            <td colSpan={5} className="px-3 py-3">
                              <AccessFields state={editAccess} setState={setEditAccess} mobileTouchedRef={editMobileTouched} />
                              <div className="flex items-center gap-2 mt-3">
                                <button
                                  onClick={() => saveEdit(u.id)}
                                  disabled={savingEdit}
                                  className="px-4 py-1.5 bg-[#2AAA8A] hover:bg-[#249978] text-white text-xs font-semibold rounded-lg
                                    disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                                >
                                  {savingEdit ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={savingEdit}
                                  className="px-4 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>

      </div>
    </div>
  );
}
