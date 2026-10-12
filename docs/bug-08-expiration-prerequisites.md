# BUG-08 expiration prerequisites and development TTL migration

Status: code and migration plan prepared. No development or production database records
or indexes have been changed. Maintenance blocking is implemented in source; see
`bug-08-maintenance.md` for deployment prerequisites and isolated test results. Do not run application startup for this work: `src/index.ts`
calls `seedAll()`.

## Expiration audit and intended behavior

* `Booking` declares `expiresAt`, previously with a zero-second MongoDB TTL index.
  That index deletes **any** booking with a due deadline, regardless of status or
  payment. The development audit confirmed `expiresAt_1` exists. Declarations do
  not remove existing indexes.
* Customer creation (`bookingController.ts`) creates pending manual-payment requests
  with `paymentStatus: pending_approval` and **no deadline**. Do not infer a deadline
  from `createdAt` or expire these requests just because they are 15 minutes old.
* Admin manual creation (`adminController.ts`) creates confirmed bookings and
  explicitly sets `expiresAt: undefined`. No other application path sets deadlines.
* `cleanupExpiredBookings()` previously bulk-updated explicitly due pending bookings
  to `expired`, but the schema did not accept that status. Dashboards already count
  expired bookings. The helper is not called by startup: `startPeriodicCleanup()`
  only handles OTPs and refresh tokens. Their TTL indexes are unaffected.
* Public availability, customer/admin creation and maintenance now consistently treat
  all pending and confirmed bookings as active, regardless of age, matching BUG-04.
  The old 15-minute read/precheck heuristic is removed; it was not an expiry policy.

Explicit expiration preserves the cleanup helper's intended predicate: `pending`
with payment status other than `paid` and a BSON Date `expiresAt` strictly earlier
than a fixed UTC cutoff. Paid-pending and confirmed bookings are excluded. This includes
pending payment-approval requests **only if they have an explicit deadline**. Payment
fields remain unchanged; expiry is not a refund. No new deadlines are introduced.
Confirmed, cancelled and already expired records are retained and never expire through
this service. Unlike the old TTL, expiration records history rather than deleting it.
This is an intentional correction to autonomous deletion, not a promise to preserve
that deletion behavior. Review unexpected deadlines on non-pending records before rollout.

`expired` is a valid terminal schema status, but is not added to the public status-update
API. `expiredAt` records the run's cutoff and `expiresAt` retains the original deadline
for audit. That retained deadline is another reason not to blindly recreate TTL on rollback.
The BUG-04 unique index stays unchanged: pending/confirmed are active; expired is excluded.
BUG-05 Dhaka booking dates and validation remain unchanged. Expiration compares absolute
instants, never local dates or wall-clock strings.

## Guarded cleanup prepared in code

`expirePendingBookings(now, batchSize)` processes at most 100 candidates by default
(maximum 1000). It refuses if any Booking TTL index exists or a candidate has no
facility/turf. For each candidate it uses a separate MongoDB transaction:

1. Increment `Facility.occupancyRevision` for the exact facility/turf.
2. Conditionally update the exact booking if status, facility, turf and deadline still
   match; set `expired`/`expiredAt`, retain the deadline, validate the schema.
3. Commit and close the session before processing the next candidate.

All transaction operations are sequential. Driver retries re-execute the callback;
there are no emails or external side effects inside it. The `$inc` initializes old
facilities without a backfill and the field is excluded from normal query results.
Missing facilities, standalone deployments and failed transactions never trigger an
unguarded fallback. Each booking commits independently: a later error leaves earlier
successful transitions committed. Runs are idempotent and can resume; the return value
counts actual transitions in one batch. Operators must monitor errors and repeat batches
until no candidates remain; this is not an all-or-nothing bulk migration. The legacy
`cleanupExpiredBookings(batchLimit = 100)` wrapper now explicitly performs just one batch.
`ExpirationBatchError` carries `completedCount`, `candidateCount`, `batchLimit` and the
original `cause`. `completedCount` is the number of positively acknowledged earlier
commits, not an assertion that the failed transaction could never have committed after
an uncertain commit result. Stop on error, inspect/reconcile state, then resume idempotently;
never automatically undo earlier transitions or report a complete sweep from one batch.

