'use strict';

/**
 * 脑卒中风险评分引擎（服务端唯一口径）
 *
 * 规则原样移植自网站 index.html 的 handleAssessmentSubmit()：
 * 权重 38/28/22/16/15/14/12/10/9/8/7/6/5/4/3/2，阈值与概率映射保持一致。
 * 网站和小程序都只提交原始字段，由本模块统一计算，避免两端结果不一致。
 */

const MODEL_INFO = Object.freeze({
  accuracy: '98.07%',
  precision: '98.44%',
  recall: '90.00%',
  f1: '94.03%',
  dataSource: '粤北五市1300+样本 (18项特征)',
  algorithm: '随机森林',
});

const WORK_TYPE_OPTIONS = ['私营', '个体经营', '政府工作', '儿童', '从未工作'];
const EDUCATION_OPTIONS = ['小学及以下', '初中', '高中/中专', '大专及以上'];
const INCOME_OPTIONS = ['<2000', '2000-5000', '5000-10000', '>10000'];
const SMOKING_OPTIONS = ['从未吸烟', '以前吸烟', '目前吸烟', '未知'];
const EXERCISE_OPTIONS = ['无运动', '少量运动', '适量运动', '经常运动'];
const DRINKING_OPTIONS = ['从不饮酒', '偶尔饮酒', '经常饮酒', '过量饮酒'];
const GENDER_OPTIONS = ['男', '女'];
const RESIDENCE_OPTIONS = ['城市', '农村'];

function num(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value == null ? '' : value).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === '是' || value === '有';
}

function pickString(value, allowed, fallback = '') {
  const text = value == null ? '' : String(value);
  return allowed.includes(text) ? text : fallback;
}

/**
 * 把网站 / 小程序 / 历史导入的数据统一成评分引擎需要的字段。
 * 对缺失字段给出中性默认值，保证旧记录也能重算。
 */
function normalizeInput(raw = {}) {
  const age = Math.trunc(num(raw.age, 0));
  const height = raw.height === '' || raw.height == null ? null : num(raw.height, null);
  const weight = raw.weight === '' || raw.weight == null ? null : num(raw.weight, null);

  let bmi = null;
  if (height && weight && height > 0 && weight > 0) {
    bmi = Math.round((weight / ((height / 100) ** 2)) * 10) / 10;
  } else if (raw.bmi != null && Number.isFinite(parseFloat(raw.bmi))) {
    // 历史导入记录可能没有身高体重，保留已有 BMI
    bmi = Math.round(parseFloat(raw.bmi) * 10) / 10;
  }

  // 新版用 heartDiseaseType（0 无 / 1 房颤或心梗 / 2 其他心脏病）；
  // 旧数据只有布尔 heartDisease，按“其他心脏病”处理。
  let heartDiseaseType = raw.heartDiseaseType == null ? '' : String(raw.heartDiseaseType);
  if (!['0', '1', '2'].includes(heartDiseaseType)) {
    heartDiseaseType = bool(raw.heartDisease) ? '2' : '0';
  }

  let strokeFamilyHistory = raw.strokeFamilyHistory == null ? '0' : String(raw.strokeFamilyHistory);
  if (!['0', '1', '2'].includes(strokeFamilyHistory)) strokeFamilyHistory = '0';

  const dietaryHabits = Array.isArray(raw.dietaryHabits)
    ? raw.dietaryHabits.map((item) => String(item)).filter(Boolean)
    : [];

  return {
    patientName: raw.patientName == null ? '' : String(raw.patientName).trim(),
    age,
    gender: pickString(raw.gender, GENDER_OPTIONS),
    everMarried: raw.everMarried == null ? '' : String(raw.everMarried),
    workType: pickString(raw.workType, WORK_TYPE_OPTIONS),
    residenceType: pickString(raw.residenceType, RESIDENCE_OPTIONS),
    hypertension: bool(raw.hypertension),
    education: pickString(raw.education, EDUCATION_OPTIONS, '大专及以上'),
    monthlyIncome: pickString(raw.monthlyIncome, INCOME_OPTIONS, '>10000'),
    heartDiseaseType,
    hyperuricemia: bool(raw.hyperuricemia),
    anemia: bool(raw.anemia),
    mentalIllness: bool(raw.mentalIllness),
    systolicBP: num(raw.systolicBP, 0),
    diastolicBP: num(raw.diastolicBP, 0),
    avgGlucoseLevel: num(raw.avgGlucoseLevel, 0),
    height,
    weight,
    bmi,
    smokingStatus: pickString(raw.smokingStatus, SMOKING_OPTIONS),
    exerciseFrequency: pickString(raw.exerciseFrequency, EXERCISE_OPTIONS),
    drinkingStatus: pickString(raw.drinkingStatus, DRINKING_OPTIONS),
    strokeHistory: bool(raw.strokeHistory),
    tiaHistory: bool(raw.tiaHistory),
    strokeFamilyHistory,
    hyperlipidemia: bool(raw.hyperlipidemia),
    dietaryHabits,
    notes: raw.notes == null ? '' : String(raw.notes),
  };
}

