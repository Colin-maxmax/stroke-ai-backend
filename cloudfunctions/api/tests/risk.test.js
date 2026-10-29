'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRisk, normalizeInput } = require('../lib/risk');
const { calculateLegacyRisk } = require('./fixtures/legacy-risk');

// 旧口径：冻结的网站 v4.1 前端实现，仅用于对照
function legacy(raw) {
  return calculateLegacyRisk(normalizeInput(raw));
}

function compareWithLegacy(raw, label) {
  const actual = computeRisk(raw);
  const expected = legacy(raw);
  const expectedScore = Math.round(expected.riskScore * 10) / 10;

  assert.equal(actual.riskScore, expectedScore, `${label}: riskScore 不一致`);
  assert.equal(actual.riskLevel, expected.riskLevel, `${label}: riskLevel 不一致`);
  assert.equal(actual.probability, expected.probability, `${label}: probability 不一致`);
  assert.deepEqual(actual.riskFactors, expected.riskFactors, `${label}: riskFactors 不一致`);
}

const base = {
  patientName: '测试患者',
  age: 40,
  gender: '男',
  everMarried: '是',
  workType: '私营',
  residenceType: '城市',
  hypertension: false,
  education: '高中/中专',
  monthlyIncome: '5000-10000',
  heartDiseaseType: '0',
  hyperuricemia: false,
  anemia: false,
  mentalIllness: false,
  systolicBP: 118,
  diastolicBP: 76,
  avgGlucoseLevel: 5.2,
  height: 172,
  weight: 62,
  smokingStatus: '从未吸烟',
  exerciseFrequency: '经常运动',
  drinkingStatus: '从不饮酒',
  strokeHistory: false,
  tiaHistory: false,
  strokeFamilyHistory: '0',
  hyperlipidemia: false,
  dietaryHabits: ['均衡'],
  notes: '',
};

test('低风险样例与旧算法一致', () => {
  compareWithLegacy({ ...base, age: 32, workType: '个体经营', exerciseFrequency: '适量运动' }, '低风险');
});

test('高风险样例与旧算法一致', () => {
  compareWithLegacy({
    ...base,
    age: 72,
    workType: '政府工作',
    residenceType: '农村',
    hypertension: true,
    education: '小学及以下',
    monthlyIncome: '<2000',
    heartDiseaseType: '1',
    systolicBP: 185,
    diastolicBP: 112,
    avgGlucoseLevel: 9.8,
    height: 168,
    weight: 82,
    smokingStatus: '目前吸烟',
    exerciseFrequency: '无运动',
    strokeHistory: true,
    tiaHistory: true,
    strokeFamilyHistory: '1',
    hyperlipidemia: true,
    hyperuricemia: true,
    anemia: true,
    mentalIllness: true,
  }, '高风险');
});

test('中风险样例与旧算法一致', () => {
  compareWithLegacy({
    ...base,
    age: 58,
    hypertension: true,
    avgGlucoseLevel: 6.5,
    height: 170,
    weight: 74,
    smokingStatus: '以前吸烟',
    exerciseFrequency: '少量运动',
    strokeFamilyHistory: '2',
  }, '中风险');
});

test('TIA 与血糖/血压边界与旧算法一致', () => {
  for (const glucose of [5.6, 6.1, 6.9, 7.0, 11.1]) {
    for (const [systolicBP, diastolicBP] of [[139, 89], [160, 100], [180, 110]]) {
      compareWithLegacy({
        ...base,
        age: 60,
        tiaHistory: true,
        avgGlucoseLevel: glucose,
        systolicBP,
        diastolicBP,
      }, `边界 glucose=${glucose} bp=${systolicBP}/${diastolicBP}`);
    }
  }
});

test('BMI 24/28 边界与旧算法一致', () => {
  for (const bmi of [18, 23.9, 24, 27.9, 28, 29.5]) {
    const height = 170;
    const weight = Math.round(bmi * (height / 100) ** 2 * 10) / 10;
    compareWithLegacy({ ...base, height, weight }, `bmi=${bmi}`);
  }
});

test('旧版小程序数据（只有 heartDisease 布尔值）与旧算法一致', () => {
  compareWithLegacy({
    ...base,
    age: 66,
    heartDisease: true,
    heartDiseaseType: undefined,
    education: undefined,
    monthlyIncome: undefined,
    strokeHistory: true,
  }, '旧小程序数据');
});

test('随机样例与旧算法一致', () => {
  // 确定性伪随机，保证测试可复现
  let seed = 20261028;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p = 0.5) => rand() < p;

  const workTypes = ['私营', '个体经营', '政府工作', '儿童', '从未工作'];
  const educations = ['小学及以下', '初中', '高中/中专', '大专及以上'];
  const incomes = ['<2000', '2000-5000', '5000-10000', '>10000'];
  const smokes = ['从未吸烟', '以前吸烟', '目前吸烟', '未知'];
  const exercises = ['无运动', '少量运动', '适量运动', '经常运动'];
  const drinks = ['从不饮酒', '偶尔饮酒', '经常饮酒', '过量饮酒'];

  for (let i = 0; i < 300; i += 1) {
    const height = 150 + Math.floor(rand() * 41);
    const weight = 40 + Math.round(rand() * 80 * 10) / 10;
    const raw = {
      ...base,
      age: 18 + Math.floor(rand() * 88),
      gender: pick(['男', '女']),
      everMarried: pick(['是', '否']),
      workType: pick(workTypes),
      residenceType: pick(['城市', '农村']),
      hypertension: chance(),
      education: pick(educations),
      monthlyIncome: pick(incomes),
      heartDiseaseType: pick(['0', '1', '2']),
      hyperuricemia: chance(0.2),
      anemia: chance(0.2),
      mentalIllness: chance(0.2),
      systolicBP: 90 + Math.floor(rand() * 110),
      diastolicBP: 55 + Math.floor(rand() * 75),
      avgGlucoseLevel: Math.round((3.5 + rand() * 12) * 10) / 10,
      height,
      weight,
      smokingStatus: pick(smokes),
      exerciseFrequency: pick(exercises),
      drinkingStatus: pick(drinks),
      strokeHistory: chance(0.15),
      tiaHistory: chance(0.1),
      strokeFamilyHistory: pick(['0', '1', '2']),
      hyperlipidemia: chance(0.3),
      dietaryHabits: [pick(['高盐', '高油', '高糖', '蔬菜不足', '水果不足', '均衡'])],
    };
    compareWithLegacy(raw, `随机样例 #${i}`);
  }
});
