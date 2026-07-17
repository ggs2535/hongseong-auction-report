"use strict";

const PROPERTY_SEARCH_PATH = "/pgj/pgjsearch/searchControllerMain.on";
const PROPERTY_SEARCH_PAGE_SIZE = 40;
const SEARCH_FILTER_FIELDS = Object.freeze([
  "cortOfcCd",
  "lclDspslGdsLstUsgCd",
  "bidDvsCd",
  "bidBgngYmd",
  "bidEndYmd",
]);

const SELECTORS = Object.freeze({
  court: "#mf_wfm_mainFrame_sbx_rletCortOfc",
  usageLarge: "#mf_wfm_mainFrame_sbx_rletLclLst",
  bidAll: "#mf_wfm_mainFrame_rad_mvprpBidLst_input_2",
  bidAllLabel:
    'label[for="mf_wfm_mainFrame_rad_mvprpBidLst_input_2"]',
  pageSize: "#mf_wfm_mainFrame_sbx_pageSize",
  saleDateFrom: "#mf_wfm_mainFrame_cal_rletPerdStr_input",
  saleDateTo: "#mf_wfm_mainFrame_cal_rletPerdEnd_input",
  submit: "#mf_wfm_mainFrame_btn_gdsDtlSrch",
});

function ymdToInputValue(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/u);
  if (!match) throw new TypeError("Court UI date must use YYYYMMDD");
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function responseStatus(response) {
  const value =
    typeof response?.status === "function" ? response.status() : response?.status;
  return Number(value);
}

function responseUrl(response) {
  return String(
    typeof response?.url === "function" ? response.url() : response?.url || "",
  );
}

function upstreamPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return PROPERTY_SEARCH_PATH;
  }
}

function payloadMessage(payload, text = "") {
  const plainText = !/<[a-z][\s\S]*>/iu.test(text)
    ? String(text || "").replace(/\s+/gu, " ").trim().slice(0, 1000)
    : "";
  return (
    payload?.errors?.errorMessage ||
    payload?.message ||
    payload?.errorMessage ||
    (typeof payload?.error === "string" ? payload.error : null) ||
    plainText ||
    null
  );
}

function blockedResponse(payload, text = "") {
  return Boolean(
    payload?.data?.ipcheck === false ||
      payload?.ipcheck === false ||
      String(payload?.code || "").toUpperCase() === "BLOCKED" ||
      /\bBLOCKED\b|ipcheck\s*[:=]\s*false/iu.test(text),
  );
}

function responseError(response, payload, text = "") {
  const statusCode = responseStatus(response);
  const blocked = blockedResponse(payload, text);
  const error = new Error(
    blocked
      ? "Court Auction site returned ipcheck=false"
      : `Court Auction UI search returned HTTP ${statusCode}`,
  );
  error.code = blocked ? "BLOCKED" : "UPSTREAM_ERROR";
  error.statusCode = Number.isInteger(statusCode) ? statusCode : null;
  error.upstreamUrl = upstreamPath(responseUrl(response));
  error.upstreamMessage = payloadMessage(payload, text);
  if (blocked) error.upstreamPayload = payload;
  return error;
}

