'use strict';

const crypto = require('crypto');
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
  getOne,
  addDoc,
  setDoc,
  updateDoc,
  removeDoc,
  COLLECTIONS,
} = require('./db');
const { ApiError, errors } = require('./errors');
const { validateCredentials } = require('./validate');

const TOKEN_TTL = process.env.TOKEN_TTL || '7d';
const LOCK_MINUTES = 10;
const MAX_FAILURES = 5;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw errors.internal('服务未配置 JWT_SECRET');
  }
  return secret;
}

function bcryptRounds() {
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  return Number.isFinite(rounds) && rounds >= 8 && rounds <= 12 ? rounds : 10;
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username || '',
    displayName: user.displayName || user.username || '用户',
    role: user.role === 'admin' ? 'admin' : 'user',
    source: user.source || 'web',
    createdAt: user.createdAt || null,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      uid: user._id,
      role: user.role === 'admin' ? 'admin' : 'user',
      tv: user.tokenVersion || 0,
    },
    jwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

async function authenticate(token) {
  if (!token) throw errors.unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret());
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      throw new ApiError('TOKEN_EXPIRED', '登录已过期，请重新登录', 401);
    }
    throw errors.unauthorized('登录凭证无效，请重新登录');
  }

  const user = await getOne(COLLECTIONS.users, { _id: payload.uid });
  if (!user) throw errors.unauthorized('账号不存在，请重新登录');
  if ((user.tokenVersion || 0) !== (payload.tv || 0)) {
    throw errors.unauthorized('登录状态已失效，请重新登录');
  }
  return user;
}

function isAdmin(user) {
  return user && user.role === 'admin';
}

// ---------- 登录失败限流 ----------

function throttleId(ip, username) {
  return `th_${sha256(`${ip || 'unknown'}|${username || ''}`).slice(0, 40)}`;
}

async function readThrottle(id) {
  try {
    return await getOne(COLLECTIONS.throttle, { _id: id });
  } catch (err) {
    // 限流集合不存在等异常不应阻塞登录
    return null;
  }
}

async function assertNotLocked(ip, username) {
  const doc = await readThrottle(throttleId(ip, username));
  if (doc && doc.lockedUntil && Date.parse(doc.lockedUntil) > Date.now()) {
    throw errors.tooMany('登录尝试次数过多，请 10 分钟后再试');
  }
}

async function recordFailure(ip, username) {
  const id = throttleId(ip, username);
  const now = Date.now();
  const existing = await readThrottle(id);
  let attempts = 1;
  let firstAt = now;
  let lockedUntil = null;

  if (existing) {
    const first = Date.parse(existing.firstAt) || now;
    if (now - first > LOCK_MINUTES * 60 * 1000) {
      attempts = 1;
      firstAt = now;
    } else {
      attempts = (existing.attempts || 0) + 1;
      firstAt = first;
    }
  }
  if (attempts >= MAX_FAILURES) {
    lockedUntil = new Date(now + LOCK_MINUTES * 60 * 1000).toISOString();
  }

  const data = {
    attempts,
    firstAt: new Date(firstAt).toISOString(),
    lockedUntil,
    updatedAt: new Date(now).toISOString(),
  };
  try {
    await setDoc(COLLECTIONS.throttle, id, data);
  } catch (err) {
    try {
      await addDoc(COLLECTIONS.throttle, { _id: id, ...data });
    } catch (ignored) {
      // 限流写入失败时降级为仅依赖用户级锁
    }
  }
}

async function clearFailures(ip, username) {
  try {
    await removeDoc(COLLECTIONS.throttle, throttleId(ip, username));
  } catch (err) {
    // ignore
  }
}

// ---------- 账号 ----------

async function register(input = {}) {
  if (String(process.env.ALLOW_REGISTER || 'true').toLowerCase() === 'false') {
    throw errors.forbidden('暂未开放自助注册');
  }
  const { username, password, displayName } = validateCredentials(input);

  const existing = await getOne(COLLECTIONS.users, { username });
  if (existing) throw errors.conflict('该账号已存在，请换一个账号');

  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, bcryptRounds());
  const doc = {
    username,
    passwordHash,
    displayName,
    role: 'user',
    source: 'web',
    tokenVersion: 0,
    failedAttempts: 0,
    lockUntil: null,
    createdAt: now,
    lastLoginAt: now,
  };

  let id;
  try {
    id = await addDoc(COLLECTIONS.users, doc);
  } catch (err) {
    if (/duplicate|exist|E11000/i.test(err.message || '')) {
      throw errors.conflict('该账号已存在，请换一个账号');
    }
    throw err;
  }

  const user = { _id: id, ...doc };
  return { token: signToken(user), user: publicUser(user) };
}