**Do not enable online cleanup yet.** The handlers are guarded in source, but the full
deployment, TTL migration and rollout verification are still pending.
The service requires `BOOKING_EXPIRATION_OFFLINE_ACK=all-other-writers-stopped-and-access-disabled`
on every invocation. This is operator attestation, not discovery of remote writers.
Stop all API processes, workers and migration scripts, and disable their MongoDB access
before acknowledging. Use a separate migration credential. No scheduler or CLI that
automatically expires records has been added. The shared guard is now integrated into
creation, cancellation, confirmation/reactivation, payment approval and deletion. Only
a separately approved rollout may remove this offline restriction after migration and
verification; this change deliberately leaves it in place.

The proposed online worker, once BUG-08 is complete, runs every minute, captures one
cutoff per sweep, and repeats bounded batches until empty or a per-sweep work budget is
reached. Avoid overlapping sweeps within a process. Duplicate workers remain safe through
conditional updates and the shared guard, but a single designated worker is simpler.
Catch/report failures without an unhandled rejection, retry on the next sweep, and alert
on sustained failures or a growing due-pending backlog. Expiry becomes visible when its
transaction commits, not when a reader notices the clock; all readers must consider
pending/confirmed active until that transition, consistently with BUG-04. No scheduler is
enabled by this preparation.

## Legacy facility migration: offline only

The script refuses without **both** `--offline` and
`BOOKING_MIGRATION_OFFLINE_ACK=all-writers-stopped-and-access-disabled`, and requires
exactly one `--confirm-database=<development database name>` matching the connected DB.
`NODE_ENV=production` is refused. The checks also protect the exported migration function.
No `.env` file is loaded or connection opened on an unacknowledged CLI invocation.
Authorized CLI use loads `.env.development` quietly; database values must stay private.
Connections disable `autoIndex` and `autoCreate` so the script cannot implicitly alter
indexes. Failure exits nonzero; errors do not print raw driver connection details.

Before acknowledging, stop and drain all writers and disable their database access
(Atlas database user revocation/temporary privilege removal, with the prior grants
saved privately). Merely disabling HTTP routing or setting an environment variable is
insufficient. Prevent automatic restarts. Verify there are no other processes/jobs
using the migration credential. Network Access alone cannot separate writers on the
same IP. Retain the backup and restore credentials/grants only after verification.

Run only in the approved offline window using the existing `migrate:facilities` command
with those arguments. It is not run as part of tests. Do not run it alongside TTL deletion:
complete the TTL removal below first if bookings being migrated have deadlines. If offline
conditions cannot be established, abort. The script does not implement a distributed
lock and its flags cannot mechanically prove no other client is writing.

## Development database migration plan (not executed)

### 1. Preflight and backup

1. Confirm the target is the approved **development** Atlas database in a private
   authenticated session. Confirm replica-set/sharded topology and logical sessions
   with `hello`. Do not print its URI, hosts, credentials, user documents or booking data.
2. Inventory all deployed app versions, workers, cron jobs, scripts and credentials.
   Arrange an offline window as above. Do not start the normal app to test the plan.
3. Save `bookings.getIndexes()` metadata privately, including the exact TTL specification
   and the exact BUG-04 `uniq_active_booking_slot` key, uniqueness and partial predicate.
   Expect `expiresAt_1` key `{expiresAt: 1}`, `expireAfterSeconds: 0`; abort for unexpected
   definitions, additional Booking TTL indexes or a missing/mismatched BUG-04 index.
   Also record collection options and baseline counts by status/deadline presence/type.
4. Count explicitly due pending bookings, pending bookings without deadlines, bookings
   with non-Date deadlines, deadlines on confirmed/cancelled/expired bookings, and active
   bookings missing facility/turf or referencing nonexistent/mismatched facilities.
   Inspect exceptions privately. Abort on unexplained data or missing associations;
   do not invent deadlines or silently discard payment history. There were zero active
   bookings lacking facilities in the earlier development audit; recheck at migration time.
5. Take an Atlas snapshot/PITR backup (where supported) or an authenticated consistent
   backup of the development database and index metadata. Include Booking and Facility
   data together; store encrypted outside the repository. Test restore to an isolated
   database with application access disabled. Never put credentials in shell history,
   command arguments or transcripts. Confirm retention and recovery permissions.
   Stopping application writers does not stop the existing TTL monitor: a backup is a
   recovery point, not a guarantee that records cannot expire while preflighting. Record
   its timestamp and available PITR range. Recover earlier TTL deletions from backup/PITR
   only through a separately reviewed data-restoration procedure.

