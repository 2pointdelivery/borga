/**
 * The one transform every data save goes through before it is written:
 * client-supplied privilege fields are stripped and money entities are
 * recalculated from their lines. Extracted from the route so the save path
 * itself (not just the individual helpers) is unit-tested, and so the two
 * cannot drift apart: the route calls exactly this function.
 */

import { stripClientPrivileges } from './client-privileges';
import { MONEY_ENTITIES, normalizeMoneyEntity } from './pricing';

export function isMoneyEntity(entity: string): boolean {
  return (MONEY_ENTITIES as readonly string[]).includes(entity);
}

export function prepareEntityForSave(entity: string, value: unknown, currency = 'USD'): unknown {
  const stripped = stripClientPrivileges(entity, value ?? null);
  return isMoneyEntity(entity) ? normalizeMoneyEntity(entity, stripped, currency) : stripped;
}
