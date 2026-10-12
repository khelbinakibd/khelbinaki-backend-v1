import type { NextFunction, Response } from 'express'
import type { AuthRequest } from '../src/middlewares/authMiddleware'
import assert from 'node:assert/strict'
// Use Node's installed runner without adding a test dependency.
// eslint-disable-next-line test/no-import-node-test
import { afterEach, test } from 'node:test'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { refreshToken } from '../src/controllers/authController'
import { getAdminTurfsHandler } from '../src/controllers/turfController'
import { optionalAuth, requireAuth } from '../src/middlewares/authMiddleware'
import { permitRoles, requireTurfAccess } from '../src/middlewares/roleMiddleware'
import { RefreshToken } from '../src/models/RefreshToken'
import { Turf } from '../src/models/Turf'
import { User } from '../src/models/User'

const id = new mongoose.Types.ObjectId()
const originals = { user: User.findById, refresh: RefreshToken.findOne, create: RefreshToken.create, turf: Turf.findById, find: Turf.find, count: Turf.countDocuments }
afterEach(() => {
  User.findById = originals.user
  RefreshToken.findOne = originals.refresh
  RefreshToken.create = originals.create
  Turf.findById = originals.turf
  Turf.find = originals.find
  Turf.countDocuments = originals.count
})
function token(role = 'manager') {
  return jwt.sign({ id: id.toString(), role }, process.env.JWT_SECRET!, { expiresIn: '5m' })
}
function fixture(value?: string) {
  const req = { headers: value ? { authorization: `Bearer ${value}` } : {}, cookies: {}, body: {}, params: {}, query: {} } as AuthRequest
  let status = 200
  let body: unknown
  let error: unknown
  let calls = 0
  const cookies: Record<string, unknown> = {}
  const res = {
    status(code: number) {
      status = code
      return this
    },
    json(data: unknown) {
      body = data
      return this
    },
    cookie(name: string, value: unknown) {
      cookies[name] = value
      return this
    },
  } as unknown as Response
  const next: NextFunction = (value?: unknown) => {
    error = value
    calls++
  }
  return { req, res, next, cookies, result: () => ({ status, body, error, calls }) }
}
function lookup(role: 'user' | 'admin' | 'manager' = 'user', active = true, missing = false, failure?: Error) {
  let calls = 0
  User.findById = (() => {
    calls++
    return { select(fields: string) {
      assert.equal(fields, '_id role isActive')
      return { lean: async () => {
        if (failure)
          throw failure
        return missing ? null : { _id: id, role, isActive: active }
      } }
    } }
  }) as unknown as typeof User.findById
  return () => calls
}

test('old manager JWT uses the demoted database role and loses manager-only access', async () => {
  lookup('user')
  const f = fixture(token())
  await requireAuth(f.req, f.res, f.next)
  assert.deepEqual(f.req.user, { id: id.toString(), role: 'user' })
  permitRoles('manager')(f.req, f.res, f.next)
  assert.equal(f.result().status, 403)
  permitRoles('user', 'admin', 'manager')(f.req, f.res, f.next)
  assert.equal(f.result().calls, 2)
})

test('active database manager retains access despite an old user claim', async () => {
  lookup('manager')
  const f = fixture(token('user'))
  await requireAuth(f.req, f.res, f.next)
  permitRoles('manager')(f.req, f.res, f.next)
  assert.equal(f.result().status, 200)
  assert.equal(f.result().calls, 2)
})

test('assigned admins retain turf scope and unassigned admins are rejected', async () => {
  lookup('admin')
  const f = fixture(token())
  await requireAuth(f.req, f.res, f.next)
  Turf.findById = (async () => ({ admins: [id] })) as unknown as typeof Turf.findById
  await requireTurfAccess()(f.req, f.res, f.next)
  assert.equal(f.result().calls, 2)
  Turf.findById = (async () => ({ admins: [] })) as unknown as typeof Turf.findById
  await requireTurfAccess()(f.req, f.res, f.next)
  assert.equal(f.result().status, 403)
})

for (const missing of [false, true]) {
  test(`${missing ? 'deleted' : 'inactive'} users are rejected or anonymous`, async () => {
    lookup('manager', false, missing)
    const required = fixture(token())
    await requireAuth(required.req, required.res, required.next)
    assert.equal(required.result().status, 401)
    assert.equal(required.result().calls, 0)
    const optional = fixture(token())
    await optionalAuth(optional.req, optional.res, optional.next)
    assert.equal(optional.req.user, undefined)
    assert.equal(optional.result().calls, 1)
  })
}

test('missing, invalid and malformed tokens never reach the database', async () => {
  const calls = lookup()
  for (const value of [undefined, 'invalid', jwt.sign({ id: id.toString(), role: 'manager' }, process.env.JWT_SECRET!, { expiresIn: -1 }), jwt.sign({ id: 'bad', role: 'manager' }, process.env.JWT_SECRET!)]) {
    const required = fixture(value)
    await requireAuth(required.req, required.res, required.next)
    assert.equal(required.result().status, 401)
    const optional = fixture(value)
    await optionalAuth(optional.req, optional.res, optional.next)
    assert.equal(optional.req.user, undefined)
    assert.equal(optional.result().calls, 1)
  }
  assert.equal(calls(), 0)
})

test('optional authentication also uses the current role', async () => {
  lookup('user')
  const f = fixture(token())
  await optionalAuth(f.req, f.res, f.next)
  assert.equal(f.req.user?.role, 'user')
})

test('both middleware paths pass database failures to next without granting identity', async () => {
  const failure = new Error('Synthetic database failure')
  lookup('manager', true, false, failure)
  for (const middleware of [requireAuth, optionalAuth]) {
    const f = fixture(token())
    await middleware(f.req, f.res, f.next)
    assert.equal(f.result().error, failure)
    assert.equal(f.result().calls, 1)
    assert.equal(f.req.user, undefined)
  }
})