### 2. Remove only the Booking TTL index

Keep writers stopped and access disabled throughout. Prevent old code from recreating
the TTL index: deploy the prepared Booking schema to every instance before allowing
them to reconnect, or leave instances stopped. Do not use `syncIndexes()` or broad
index recreation. Both can touch BUG-04 or unrelated indexes.

In the already authenticated development-only MongoDB shell, after reconfirming the
selected database and saved TTL specification, the single planned index mutation is:

```javascript
db.bookings.dropIndex('expiresAt_1')
```

This is a proposed operator action, not a command run by these changes. No booking
records are edited by dropping an index. Do not drop OTP/refresh-token TTL indexes.
The schema now declares optional non-TTL `booking_expiration_candidates` on
`{status: 1, expiresAt: 1}`. Approve/create that index separately or allow normal index
creation after the deployment; expiration works without it. Avoid automatic index
creation during preflight so the plan's only initial change is the specific TTL drop.

### 3. Verify before resuming writers

* Re-read indexes: no Booking TTL option anywhere; BUG-04 metadata matches exactly.
  Record that the named TTL index is absent. If it was already absent, verify the
  entire index inventory instead of treating every drop error as success.
* Compare counts and reviewed record identities against the backup/preflight. Explain
  any differences caused by TTL deletions before the drop; do not assume dropping an
  index undoes them. Check that due records stay present over multiple former TTL
  monitor cycles (at least two minutes). Read counts/metadata only in shared output.
* Run the prepared unit tests and type-check. In an **isolated restored database**,
  test due pending -> expired with history retained, future/missing deadlines unchanged,
  confirmed bookings retained, idempotent reruns, and rollback on missing facility.
  Unit-test fakes do not replace this real MongoDB verification.
* Inspect the pending/no-deadline and non-pending/deadline cohorts manually. Customer
  payment-approval bookings must not acquire artificial 15-minute deadlines.
* Before online cleanup, deploy every guarded writer and repeat real
  replica-set contention tests (expiration vs approval/cancellation/reactivation,
  and maintenance vs booking). Until then retain the offline gate and do not schedule
  expiration. Removing TTL can retain more records; monitor storage and backlog.
* For a separately approved offline expiration run, repeat bounded batches to completion,
  verify expired records retained with payment metadata unchanged, and record aggregate
  results privately. No such run is authorized/executed by this preparation.

### 4. Rollback

Rollback of **index metadata** is reversible; replaying deletions or reverting expiration
records is not automatically reversible. Keep writers stopped and new expiration disabled.
Recreating a TTL index immediately makes every due deadline eligible for deletion, even on
confirmed bookings. Therefore do not blindly recreate it.

Before any recreation, review/backup every remaining due deadline and verify no protected
history or payment records would be lost. If due deadlines exist that must survive, leave
TTL absent and roll back application code only under a separately reviewed compatibility
plan. Do not restore old code that rejects `expired` records or can recreate TTL implicitly
without checking those records and automatic index settings first. Data restoration must
be tested in isolation and separately approved; never overlay a snapshot onto newer bookings
or restore Booking without its matching Facility state.

Only after the reviewed rollback policy permits automatic deletion, reproduce the **saved**
TTL definition (the known development definition is shown below):

```javascript
db.bookings.createIndex({ expiresAt: 1 }, { name: 'expiresAt_1', expireAfterSeconds: 0 })
```

Re-read indexes, reconfirm BUG-04, verify app compatibility, then restore the recorded
database grants and restart approved processes. The replacement non-TTL index can remain;
removing it is unnecessary for rollback. This plan does not promise recovery of records
already deleted by TTL or blindly restore expired occupancy into conflicts.

## Validation limits

`pnpm run test:expiration` contains 18 unit/CLI tests, including paid-pending exclusion
and partial-progress failure reporting. `test:maintenance` contains 3 pure unit tests
and 17 real MongoDB integration tests when `RUN_BUG08_MONGO_TESTS=1`. Real tests have
passed on an isolated disposable MongoDB 8 replica set, including observed write-conflict
retry, booking/block races and expiration vs approval. They do not connect to development
or production, execute the TTL migration, create application indexes or prove the actual
Atlas deployment has no unguarded old clients. The TTL removal/rollback rehearsal,
isolated restore, historical deadline review and rollout inventory remain deployment
prerequisites. No frontend files are changed.
