(() => {
  "use strict";

  const CHANGE_LABELS = {
    NEW: "신규",
    PRICE_DOWN: "가격 하락",
    PRICE_UP: "가격 상승",
    FAILED_BID_INCREMENT: "유찰 증가",
    SALE_DATE_CHANGED: "매각기일 변경",
    STATUS_CHANGED: "상태 변경",
    RESTARTED: "재개",
    WITHDRAWN: "취하 확인",
    DETAIL_UPDATED: "상세 변경",
  };
  const FILTERABLE_CHANGES = new Set([
    "NEW",
    "PRICE_DOWN",
    "FAILED_BID_INCREMENT",
  ]);

  function readPayload() {
    const element = document.getElementById("report-data");
    if (!element) return {};
    try {
      return JSON.parse(element.textContent || "{}");
    } catch (error) {
      console.error("보고서 데이터를 읽지 못했습니다.", error);
      return {};
    }
  }

  function asNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function formatCount(value) {
    if (value === null || value === undefined || value === "") return "산정 불가";
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return "산정 불가";
    return `${number.toLocaleString("ko-KR")}건`;
  }

  function formatWon(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${Math.round(number).toLocaleString("ko-KR")}원`;
  }

  function formatRatio(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(1)}%` : "—";
  }

  function formatTimestamp(value) {
    if (!value) return "기록 없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter(({ type }) => type !== "literal")
        .map(({ type, value: partValue }) => [type, partValue]),
    );
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
  }

  function formatSaleDate(value) {
    const text = String(value || "").trim();
    return text || "미정";
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function itemChanges(item) {
    return Array.isArray(item?.changeType)
      ? item.changeType.filter((type) => Object.hasOwn(CHANGE_LABELS, type))
      : [];
  }

  function hasVisibleChange(item) {
    return itemChanges(item).length > 0;
  }

  function saleDateKey(item) {
    const text = String(item?.saleDate || "");
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }

  function sortItems(items) {
    return [...items].sort((left, right) => {
      const changedOrder =
        Number(!hasVisibleChange(left)) - Number(!hasVisibleChange(right));
      if (changedOrder !== 0) return changedOrder;

      const dateOrder = saleDateKey(left) - saleDateKey(right);
      if (dateOrder !== 0) return dateOrder;
      return String(left?.caseNumber || "").localeCompare(
        String(right?.caseNumber || ""),
        "ko",
      );
    });
  }

  function itemRegion(item) {
    const explicit = String(item?.region || "");
    const address = String(item?.address || "");
    if (explicit.includes("홍성군") || address.includes("홍성군")) return "홍성군";
    if (explicit.includes("예산군") || address.includes("예산군")) return "예산군";
    return "";
  }

  function verifiedEvidence(item) {
    const evidence = Array.isArray(item?.remarksEvidence)
      ? item.remarksEvidence
      : [];
    return evidence.filter((entry) => {
      const keyword = String(entry?.keyword || "").trim();
      const field = String(entry?.field || "").trim();
      const sourceText = String(entry?.sourceText || "").trim();
      return keyword && field && sourceText && sourceText.includes(keyword);
    });
  }

  function appendChangeBadges(container, item) {
    const changes = itemChanges(item);
    if (changes.length === 0) {
      container.append(element("span", "muted-text", "변경 없음"));
      return;
    }
    for (const type of changes) {
      const badge = element(
        "span",
        `badge badge-change badge-${type.toLowerCase().replaceAll("_", "-")}`,
        CHANGE_LABELS[type],
      );
      container.append(badge);
    }
  }

  function appendRemarks(container, item) {
    const evidence = verifiedEvidence(item);
    if (evidence.length === 0) {
      container.append(
        element("span", "muted-text", "검색목록상 별도 특이사항 미표시"),
      );
    } else {
      const keywords = [...new Set(evidence.map(({ keyword }) => keyword))];
      const badgeRow = element("div", "badge-row");
      for (const keyword of keywords) {
        badgeRow.append(element("span", "badge badge-remark", keyword));
      }
      container.append(badgeRow);

      const details = element("details", "evidence-details");
      details.append(element("summary", "", "원문 근거 보기"));
      const list = element("ul", "evidence-list");
      for (const entry of evidence) {
        const itemElement = element("li");
        itemElement.append(
          element("strong", "", `${entry.field}: `),
          document.createTextNode(entry.sourceText),
        );
        list.append(itemElement);
      }
      details.append(list);
      container.append(details);
    }

    const verification = item?.documentVerification || {};
    if (
      verification.saleSpecificationChecked !== true ||
      verification.fieldSurveyChecked !== true
    ) {
      container.append(
        element(
          "span",
          "document-warning",
          "매각물건명세서·현황조사서 미검증",
        ),
      );
    }
    if (verification.appraisalChecked !== true) {
      container.append(
        element("span", "document-warning", "감정평가서 미검증"),
      );
    }
  }

  function appendDetailStatus(container, item) {
    const status = String(item?.detailStatus || "");
    if (!/(대기|실패|차단|중단)/u.test(status)) return;
    container.append(element("span", "detail-status", status));
  }

  function copyButton(item) {
    const caseNumber = String(item?.caseNumber || "").trim();
    const button = element("button", "copy-button", "사건번호 복사");
    button.type = "button";
    button.dataset.copyValue = caseNumber;
    button.disabled = !caseNumber;
    button.setAttribute(
      "aria-label",
      caseNumber ? `${caseNumber} 사건번호 복사` : "복사할 사건번호 없음",
    );
    return button;
  }

  function caseBlock(item) {
    const wrapper = element("div", "case-block");
    wrapper.append(
      element("strong", "case-number", item?.caseNumber || "사건번호 미확인"),
    );
    if (item?.itemNumber) {
      wrapper.append(element("span", "item-number", `물건 ${item.itemNumber}`));
    }
    wrapper.append(copyButton(item));
    return wrapper;
  }

  function makeTableRow(item) {
    const row = document.createElement("tr");
    if (hasVisibleChange(item)) row.classList.add("is-changed");

    const caseCell = document.createElement("td");
    caseCell.append(caseBlock(item));

    const propertyCell = document.createElement("td");
    propertyCell.append(
      element("strong", "usage-name", item?.usage || "용도 미확인"),
      element("span", "address-text", item?.address || "주소 미확인"),
    );
    if (item?.status) {
      propertyCell.append(element("span", "status-text", item.status));
    }
    appendDetailStatus(propertyCell, item);

    const appraisalCell = element(
      "td",
      "numeric-cell",
      formatWon(item?.appraisedPrice),
    );
    const minimumCell = element(
      "td",
      "numeric-cell price-current",
      formatWon(item?.minimumSalePrice),
    );
    const ratioCell = element(
      "td",
      "numeric-cell",
      formatRatio(item?.priceRatio),
    );
    const failedCell = element(
      "td",
      "numeric-cell",
      `${asNonNegativeNumber(item?.failedBidCount)}회`,
    );
    const saleCell = element(
      "td",
      "date-cell",
      formatSaleDate(item?.saleDate),
    );

    const remarksCell = document.createElement("td");
    remarksCell.className = "remarks-cell";
    appendRemarks(remarksCell, item);

    const changesCell = document.createElement("td");
    changesCell.className = "changes-cell badge-row";
    appendChangeBadges(changesCell, item);

    row.append(
      caseCell,
      propertyCell,
      appraisalCell,
      minimumCell,
      ratioCell,
      failedCell,
      saleCell,
      remarksCell,
      changesCell,
    );
    return row;
  }

  function definition(label, value, className = "") {
    const wrapper = element("div", `definition ${className}`.trim());
    wrapper.append(element("dt", "", label), element("dd", "", value));
    return wrapper;
  }

  function makeCard(item) {
    const card = element("article", "auction-card");
    if (hasVisibleChange(item)) card.classList.add("is-changed");

    const top = element("div", "card-top");
    top.append(caseBlock(item));
    const changes = element("div", "badge-row card-changes");
    appendChangeBadges(changes, item);
    top.append(changes);

    const location = element("div", "card-location");
    location.append(
      element("strong", "usage-name", item?.usage || "용도 미확인"),
      element("p", "address-text", item?.address || "주소 미확인"),
    );
    if (item?.status) {
      location.append(element("span", "status-text", item.status));
    }
    appendDetailStatus(location, item);

    const values = element("dl", "card-values");
    values.append(
      definition("감정가", formatWon(item?.appraisedPrice)),
      definition(
        "현재 최저가",
        formatWon(item?.minimumSalePrice),
        "definition-highlight",
      ),
      definition("감정가 대비", formatRatio(item?.priceRatio)),
      definition("유찰횟수", `${asNonNegativeNumber(item?.failedBidCount)}회`),
      definition("매각기일", formatSaleDate(item?.saleDate), "definition-wide"),
    );

    const remarks = element("div", "card-remarks");
    remarks.append(element("h3", "", "특이사항"));
    appendRemarks(remarks, item);

    card.append(top, location, values, remarks);
    return card;
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const temporary = document.createElement("textarea");
    temporary.value = value;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) throw new Error("copy command failed");
  }

  let toastTimer;
  function showToast(message) {
    const toast = document.getElementById("copy-toast");
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  function installCopyHandler() {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-copy-value]");
      if (!button || button.disabled) return;
      try {
        await copyText(button.dataset.copyValue);
        showToast("사건번호를 복사했습니다.");
      } catch {
        showToast("복사하지 못했습니다. 사건번호를 길게 눌러 복사해 주세요.");
      }
    });
  }

  function setText(id, text) {
    const target = document.getElementById(id);
    if (target) target.textContent = text;
  }

  const payload = readPayload();
  const latest = payload.latest || {};
  const completeness = latest.completeness || {};
  const display = payload.display || {};
  const allItems = sortItems(Array.isArray(display.items) ? display.items : []);
  const reviewItems = Array.isArray(display.reviewItems)
    ? display.reviewItems
    : [];
  const state = { region: "ALL", change: "ALL" };

  function updateSummary() {
    const complete = completeness.complete === true;
    const fetchedPages = asNonNegativeNumber(completeness.fetchedPages);
    const expectedPages = asNonNegativeNumber(completeness.expectedPages);
    const residentialCount =
      completeness.matchedResidentialCount === undefined
        ? allItems.length
        : completeness.matchedResidentialCount;

    setText("updated-at", formatTimestamp(latest.generatedAt));
    setText("stat-total", formatCount(completeness.totalCount));
    setText("stat-checked", formatCount(completeness.fetchedUniqueCount));
    setText("stat-missing", formatCount(completeness.missingCount));
    setText("stat-residential", formatCount(residentialCount));
    setText("stat-success", complete ? "성공" : "실패");

    const successCard = document.getElementById("success-card");
    successCard.classList.toggle("is-success", complete);
    successCard.classList.toggle("is-failure", !complete);
    document.body.dataset.reportState = complete ? "complete" : "incomplete";

    const warning = document.getElementById("incomplete-warning");
    warning.hidden = complete;
    if (!complete) {
      setText(
        "warning-missing",
        `미확인 경매 ${formatCount(completeness.missingCount)}`,
      );
      setText(
        "warning-pages",
        `확인 페이지 ${fetchedPages.toLocaleString("ko-KR")}/${expectedPages.toLocaleString("ko-KR")}`,
      );
      setText(
        "warning-last-good",
        payload.lastGoodGeneratedAt
          ? `마지막 정상 전체조회 ${formatTimestamp(payload.lastGoodGeneratedAt)}`
          : "마지막 정상 전체조회 기록 없음",
      );
    }

    const fixtureMode = latest?.source?.mode === "fixture";
    const modeBadge = document.getElementById("mode-badge");
    modeBadge.hidden = !fixtureMode;
    document.body.dataset.sourceMode = fixtureMode ? "fixture" : "live";
    const fixturePrefix = fixtureMode ? "예제 fixture 데이터 · " : "";

    if (payload.displaySource === "last-good") {
      setText(
        "display-source-note",
        `${fixturePrefix}목록은 마지막 정상 전체조회 ${formatTimestamp(display.generatedAt)} 결과를 표시합니다.`,
      );
    } else if (payload.displaySource === "none") {
      setText(
        "display-source-note",
        `${fixturePrefix}아직 표시할 정상 전체조회 결과가 없습니다.`,
      );
    } else {
      setText(
        "display-source-note",
        `${fixturePrefix}목록 기준 ${formatTimestamp(display.generatedAt)}`,
      );
    }
  }

  function matchesFilters(item) {
    const regionMatches =
      state.region === "ALL" || itemRegion(item) === state.region;
    const changes = itemChanges(item);
    const changeMatches =
      state.change === "ALL" ||
      (FILTERABLE_CHANGES.has(state.change) && changes.includes(state.change));
    return regionMatches && changeMatches;
  }

  function renderItems() {
    const visibleItems = allItems.filter(matchesFilters);
    const tableBody = document.getElementById("auction-table-body");
    const cards = document.getElementById("auction-cards");
    const tableFragment = document.createDocumentFragment();
    const cardFragment = document.createDocumentFragment();

    for (const item of visibleItems) {
      tableFragment.append(makeTableRow(item));
      cardFragment.append(makeCard(item));
    }
    tableBody.replaceChildren(tableFragment);
    cards.replaceChildren(cardFragment);

    setText("visible-count", `${visibleItems.length.toLocaleString("ko-KR")}건 표시`);
    document.getElementById("empty-state").hidden = visibleItems.length !== 0;
  }

  function makeReviewCard(entry) {
    const item = entry?.item || {};
    const card = element("article", "review-card");
    const reason = element(
      "span",
      "badge badge-review",
      entry?.reason || "수동확인 필요",
    );
    const heading = element("div", "review-card-heading");
    heading.append(caseBlock(item), reason);

    const location = element("div", "card-location");
    location.append(
      element("strong", "usage-name", item?.usage || "용도 미확인"),
      element("p", "address-text", item?.address || "주소 미확인"),
    );

    const matched = entry?.matchedKeywords || {};
    const keywordText = [
      ...(Array.isArray(matched.residential) ? matched.residential : []),
      ...(Array.isArray(matched.excluded) ? matched.excluded : []),
    ];
    if (keywordText.length > 0) {
      location.append(
        element(
          "p",
          "review-keywords",
          `판정 키워드: ${[...new Set(keywordText)].join(", ")}`,
        ),
      );
    }

    const remarks = element("div", "card-remarks");
    remarks.append(element("h3", "", "특이사항 근거"));
    appendRemarks(remarks, item);
    card.append(heading, location, remarks);
    return card;
  }

  function renderReviewItems() {
    const section = document.getElementById("review-section");
    const container = document.getElementById("review-cards");
    section.hidden = reviewItems.length === 0;
    setText("review-count", `${reviewItems.length.toLocaleString("ko-KR")}건`);
    const fragment = document.createDocumentFragment();
    for (const entry of reviewItems) fragment.append(makeReviewCard(entry));
    container.replaceChildren(fragment);

    const detail = display.detailSummary || {};
    const messages = [];
    if (detail.blocked) messages.push("상세조회 차단");
    if (Number(detail.pending) > 0) messages.push(`상세조회 대기 ${detail.pending}건`);
    if (Number(detail.failed) > 0) messages.push(`상세조회 실패 ${detail.failed}건`);
    const detailElement = document.getElementById("detail-summary");
    detailElement.hidden = messages.length === 0;
    detailElement.textContent = messages.join(" · ");
  }

  function installFilters() {
    document.querySelectorAll("[data-region]").forEach((button) => {
      button.addEventListener("click", () => {
        state.region = button.dataset.region;
        document.querySelectorAll("[data-region]").forEach((candidate) => {
          candidate.setAttribute(
            "aria-pressed",
            String(candidate === button),
          );
        });
        renderItems();
      });
    });

    document.querySelectorAll("[data-change]").forEach((button) => {
      button.addEventListener("click", () => {
        state.change = button.dataset.change;
        document.querySelectorAll("[data-change]").forEach((candidate) => {
          candidate.setAttribute(
            "aria-pressed",
            String(candidate === button),
          );
        });
        renderItems();
      });
    });
  }

  function updateNetworkStatus() {
    const status = document.getElementById("network-status");
    const online = navigator.onLine;
    status.textContent = online ? "온라인" : "오프라인 · 저장된 보고서";
    status.classList.toggle("is-offline", !online);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
        console.warn("오프라인 저장을 시작하지 못했습니다.", error);
      });
    });
  }

  updateSummary();
  installFilters();
  installCopyHandler();
  renderItems();
  renderReviewItems();
  updateNetworkStatus();
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  registerServiceWorker();
})();