async function refresh(user: unknown, failure?: Error) {
  let deleted = 0
  let created = 0
  User.findById = (async () => {
    if (failure)
      throw failure
    return user
  }) as unknown as typeof User.findById
  RefreshToken.findOne = (async () => ({ deleteOne: async () => {
    deleted++
  } })) as unknown as typeof RefreshToken.findOne
  RefreshToken.create = (async () => {
    created++
  }) as unknown as typeof RefreshToken.create
  const f = fixture()
  f.req.body = { refreshToken: jwt.sign({ id: id.toString(), role: 'manager' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '5m' }) }
  await new Promise<void>((resolve) => {
    f.res.json = ((body: unknown) => {
      void body
      resolve()
      return f.res
    }) as Response['json']
    refreshToken(f.req, f.res, (error?: unknown) => {
      f.next(error)
      resolve()
    })
  })
  return { ...f, deleted, created }
}

test('refresh rotates tokens and cookies using the current role and ID', async () => {
  const f = await refresh({ _id: id, role: 'user', isActive: true })
  const access = jwt.verify(f.cookies.accessToken as string, process.env.JWT_SECRET!) as jwt.JwtPayload
  const replacement = jwt.verify(f.cookies.refreshToken as string, process.env.JWT_REFRESH_SECRET!) as jwt.JwtPayload
  assert.equal(access.role, 'user')
  assert.equal(replacement.role, 'user')
  assert.equal(access.id, id.toString())
  assert.equal(replacement.id, id.toString())
  assert.equal(f.deleted, 1)
  assert.equal(f.created, 1)
})

test('refresh rejects deleted/inactive users and propagates database errors without issuing tokens', async () => {
  for (const user of [null, { _id: id, role: 'manager', isActive: false }]) {
    const f = await refresh(user)
    assert.equal((f.result().error as { statusCode: number }).statusCode, 401)
    assert.equal(f.created, 0)
    assert.equal(f.deleted, 1)
    assert.deepEqual(f.cookies, {})
  }
  const failure = new Error('Synthetic refresh database failure')
  const f = await refresh(null, failure)
  assert.equal(f.result().error, failure)
  assert.equal(f.created, 0)
  assert.equal(f.deleted, 0)
})

test('refresh rejects missing and invalid tokens before model lookups', async () => {
  const calls = lookup()
  for (const refreshValue of [undefined, 'invalid']) {
    const f = fixture()
    f.req.body = refreshValue ? { refreshToken: refreshValue } : {}
    await new Promise<void>((resolve) => {
      refreshToken(f.req, f.res, (error?: unknown) => {
        f.next(error)
        resolve()
      })
    })
    assert.equal((f.result().error as { statusCode: number }).statusCode, refreshValue ? 401 : 400)
    assert.deepEqual(f.cookies, {})
  }
  assert.equal(calls(), 0)
})

test('assigned users keep their turf-list scope while current managers remain platform-wide', async () => {
  for (const role of ['user', 'manager'] as const) {
    lookup(role)
    const f = fixture(token())
    await requireAuth(f.req, f.res, f.next)
    const expected = role === 'manager' ? {} : { admins: id.toString() }
    const query = {
      skip: () => query,
      limit: () => query,
      select: () => query,
      exec: async () => [{ _id: id, admins: [id] }],
    }
    Turf.find = ((filters: object) => {
      assert.deepEqual(filters, expected)
      return query
    }) as unknown as typeof Turf.find
    Turf.countDocuments = (async (filters: object) => {
      assert.deepEqual(filters, expected)
      return 1
    }) as unknown as typeof Turf.countDocuments
    await new Promise<void>((resolve, reject) => {
      f.res.json = ((body: { data: unknown[] }) => {
        assert.equal(body.data.length, 1)
        resolve()
        return f.res
      }) as Response['json']
      getAdminTurfsHandler(f.req, f.res, reject)
    })
  }
})

test('authentication preserves legacy missing-token, verification and malformed-payload responses', async () => {
  const calls = lookup()
  // verifyAccessToken historically wraps all verification failures with a
  // message containing "expired", so invalid signatures share TOKEN_EXPIRED.
  const cases = [
    { value: undefined, body: { message: 'Access token required', error: 'UNAUTHORIZED' } },
    { value: 'invalid', body: { message: 'Access token expired', error: 'TOKEN_EXPIRED' } },
    { value: jwt.sign({ id: id.toString(), role: 'manager' }, 'synthetic-wrong-signing-secret'), body: { message: 'Access token expired', error: 'TOKEN_EXPIRED' } },
    { value: jwt.sign({ id: id.toString(), role: 'manager' }, process.env.JWT_SECRET!, { expiresIn: -1 }), body: { message: 'Access token expired', error: 'TOKEN_EXPIRED' } },
    ...[{ role: 'manager' }, { id: id.toString() }, { id: 'bad', role: 'manager' }].map(payload => ({
      value: jwt.sign(payload, process.env.JWT_SECRET!),
      body: { message: 'Invalid token payload', error: 'INVALID_TOKEN' },
    })),
  ]
  for (const item of cases) {
    const f = fixture(item.value)
    await requireAuth(f.req, f.res, f.next)
    assert.equal(f.result().status, 401)
    assert.deepEqual(f.result().body, item.body)
    assert.equal(f.result().calls, 0)
    assert.equal(f.req.user, undefined)
    const optional = fixture(item.value)
    await optionalAuth(optional.req, optional.res, optional.next)
    assert.equal(optional.req.user, undefined)
    assert.equal(optional.result().calls, 1)
  }
  assert.equal(calls(), 0)
})
