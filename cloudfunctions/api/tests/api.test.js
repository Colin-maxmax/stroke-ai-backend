'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// ---------- 内存版 CloudBase 数据库 ----------

function createMockDb() {
  const store = {
    users: new Map(),
    assessments: new Map(),
    auth_throttle: new Map(),
  };
  let seq = 0;

  const command = {
    gte: (v) => ({ $op: 'gte', v }),
    gt: (v) => ({ $op: 'gt', v }),
    in: (v) => ({ $op: 'in', v }),
    exists: (v) => ({ $op: 'exists', v }),
  };

  function match(doc, where) {
    return Object.keys(where || {}).every((key) => {
      const cond = where[key];
      const value = doc[key];
      if (cond && typeof cond === 'object' && cond.$op) {
        if (cond.$op === 'gte') return value >= cond.v;
        if (cond.$op === 'gt') return value > cond.v;
        if (cond.$op === 'in') return cond.v.includes(value);
        if (cond.$op === 'exists') return (value != null) === Boolean(cond.v);
        return false;
      }
      return value === cond;
    });
  }

  function list(collection, where) {
    return [...store[collection].values()].filter((doc) => match(doc, where));
  }

  return {
    COLLECTIONS: { users: 'users', assessments: 'assessments', throttle: 'auth_throttle' },
    _: command,
    store,
    async getOne(collection, where) {
      return list(collection, where)[0] || null;
    },
    async getById(collection, id) {
      return store[collection].get(id) || null;
    },
    async addDoc(collection, data) {
      seq += 1;
      const id = data._id || `mock_${seq}`;
      store[collection].set(id, { ...data, _id: id });
      return id;
    },
    async setDoc(collection, id, data) {
      store[collection].set(id, { ...data, _id: id });
    },
    async updateDoc(collection, id, data) {
      const current = store[collection].get(id);
      if (!current) throw new Error('doc not found');
      store[collection].set(id, { ...current, ...data });
    },
    async removeDoc(collection, id) {
      store[collection].delete(id);
    },
    async removeWhere(collection, where) {
      const docs = list(collection, where);
      docs.forEach((doc) => store[collection].delete(doc._id));
      return docs.length;
    },
    async query(collection, where, options = {}) {
      let docs = list(collection, where);
      const { orderBy, order = 'desc', limit = 200 } = options;
      if (orderBy) {
        docs.sort((a, b) => {
          const av = a[orderBy];
          const bv = b[orderBy];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (order === 'desc' ? -1 : 1);
        });
      }
      return docs.slice(0, limit);
    },
    async count(collection, where) {
      return list(collection, where).length;
    },
    async app() {},
    db: null,
  };
}

const mockDb = createMockDb();
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: mockDb,
};

process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
process.env.ALLOW_REGISTER = 'true';

const {
  register, login, authenticate, publicUser,
} = require('../lib/auth');
const {
  createAssessment, listAssessments, deleteAssessment, clearAssessments, importAssessments,
} = require('../lib/assessments');
const { errors } = require('../lib/errors');

function resetStore() {
  mockDb.store.users.clear();
  mockDb.store.assessments.clear();
  mockDb.store.auth_throttle.clear();
}

const aliceCredentials = { username: 'alice', password: 'secret123' };
const bobCredentials = { username: 'bob', password: 'secret456' };

test.beforeEach(() => resetStore());

test('注册返回 token，重复账号返回冲突', async () => {
  const result = await register(aliceCredentials);
  assert.ok(result.token);
  assert.equal(result.user.role, 'user');
  assert.equal(result.user.username, 'alice');
  assert.equal(result.user.source, 'web');

  await assert.rejects(
    () => register(aliceCredentials),
    (err) => err instanceof Error && err.code === 'CONFLICT'
  );
});

test('正确密码登录成功，错误密码连续 5 次后锁定', async () => {
  await register(aliceCredentials);

  const success = await login(aliceCredentials, { ip: '1.2.3.4' });
  assert.ok(success.token);

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(
      () => login({ username: 'alice', password: 'wrong-password' }, { ip: '1.2.3.4' }),
      (err) => err.code === 'UNAUTHORIZED'
    );
  }
  await assert.rejects(
    () => login(aliceCredentials, { ip: '1.2.3.4' }),
    (err) => err.code === 'RATE_LIMITED'
  );
});

