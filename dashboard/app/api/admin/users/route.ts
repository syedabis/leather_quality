import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { PLANTS } from '../../../../lib/constants';
import {
  getDashboardAccess, getMobileAccess, applyAccessRules,
  type DashboardRole, type MobileRole,
} from '../../../../lib/access';

async function requireAdmin() {
  const { sessionClaims } = await auth();
  return getDashboardAccess(sessionClaims?.metadata).role === 'admin';
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ limit: 100 });

    const users = data.map(u => ({
      id:        u.id,
      email:     u.emailAddresses[0]?.emailAddress ?? '',
      firstName: u.firstName,
      lastName:  u.lastName,
      dashboard: getDashboardAccess(u.publicMetadata),
      mobile:    getMobileAccess(u.publicMetadata),
      createdAt: u.createdAt,
    }));

    return NextResponse.json(users);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/admin/users GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const PLANT_IDS = new Set(PLANTS.map(p => p.id));

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { firstName, lastName, email, password } = body ?? {};

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const dashboardIn = body?.dashboard ?? {};
  const mobileIn    = body?.mobile ?? {};
  const dashboardEnabled = !!dashboardIn.enabled;
  const mobileEnabled    = !!mobileIn.enabled;

  if (dashboardEnabled && dashboardIn.role !== 'admin' && dashboardIn.role !== 'supervisor') {
    return NextResponse.json({ error: 'Invalid dashboard role' }, { status: 400 });
  }
  if (mobileEnabled && mobileIn.role !== 'admin' && mobileIn.role !== 'user') {
    return NextResponse.json({ error: 'Invalid mobile role' }, { status: 400 });
  }
  if (mobileEnabled && mobileIn.role === 'user' && !PLANT_IDS.has(mobileIn.plant)) {
    return NextResponse.json({ error: 'A valid plant is required when mobile role is User' }, { status: 400 });
  }

  const mobileTouched = 'mobile' in (body ?? {});
  const normalized = applyAccessRules(
    { enabled: dashboardEnabled, role: dashboardEnabled ? (dashboardIn.role as DashboardRole) : null },
    { enabled: mobileEnabled, role: mobileEnabled ? (mobileIn.role as MobileRole) : null, plant: mobileEnabled ? (mobileIn.plant ?? null) : null },
    mobileTouched,
  );
  if (normalized.error) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const client = await clerkClient();
  try {
    const user = await client.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      lastName,
      publicMetadata: { dashboard: normalized.dashboard, mobile: normalized.mobile },
    });
    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as { errors?: { longMessage?: string }[] })?.errors?.[0]?.longMessage
      ?? (err instanceof Error ? err.message : 'Failed to create user');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
