"use strict";

const { collectSearchText } = require("./residential-filter");

const SPECIAL_REMARK_KEYWORDS = [
  "유치권",
  "법정지상권",
  "분묘기지권",
  "지분매각",
  "일괄매각",
  "제시외 건물",
  "매각 제외",
  "재매각",
  "특별매각조건",
  "전세권",
  "임차권등기",
  "대항력",
  "선순위 임차인",
  "위반건축물",
  "공유자우선매수",
  "농지취득자격증명",
  "별도등기",
  "점유자",
  "임차인",
];

function extractSpecialRemarks(sourceItem) {
  const evidence = [];
  const seen = new Set();

  for (const { field, text } of collectSearchText(sourceItem)) {
    for (const keyword of SPECIAL_REMARK_KEYWORDS) {
      if (!text.includes(keyword)) continue;
      const key = `${keyword}\u0000${field}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({ keyword, field, sourceText: text });
    }
  }

  return {
    remarks: [
      ...new Set(evidence.map(({ keyword }) => keyword)),
    ],
    remarksEvidence: evidence,
  };
}

function unverifiedDocumentStatus() {
  return {
    saleSpecificationChecked: false,
    fieldSurveyChecked: false,
    appraisalChecked: false,
  };
}

module.exports = {
  SPECIAL_REMARK_KEYWORDS,
  extractSpecialRemarks,
  unverifiedDocumentStatus,
};
