'use strict';

/**
 * 生成管理员账号的 bcrypt 哈希，并输出可直接粘贴到 CloudBase 数据库的记录 JSON。
 *
 * 用法（二选一，推荐环境变量，避免密码进入命令行历史）：
 *   ADMIN_PASSWORD='一个足够强的密码' node scripts/hash-password.cjs admin
 *   node scripts/hash-password.cjs admin '一个足够强的密码'
 *
 * 要求：先在 cloudfunctions/api 目录执行过 npm install（需要 bcryptjs）。
 * 输出里的 passwordHash 只能写入数据库，不要提交到仓库或发给别人。
 */

const path = require('path');
const { createRequire } = require('module');

const cloudRequire = createRequire(path.join(__dirname, '..', 'cloudfunctions', 'api', 'package.json'));

let bcrypt;
try {
  bcrypt = cloudRequire('bcryptjs');
} catch (err) {
  console.error('未找到 bcryptjs。请先在 cloudfunctions/api 目录执行：npm install');
  process.exit(1);
}

const username = (process.argv[2] || 'admin').trim();
const password = process.env.ADMIN_PASSWORD || process.argv[3] || '';

if (!/^[A-Za-z0-9_一-龥]{3,32}$/.test(username)) {
  console.error('账号需为 3-32 位中英文、数字或下划线');
  process.exit(1);
}
if (password.length < 8) {
  console.error('管理员密码至少 8 位；建议 12 位以上并包含大小写字母、数字和符号');
  process.exit(1);
}

const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
const now = new Date().toISOString();
const doc = {
  username,
  passwordHash: bcrypt.hashSync(password, Number.isFinite(rounds) ? rounds : 10),
  displayName: process.env.ADMIN_DISPLAY_NAME || '管理员',
  role: 'admin',
  source: 'web',
  tokenVersion: 0,
  failedAttempts: 0,
  lockUntil: null,
  createdAt: now,
  lastLoginAt: null
};

console.log('在 CloudBase 数据库 users 集合中新增以下记录（把 passwordHash 原样粘贴）：');
console.log(JSON.stringify(doc, null, 2));
