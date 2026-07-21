import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { PLANTS } from '../../../../../lib/constants';
import {
  getDashboardAccess, getMobileAccess, applyAccessRules,
  type DashboardRole, type MobileRole,
} from '../../../../../lib/access';

const PLANT_IDS = new Set(PLANTS.map(p => p.id));

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth();
  if (getDashboardAccess(sessionClaims?.metadata).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json()) ?? {};

  const client = await clerkClient();
  const target = await client.users.getUser(id);
  const currentDashboard = getDashboardAccess(target.publicMetadata);
  const currentMobile    = getMobileAccess(target.publicMetadata);

  // Only apply the pieces of dashboard/mobile actually present in this PATCH —
  // an edit that only touches `mobile` must leave `dashboard` exactly as it was.
  const dashboardIn = body.dashboard;
  const mobileIn    = body.mobile;

  const dashboardEnabled = dashboardIn ? !!dashboardIn.enabled : currentDashboard.enabled;
  const dashboardRole    = dashboardIn ? dashboardIn.role : currentDashboard.role;
  if (dashboardIn && dashboardEnabled && dashboardRole !== 'admin' && dashboardRole !== 'supervisor') {
    return NextResponse.json({ error: 'Invalid dashboard role' }, { status: 400 });
  }

  const mobileEnabled = mobileIn ? !!mobileIn.enabled : currentMobile.enabled;
  const mobileRole    = mobileIn ? mobileIn.role : currentMobile.role;
  const mobilePlant   = mobileIn ? mobileIn.plant : currentMobile.plant;
  if (mobileIn && mobileEnabled && mobileRole !== 'admin' && mobileRole !== 'user') {
    return NextResponse.json({ error: 'Invalid mobile role' }, { status: 400 });
  }
  if (mobileIn && mobileEnabled && mobileRole === 'user' && !PLANT_IDS.has(mobilePlant)) {
    return NextResponse.json({ error: 'A valid plant is required when mobile role is User' }, { status: 400 });
  }

  const mobileTouched = !!mobileIn;
  const normalized = applyAccessRules(
    { enabled: dashboardEnabled, role: dashboardEnabled ? (dashboardRole as DashboardRole) : null },
    { enabled: mobileEnabled, role: mobileEnabled ? (mobileRole as MobileRole) : null, plant: mobileEnabled ? (mobilePlant ?? null) : null },
    mobileTouched,
  );
  if (normalized.error) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  if (id === userId && !(normalized.dashboard.enabled && normalized.dashboard.role === 'admin')) {
    return NextResponse.json({ error: "You can't remove your own dashboard admin access" }, { status: 400 });
  }

  await client.users.updateUserMetadata(id, {
    publicMetadata: { dashboard: normalized.dashboard, mobile: normalized.mobile },
  });
  return NextResponse.json({ status: 'ok', dashboard: normalized.dashboard, mobile: normalized.mobile });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth();
  if (getDashboardAccess(sessionClaims?.metadata).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (id === userId) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }

  const client = await clerkClient();
  await client.users.deleteUser(id);
  return NextResponse.json({ status: 'ok' });
}
