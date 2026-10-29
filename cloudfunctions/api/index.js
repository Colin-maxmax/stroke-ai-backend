'use strict';

/**
 * CloudBase 云函数 HTTP 入口
 *
 * 路由：POST /api
 * 请求体：{ action, token?, payload? }
 * 响应：{ ok: true, data } / { ok: false, error: { code, message } }
 *
 * 也支持 CloudBase 控制台/本地直接调用：event = { action, token, payload }。
 */

const {
  authenticate, register, login, wxLogin, publicUser,
} = require('./lib/auth');
const {
  createAssessment, listAssessments, deleteAssessment,
  clearAssessments, importAssessments,
} = require('./lib/assessments');
const { ApiError, errors } = require('./lib/errors');

const DEFAULT_ORIGINS = [
  'https://colin-maxmax.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
];
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function allowedOrigins() {
  const fromEnv = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...fromEnv]);
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function response(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
    body: JSON.stringify(body),
  };
}

function ok(data, origin) {
  return response(200, { ok: true, data }, origin);
}

function fail(err, origin) {
  const status = err instanceof ApiError ? err.status : 500;
  const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
  const message = err instanceof ApiError ? err.message : '服务暂时不可用';
  return response(status, { ok: false, error: { code, message } }, origin);
}

function headerValue(headers, name) {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return '';
}

function methodOf(event) {
  if (event.httpMethod) return String(event.httpMethod).toUpperCase();
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method) {
    return String(event.requestContext.http.method).toUpperCase();
  }
  return 'POST';
}

function parseBody(event) {
  if (!event || event.body == null) return {};
  let raw = event.body;
  if (event.isBase64Encoded && typeof raw === 'string') {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  if (typeof raw === 'object') return raw;
  if (Buffer.byteLength(String(raw), 'utf8') > MAX_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', '请求内容过大', 413);
  }
  try {
    return JSON.parse(String(raw));
  } catch (err) {
    throw errors.invalid('请求体不是合法的 JSON');
  }
}

function clientIp(event, headers) {
  const forwarded = headerValue(headers, 'x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  const realIp = headerValue(headers, 'x-real-ip');
  if (realIp) return String(realIp).trim();
  if (event && event.requestContext && event.requestContext.identity) {
    return event.requestContext.identity.sourceIp || 'unknown';
  }
  return 'unknown';
}

async function dispatch(action, payload, token, meta) {
  switch (action) {
    case 'health':
      return { status: 'ok', serverTime: new Date().toISOString() };

    case 'register':
      return register(payload);

    case 'login':
      return login(payload, { ip: meta.ip });

    case 'wxLogin':
      return wxLogin(payload);

    default:
      break;
  }

  const user = await authenticate(token);

  switch (action) {
    case 'me':
      return { user: publicUser(user) };
    case 'createAssessment':
      return createAssessment(user, payload);
    case 'listAssessments':
      return listAssessments(user, payload);
    case 'deleteAssessment':
      return deleteAssessment(user, payload);
    case 'clearAssessments':
      return clearAssessments(user, payload);
    case 'importAssessments':
      return importAssessments(user, payload);
    default:
      throw new ApiError('UNKNOWN_ACTION', '未知的接口操作', 404);
  }
}

exports.main = async (event = {}, context = {}) => {
  const origin = headerValue(event.headers, 'origin');
  const allowed = allowedOrigins();

  // 直接从控制台/本地调用时没有 Origin；浏览器跨域时必须命中白名单
  if (origin && !allowed.has(origin)) {
    return response(403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED', message: '来源域名未授权' } }, null);
  }

  const method = methodOf(event);
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: '',
    };
  }

  if (method === 'GET') {
    return ok({ status: 'ok', serverTime: new Date().toISOString() }, origin);
  }

  if (method !== 'POST') {
    return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' } }, origin);
  }

  try {
    const body = event.body == null && event.action
      ? event
      : parseBody(event);
    const action = body.action == null ? '' : String(body.action);
    if (!action) throw errors.invalid('缺少 action');

    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const authHeader = headerValue(event.headers, 'authorization');
    const token = body.token || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');

    const data = await dispatch(action, payload, token, {
      ip: clientIp(event, event.headers),
      context,
    });

    return ok(data, origin);
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('api error:', err && err.stack ? err.stack : err);
    }
    return fail(err, origin);
  }
};
