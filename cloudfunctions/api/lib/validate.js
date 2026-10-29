'use strict';

const { OPTIONS } = require('./risk');
const { errors } = require('./errors');

const DIETARY_OPTIONS = ['高盐', '高油', '高糖', '蔬菜不足', '水果不足', '均衡'];
const USERNAME_RE = /^[A-Za-z0-9_一-龥]{3,32}$/;

function text(value, max = 100) {
  if (value == null) return '';
  return String(value).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === '是' || value === '有';
}

function intInRange(value, min, max) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function floatInRange(value, min, max) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function enumValue(value, allowed, field, loose) {
  const raw = value == null ? '' : String(value);
  if (raw === '') return '';
  if (allowed.includes(raw)) return raw;
  if (loose) return '';
  throw errors.invalid(`${field}的取值不合法`);
}

function validateCredentials(input = {}) {
  const username = text(input.username, 32);
  const password = input.password == null ? '' : String(input.password);

  if (!USERNAME_RE.test(username)) {
    throw errors.invalid('账号需为 3-32 位中英文、数字或下划线');
  }
  if (password.length < 6 || password.length > 64) {
    throw errors.invalid('密码长度需为 6-64 位');
  }
  const displayName = text(input.displayName, 32) || username;
  return { username, password, displayName };
}

/**
 * 校验并清洗评估表单。strict=true 用于网站/小程序正式提交；
 * loose=true 用于历史数据导入，缺失字段按中性值处理。
 */
function validateAssessment(raw = {}, { loose = false } = {}) {
  const patientName = text(raw.patientName, 50);
  if (!loose && !patientName) throw errors.invalid('请填写患者姓名');

  const age = intInRange(raw.age, 18, 120);
  if (!loose && age == null) throw errors.invalid('年龄需在 18-120 岁之间');

  const systolicBP = intInRange(raw.systolicBP, 60, 250);
  const diastolicBP = intInRange(raw.diastolicBP, 40, 180);
  if (!loose && systolicBP == null) throw errors.invalid('收缩压需在 60-250 mmHg 之间');
  if (!loose && diastolicBP == null) throw errors.invalid('舒张压需在 40-180 mmHg 之间');

  const avgGlucoseLevel = floatInRange(raw.avgGlucoseLevel, 1.0, 50.0);
  if (!loose && avgGlucoseLevel == null) throw errors.invalid('空腹血糖需在 1.0-50.0 mmol/L 之间');

  const height = floatInRange(raw.height, 100, 250);
  const weight = floatInRange(raw.weight, 30, 200);
  if (!loose && raw.height !== '' && raw.height != null && height == null) {
    throw errors.invalid('身高需在 100-250 cm 之间');
  }
  if (!loose && raw.weight !== '' && raw.weight != null && weight == null) {
    throw errors.invalid('体重需在 30-200 kg 之间');
  }

  const gender = enumValue(raw.gender, OPTIONS.GENDER, '性别', loose);
  if (!loose && !gender) throw errors.invalid('请选择性别');

  let heartDiseaseType = raw.heartDiseaseType == null ? '' : String(raw.heartDiseaseType);
  if (!['0', '1', '2'].includes(heartDiseaseType)) {
    if (!loose && heartDiseaseType !== '') throw errors.invalid('心脏病类型不合法');
    heartDiseaseType = bool(raw.heartDisease) ? '2' : '0';
  }

  let strokeFamilyHistory = raw.strokeFamilyHistory == null ? '0' : String(raw.strokeFamilyHistory);
  if (!['0', '1', '2'].includes(strokeFamilyHistory)) {
    if (!loose) throw errors.invalid('脑卒中家族史取值不合法');
    strokeFamilyHistory = '0';
  }

  const dietaryHabits = Array.isArray(raw.dietaryHabits)
    ? [...new Set(raw.dietaryHabits.map((item) => String(item)).filter((item) => DIETARY_OPTIONS.includes(item)))]
    : [];
  if (!loose && dietaryHabits.length !== (Array.isArray(raw.dietaryHabits) ? raw.dietaryHabits.length : 0)) {
    throw errors.invalid('膳食习惯包含不支持的选项');
  }

  return {
    patientName: patientName || (loose ? '未命名' : ''),
    age: age == null ? 0 : age,
    gender,
    everMarried: enumValue(raw.everMarried, ['是', '否'], '婚姻状况', loose),
    workType: enumValue(raw.workType, OPTIONS.WORK_TYPE, '职业类型', loose),
    residenceType: enumValue(raw.residenceType, OPTIONS.RESIDENCE, '居住地类型', loose),
    hypertension: bool(raw.hypertension),
    education: enumValue(raw.education, OPTIONS.EDUCATION, '学历', loose),
    monthlyIncome: enumValue(raw.monthlyIncome, OPTIONS.INCOME, '家庭人均月收入', loose),
    heartDiseaseType,
    heartDisease: heartDiseaseType !== '0',
    hyperuricemia: bool(raw.hyperuricemia),
    anemia: bool(raw.anemia),
    mentalIllness: bool(raw.mentalIllness),
    systolicBP: systolicBP == null ? 0 : systolicBP,
    diastolicBP: diastolicBP == null ? 0 : diastolicBP,
    avgGlucoseLevel: avgGlucoseLevel == null ? 0 : avgGlucoseLevel,
    height: height == null ? null : height,
    weight: weight == null ? null : weight,
    smokingStatus: enumValue(raw.smokingStatus, OPTIONS.SMOKING, '吸烟状况', loose),
    exerciseFrequency: enumValue(raw.exerciseFrequency, OPTIONS.EXERCISE, '运动频率', loose),
    drinkingStatus: enumValue(raw.drinkingStatus, OPTIONS.DRINKING, '饮酒状况', loose),
    strokeHistory: bool(raw.strokeHistory),
    tiaHistory: bool(raw.tiaHistory),
    strokeFamilyHistory,
    hyperlipidemia: bool(raw.hyperlipidemia),
    dietaryHabits,
    notes: text(raw.notes, 500),
  };
}

module.exports = {
  DIETARY_OPTIONS,
  validateCredentials,
  validateAssessment,
};
