import type { PlantId } from '../types';

/**
 * Canonical account-access shape stored in Clerk publicMetadata (and mirrored
 * into the session JWT's `metadata` claim). Two independent grants per account:
 *
 *   dashboard: can this account use the web dashboard, and at what role
 *   mobile:    can this account use the mobile app, and at what role/plant
 *
 * Two coupling rules on top (enforced where metadata is WRITTEN, in the admin
 * API routes — this file only reads/normalizes):
 *   Rule A (default, overridable): dashboard.role="admin" defaults mobile to
 *     {enabled:true, role:"admin"} unless the same edit set mobile explicitly.
 *   Rule B (hard constraint): dashboard.role="admin" and mobile.role="user"
 *     can never both be true at once.
 *
 * Legacy accounts created before this schema only have a flat `role` field —
 * getDashboardAccess() falls back to treating that as an enabled dashboard
 * grant with no mobile access, so existing admins/supervisors keep working
 * without a forced migration.
 */

export type DashboardRole = 'admin' | 'supervisor';
export type MobileRole = 'admin' | 'user';

export interface AccessMetadata {
  dashboard?: { enabled?: boolean; role?: DashboardRole } | null;
  mobile?: { enabled?: boolean; role?: MobileRole; plant?: string | null } | null;
  /** Legacy flat shape, pre-dating the dashboard/mobile split. */
  role?: DashboardRole;
}

export interface DashboardAccess {
  enabled: boolean;
  role: DashboardRole | null;
}

export interface MobileAccess {
  enabled: boolean;
  role: MobileRole | null;
  plant: PlantId | null;
}

export function getDashboardAccess(meta: AccessMetadata | null | undefined): DashboardAccess {
  if (!meta) return { enabled: false, role: null };
  if (meta.dashboard) {
    return { enabled: !!meta.dashboard.enabled, role: meta.dashboard.role ?? null };
  }
  // Legacy flat shape: presence of `role` meant "has dashboard access" pre-split.
  if (meta.role) {
    return { enabled: true, role: meta.role };
  }
  return { enabled: false, role: null };
}

export function getMobileAccess(meta: AccessMetadata | null | undefined): MobileAccess {
  if (!meta?.mobile) return { enabled: false, role: null, plant: null };
  return {
    enabled: !!meta.mobile.enabled,
    role: meta.mobile.role ?? null,
    plant: (meta.mobile.plant as PlantId | undefined) ?? null,
  };
}

/**
 * Applies Rule A + Rule B to a proposed (dashboard, mobile) pair and returns
 * the normalized result to actually persist, or an error if the combination
 * is unsatisfiable. Used by the admin API routes on every create/update.
 *
 * `mobileTouched` distinguishes "the edit didn't mention mobile at all" (Rule
 * A's default may apply) from "the edit explicitly set mobile" (no default —
 * use exactly what was given, then still enforce Rule B).
 */
export function applyAccessRules(
  dashboard: { enabled: boolean; role: DashboardRole | null },
  mobile: { enabled: boolean; role: MobileRole | null; plant: string | null },
  mobileTouched: boolean,
): { dashboard: { enabled: boolean; role: DashboardRole | null };
     mobile: { enabled: boolean; role: MobileRole | null; plant: string | null };
     error?: string } {
  let d = { ...dashboard };
  let m = { ...mobile };

  // Rule A: Dashboard Admin defaults Mobile to enabled+admin, but only when
  // this edit didn't already say what mobile should be.
  if (d.enabled && d.role === 'admin' && !mobileTouched) {
    m = { enabled: true, role: 'admin', plant: null };
  }

  // Rule B: Dashboard Admin + Mobile User (plant-scoped) is never allowed.
  if (d.enabled && d.role === 'admin' && m.enabled && m.role === 'user') {
    return {
      dashboard: d,
      mobile: m,
      error: 'A Dashboard Admin cannot also be a plant-scoped Mobile User. '
        + 'Set Mobile role to Admin, or change Dashboard role to Supervisor / disable dashboard access.',
    };
  }

  if (m.enabled && m.role === 'user' && !m.plant) {
    return { dashboard: d, mobile: m, error: 'A plant is required when Mobile role is User.' };
  }

  return { dashboard: d, mobile: m };
}