function requestBody(response) {
  const request =
    typeof response?.request === "function" ? response.request() : response?.request;
  if (!request) return null;
  try {
    if (typeof request.postDataJSON === "function") return request.postDataJSON();
    const text =
      typeof request.postData === "function" ? request.postData() : request.postData;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function validateSubmittedContract(actualBody, options) {
  if (!actualBody) {
    const error = new Error("Court UI search request body could not be inspected");
    error.code = "UI_CONTRACT_MISMATCH";
    throw error;
  }

  const actualFilters = actualBody.dma_srchGdsDtlSrchInfo || {};
  const mismatches = [];
  if (String(actualFilters.cortOfcCd || "") !== String(options.courtCode || "")) {
    mismatches.push("cortOfcCd");
  }
  if (!String(actualFilters.lclDspslGdsLstUsgCd || "")) {
    mismatches.push("lclDspslGdsLstUsgCd");
  }
  if (String(actualFilters.bidDvsCd || "") !== "") {
    mismatches.push("bidDvsCd");
  }
  if (
    String(actualFilters.bidBgngYmd || "") !== String(options.saleDate?.from || "")
  ) {
    mismatches.push("bidBgngYmd");
  }
  if (
    String(actualFilters.bidEndYmd || "") !== String(options.saleDate?.to || "")
  ) {
    mismatches.push("bidEndYmd");
  }
  if (String(actualBody?.dma_pageInfo?.pageNo ?? "") !== "1") {
    mismatches.push("dma_pageInfo.pageNo");
  }
  if (
    options.pageSize !== undefined &&
    String(actualBody?.dma_pageInfo?.pageSize ?? "") !==
      String(options.pageSize)
  ) {
    mismatches.push("dma_pageInfo.pageSize");
  }
  if (mismatches.length > 0) {
    const error = new Error(
      `Court UI submitted unexpected search fields: ${mismatches.join(", ")}`,
    );
    error.code = "UI_CONTRACT_MISMATCH";
    throw error;
  }
}

function validatePaginationContract(actualBody, expectedBody, targetPage) {
  if (!actualBody || !expectedBody) {
    const error = new Error(
      "Court UI pagination request body could not be inspected",
    );
    error.code = "UI_CONTRACT_MISMATCH";
    throw error;
  }

  const actualFilters = actualBody.dma_srchGdsDtlSrchInfo || {};
  const expectedFilters = expectedBody.dma_srchGdsDtlSrchInfo || {};
  const mismatches = SEARCH_FILTER_FIELDS.filter(
    (field) =>
      String(actualFilters[field] ?? "") !==
      String(expectedFilters[field] ?? ""),
  );
  if (
    String(actualBody?.dma_pageInfo?.pageNo ?? "") !== String(targetPage)
  ) {
    mismatches.push("dma_pageInfo.pageNo");
  }
  if (
    String(actualBody?.dma_pageInfo?.pageSize ?? "") !==
    String(expectedBody?.dma_pageInfo?.pageSize ?? "")
  ) {
    mismatches.push("dma_pageInfo.pageSize");
  }
  if (mismatches.length > 0) {
    const error = new Error(
      `Court UI pagination changed search fields: ${mismatches.join(", ")}`,
    );
    error.code = "UI_CONTRACT_MISMATCH";
    throw error;
  }
}

async function readResponsePayload(response) {
  const text = await response.text();
  try {
    return { payload: JSON.parse(text), text, parseError: null };
  } catch (parseError) {
    return { payload: null, text, parseError };
  }
}

async function resolveCourtLabel(page, courtName, timeoutMs) {
  await page.waitForFunction(
    ({ selector, fragment }) => {
      const select = document.querySelector(selector);
      return Array.from(select?.options || []).some((option) =>
        String(option.textContent || "").trim().includes(fragment),
      );
    },
    { selector: SELECTORS.court, fragment: courtName },
    { timeout: timeoutMs },
  );
  const labels = await page
    .locator(`${SELECTORS.court} option`)
    .allTextContents();
  const normalized = labels.map((label) => String(label || "").trim());
  const exact = normalized.find((label) => label === courtName);
  const partial = normalized.filter((label) => label.includes(courtName));
  const selected = exact || (partial.length === 1 ? partial[0] : "");
  if (!selected) {
    const error = new Error(`Court UI option was not unique for: ${courtName}`);
    error.code = "UI_CONTRACT_MISMATCH";
    throw error;
  }
  return selected;
}

async function setDateInput(locator, value, timeoutMs) {
  const current = await locator.inputValue({ timeout: timeoutMs });
  if (current === value) return;
  await locator.fill(value, { timeout: timeoutMs });
  await locator.press("Tab", { timeout: timeoutMs });
}

async function triggerSearchResponse(page, trigger, timeoutMs) {
  const responsePromise = page.waitForResponse(
    (response) => {
      const request = response.request();
      return (
        upstreamPath(response.url()) === PROPERTY_SEARCH_PATH &&
        request.method() === "POST"
      );
    },
    { timeout: timeoutMs },
  );
  const [, response] = await Promise.all([trigger(), responsePromise]);
  const { payload, text, parseError } = await readResponsePayload(response);
  const actualBody = requestBody(response);

  const status = responseStatus(response);
  if (
    !Number.isInteger(status) ||
    status >= 400 ||
    blockedResponse(payload, text) ||
    payload?.errors?.errorMessage
  ) {
    throw responseError(response, payload, text);
  }
  if (parseError) {
    const error = new Error("Court Auction UI search returned invalid JSON");
    error.code = "NETWORK_ERROR";
    error.upstreamUrl = upstreamPath(responseUrl(response));
    error.parseCause = parseError;
    throw error;
  }
  return { payload, requestBody: actualBody };
}

async function submitPropertySearchUi(page, options) {
  if (!page || typeof page.locator !== "function") {
    throw new TypeError("A Playwright page is required for Court UI search");
  }
  const timeoutMs = Number.isFinite(options?.timeoutMs)
    ? options.timeoutMs
    : 30000;
  const courtName = String(options?.courtName || "").trim();
  const usageLarge = String(options?.usageLarge || "").trim();
  if (!courtName || !usageLarge) {
    throw new TypeError("Court UI search requires courtName and usageLarge");
  }

  const court = page.locator(SELECTORS.court);
  const usage = page.locator(SELECTORS.usageLarge);
  const bidAll = page.locator(SELECTORS.bidAll);
  const bidAllLabel = page.locator(SELECTORS.bidAllLabel);
  const from = page.locator(SELECTORS.saleDateFrom);
  const to = page.locator(SELECTORS.saleDateTo);
  const submit = page.locator(SELECTORS.submit);

  await court.waitFor({ state: "visible", timeout: timeoutMs });
  await usage.waitFor({ state: "visible", timeout: timeoutMs });
  const courtLabel = await resolveCourtLabel(page, courtName, timeoutMs);
  await court.selectOption({ label: courtLabel }, { timeout: timeoutMs });
  await usage.selectOption({ label: usageLarge }, { timeout: timeoutMs });
  if (!(await bidAll.isChecked({ timeout: timeoutMs }))) {
    await bidAllLabel.click({ timeout: timeoutMs });
    if (!(await bidAll.isChecked({ timeout: timeoutMs }))) {
      const error = new Error(
        "Court UI did not select all bid types after clicking its label",
      );
      error.code = "UI_CONTRACT_MISMATCH";
      throw error;
    }
  }
  await setDateInput(
    from,
    ymdToInputValue(options.saleDate?.from),
    timeoutMs,
  );
  await setDateInput(to, ymdToInputValue(options.saleDate?.to), timeoutMs);

  const result = await triggerSearchResponse(
    page,
    () => submit.click({ timeout: timeoutMs }),
    timeoutMs,
  );
  validateSubmittedContract(result.requestBody, options);
  return result;
}

async function submitPropertySearchUiPageSize(page, options) {
  if (!page || typeof page.locator !== "function") {
    throw new TypeError("A Playwright page is required for Court UI search");
  }
  const timeoutMs = Number.isFinite(options?.timeoutMs)
    ? options.timeoutMs
    : 30000;
  const targetPageSize = Number(options?.pageSize);
  if (![10, 20, 30, 40].includes(targetPageSize)) {
    throw new TypeError("Court UI page size must be 10, 20, 30, or 40");
  }

  const pageSize = page.locator(SELECTORS.pageSize);
  await pageSize.waitFor({ state: "visible", timeout: timeoutMs });
  const result = await triggerSearchResponse(
    page,
    () =>
      pageSize.selectOption(
        { label: String(targetPageSize) },
        { timeout: timeoutMs },
      ),
    timeoutMs,
  );
  validateSubmittedContract(result.requestBody, {
    ...options,
    pageSize: targetPageSize,
  });
  return result;
}

async function submitPropertySearchUiPage(
  page,
  pageNo,
  timeoutMs = 30000,
  expectedRequestBody,
) {
  const targetPage = Number(pageNo);
  if (!Number.isInteger(targetPage) || targetPage < 2 || targetPage > 10) {
    throw new TypeError("Court UI page must be an integer from 2 to 10");
  }
  const pageLink = page.locator(
    `#mf_wfm_mainFrame_pgl_gdsDtlSrchPage_page_${targetPage}`,
  );
  await pageLink.waitFor({ state: "visible", timeout: timeoutMs });
  const result = await triggerSearchResponse(
    page,
    () => pageLink.click({ timeout: timeoutMs }),
    timeoutMs,
  );
  validatePaginationContract(
    result.requestBody,
    expectedRequestBody,
    targetPage,
  );
  return result;
}

module.exports = {
  PROPERTY_SEARCH_PATH,
  PROPERTY_SEARCH_PAGE_SIZE,
  submitPropertySearchUi,
  submitPropertySearchUiPage,
  submitPropertySearchUiPageSize,
};
