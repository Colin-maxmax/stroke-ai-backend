'use strict';

const cloudbase = require('@cloudbase/node-sdk');

const initOptions = {
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV,
};
const app = cloudbase.init(initOptions);
const db = app.database();
const _ = db.command;

const COLLECTIONS = {
  users: 'users',
  assessments: 'assessments',
  throttle: 'auth_throttle',
};

async function getOne(collection, where) {
  const res = await db.collection(collection).where(where).limit(1).get();
  return (res && res.data && res.data[0]) || null;
}

async function getById(collection, id) {
  if (!id) return null;
  return getOne(collection, { _id: id });
}

// 注意：@cloudbase/node-sdk 的 add/set/update 直接接收文档对象，
// 不要再包一层 { data }（那是 wx-server-sdk 的写法）。
async function addDoc(collection, data) {
  const res = await db.collection(collection).add(data);
  return (res && (res.id || res._id)) || null;
}

async function setDoc(collection, id, data) {
  return db.collection(collection).doc(id).set(data);
}

async function updateDoc(collection, id, data) {
  return db.collection(collection).doc(id).update(data);
}

async function removeDoc(collection, id) {
  return db.collection(collection).doc(id).remove();
}

async function removeWhere(collection, where) {
  return db.collection(collection).where(where).remove();
}

async function query(collection, where, options = {}) {
  const { orderBy, order = 'desc', limit = 200 } = options;
  let q = db.collection(collection);
  if (where && Object.keys(where).length > 0) q = q.where(where);
  if (orderBy) q = q.orderBy(orderBy, order);
  if (limit) q = q.limit(limit);
  const res = await q.get();
  return (res && res.data) || [];
}

async function count(collection, where) {
  let q = db.collection(collection);
  if (where && Object.keys(where).length > 0) q = q.where(where);
  const res = await q.count();
  return (res && res.total) || 0;
}

module.exports = {
  app,
  db,
  _,
  COLLECTIONS,
  getOne,
  getById,
  addDoc,
  setDoc,
  updateDoc,
  removeDoc,
  removeWhere,
  query,
  count,
};
