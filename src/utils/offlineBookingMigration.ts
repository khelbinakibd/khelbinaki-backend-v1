/** Operator attestation, not a distributed lock. Before acknowledging, stop all
 * API instances, workers and scripts and disable their database access. A flag
 * alone cannot discover remote writers; see the prerequisite migration runbook.
 */
export function assertOfflineBookingMigration(
  args: string[],
  environment: NodeJS.ProcessEnv,
  connectedDatabase?: string,
): void {
  if (environment.NODE_ENV === 'production')
    throw new Error('Legacy booking migration is development-only; production is refused')

  if (!args.includes('--offline')
    || environment.BOOKING_MIGRATION_OFFLINE_ACK !== 'all-writers-stopped-and-access-disabled') {
    throw new Error('Offline migration required: stop all booking writers, disable their database access, then supply --offline and BOOKING_MIGRATION_OFFLINE_ACK=all-writers-stopped-and-access-disabled')
  }

  const confirmations = args.filter(arg => arg.startsWith('--confirm-database='))
  const confirmedDatabase = confirmations[0]?.slice('--confirm-database='.length)
  if (confirmations.length !== 1 || !confirmedDatabase)
    throw new Error('Exactly one --confirm-database=<development database name> is required')

  if (connectedDatabase !== undefined && connectedDatabase !== confirmedDatabase)
    throw new Error('Connected database differs from the explicitly confirmed development database; migration refused')
}
