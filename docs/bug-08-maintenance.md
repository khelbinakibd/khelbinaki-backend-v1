# BUG-08 manager maintenance slot blocking

Implemented in backend source only. Existing uncommitted prerequisite changes are
retained. Development/production records and indexes have not been changed; no startup,
seeding, commit or push was run. Test fixtures run only in a disposable local replica set.

## API

All endpoints require existing cookie/bearer authentication:

* `GET /api/v1/facilities/:facilityId/maintenance-blocks`
  accepts optional `date=YYYY-MM-DD`, `includeReleased=true|false` (default false),
  `limit=1..100` (default 50) and `skip` (default 0). Returns `{message, data}`.
* `POST /api/v1/facilities/:facilityId/maintenance-blocks`
  accepts `{date, startTime, endTime, reason?}`. Returns 201 with `{message, data}`.
* `PATCH /api/v1/facilities/:facilityId/maintenance-blocks/:blockId/release`
  accepts `{reason?}`. Returns `{message, data}`. Repeated release preserves the
  original release actor, timestamp and reason; blocks are never deleted by this API.

Managers retain platform-wide access. Every scoped actor must be explicitly present
in the turf's `admins`, including accounts with the `admin` role. Existing assigned
`user` accounts remain eligible, consistent with current admin booking routes. Listing
and both mutations verify assignment; release also matches block ID to both the requested
facility and its turf. A block ID from another facility is not a permission shortcut.

Times are HH:mm and dates use the BUG-05 Asia/Dhaka helpers. Maintenance end must be
strictly after start on the same date; overnight/equal-time maintenance is rejected with
a validation error. Intervals are half-open: a block ending at 11:00 allows a booking or
block starting at 11:00. Legacy overnight bookings are still checked across Dhaka day
boundaries. Reasons and release reasons are optional, limited to 500 characters.

`MaintenanceBlock` stores facility/turf/date/times/reason/creator, creation/update timestamps,
and release timestamp/actor/reason. Creation fields are immutable. Public availability
uses only interval fields and does not expose maintenance reasons or creator details.

## Occupancy mutation audit

Every transaction first writes `Facility.occupancyRevision`, then reads fresh occupancy
and authorizes the operation using the same session. Operations are sequential. MongoDB
driver `withTransaction` handles transient write-conflict retries. No emails, HTTP calls,
or responses are performed inside retryable callbacks.

| Path | Guarded implementation |
| --- | --- |
| Customer booking creation | `createGuardedBooking`, via `createBookingHandler` |
| Admin manual booking creation | `createGuardedBooking`, via `createAdminBookingHandler` |
| Status update / confirmation / reactivation | `mutateBookingOccupancy`, kind `status` |
| Customer cancellation | kind `cancel-own`, owner and pending status rechecked |
| Admin cancellation / refund status | kind `cancel-admin`, authorization and current payment rechecked |
| Mark paid / pending confirmation | kind `paid` |
| Payment approval / reactivation | kind `approve`; confirmation email only after commit |
| Admin deletion | kind `delete` |
| Explicit expiration | guarded conditional update; excludes paid and confirmed; offline/TTL gates retained |
| Maintenance create/release | `maintenanceService` guarded transactions |
| Facility deletion/deactivation | shared guard; hard deletion refuses any booking or maintenance history |
| Legacy facility reassignment script | offline-only acknowledgement and operator-enforced access isolation |
| Existing MongoDB Booking TTL monitor | **not guardable in application code; migration still required** |

Pending and confirmed are active regardless of creation time/payment status, matching
the unchanged BUG-04 unique index. All activation paths check both existing bookings
and unreleased maintenance blocks, excluding the booking being updated. Cancellation,
deletion and release serialize on the same facility. Permission/business checks for
booking mutations are repeated inside the transaction rather than trusting preloaded
controller documents. Missing/moved legacy facility associations fail closed.

The admin's existing optional customer-account creation remains outside the occupancy
transaction. It is not a slot mutation and does not send an email inside the transaction;
as before, a customer account can remain if its later booking fails. Pricing/input
validation stays in existing controllers. Facility pricing/configuration updates already
write the same Facility document and therefore conflict with a participating transaction;
this work does not change pricing behavior. Hard-deletion checks are now inside the guard
so a concurrent new block or booking cannot be orphaned by a stale zero-count check.

Paid/confirmed booking transitions clear a legacy deadline so newly approved bookings
cannot retain that deadline. This does not repair all existing records or remove TTL.
Schema support for `expired` retains booking history; it is not a new public status-update
option. Reactivation must pass the same occupancy checks as creation.

## Tests and reproduction

* `pnpm run test:expiration`: 18 passing unit/CLI tests. Covers predicate, paid-pending
  and confirmed exclusions, bounded batches, partial failures, transaction cleanup and
  offline/TTL gates. Its fakes do not establish database isolation.
* `RUN_BUG08_MONGO_TESTS=1 pnpm run test:maintenance`: 20 passing tests, comprising
  3 unit tests and 17 real integration tests against a disposable MongoDB 8 replica set.
  Covers authenticated HTTP endpoints, authorization, release audit, public availability,
  pending/confirmed conflicts, adjacent intervals, legacy overnight conflicts, all booking
  mutation kinds, expiration batches/rollback, and real concurrent requests.
* The real write-conflict test holds one transaction, observes a competing transaction's
  failed Facility write, releases the holder, and verifies callback retry and final revision.
  Booking-vs-block contention is repeated five times; overlapping blocks/bookings have
  one winner, adjacent blocks both commit, and expiration vs approval preserves paid state.
* Backend and the added tests/migration script are separately type-checked.

The integration suite defaults to skipped unless explicitly enabled. It always connects
to `127.0.0.1`, port 27028 by default (`BUG08_TEST_MONGO_PORT` may override the port), using
a new random `bug08_test_*` database. It never consumes `MONGODB_URI` or starts the app.
Automatic index creation is disabled: no application indexes, including BUG-04, are
created or dropped. MongoDB's normal implicit collection `_id` indexes exist only in the
disposable test database. The HTTP test uses a synthetic signing key and test configuration.

For reproduction, create an approved disposable local MongoDB 8 replica set, initialize
it, expose it only on loopback port 27028, run the enabled test command above, then destroy
the container. The current run used the container `khelbinaki-bug08-test`. Existing Atlas
records/indexes are not test targets. Re-run with the actual BUG-04 index in a separately
approved isolated clone during rollout; these tests deliberately do not alter indexes.

## Deployment prerequisites and limits

Do not activate this feature in the live environment before completing the offline
[Booking TTL migration](bug-08-expiration-prerequisites.md), verifying BUG-04, reviewing
historical deadlines and missing associations, and deploying all guarded writers together.
Existing TTL still deletes independently, and old app instances/scripts still bypass
the new guard. There is no claim of end-to-end Atlas concurrency safety while those remain.
The source endpoints are wired; deployment must keep them inaccessible until prerequisites
are fulfilled. No runtime feature-flag configuration or database migration is performed here.

Keep online expiration disabled: the offline acknowledgement and no-TTL checks remain in
code, and no scheduler is installed. Follow the explicit bounded-batch/partial-progress
contract in the expiration runbook. Backups, index migration/rollback rehearsal, Atlas
permissions and transaction latency under production-like load need manual verification.
The new MaintenanceBlock query index is declared for future deployment but not installed
by this work. Do not use broad `syncIndexes()` or run startup/seeding for verification.
