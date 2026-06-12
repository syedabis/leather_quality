import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { ROLES } from '../../../../lib/constants';

async function requireAdmin() {
  const { sessionClaims } = await auth();
  return sessionClaims?.metadata?.role === ROLES.ADMIN;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await clerkClient();
  const { data } = await client.users.getUserList({ limit: 100 });

  const users = data.map(u => ({
    id:        u.id,
    email:     u.emailAddresses[0]?.emailAddress ?? '',
    firstName: u.firstName,
    lastName:  u.lastName,
    role:      (u.publicMetadata?.role as string | undefined) ?? ROLES.SUPERVISOR,
    createdAt: u.createdAt,
  }));

  return NextResponse.json(users);
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { firstName, lastName, email, password, role } = body ?? {};

  if (!email || !password || !role) {
    return NextResponse.json({ error: 'email, password and role are required' }, { status: 400 });
  }
  if (role !== ROLES.ADMIN && role !== ROLES.SUPERVISOR) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const client = await clerkClient();
  try {
    const user = await client.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      lastName,
      publicMetadata: { role },
    });
    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (err: unknown) {
    const message = (err as { errors?: { longMessage?: string }[] })?.errors?.[0]?.longMessage
      ?? (err instanceof Error ? err.message : 'Failed to create user');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
