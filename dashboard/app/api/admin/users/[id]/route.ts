import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { ROLES } from '../../../../../lib/constants';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth();
  if (sessionClaims?.metadata?.role !== ROLES.ADMIN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const { role } = (await req.json()) ?? {};
  if (role !== ROLES.ADMIN && role !== ROLES.SUPERVISOR) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  if (id === userId && role !== ROLES.ADMIN) {
    return NextResponse.json({ error: "You can't remove your own admin role" }, { status: 400 });
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(id, { publicMetadata: { role } });
  return NextResponse.json({ status: 'ok' });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth();
  if (sessionClaims?.metadata?.role !== ROLES.ADMIN) {
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
