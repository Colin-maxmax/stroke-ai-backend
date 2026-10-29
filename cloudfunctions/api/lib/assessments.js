'use strict';

const {
  _, COLLECTIONS, getOne, getById, addDoc, removeWhere, query, count,
} = require('./db');
const { errors } = require('./errors');
const { computeRisk, MODEL_INFO } = require('./risk');
const { validateAssessment } = require('./validate');
const { isAdmin } = require('./auth');

const RISK_LEVELS = ['低风险', '中风险', '高风险', '极低风险'];
const SOURCE_WEB = 'web';
const SOURCE_MP = 'miniprogram';

function nowIso() {
  return new Date().toISOString();
}

function sourceOf(user) {
  return user && user.source === SOURCE_MP ? SOURCE_MP : SOURCE_WEB;
}

function mapDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return {
    id: _id,
    ...rest,
    riskFactors: Array.isArray(rest.riskFactors) ? rest.riskFactors : [],
    date: rest.date || rest.createdAt || null,
  };
}

function ownerFields(user) {
  return {
    ownerId: user._id,
    ownerName: user.displayName || user.username || '用户',
    assessedBy: user.username || user.displayName || '用户',
  };
}

function hasClinicalData(record) {
  return Number(record.systolicBP) > 0
    && Number(record.diastolicBP) > 0
    && Number(record.avgGlucoseLevel) > 0;
}

function sanitizeLegacyResult(record, fallbackRisk) {
  const level = RISK_LEVELS.includes(record.riskLevel) ? record.riskLevel : fallbackRisk.riskLevel;
  let probability = record.probability == null ? fallbackRisk.probability : String(record.probability).replace('%', '').trim();
  if (!Number.isFinite(Number(probability))) probability = fallbackRisk.probability;
  else probability = Number(probability).toFixed(1);

  const score = Number(record.riskScore);
  const riskFactors = Array.isArray(record.riskFactors)
    ? record.riskFactors.map((item) => String(item).slice(0, 50)).filter(Boolean).slice(0, 30)
    : fallbackRisk.riskFactors;

  return {
    riskScore: Number.isFinite(score) ? Math.round(score * 10) / 10 : fallbackRisk.riskScore,
    riskLevel: level,
    probability,
    riskFactors,
    modelInfo: record.modelInfo && typeof record.modelInfo === 'object'
      ? { ...MODEL_INFO, ...record.modelInfo }
      : { ...MODEL_INFO },
  };
}

function buildCreateDoc(user, data) {
  const computed = computeRisk(data);
  const now = nowIso();
  return {
    ...computed.input,
    heartDisease: computed.input.heartDiseaseType !== '0',
    riskScore: computed.riskScore,
    riskLevel: computed.riskLevel,
    probability: computed.probability,
    riskFactors: computed.riskFactors,
    modelInfo: computed.modelInfo,
    notes: computed.input.notes || '',
    date: now,
    createdAt: now,
    ...ownerFields(user),
    source: sourceOf(user),
    clientRequestId: null,
    legacyKey: null,
  };
}

async function createAssessment(user, payload = {}) {
  const data = validateAssessment(payload.data || {}, { loose: false });
  const clientRequestId = payload.clientRequestId == null
    ? ''
    : String(payload.clientRequestId).slice(0, 80);

  if (clientRequestId) {
    const existing = await getOne(COLLECTIONS.assessments, {
      ownerId: user._id,
      clientRequestId,
    });
    if (existing) return mapDoc(existing);
  }

  const doc = buildCreateDoc(user, data);
  doc.clientRequestId = clientRequestId || null;

  const id = await addDoc(COLLECTIONS.assessments, doc);
  return mapDoc({ _id: id, ...doc });
}

async function listAssessments(user, payload = {}) {
  const limit = Math.min(Math.max(parseInt(payload.limit || 200, 10) || 200, 1), 500);
  const where = {};
  if (!isAdmin(user)) where.ownerId = user._id;

  if (payload.since) {
    const since = String(payload.since);
    if (!Number.isNaN(Date.parse(since))) {
      where.createdAt = _.gte(since);
    }
  }

  // 游标取查询前的时间：查询开始后新写入的记录下次一定还能被 since 查到
  const serverTime = nowIso();
  const [items, total] = await Promise.all([
    query(COLLECTIONS.assessments, where, { orderBy: 'createdAt', order: 'desc', limit }),
    count(COLLECTIONS.assessments, where),
  ]);

  return {
    items: items.map(mapDoc),
    total,
    serverTime,
  };
}

