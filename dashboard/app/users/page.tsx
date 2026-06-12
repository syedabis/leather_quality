"use client";
import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { FiUserPlus, FiTrash2, FiShield, FiMail, FiUser, FiCheck, FiAlertCircle, FiLock } from 'react-icons/fi';
import Unauthorized from '../../components/Unauthorized';
import { ROLES } from '../../lib/constants';

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  createdAt: number;
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
  const [role,      setRole]      = useState<string>(ROLES.SUPERVISOR);
  const [creating,  setCreating]  = useState(false);
  const [createStatus, setCreateStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [createError, setCreateError]   = useState('');

  // Row action state
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');

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
        body: JSON.stringify({ firstName, lastName, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create user');
      setFirstName(''); setLastName(''); setEmail(''); setPassword(''); setRole(ROLES.SUPERVISOR);
      setCreateStatus('success');
      await loadUsers();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
      setCreateStatus('error');
    } finally {
      setCreating(false);
      setTimeout(() => setCreateStatus('idle'), 4000);
    }
  }, [firstName, lastName, email, password, role, loadUsers]);

  const handleToggleRole = useCallback(async (target: AdminUser) => {
    const nextRole = target.role === ROLES.ADMIN ? ROLES.SUPERVISOR : ROLES.ADMIN;
    setBusyId(target.id);
    setRowError('');
    try {
      const res = await fetch(`/api/admin/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to update role');
      setUsers(prev => prev.map(u => u.id === target.id ? { ...u, role: nextRole } : u));
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  }, []);

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

  if (user?.publicMetadata?.role !== ROLES.ADMIN) {
    return <Unauthorized />;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
          Users
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Create accounts and manage admin access</p>
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

          <div className="grid grid-cols-2 gap-3 mb-3">
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

          <div className="flex items-center gap-3 mb-4">
            <label className="text-xs text-gray-500 font-medium">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="px-3 py-2 text-sm bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl
                text-gray-900 dark:text-white focus:outline-none focus:border-[#2AAA8A] transition-all capitalize"
            >
              <option value={ROLES.SUPERVISOR}>Supervisor</option>
              <option value={ROLES.ADMIN}>Admin</option>
            </select>
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
            <FiShield className="w-4 h-4 text-[#2AAA8A]" />
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
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                    <th className="px-3 py-2 w-40" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
                  {users.map(u => {
                    const isSelf = u.id === user?.id;
                    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
                    return (
                      <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-[#111111]">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                          {name}{isSelf && <span className="ml-1.5 text-[10px] text-gray-400">(you)</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{u.email}</td>
                        <td className="px-3 py-2">
                          <span className={`capitalize px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            u.role === ROLES.ADMIN
                              ? 'bg-[#2AAA8A]/10 border-[#2AAA8A]/25 text-[#2AAA8A]'
                              : 'bg-gray-100 dark:bg-[#252525] border-gray-200 dark:border-[#2c2c2c] text-gray-500 dark:text-gray-400'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {confirmDeleteId === u.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-[10px] text-red-500 font-medium">Delete?</span>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[10px] text-gray-500 hover:text-gray-700 font-medium"
                              >
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
                                onClick={() => handleToggleRole(u)}
                                disabled={busyId === u.id || (isSelf && u.role === ROLES.ADMIN)}
                                title={isSelf && u.role === ROLES.ADMIN ? "You can't remove your own admin role" : undefined}
                                className="text-[10px] font-semibold text-[#2AAA8A] hover:text-[#249978] disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {u.role === ROLES.ADMIN ? 'Make Supervisor' : 'Make Admin'}
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