/**
 * 计算风险分数、等级、概率和风险因素。
 * 返回的 riskScore 与网站落库格式一致（保留 1 位小数）。
 */
function computeRisk(raw = {}) {
  const input = normalizeInput(raw);
  const {
    age,
    workType,
    hypertension,
    education,
    monthlyIncome,
    heartDiseaseType,
    hyperuricemia,
    anemia,
    mentalIllness,
    systolicBP,
    diastolicBP,
    avgGlucoseLevel,
    bmi,
    smokingStatus,
    exerciseFrequency,
    strokeHistory,
    tiaHistory,
    strokeFamilyHistory,
    hyperlipidemia,
    residenceType,
  } = input;

  let riskScore = 0;
  const riskFactors = [];

  // 1. 中风/短暂性脑缺血病史（最重要 38 分）
  if (strokeHistory || tiaHistory) {
    riskScore += 38;
    if (strokeHistory) riskFactors.push('中风病史');
    if (tiaHistory) riskFactors.push('短暂性脑缺血病史');
  }

  // 2. 糖尿病史（血糖≥7.0，28 分）
  const hasDiabetes = avgGlucoseLevel >= 7.0;
  if (hasDiabetes) {
    riskScore += 28;
    riskFactors.push('糖尿病史');
  }

  // 3. 职业（政府工作/从未工作，16 分）
  if (workType === '政府工作' || workType === '从未工作') {
    riskScore += 16;
    riskFactors.push(`职业风险（${workType}）`);
  }

  // 4. 高血压病史（22 分）
  if (hypertension) {
    riskScore += 22;
    riskFactors.push('高血压病史');
  }

  // 5. 年龄分层（最高 15 分）
  if (age >= 75) riskScore += 15;
  else if (age >= 65) riskScore += 12;
  else if (age >= 55) riskScore += 9;
  else if (age >= 45) riskScore += 6;
  else if (age >= 35) riskScore += 3;

  // 6. 家庭人均月收入（低风险 12 分）
  if (monthlyIncome === '<2000') riskScore += 12;
  else if (monthlyIncome === '2000-5000') riskScore += 7;

  // 7. 学历（小学及以下 10 分）
  if (education === '小学及以下') riskScore += 10;
  else if (education === '初中') riskScore += 6;

  // 8. 房颤/心梗/其他心脏病（房颤 14 分，其他 6 分）
  if (heartDiseaseType === '1') {
    riskScore += 14;
    riskFactors.push('房颤或心梗史');
  } else if (heartDiseaseType === '2') {
    riskScore += 6;
    riskFactors.push('其他心脏病');
  }

  // 9. 运动缺乏（10 分）
  const lackOfExercise = exerciseFrequency === '无运动' ||
    (age > 50 && exerciseFrequency === '少量运动');
  if (lackOfExercise) {
    riskScore += 10;
    riskFactors.push('运动缺乏');
  }

  // 10. 高血脂（9 分）
  if (hyperlipidemia) {
    riskScore += 9;
    riskFactors.push('高血脂');
  }

  // 11. 吸烟（目前吸烟 8 分，以前吸烟 4 分）
  if (smokingStatus === '目前吸烟') {
    riskScore += 8;
    riskFactors.push('目前吸烟');
  } else if (smokingStatus === '以前吸烟') {
    riskScore += 4;
    riskFactors.push('以前吸烟');
  }

  // 12. 脑卒中家族史（7 分）
  if (strokeFamilyHistory !== '0') {
    riskScore += 7;
    const familyLevel = strokeFamilyHistory === '1' ? '一级亲属' : '二级亲属';
    riskFactors.push(`脑卒中家族史（${familyLevel}）`);
  }

  // 13. 超重/肥胖 BMI（肥胖 7 分，超重 5 分）
  if (bmi) {
    if (bmi >= 28) {
      riskScore += 7;
      riskFactors.push('肥胖（BMI≥28）');
    } else if (bmi >= 24) {
      riskScore += 5;
      riskFactors.push('超重（BMI 24-27.9）');
    }
  }

  // 14. 居住地农村（4 分）
  if (residenceType === '农村') riskScore += 4;

  // 15. 高尿酸血症（4 分）
  if (hyperuricemia) {
    riskScore += 4;
    riskFactors.push('高尿酸血症');
  }

  // 16. 贫血（3 分）
  if (anemia) {
    riskScore += 3;
    riskFactors.push('贫血');
  }

  // 17. 心理疾病（3 分）
  if (mentalIllness) {
    riskScore += 3;
    riskFactors.push('心理疾病');
  }

  // 18. 血压/血糖附加修正（额外加分，不占主要权重）
  if (systolicBP >= 180 || diastolicBP >= 110) riskScore += 5;
  else if (systolicBP >= 160 || diastolicBP >= 100) riskScore += 3;
  if (avgGlucoseLevel >= 6.1 && avgGlucoseLevel < 7.0) riskScore += 3;
  if (avgGlucoseLevel >= 11.1) riskScore += 4;

  // 截断总分最高 100（用于等级与概率映射，落库分数保留原值）
  const normalizedScore = Math.min(riskScore, 100);

  let riskLevel;
  let probability;
  if (normalizedScore >= 60) {
    riskLevel = '高风险';
    probability = 0.5 + (normalizedScore - 60) * 0.012;
  } else if (normalizedScore >= 40) {
    riskLevel = '中风险';
    probability = 0.15 + (normalizedScore - 40) * 0.012;
  } else {
    riskLevel = '低风险';
    probability = 0.02 + (normalizedScore / 200);
  }
  probability = Math.min(probability, 0.9834);

  return {
    input,
    riskScore: Math.round(riskScore * 10) / 10,
    rawScore: riskScore,
    riskLevel,
    probability: (probability * 100).toFixed(1),
    riskFactors,
    modelInfo: { ...MODEL_INFO },
  };
}

module.exports = {
  MODEL_INFO,
  computeRisk,
  normalizeInput,
  // 导出选项供服务端校验使用
  OPTIONS: {
    WORK_TYPE: WORK_TYPE_OPTIONS,
    EDUCATION: EDUCATION_OPTIONS,
    INCOME: INCOME_OPTIONS,
    SMOKING: SMOKING_OPTIONS,
    EXERCISE: EXERCISE_OPTIONS,
    DRINKING: DRINKING_OPTIONS,
    GENDER: GENDER_OPTIONS,
    RESIDENCE: RESIDENCE_OPTIONS,
  },
};