async function login(input = {}, meta = {}) {
  const username = input.username == null ? '' : String(input.username).trim();
  const password = input.password == null ? '' : String(input.password);
  const ip = meta.ip || 'unknown';

  if (!username || !password) throw errors.invalid('请输入账号和密码');
  await assertNotLocked(ip, username);

  const user = await getOne(COLLECTIONS.users, { username });
  if (!user || !user.passwordHash) {
    await recordFailure(ip, username);
    throw errors.unauthorized('账号或密码错误');
  }

  if (user.lockUntil && Date.parse(user.lockUntil) > Date.now()) {
    throw errors.tooMany('该账号已被临时锁定，请 10 分钟后再试');
  }

  const matched = await bcrypt.compare(password, user.passwordHash);
  if (!matched) {
    const failedAttempts = (user.failedAttempts || 0) + 1;
    const lockUntil = failedAttempts >= MAX_FAILURES
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    try {
      await updateDoc(COLLECTIONS.users, user._id, { failedAttempts, lockUntil });
    } catch (err) {
      // ignore
    }
    await recordFailure(ip, username);
    throw errors.unauthorized('账号或密码错误');
  }

  const now = new Date().toISOString();
  try {
    await updateDoc(COLLECTIONS.users, user._id, {
      failedAttempts: 0,
      lockUntil: null,
      lastLoginAt: now,
    });
  } catch (err) {
    // ignore
  }
  await clearFailures(ip, username);

  return { token: signToken(user), user: publicUser(user) };
}

// ---------- 微信小程序登录 ----------

function httpsGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error('微信接口返回格式异常'));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('微信接口超时')));
    req.on('error', reject);
  });
}

async function wxLogin(input = {}) {
  const code = input.code == null ? '' : String(input.code).trim();
  if (!code) throw errors.invalid('缺少微信登录凭证');

  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) {
    throw errors.internal('服务未配置微信登录参数');
  }

  const url = 'https://api.weixin.qq.com/sns/jscode2session'
    + `?appid=${encodeURIComponent(appid)}`
    + `&secret=${encodeURIComponent(secret)}`
    + `&js_code=${encodeURIComponent(code)}`
    + '&grant_type=authorization_code';

  let data;
  try {
    data = await httpsGetJson(url);
  } catch (err) {
    console.error('jscode2session request failed:', err.message);
    throw errors.internal('微信登录服务暂时不可用');
  }

  if (!data || !data.openid) {
    console.error('jscode2session error:', data && data.errcode, data && data.errmsg);
    throw errors.unauthorized('微信登录失败，请重试');
  }

  let user = await getOne(COLLECTIONS.users, { openid: data.openid });
  if (!user) {
    const now = new Date().toISOString();
    const doc = {
      username: `mp_${sha256(data.openid).slice(0, 12)}`,
      openid: data.openid,
      unionid: data.unionid || null,
      passwordHash: null,
      displayName: `微信用户${sha256(data.openid).slice(0, 4)}`,
      role: 'user',
      source: 'miniprogram',
      tokenVersion: 0,
      failedAttempts: 0,
      lockUntil: null,
      createdAt: now,
      lastLoginAt: now,
    };

    let id = null;
    try {
      id = await addDoc(COLLECTIONS.users, doc);
    } catch (err) {
      // 并发首次登录时可能重复创建，重新读取
      user = await getOne(COLLECTIONS.users, { openid: data.openid });
      if (!user) throw err;
    }
    if (!user) user = { _id: id, ...doc };
  } else {
    try {
      await updateDoc(COLLECTIONS.users, user._id, { lastLoginAt: new Date().toISOString() });
    } catch (err) {
      // ignore
    }
  }

  return { token: signToken(user), user: publicUser(user) };
}

module.exports = {
  authenticate,
  isAdmin,
  publicUser,
  register,
  login,
  wxLogin,
};