async function deleteAssessment(user, payload = {}) {
  const id = payload.id == null ? '' : String(payload.id);
  if (!id) throw errors.invalid('缺少评估记录 ID');

  const doc = await getById(COLLECTIONS.assessments, id);
  if (!doc) throw errors.notFound('评估记录不存在');
  if (!isAdmin(user) && doc.ownerId !== user._id) {
    throw errors.forbidden('只能删除自己的评估记录');
  }

  await removeWhere(COLLECTIONS.assessments, { _id: id });
  return { id };
}

async function removeInBatches(where) {
  let removed = 0;
  for (let round = 0; round < 100; round += 1) {
    const items = await query(COLLECTIONS.assessments, where, {
      limit: 100,
      orderBy: 'createdAt',
      order: 'asc',
    });
    if (!items.length) break;
    const ids = items.map((item) => item._id);
    await removeWhere(COLLECTIONS.assessments, { _id: _.in(ids) });
    removed += ids.length;
    if (ids.length < 100) break;
  }
  return removed;
}

async function clearAssessments(user, payload = {}) {
  const clearAll = isAdmin(user) && payload.scope === 'all';
  if (clearAll && payload.confirm !== 'CLEAR_ALL') {
    throw errors.invalid('清空全部数据需要确认参数 confirm=CLEAR_ALL');
  }

  const where = clearAll ? { _id: _.exists(true) } : { ownerId: user._id };
  const removed = await removeInBatches(where);
  return { removed };
}

function legacyKeyFor(user, source, record, index) {
  const legacyId = record.legacyId != null
    ? String(record.legacyId)
    : (record.id != null ? String(record.id) : `${record.date || ''}_${record.patientName || ''}_${index}`);
  return `${source}:${user._id}:${legacyId}`;
}

function legacyDate(record) {
  if (!record.date) return nowIso();
  const parsed = new Date(record.date);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

async function importAssessments(user, payload = {}) {
  const records = Array.isArray(payload.records) ? payload.records.slice(0, 200) : [];
  if (!records.length) throw errors.invalid('没有可导入的记录（单次最多 200 条）');

  const source = payload.source === SOURCE_MP || sourceOf(user) === SOURCE_MP ? SOURCE_MP : SOURCE_WEB;
  const prepared = records.map((record, index) => {
    const legacyKey = legacyKeyFor(user, source, record || {}, index);
    return { record: record || {}, legacyKey };
  });

  const legacyKeys = prepared.map((item) => item.legacyKey);
  const existing = await query(COLLECTIONS.assessments, {
    ownerId: user._id,
    legacyKey: _.in(legacyKeys),
  }, { limit: 500 });
  const existingKeys = new Set(existing.map((item) => item.legacyKey));

  let imported = 0;
  let skipped = existingKeys.size;
  let failed = 0;

  for (const item of prepared) {
    if (existingKeys.has(item.legacyKey)) continue;
    const record = item.record;

    try {
      const basics = validateAssessment(record, { loose: true });
      const date = legacyDate(record);
      let risk;
      if (hasClinicalData(record)) {
        const computed = computeRisk(record);
        risk = {
          riskScore: computed.riskScore,
          riskLevel: computed.riskLevel,
          probability: computed.probability,
          riskFactors: computed.riskFactors,
          modelInfo: computed.modelInfo,
        };
      } else {
        // 小程序旧记录只保存了结果，没有原始临床字段：保留原结果，避免重算后失真
        risk = sanitizeLegacyResult(record, computeRisk({}));
      }

      const doc = {
        ...basics,
        heartDisease: basics.heartDiseaseType !== '0',
        ...risk,
        date,
        createdAt: date,
        ...ownerFields(user),
        source,
        clientRequestId: null,
        legacyKey: item.legacyKey,
      };

      await addDoc(COLLECTIONS.assessments, doc);
      existingKeys.add(item.legacyKey);
      imported += 1;
    } catch (err) {
      failed += 1;
      console.error('import record failed:', item.legacyKey, err.message);
    }
  }

  return { imported, skipped, failed, total: records.length };
}

module.exports = {
  createAssessment,
  listAssessments,
  deleteAssessment,
  clearAssessments,
  importAssessments,
  mapDoc,
};