test('评估创建、隔离、幂等与管理员可见性', async () => {
  const alice = await register(aliceCredentials);
  const bob = await register(bobCredentials);

  const baseAssessment = {
    patientName: '张大爷',
    age: 68,
    gender: '男',
    workType: '私营',
    residenceType: '城市',
    hypertension: true,
    education: '初中',
    monthlyIncome: '2000-5000',
    heartDiseaseType: '0',
    systolicBP: 150,
    diastolicBP: 92,
    avgGlucoseLevel: 6.4,
    height: 170,
    weight: 70,
    smokingStatus: '以前吸烟',
    exerciseFrequency: '少量运动',
    drinkingStatus: '从不饮酒',
    strokeHistory: false,
    tiaHistory: false,
    strokeFamilyHistory: '0',
    hyperlipidemia: true,
    dietaryHabits: ['高盐'],
    notes: '测试',
  };

  const first = await createAssessment(
    await authenticate(alice.token),
    { data: baseAssessment, clientRequestId: 'req-1' }
  );
  assert.ok(first.id);
  assert.equal(first.riskLevel, '高风险');
  assert.equal(first.ownerId, alice.user.id);

  const duplicate = await createAssessment(
    await authenticate(alice.token),
    { data: baseAssessment, clientRequestId: 'req-1' }
  );
  assert.equal(duplicate.id, first.id);

  await assert.rejects(
    async () => createAssessment(await authenticate(alice.token), {
      data: { ...baseAssessment, age: 10 },
    }),
    (err) => err.code === 'INVALID_INPUT'
  );

  const aliceList = await listAssessments(await authenticate(alice.token), {});
  assert.equal(aliceList.total, 1);

  const bobList = await listAssessments(await authenticate(bob.token), {});
  assert.equal(bobList.total, 0);

  await assert.rejects(
    async () => deleteAssessment(await authenticate(bob.token), { id: first.id }),
    (err) => err.code === 'FORBIDDEN'
  );

  // 把 bob 提升为管理员后应能看到全部记录
  const bobDoc = [...mockDb.store.users.values()].find((u) => u.username === 'bob');
  bobDoc.role = 'admin';
  const adminList = await listAssessments(await authenticate(bob.token), {});
  assert.equal(adminList.total, 1);

  await deleteAssessment(await authenticate(bob.token), { id: first.id });
  const afterDelete = await listAssessments(await authenticate(alice.token), {});
  assert.equal(afterDelete.total, 0);
});

test('导入历史数据：去重、保留结果型记录', async () => {
  const alice = await register(aliceCredentials);
  const user = await authenticate(alice.token);

  const fullRecord = {
    id: 111,
    patientName: '李奶奶',
    age: 75,
    gender: '女',
    workType: '从未工作',
    residenceType: '农村',
    hypertension: true,
    heartDiseaseType: '2',
    systolicBP: 170,
    diastolicBP: 100,
    avgGlucoseLevel: 8.1,
    height: 158,
    weight: 66,
    smokingStatus: '从未吸烟',
    exerciseFrequency: '无运动',
    strokeHistory: false,
    tiaHistory: false,
    strokeFamilyHistory: '1',
    hyperlipidemia: true,
    date: '2026-01-02T03:04:05.000Z',
  };

  const resultOnlyRecord = {
    id: 222,
    patientName: '王大爷',
    age: 70,
    gender: '男',
    date: '2026-02-03T04:05:06.000Z',
    riskScore: 55,
    riskLevel: '中风险',
    probability: '33.3',
    riskFactors: ['高血压病史', '糖尿病史'],
  };

  const first = await importAssessments(user, {
    source: 'miniprogram',
    records: [fullRecord, resultOnlyRecord],
  });
  assert.equal(first.imported, 2);
  assert.equal(first.failed, 0);

  const second = await importAssessments(user, {
    source: 'miniprogram',
    records: [fullRecord, resultOnlyRecord],
  });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 2);

  const list = await listAssessments(user, {});
  assert.equal(list.total, 2);

  const preserved = list.items.find((item) => item.patientName === '王大爷');
  assert.equal(preserved.riskLevel, '中风险');
  assert.equal(preserved.probability, '33.3');
  assert.deepEqual(preserved.riskFactors, ['高血压病史', '糖尿病史']);
  assert.equal(preserved.source, 'miniprogram');
});

test('清空：普通用户只清自己，管理员需显式确认', async () => {
  const alice = await register(aliceCredentials);
  const bob = await register(bobCredentials);

  const makeRecord = (name) => ({
    patientName: name,
    age: 50,
    gender: '男',
    systolicBP: 120,
    diastolicBP: 80,
    avgGlucoseLevel: 5.0,
  });

  await createAssessment(await authenticate(alice.token), { data: makeRecord('A1') });
  await createAssessment(await authenticate(bob.token), { data: makeRecord('B1') });

  const cleared = await clearAssessments(await authenticate(alice.token), {});
  assert.equal(cleared.removed, 1);

  const bobList = await listAssessments(await authenticate(bob.token), {});
  assert.equal(bobList.total, 1);

  const bobDoc = [...mockDb.store.users.values()].find((u) => u.username === 'bob');
  bobDoc.role = 'admin';
  await assert.rejects(
    async () => clearAssessments(await authenticate(bob.token), { scope: 'all' }),
    (err) => err.code === 'INVALID_INPUT'
  );

  const all = await clearAssessments(await authenticate(bob.token), {
    scope: 'all',
    confirm: 'CLEAR_ALL',
  });
  assert.equal(all.removed, 1);
});

test('token 校验：无效 token 与版本变更', async () => {
  const alice = await register(aliceCredentials);

  await assert.rejects(
    () => authenticate('not-a-token'),
    (err) => err.code === 'UNAUTHORIZED'
  );

  const user = await authenticate(alice.token);
  const aliceDoc = mockDb.store.users.get(user._id);
  aliceDoc.tokenVersion = 1;

  await assert.rejects(
    () => authenticate(alice.token),
    (err) => err.code === 'UNAUTHORIZED'
  );
});
