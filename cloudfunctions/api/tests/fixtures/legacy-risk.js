'use strict';

// 冻结的网站 v4.1 前端评分实现，仅用于和 lib/risk.js 做逐项对照测试。
// 来源：index.html 的 handleAssessmentSubmit()（2026-05-08 版本）。
// 不要在生产代码中引用本文件。

function calculateLegacyRisk(input) {
  const {
    age, strokeHistory, tiaHistory, avgGlucoseLevel, workType, hypertension,
    monthlyIncome, education, heartDiseaseType, exerciseFrequency, hyperlipidemia,
    smokingStatus, strokeFamilyHistory, bmi, residenceType, hyperuricemia,
    anemia, mentalIllness, systolicBP, diastolicBP
  } = input;

let riskScore = 0;
  let riskFactors = [];

  // 1. 中风/短暂性脑缺血病史（最重要 38分）
  const hasStrokeOrTIA = strokeHistory || tiaHistory;
  if (hasStrokeOrTIA) {
    riskScore += 38;
    if (strokeHistory) riskFactors.push('中风病史');
    if (tiaHistory) riskFactors.push('短暂性脑缺血病史');
  }

  // 2. 糖尿病史（血糖≥7.0，28分）
  const hasDiabetes = avgGlucoseLevel >= 7.0;
  if (hasDiabetes) {
    riskScore += 28;
    riskFactors.push('糖尿病史');
  }

  // 3. 职业（政府工作/从未工作，16分）
  if (workType === '政府工作' || workType === '从未工作') {
    riskScore += 16;
    riskFactors.push(`职业风险（${workType}）`);
  }

  // 4. 高血压病史（22分）
  if (hypertension) {
    riskScore += 22;
    riskFactors.push('高血压病史');
  }

  // 5. 年龄分层（最高15分）
  if (age >= 75) riskScore += 15;
  else if (age >= 65) riskScore += 12;
  else if (age >= 55) riskScore += 9;
  else if (age >= 45) riskScore += 6;
  else if (age >= 35) riskScore += 3;

  // 6. 家庭人均月收入（低风险 12分）
  if (monthlyIncome === '<2000') riskScore += 12;
  else if (monthlyIncome === '2000-5000') riskScore += 7;

  // 7. 学历（小学及以下 10分）
  if (education === '小学及以下') riskScore += 10;
  else if (education === '初中') riskScore += 6;

  // 8. 房颤/心梗/其他心脏病（房颤14分，其他6分）
  if (heartDiseaseType === '1') {
    riskScore += 14;
    riskFactors.push('房颤或心梗史');
  } else if (heartDiseaseType === '2') {
    riskScore += 6;
    riskFactors.push('其他心脏病');
  }

  // 9. 运动缺乏（10分）
  const lackOfExercise = exerciseFrequency === '无运动' || 
                         (age > 50 && exerciseFrequency === '少量运动');
  if (lackOfExercise) {
    riskScore += 10;
    riskFactors.push('运动缺乏');
  }

  // 10. 高血脂（9分）
  if (hyperlipidemia) {
    riskScore += 9;
    riskFactors.push('高血脂');
  }

  // 11. 吸烟（目前吸烟8分，以前吸烟4分）
  if (smokingStatus === '目前吸烟') {
    riskScore += 8;
    riskFactors.push('目前吸烟');
  } else if (smokingStatus === '以前吸烟') {
    riskScore += 4;
    riskFactors.push('以前吸烟');
  }

  // 12. 脑卒中家族史（7分）
  if (strokeFamilyHistory !== '0') {
    riskScore += 7;
    const familyLevel = strokeFamilyHistory === '1' ? '一级亲属' : '二级亲属';
    riskFactors.push(`脑卒中家族史（${familyLevel}）`);
  }

  // 13. 超重/肥胖 BMI（肥胖7分，超重5分）
  if (bmi) {
    if (bmi >= 28) {
      riskScore += 7;
      riskFactors.push('肥胖（BMI≥28）');
    } else if (bmi >= 24) {
      riskScore += 5;
      riskFactors.push('超重（BMI 24-27.9）');
    }
  }

  // 14. 居住地农村（4分）
  if (residenceType === '农村') riskScore += 4;

  // 15. 高尿酸血症（4分）
  if (hyperuricemia) {
    riskScore += 4;
    riskFactors.push('高尿酸血症');
  }

  // 16. 贫血（3分）
  if (anemia) {
    riskScore += 3;
    riskFactors.push('贫血');
  }

  // 17. 心理疾病（3分）
  if (mentalIllness) {
    riskScore += 3;
    riskFactors.push('心理疾病');
  }

  // 18. 血压/血糖附加修正（额外加分，不占主要权重）
  if (systolicBP >= 180 || diastolicBP >= 110) riskScore += 5;
  else if (systolicBP >= 160 || diastolicBP >= 100) riskScore += 3;
  if (avgGlucoseLevel >= 6.1 && avgGlucoseLevel < 7.0) riskScore += 3;  // 糖尿病前期
  if (avgGlucoseLevel >= 11.1) riskScore += 4;  // 严重高血糖

  // 截断总分最高100
  let normalizedScore = Math.min(riskScore, 100);

  // ========== 风险等级判定（阈值微调，匹配模型性能）==========
  let riskLevel, probability;
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
  const probabilityPercent = (probability * 100).toFixed(1);

  return { riskScore, riskLevel, probability: probabilityPercent, riskFactors };
}

module.exports = { calculateLegacyRisk };
