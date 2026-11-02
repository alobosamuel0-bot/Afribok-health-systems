import type { AfribokDb } from './db'

/**
 * Afribok no longer seeds staff accounts or sample patients into a real
 * deployment. The first account created through the sign-up screen becomes the
 * hospital administrator and the onboarding cards configure the workspace.
 *
 * Test fixtures live in tests/helpers.ts and are never imported by the server.
 */
export function seedFacility(_db: AfribokDb): { seededUsers: boolean; seededPatients: boolean } {
  return { seededUsers: false, seededPatients: false }
}
