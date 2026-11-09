import 'server-only';
import { getUserById } from './queries';

/**
 * Session resolution: a signed, unexpired cookie is only good while its user
 * row still exists. Deleting an account therefore takes effect on the very
 * next request instead of when the 30-day token expires.
 *
 * Deliberately uncached — any positive cache would keep a deleted account
 * alive for its TTL, and this is a primary-key lookup on the connection the
 * request is already using. The caller fails open on errors, so a database
 * outage cannot lock every signed-in user out.
 */
export async function sessionUserGone(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user === null;
}
