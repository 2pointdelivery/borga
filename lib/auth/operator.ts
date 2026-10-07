import 'server-only';
import type { NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { getUserById } from './queries';
import { isOperator } from './signup-policy';

/** The signed-in user if (and only if) they are a deployment operator; otherwise null. */
export async function operatorFromRequest(req: NextRequest): Promise<{ userId: string; email: string } | null> {
  const userId = await sessionUserId(req);
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user || !isOperator(user.email, process.env)) return null;
  return { userId, email: user.email };
}
