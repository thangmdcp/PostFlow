import * as XLSX from "xlsx";

const templateUrl = new URL("./export_20260612_1020.xlsx", import.meta.url).href;
const statusTemplateUrl = new URL("./export_20260612_1448.xlsx", import.meta.url).href;
const deployedResolveUrl = new URL(".." + "/api/resolve-url.php", import.meta.url).href;
const resolveUrlEndpoints = [
  deployedResolveUrl,
  new URL("/api/resolve-url", window.location.origin).href,
];
const TOKEN_STORAGE_KEY = "metaAdsUserAccessToken";
const SETTINGS_STORAGE_KEY = "metaAdsBuilderSettings";
const TABLE_STORAGE_KEY = "adsFlowTableColumnsV3";
const SIDEBAR_STORAGE_KEY = "adsFlowSidebarCollapsed";
const SIDEBAR_BUTTON_POSITION_KEY = "adsFlowSidebarButtonPosition";
const SCHEDULE_STORAGE_KEY = "adsFlowScheduleReservationsV1";
const AFFILIATE_CACHE_KEY = "adsFlowAffiliateNameCacheV1";
const AFFILIATE_CACHE_LIMIT = 600;
const affiliateResolvePromises = new Map();
const columnDefinitions = [
  { id: "select", label: "", width: 42, minWidth: 42, visible: true },
  { id: "name", label: "Tên chiến dịch", width: 125, minWidth: 78, visible: true },
  { id: "body", label: "Nội dung", width: 190, minWidth: 96, visible: true },
  { id: "budget", label: "Ngân sách", width: 95, minWidth: 72, visible: true },
  { id: "age", label: "Độ tuổi", width: 110, minWidth: 76, visible: true },
  { id: "gender", label: "Giới tính", width: 90, minWidth: 76, visible: true },
  { id: "start", label: "Bắt đầu", width: 145, minWidth: 116, visible: true },
  { id: "link", label: "Link", width: 48, minWidth: 42, visible: true },
  { id: "page", label: "Page", width: 130, minWidth: 88, visible: true },
  { id: "comment", label: "Bình luận", width: 145, minWidth: 102, visible: true },
  { id: "status", label: "Trạng thái", width: 110, minWidth: 82, visible: true },
  { id: "actions", label: "Thao tác", width: 120, minWidth: 104, visible: true },
];
const state = {
  workbook: null,
  sheetName: "",
  headers: [],
  templateRows: [],
  templates: {},
  ads: [],
  pages: [],
  pagePosts: new Map(),
  selectedBulkPageIds: [],
  pageLinkDrafts: new Map([["", ""]]),
  autoProcessTimer: null,
  syncVersion: 0,
  processing: false,
  columns: columnDefinitions.map((column) => ({ ...column })),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const persistedSettingIds = [
  "commonName",
  "currency",
  "budgetStep",
  "budgetMin",
  "budgetMax",
  "postFormat",
  "status",
  "ageMinFrom",
  "ageMinTo",
  "ageMaxFrom",
  "ageMaxTo",
  "gender",
  "countries",
  "objective",
  "optimizationGoal",
  "locales",
  "scheduleMode",
  "postsPerDay",
  "scheduleBaseTime",
  "scheduleStepMinutes",
  "commentMode",
  "commentText",
  "metaAppId",
];

function restoreLocalSettings() {
  try {
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    if (savedToken) $("#userAccessToken").value = savedToken;

    const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    persistedSettingIds.forEach((id) => {
      if (settings[id] !== undefined && $(`#${id}`)) $(`#${id}`).value = settings[id];
    });
    $("#commentAll").checked = Boolean(settings.commentAll);
    document.body.classList.toggle(
      "sidebar-open",
      localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false",
    );
    const savedColumns = JSON.parse(localStorage.getItem(TABLE_STORAGE_KEY) || "[]");
    state.columns = columnDefinitions.map((column) => {
      const saved = savedColumns.find((item) => item.id === column.id) || {};
      return {
        ...column,
        width: Math.max(Number(saved.width) || column.width, column.minWidth),
        visible:
          typeof saved.visible === "boolean" ? saved.visible : column.visible,
      };
    });
  } catch {
    // Local storage may be disabled by the browser.
  }
}

function persistLocalSettings() {
  try {
    const settings = Object.fromEntries(
      persistedSettingIds.map((id) => [id, $(`#${id}`).value]),
    );
    settings.commentAll = $("#commentAll").checked;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(state.columns));

    if ($("#rememberToken").checked && value("userAccessToken")) {
      localStorage.setItem(TOKEN_STORAGE_KEY, value("userAccessToken"));
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Keep the app usable when local storage is unavailable.
  }
}

function showToast(message, type = "success", duration = 7000) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = "toast";
  }, duration);
}

function setButtonLabel(button, label) {
  const span = $("span", button);
  if (span) span.textContent = label;
}

function extractPostId(url) {
  if (!url) return "";
  const patterns = [
    /facebook\.com\/reel\/(\d+)/i,
    /facebook\.com\/[^/]+\/(?:posts|videos)\/(\d+)/i,
    /facebook\.com\/watch\/?\?v=(\d+)/i,
    /[?&](?:story_fbid|fbid|v)=(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function metaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.month}/${value.day}/${value.year} ${value.hour}:${value.minute}:${value.second} ${value.dayPeriod.toLowerCase()}`;
}

function exportTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}_${values.hour}${values.minute}`;
}

function makeAd(seed = {}) {
  return {
    id: crypto.randomUUID(),
    permalink: seed.permalink || "",
    sourcePermalink: seed.sourcePermalink || seed.permalink || "",
    body: seed.body || "",
    videoId: seed.videoId || "",
    storyId: seed.storyId || "",
    processedKey: seed.processedKey || "",
    commentEnabled: seed.commentEnabled ?? $("#commentAll")?.checked ?? false,
    commentMode: seed.commentMode || valueOrEmpty("commentMode") || "BODY",
    commentText: seed.commentText || valueOrEmpty("commentText"),
    commentPostedKey: seed.commentPostedKey || "",
    commentCheckedKey: seed.commentCheckedKey || "",
    commentStatus: seed.commentStatus || "idle",
    commentError: seed.commentError || "",
    name: seed.name || "",
    pageId: seed.pageId || "",
    pageName: seed.pageName || "",
    pageToken: seed.pageToken || "",
    instagramId: seed.instagramId || "",
    gender: seed.gender ?? valueOrEmpty("gender"),
    selected: seed.selected ?? false,
    scheduleReservationKey: seed.scheduleReservationKey || "",
    detectedFormat: seed.detectedFormat || "",
    budget: seed.budget || null,
    ageMin: seed.ageMin || null,
    ageMax: seed.ageMax || null,
    status: seed.status || "pending",
    error: seed.error || "",
    startTime: seed.startTime || localDateTimeValue(),
  };
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function updateCounts() {
  $("#adCountHero").textContent = String(state.ads.length);
}

function currencyLabel() {
  return value("currency") === "USD" ? "$" : "₫";
}

function valueOrEmpty(id) {
  return $(`#${id}`)?.value.trim() || "";
}

function selectedGender(ad) {
  return ad.gender ?? value("gender");
}

function applyTablePixelWidth() {
  const tableWidth = state.columns
    .filter((column) => column.visible)
    .reduce((total, column) => total + column.width, 0);
  const table = $("#adsTable");
  const availableWidth = Math.max(0, $(".ads-table-wrap")?.clientWidth - 2 || 0);
  const renderedWidth = Math.max(tableWidth, availableWidth);
  table.style.width = `${renderedWidth}px`;
  table.style.minWidth = `${renderedWidth}px`;
  table.style.maxWidth = `${renderedWidth}px`;
}

function renderColumnControls() {
  applyTablePixelWidth();
  $("#adsColgroup").innerHTML = state.columns
    .map(
      (column) =>
        `<col data-column="${column.id}" style="width:${column.width}px"${column.visible ? "" : " class=\"column-hidden\""}>`,
    )
    .join("");
  $("#columnOptions").innerHTML = state.columns
    .map(
      (column) => `
        <label>
          <input type="checkbox" data-toggle-column="${column.id}" ${column.visible ? "checked" : ""}>
          <span>${column.label}</span>
        </label>`,
    )
    .join("");

  state.columns.forEach((column) => {
    $$(`[data-column="${column.id}"]`).forEach((element) => {
      element.classList.toggle("column-hidden", !column.visible);
    });
  });

  $$("[data-toggle-column]").forEach((input) => {
    input.addEventListener("change", () => {
      const column = state.columns.find((item) => item.id === input.dataset.toggleColumn);
      if (!column) return;
      column.visible = input.checked;
      renderAds();
      persistLocalSettings();
    });
  });
  setupColumnResizing();
}

function renderAds() {
  const body = $("#adsTableBody");
  body.replaceChildren();
  $("#tableEmpty").hidden = state.ads.length > 0;
  const selectAll = $("#selectAllAds");
  if (selectAll) {
    selectAll.checked = state.ads.length > 0 && state.ads.every((ad) => ad.selected);
    selectAll.indeterminate =
      state.ads.some((ad) => ad.selected) && !state.ads.every((ad) => ad.selected);
  }

  state.ads.forEach((ad, index) => {
    const row = document.createElement("tr");
    row.dataset.id = ad.id;
    row.innerHTML = `
      <td data-column="select"><input class="row-check ad-select-input" type="checkbox" ${ad.selected ? "checked" : ""} aria-label="Chọn quảng cáo ${index + 1}"></td>
      <td data-column="name"><input class="table-input name-input" value="${escapeHtml(ad.name || value("commonName"))}" aria-label="Tên chiến dịch ${index + 1}"></td>
      <td data-column="body"><textarea class="table-input body-input" rows="3" placeholder="Nội dung bài viết sẽ hiện tại đây" aria-label="Nội dung bài đăng ${index + 1}">${escapeHtml(ad.body)}</textarea></td>
      <td data-column="budget">
        <div class="money-cell"><span>${currencyLabel()}</span><input class="table-input budget-input" type="number" min="0.01" step="0.01" value="${ad.budget || ""}" aria-label="Ngân sách quảng cáo ${index + 1}"></div>
      </td>
      <td data-column="age">
        <div class="age-cell">
          <input class="table-input age-min-input" type="number" min="18" max="65" value="${ad.ageMin || ""}" aria-label="Tuổi tối thiểu quảng cáo ${index + 1}">
          <span>–</span>
          <input class="table-input age-max-input" type="number" min="18" max="65" value="${ad.ageMax || ""}" aria-label="Tuổi tối đa quảng cáo ${index + 1}">
        </div>
      </td>
      <td data-column="gender">
        <select class="table-input gender-input" aria-label="Giới tính quảng cáo ${index + 1}">
          <option value="" ${selectedGender(ad) === "" ? "selected" : ""}>Tất cả</option>
          <option value="Men" ${selectedGender(ad) === "Men" ? "selected" : ""}>Nam</option>
          <option value="Women" ${selectedGender(ad) === "Women" ? "selected" : ""}>Nữ</option>
        </select>
      </td>
      <td data-column="start"><input class="table-input start-input" type="datetime-local" value="${ad.startTime}" aria-label="Thời gian bắt đầu quảng cáo ${index + 1}"></td>
      <td data-column="link" class="link-cell">
        <a class="link-icon" href="${escapeHtml(ad.permalink)}" target="_blank" rel="noreferrer" title="Mở bài đăng Facebook" aria-label="Mở link bài đăng ${index + 1}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a4 4 0 0 0 5.66 0l2.14-2.14a4 4 0 0 0-5.66-5.66l-1.23 1.23"/><path d="M13.4 10.6a4 4 0 0 0-5.66 0L5.6 12.74a4 4 0 1 0 5.66 5.66l1.23-1.23"/></svg>
        </a>
      </td>
      <td data-column="page">
        <div class="page-combobox row-page-combobox">
          <input class="table-input page-input" type="search" autocomplete="off" value="${escapeHtml(pageDisplayName(ad))}" placeholder="Tìm Page..." title="${escapeHtml(ad.pageId ? `Page ID: ${ad.pageId}` : "Chưa chọn Page")}" aria-label="Page quảng cáo ${index + 1}" aria-expanded="false">
          <div class="page-dropdown" role="listbox"></div>
        </div>
      </td>
      <td data-column="comment">
        <div class="comment-cell">
          <div class="comment-control-row">
            <select class="table-input comment-mode-input" aria-label="Kiểu bình luận bài đăng ${index + 1}">
              <option value="BODY" ${ad.commentMode === "BODY" ? "selected" : ""}>Nội dung bài viết</option>
              <option value="DEFAULT" ${ad.commentMode === "DEFAULT" ? "selected" : ""}>Chỉ mặc định</option>
              <option value="DEFAULT_BODY" ${ad.commentMode === "DEFAULT_BODY" ? "selected" : ""}>Mặc định + bài viết</option>
            </select>
            <label class="comment-toggle" title="Đăng bình luận trong lượt xử lý tiếp theo">
              <input class="comment-enabled-input" type="checkbox" ${ad.commentEnabled ? "checked" : ""}>
              <span class="sr-only">Bình luận</span>
            </label>
          </div>
          ${commentStatusHtml(ad)}
        </div>
      </td>
      <td data-column="status"><span class="row-status status-${ad.status}">${statusLabel(ad)}</span></td>
      <td data-column="actions">
        <div class="row-actions">
          <button class="mini-button icon-action process-row" type="button" title="Xử lý bài" aria-label="Xử lý bài ${index + 1}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>
          </button>
          <button class="mini-button icon-action random-row" type="button" title="Random thông số" aria-label="Random thông số bài ${index + 1}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 17l5-5 3 3 9-9M16 21h5v-5M15 15l6 6M4 7l4 4"/></svg>
          </button>
          <button class="mini-button icon-action danger remove-row" type="button" title="Xóa dòng" aria-label="Xóa bài ${index + 1}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
          </button>
        </div>
      </td>
    `;

    $(".ad-select-input", row).addEventListener("change", (event) => {
      ad.selected = event.target.checked;
      renderAds();
    });
    $(".name-input", row).addEventListener("input", (event) => {
      ad.name = event.target.value.trim();
    });
    $(".body-input", row).addEventListener("input", (event) => {
      ad.body = event.target.value;
      if (ad.commentMode !== "DEFAULT") {
        ad.commentStatus = "idle";
        ad.commentPostedKey = "";
      }
    });
    $(".budget-input", row).addEventListener("input", (event) => {
      ad.budget = Number(event.target.value) || null;
    });
    $(".age-min-input", row).addEventListener("input", (event) => {
      ad.ageMin = Number(event.target.value) || null;
    });
    $(".age-max-input", row).addEventListener("input", (event) => {
      ad.ageMax = Number(event.target.value) || null;
    });
    $(".gender-input", row).addEventListener("change", (event) => {
      ad.gender = event.target.value;
    });
    $(".start-input", row).addEventListener("input", (event) => {
      ad.startTime = event.target.value;
    });
    $(".comment-enabled-input", row).addEventListener("change", async (event) => {
      ad.commentEnabled = event.target.checked;
      ad.commentError = "";
      ad.commentStatus = "idle";
      if (ad.commentEnabled && !ad.commentText) {
        ad.commentText = valueOrEmpty("commentText");
      }
      renderAds();
      if (ad.commentEnabled && ad.status === "ready") {
        const result = await postCommentForAd(ad);
        renderAds();
        showToast(
          result.ok
            ? result.exists
              ? "Bài viết đã có bình luận giống nội dung này nên app không đăng trùng."
              : "Đã bình luận nội dung vào bài viết."
            : result.error || "Không đăng được bình luận.",
          result.ok ? "success" : "error",
        );
      }
    });
    $(".comment-mode-input", row).addEventListener("change", (event) => {
      ad.commentMode = event.target.value;
      ad.commentStatus = "idle";
      ad.commentError = "";
      ad.commentPostedKey = "";
      ad.commentCheckedKey = "";
    });
    setupPageCombobox($(".row-page-combobox", row), {
      selectedPageId: ad.pageId,
      onSelect: async (page) => {
        assignPage(ad, page);
        renderAds();
        await processOneAd(ad);
      },
      onClear: () => {
        clearAssignedPage(ad);
      },
    });
    $(".process-row", row).addEventListener("click", async () => {
      await processOneAd(ad);
    });
    $(".random-row", row).addEventListener("click", () => {
      randomizeAd(ad);
      renderAds();
    });
    $(".remove-row", row).addEventListener("click", () => {
      state.ads = state.ads.filter((item) => item.id !== ad.id);
      syncLinkInputsFromAds();
      renderAds();
    });

    body.append(row);
  });
  renderColumnControls();
  setupCustomSelects(body);
  updateCounts();
}

function commentStatusHtml(ad) {
  if (ad.commentStatus === "posting") {
    return '<small class="comment-state posting">Đang đăng...</small>';
  }
  if (ad.commentStatus === "posted") {
    return '<small class="comment-state posted">Đã bình luận</small>';
  }
  if (ad.commentStatus === "exists") {
    return '<small class="comment-state posted">Đã có bình luận</small>';
  }
  if (ad.commentStatus === "error") {
    const label = /pages_manage_engagement|permission|Meta (?:10|200)/i.test(ad.commentError)
      ? "Thiếu quyền bình luận"
      : /đang trống/i.test(ad.commentError)
        ? "Thiếu nội dung"
        : "Lỗi bình luận";
    return `<small class="comment-state error" title="${escapeHtml(ad.commentError)}">${label}</small>`;
  }
  return "";
}

function pageDisplayName(ad) {
  return ad.pageName || "";
}

function matchingPages(query) {
  const normalized = String(query || "").trim().toLowerCase();
  const pages = normalized
    ? state.pages.filter(
        (page) =>
          page.name.toLowerCase().includes(normalized) ||
          String(page.id).includes(normalized),
      )
    : state.pages;
  return pages.slice(0, 12);
}

function setupPageCombobox(container, options = {}) {
  const input = $("input", container);
  const dropdown = $(".page-dropdown", container);
  let activeIndex = -1;
  let results = [];

  const close = () => {
    dropdown.classList.remove("visible");
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };

  const choose = (page) => {
    input.value = `${page.name} · ${page.id}`;
    input.dataset.pageId = page.id;
    close();
    options.onSelect?.(page);
  };

  const renderResults = () => {
    results = matchingPages(input.dataset.pageId ? "" : input.value);
    dropdown.innerHTML = results.length
      ? results
          .map(
            (page, index) => `
              <button class="page-option${index === activeIndex ? " active" : ""}" type="button" role="option" data-page-id="${page.id}">
                <span>${escapeHtml(page.name)}</span>
                <small>${page.id}</small>
              </button>`,
          )
          .join("")
      : '<div class="page-empty-option">Không tìm thấy Page</div>';
    if (container.classList.contains("row-page-combobox")) {
      const rect = input.getBoundingClientRect();
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.width = `${Math.max(rect.width, 260)}px`;
    }
    dropdown.classList.add("visible");
    input.setAttribute("aria-expanded", "true");
    $$(".page-option", dropdown).forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const page = state.pages.find((item) => item.id === button.dataset.pageId);
        if (page) choose(page);
      });
    });
  };

  input.dataset.pageId = options.selectedPageId || "";
  input.addEventListener("focus", () => {
    input.select();
    renderResults();
  });
  input.addEventListener("click", () => {
    input.select();
    renderResults();
  });
  input.addEventListener("input", () => {
    input.dataset.pageId = "";
    activeIndex = -1;
    options.onClear?.();
    renderResults();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, results.length - 1);
      renderResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderResults();
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Escape") {
      close();
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(close, 120);
  });
}

function saveVisibleLinkDrafts() {
  $$(".page-links-input").forEach((input) => {
    state.pageLinkDrafts.set(input.dataset.pageId || "", input.value);
  });
}

function selectedBulkPages() {
  return state.selectedBulkPageIds
    .map((pageId) => state.pages.find((page) => page.id === pageId))
    .filter(Boolean);
}

function renderMultiPageOptions(query = "") {
  const normalized = query.trim().toLowerCase();
  const pages = state.pages
    .filter(
      (page) =>
        !normalized ||
        page.name.toLowerCase().includes(normalized) ||
        String(page.id).includes(normalized),
    )
    .sort((left, right) => {
      const leftSelected = state.selectedBulkPageIds.includes(left.id);
      const rightSelected = state.selectedBulkPageIds.includes(right.id);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return left.name.localeCompare(right.name, "vi");
    });
  $("#bulkPageOptions").innerHTML = pages.length
    ? pages
        .map(
          (page) => `
            <label class="multi-page-option" title="Page ID: ${escapeHtml(page.id)}">
              <input type="checkbox" value="${escapeHtml(page.id)}" ${state.selectedBulkPageIds.includes(page.id) ? "checked" : ""}>
              <span>${escapeHtml(page.name)}</span>
              <small>${escapeHtml(page.id)}</small>
            </label>`,
        )
        .join("")
    : '<div class="page-empty-option">Không tìm thấy Page</div>';

  $$("#bulkPageOptions input").forEach((input) => {
    input.addEventListener("change", () => {
      saveVisibleLinkDrafts();
      const previousCount = state.selectedBulkPageIds.length;
      if (input.checked) {
        state.selectedBulkPageIds = [...state.selectedBulkPageIds, input.value];
        if (
          previousCount === 0 &&
          state.pageLinkDrafts.get("") &&
          !state.pageLinkDrafts.get(input.value)
        ) {
          state.pageLinkDrafts.set(input.value, state.pageLinkDrafts.get(""));
          state.pageLinkDrafts.set("", "");
        }
      } else {
        state.selectedBulkPageIds = state.selectedBulkPageIds.filter(
          (pageId) => pageId !== input.value,
        );
      }
      updateMultiPageLabel();
      renderLinkInputs();
      syncAdsFromLinkInputs();
    });
  });
}

function updateMultiPageLabel() {
  const pages = selectedBulkPages();
  $("#bulkPageLabel").textContent = pages.length
    ? pages.length === 1
      ? pages[0].name
      : `${pages.length} Page đã chọn`
    : "Chọn Page nhập link";
}

function renderLinkInputs() {
  saveVisibleLinkDrafts();
  const pages = selectedBulkPages();
  const entries = pages.length ? pages : [{ id: "", name: "Danh sách bài đăng" }];
  const area = $("#linkInputArea");
  area.classList.toggle("is-multiple", entries.length > 1);
  area.innerHTML = entries
    .map(
      (page) => `
        <section class="page-link-panel">
          <header>
            <div class="page-link-title">
              <strong>${escapeHtml(page.name)}</strong>
              ${page.id ? `<small title="Page ID: ${escapeHtml(page.id)}">${escapeHtml(page.id)}</small>` : "<small>Chưa gắn Page</small>"}
            </div>
            <button class="page-list-remove" type="button" data-page-id="${escapeHtml(page.id)}" aria-label="Xóa danh sách ${escapeHtml(page.name)}" title="Xóa list">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>
            </button>
          </header>
          <textarea class="page-links-input" data-page-id="${escapeHtml(page.id)}" rows="5" aria-label="Link bài đăng của ${escapeHtml(page.name)}" placeholder="Dán link Facebook, mỗi dòng một bài">${escapeHtml(state.pageLinkDrafts.get(page.id) || "")}</textarea>
        </section>`,
    )
    .join("");

  $$(".page-links-input", area).forEach((input) => {
    input.addEventListener("input", () => {
      state.pageLinkDrafts.set(input.dataset.pageId || "", input.value);
      syncAdsFromLinkInputs();
    });
  });
  $$(".page-list-remove", area).forEach((button) => {
    button.addEventListener("click", () => {
      const pageId = button.dataset.pageId || "";
      button.closest(".page-link-panel")?.remove();
      state.pageLinkDrafts.delete(pageId);
      if (pageId) {
        state.selectedBulkPageIds = state.selectedBulkPageIds.filter(
          (selectedId) => selectedId !== pageId,
        );
        state.ads = state.ads.filter((ad) => ad.pageId !== pageId);
      } else {
        state.ads = [];
        state.pageLinkDrafts.set("", "");
      }
      updateMultiPageLabel();
      renderMultiPageOptions($("#bulkPageSearch").value);
      renderLinkInputs();
      renderAds();
      showToast(pageId ? "Đã xóa list Page khỏi vùng nhập." : "Đã xóa danh sách bài đăng.");
    });
  });
}

function closeCustomSelects(except = null) {
  $$(".saas-select.open").forEach((dropdown) => {
    if (dropdown === except) return;
    dropdown.classList.remove("open");
    $(".saas-select-trigger", dropdown)?.setAttribute("aria-expanded", "false");
  });
}

function setupCustomSelects(root = document) {
  $$("select:not(.hidden-config)", root).forEach((select) => {
    if (select.dataset.customSelect === "true") return;
    select.dataset.customSelect = "true";
    if (select.parentElement?.tagName === "LABEL") {
      const label = select.parentElement;
      const field = document.createElement("div");
      field.className = label.className;
      [...label.attributes].forEach((attribute) => {
        if (attribute.name !== "class") field.setAttribute(attribute.name, attribute.value);
      });
      while (label.firstChild) field.append(label.firstChild);
      label.replaceWith(field);
    }
    const fieldName =
      select.getAttribute("aria-label") ||
      select.parentElement?.querySelector(":scope > span")?.textContent?.trim() ||
      "Chọn tùy chọn";
    const wrapper = document.createElement("div");
    wrapper.className = "saas-select";
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select);

    const trigger = document.createElement("button");
    trigger.className = "saas-select-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", fieldName);
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = `
      <span></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`;

    const menu = document.createElement("div");
    menu.className = "saas-select-menu";
    menu.setAttribute("role", "listbox");
    wrapper.append(trigger, menu);

    const refresh = () => {
      const selected = select.options[select.selectedIndex];
      $("span", trigger).textContent = selected?.textContent || "";
      menu.innerHTML = [...select.options]
        .map(
          (option) => `
            <button class="saas-select-option${option.selected ? " selected" : ""}" type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="${option.selected}">
              <span>${escapeHtml(option.textContent)}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
            </button>`,
        )
        .join("");
      $$(".saas-select-option", menu).forEach((optionButton) => {
        optionButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          select.value = optionButton.dataset.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          refresh();
          closeCustomSelects();
        });
      });
    };

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = !wrapper.classList.contains("open");
      closeCustomSelects(wrapper);
      wrapper.classList.toggle("open", willOpen);
      trigger.setAttribute("aria-expanded", String(willOpen));
    });
    select.addEventListener("change", refresh);
    refresh();
  });
}

function setupMultiPagePicker() {
  const picker = $("#multiPagePicker");
  const trigger = $("#bulkPageTrigger");
  const popup = $("#bulkPagePopup");
  const search = $("#bulkPageSearch");
  const setOpen = (open) => {
    popup.classList.toggle("visible", open);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      renderMultiPageOptions(search.value);
      window.setTimeout(() => search.focus(), 0);
    }
  };
  trigger.addEventListener("click", () => setOpen(!popup.classList.contains("visible")));
  search.addEventListener("input", () => renderMultiPageOptions(search.value));
  picker.closePopup = () => setOpen(false);
}

function statusLabel(ad) {
  if (ad.status === "loading") return "Đang xử lý";
  if (ad.status === "ready") return `Sẵn sàng · ${storyIdForExcel(ad.storyId)}`;
  if (ad.status === "error") return ad.error || "Có lỗi";
  return "Chưa xử lý";
}

function resetAdPostData(ad) {
  ad.storyId = "";
  ad.body = "";
  ad.videoId = extractPostId(ad.permalink);
  ad.detectedFormat = "";
  ad.processedKey = "";
  ad.commentPostedKey = "";
  ad.commentCheckedKey = "";
  ad.commentStatus = "idle";
  ad.commentError = "";
  ad.status = "pending";
  ad.error = "";
}

function idsFromUrl(url) {
  return [...String(url).matchAll(/\d{8,}/g)].map((match) => match[0]);
}

function urlsFromText(text) {
  return [...String(text).matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((match) =>
    match[0].replace(/[.,;!?]+$/, ""),
  );
}

function normalizedUtmContent(raw) {
  return decodeURIComponent(String(raw || "")).trim().replace(/[-_]+$/, "");
}

function affiliateNameFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const directName = normalizedUtmContent(url.searchParams.get("utm_content"));
    if (directName) return directName;

    for (const value of url.searchParams.values()) {
      if (/^https?:\/\//i.test(value)) {
        const nestedName = affiliateNameFromUrl(value);
        if (nestedName) return nestedName;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function nestedUrlsFromUrl(rawUrl) {
  const urls = [];
  try {
    const url = new URL(rawUrl);
    for (const value of url.searchParams.values()) {
      if (/^https?:\/\//i.test(value)) urls.push(value);
    }
  } catch {
    // Ignore malformed URLs in post content.
  }
  return urls;
}

function affiliateUrlCandidates(body) {
  const seen = new Set();
  const pending = urlsFromText(body);
  const candidates = [];

  while (pending.length) {
    const url = pending.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push(url);
    pending.push(...nestedUrlsFromUrl(url));
  }

  return candidates;
}

function loadAffiliateCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AFFILIATE_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAffiliateCache(cache) {
  try {
    const entries = Object.entries(cache)
      .sort((left, right) => Number(right[1].time) - Number(left[1].time))
      .slice(0, AFFILIATE_CACHE_LIMIT);
    localStorage.setItem(AFFILIATE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Cache is only a speed-up; resolving still works without it.
  }
}

function cachedAffiliateName(rawUrl) {
  const cache = loadAffiliateCache();
  const entry = cache[rawUrl];
  return entry?.name || "";
}

function rememberAffiliateName(rawUrl, name) {
  if (!name) return;
  const cache = loadAffiliateCache();
  cache[rawUrl] = { name, time: Date.now() };
  saveAffiliateCache(cache);
}

async function fetchRedirectUrl(rawUrl) {
  for (const route of resolveUrlEndpoints) {
    try {
      const endpoint = new URL(route);
      endpoint.searchParams.set("url", rawUrl);
      const response = await fetch(endpoint);
      const data = await response.json();
      if (response.ok && data.url) return data.url;
    } catch {
      // Try the next endpoint. Static deploys use the PHP endpoint.
    }
  }
  return "";
}

async function resolveRedirectUrl(rawUrl) {
  if (!affiliateResolvePromises.has(rawUrl)) {
    affiliateResolvePromises.set(
      rawUrl,
      fetchRedirectUrl(rawUrl).finally(() => affiliateResolvePromises.delete(rawUrl)),
    );
  }
  return affiliateResolvePromises.get(rawUrl);
}

async function resolveAffiliateName(body, attachments) {
  const attachmentText = attachmentUrls(attachments).join("\n");
  const urls = affiliateUrlCandidates(`${body || ""}\n${attachmentText}`);

  for (const rawUrl of urls) {
    const directName = affiliateNameFromUrl(rawUrl);
    if (directName) {
      rememberAffiliateName(rawUrl, directName);
      return directName;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }

    if (parsed.hostname !== "s.shopee.vn") continue;

    const cachedName = cachedAffiliateName(rawUrl);
    if (cachedName) return cachedName;

    const resolvedUrl = await resolveRedirectUrl(rawUrl);
    const resolvedName = affiliateNameFromUrl(resolvedUrl);
    if (resolvedName) {
      rememberAffiliateName(rawUrl, resolvedName);
      rememberAffiliateName(resolvedUrl, resolvedName);
      return resolvedName;
    }
  }

  return "";
}

function attachmentMediaIds(attachments) {
  const ids = [];

  for (const attachment of attachments?.data || []) {
    if (attachment.target?.id) ids.push(String(attachment.target.id));
    ids.push(...idsFromUrl(attachment.url || ""));
    ids.push(...attachmentMediaIds(attachment.subattachments));
  }

  return ids;
}

function attachmentUrls(attachments) {
  const urls = [];

  for (const attachment of attachments?.data || []) {
    if (attachment.url) urls.push(attachment.url);
    urls.push(...attachmentUrls(attachment.subattachments));
  }

  return urls;
}

function normalizedFacebookPath(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function pfbidFromUrl(url) {
  return normalizedFacebookPath(url)
    .split("/")
    .find((part) => part.startsWith("pfbid")) || "";
}

function explicitPostId(url) {
  const patterns = [
    /\/posts\/(\d+)/i,
    /[?&]story_fbid=(\d+)/i,
    /\/videos\/(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match) return match[1];
  }
  return "";
}

function postMatchesLink(post, permalink, mediaId) {
  const attachmentIds = new Set(attachmentMediaIds(post.attachments));
  if (mediaId && attachmentIds.has(mediaId)) return true;

  const requestedPath = normalizedFacebookPath(permalink);
  const returnedPath = normalizedFacebookPath(post.permalink_url);
  if (requestedPath && returnedPath && requestedPath === returnedPath) return true;

  const requestedPfbid = pfbidFromUrl(permalink);
  if (requestedPfbid && requestedPfbid === pfbidFromUrl(post.permalink_url)) return true;

  const requestedPostId = explicitPostId(permalink);
  if (!requestedPostId) return false;
  const returnedPostId = explicitPostId(post.permalink_url);
  const graphPostId = String(post.id || "").split("_").at(-1);
  return requestedPostId === returnedPostId || requestedPostId === graphPostId;
}

function isVideoPost(post, permalink) {
  if (/facebook\.com\/(?:reel|watch)|\/videos\//i.test(permalink)) return true;
  return (post?.attachments?.data || []).some(
    (attachment) =>
      String(attachment.media_type || "").toUpperCase() === "VIDEO" ||
      (attachment.subattachments?.data || []).some(
        (item) => String(item.media_type || "").toUpperCase() === "VIDEO",
      ),
  );
}

async function getPagePosts(page) {
  if (state.pagePosts.has(page.id)) return state.pagePosts.get(page.id);

  const request = (async () => {
    const posts = [];
    let nextUrl = new URL(
      `https://graph.facebook.com/v25.0/${page.id}/published_posts`,
    );
    nextUrl.searchParams.set(
      "fields",
      "id,message,permalink_url,attachments.limit(10){target{id},media_type,url}",
    );
    nextUrl.searchParams.set("limit", "25");
    nextUrl.searchParams.set("access_token", page.access_token);

    for (let cursor = 0; cursor < 2 && nextUrl; cursor += 1) {
      const response = await fetch(nextUrl);
      const data = await response.json();
      if (!response.ok || data.error) {
        const error = new Error(
          data.error?.message || `Không đọc được Page ${page.name}.`,
        );
        error.code = data.error?.code;
        error.isRateLimit = [4, 17, 32, 613].includes(Number(error.code)) ||
          /reduce the amount of data|rate limit|too many calls/i.test(error.message);
        throw error;
      }
      posts.push(...(data.data || []));
      nextUrl = data.paging?.next ? new URL(data.paging.next) : null;
    }
    return posts;
  })();

  state.pagePosts.set(page.id, request);
  request.catch(() => state.pagePosts.delete(page.id));
  return request;
}

async function loadManagedPages() {
  const token = value("userAccessToken");
  const button = $("#loadPages");
  const selector = $("#pageSelector");
  const status = $("#pageStatus");

  if (!token) {
    showToast("Hãy nhập Facebook User Access Token.", "error");
    return;
  }

  button.disabled = true;
  setButtonLabel(button, "Đang tải...");
  selector.disabled = true;
  status.textContent = "Đang lấy danh sách Page bạn quản lý...";

  try {
    const pages = [];
    let nextUrl = new URL("https://graph.facebook.com/v25.0/me/accounts");
    nextUrl.searchParams.set(
      "fields",
      "id,name,access_token,picture{url},instagram_business_account{id,username}",
    );
    nextUrl.searchParams.set("limit", "100");
    nextUrl.searchParams.set("access_token", token);

    while (nextUrl) {
      const response = await fetch(nextUrl);
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error?.message || "Không tải được danh sách Page.");
      }
      pages.push(...(data.data || []));
      nextUrl = data.paging?.next ? new URL(data.paging.next) : null;
    }

    state.pages = pages;
    state.pagePosts.clear();
    state.selectedBulkPageIds = state.selectedBulkPageIds.filter((pageId) =>
      pages.some((page) => page.id === pageId),
    );
    selector.innerHTML = pages.length
      ? [
          '<option value="">Chọn một Page...</option>',
          ...pages.map(
            (page, index) =>
              `<option value="${index}">${escapeHtml(page.name)} · ${page.id}</option>`,
          ),
        ].join("")
      : '<option value="">Không tìm thấy Page nào</option>';
    selector.disabled = !pages.length;
    status.textContent = pages.length
      ? ""
      : "";
    showToast(`Đã tải ${pages.length} Page. Có thể tìm Page theo tên trong từng dòng.`);
    updateMultiPageLabel();
    renderMultiPageOptions($("#bulkPageSearch").value);
    renderLinkInputs();
    persistLocalSettings();
    if (pages.length === 1) {
      if (state.pageLinkDrafts.get("") && !state.pageLinkDrafts.get(pages[0].id)) {
        state.pageLinkDrafts.set(pages[0].id, state.pageLinkDrafts.get(""));
        state.pageLinkDrafts.set("", "");
      }
      state.selectedBulkPageIds = [pages[0].id];
      updateMultiPageLabel();
      renderLinkInputs();
      state.ads.forEach((ad) => assignPage(ad, pages[0]));
      renderAds();
    }
  } catch (error) {
    state.pages = [];
    selector.innerHTML = '<option value="">Không tải được danh sách Page</option>';
    status.textContent = "";
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    setButtonLabel(button, "Tải Page");
  }
}

async function exchangeLongLivedToken() {
  const appId = value("metaAppId");
  const appSecret = value("metaAppSecret");
  const shortLivedToken = value("userAccessToken");
  const button = $("#exchangeLongLivedToken");

  if (!appId || !appSecret || !shortLivedToken) {
    showToast("Cần nhập App ID, App Secret và User Access Token.", "error");
    return;
  }

  button.disabled = true;
  setButtonLabel(button, "Đang đổi token...");
  try {
    const response = await fetch("/api/meta/long-lived-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, appSecret, shortLivedToken }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Không đổi được Long-lived Token.");
    }

    $("#userAccessToken").value = data.accessToken;
    $("#metaAppSecret").value = "";
    persistLocalSettings();
    const days = data.expiresIn
      ? Math.max(1, Math.round(Number(data.expiresIn) / 86400))
      : 60;
    showToast(`Đã đổi sang Long-lived Token, thời hạn khoảng ${days} ngày.`);
    await loadManagedPages();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    setButtonLabel(button, "Lấy Long-lived Token");
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectManagedPage() {
  const selectedIndex = $("#pageSelector").value;
  if (selectedIndex === "") return;
  const page = state.pages[Number(selectedIndex)];
  if (!page) return;

  $("#pageId").value = page.id;
  $("#pageAccessToken").value = page.access_token || "";
  $("#pageStatus").textContent = `Đang dùng Page: ${page.name} · ${page.id}`;
  showToast(`Đã chọn Page “${page.name}”.`);
}

function assignPage(ad, page) {
  if (ad.pageId && ad.pageId !== page.id) resetAdPostData(ad);
  ad.pageId = page.id;
  ad.pageName = page.name;
  ad.pageToken = page.access_token || "";
  ad.instagramId = page.instagram_business_account?.id || "";
  ad.status = ad.storyId ? "ready" : "pending";
  ad.error = "";
}

function adProcessingKey(ad) {
  return `${ad.pageId}|${ad.sourcePermalink || ad.permalink}`;
}

function commentMessage(ad) {
  const body = String(ad.body || "").trim();
  const defaultText = String(ad.commentText || "").trim();
  if (ad.commentMode === "DEFAULT") return defaultText;
  if (ad.commentMode === "DEFAULT_BODY") {
    return [defaultText, body].filter(Boolean).join("\n\n");
  }
  return body;
}

function adCommentKey(ad) {
  return `${ad.storyId}|${commentMessage(ad)}`;
}

function normalizedCommentText(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

async function hasExistingComment(ad, message) {
  const key = adCommentKey(ad);
  if (ad.commentCheckedKey === key && ad.commentStatus === "exists") return true;

  let nextUrl = new URL(
    `https://graph.facebook.com/v25.0/${encodeURIComponent(ad.storyId)}/comments`,
  );
  nextUrl.searchParams.set("fields", "message");
  nextUrl.searchParams.set("limit", "100");
  nextUrl.searchParams.set("order", "reverse_chronological");
  nextUrl.searchParams.set("access_token", ad.pageToken);
  const expected = normalizedCommentText(message);

  for (let page = 0; page < 3 && nextUrl; page += 1) {
    const response = await fetch(nextUrl);
    const data = await response.json();
    if (!response.ok || data.error) {
      const error = new Error(data.error?.message || "Không kiểm tra được bình luận cũ.");
      error.code = data.error?.code;
      error.subcode = data.error?.error_subcode;
      throw error;
    }
    if ((data.data || []).some((comment) => normalizedCommentText(comment.message) === expected)) {
      ad.commentCheckedKey = key;
      return true;
    }
    nextUrl = data.paging?.next ? new URL(data.paging.next) : null;
  }
  ad.commentCheckedKey = key;
  return false;
}

function commentNeedsPosting(ad) {
  return (
    ad.commentEnabled &&
    ad.commentPostedKey !== adCommentKey(ad)
  );
}

async function postCommentForAd(ad) {
  const message = commentMessage(ad);
  if (!ad.commentEnabled) return { ok: true, skipped: true };
  if (!message) {
    ad.commentStatus = "error";
    ad.commentError =
      ad.commentMode === "BODY"
        ? "Nội dung bài viết đang trống. Hãy xử lý bài hoặc nhập Body trước."
        : "Nội dung bình luận đang trống.";
    return { ok: false, error: ad.commentError };
  }
  if (!ad.storyId || !ad.pageToken) {
    ad.commentStatus = "error";
    ad.commentError = "Thiếu Story ID hoặc Page Access Token.";
    return { ok: false, error: ad.commentError };
  }
  const key = adCommentKey(ad);
  if (ad.commentPostedKey === key) return { ok: true, skipped: true };

  ad.commentStatus = "posting";
  ad.commentError = "";
  renderAds();

  try {
    if (await hasExistingComment(ad, message)) {
      ad.commentPostedKey = key;
      ad.commentStatus = "exists";
      ad.commentError = "";
      return { ok: true, skipped: true, exists: true };
    }
    const endpoint = new URL(
      `https://graph.facebook.com/v25.0/${encodeURIComponent(ad.storyId)}/comments`,
    );
    const payload = new URLSearchParams({
      message,
      access_token: ad.pageToken,
    });
    const response = await fetch(endpoint, { method: "POST", body: payload });
    const data = await response.json();
    if (!response.ok || data.error) {
      const error = new Error(data.error?.message || "Không đăng được bình luận.");
      error.code = data.error?.code;
      error.subcode = data.error?.error_subcode;
      throw error;
    }
    ad.commentPostedKey = key;
    ad.commentCheckedKey = key;
    ad.commentStatus = "posted";
    return { ok: true, id: data.id || "" };
  } catch (error) {
    ad.commentStatus = "error";
    const code = [error.code, error.subcode].filter(Boolean).join("/");
    const permissionHint =
      Number(error.code) === 10 ||
      Number(error.code) === 200 ||
      /permission|pages_manage_engagement/i.test(error.message)
        ? " Token cần quyền pages_manage_engagement và phải là Page Access Token."
        : "";
    ad.commentError = `${error.message}${code ? ` (Meta ${code})` : ""}.${permissionHint}`
      .replace("..", ".")
      .trim();
    return { ok: false, error: ad.commentError };
  }
}

function clearAssignedPage(ad) {
  ad.pageId = "";
  ad.pageName = "";
  ad.pageToken = "";
  ad.instagramId = "";
  resetAdPostData(ad);
}

function assignPageByName(ad, inputValue) {
  const normalized = String(inputValue).trim().toLowerCase();
  const page = state.pages.find(
    (item) =>
      `${item.name} · ${item.id}`.toLowerCase() === normalized ||
      item.name.toLowerCase() === normalized ||
      item.id === normalized,
  );

  if (page) {
    assignPage(ad, page);
  } else {
    clearAssignedPage(ad);
    ad.pageName = inputValue.trim();
  }
}

async function enrichAd(ad) {
  const requestedPermalink = ad.sourcePermalink || ad.permalink;
  const postId = extractPostId(requestedPermalink);

  if (!requestedPermalink) {
    throw new Error("Link bài đăng đang trống.");
  }
  try {
    const url = new URL(requestedPermalink);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname.replace(/^www\./, ""))) {
      throw new Error();
    }
  } catch {
    throw new Error("Link bài đăng Facebook chưa đúng định dạng.");
  }

  ad.status = "loading";
  ad.error = "";

  try {
    const page = state.pages.find((item) => item.id === ad.pageId);
    if (!page) {
      throw new Error("Hãy chọn Page cho dòng này.");
    }

    const posts = await getPagePosts(page);
    const post = posts.find((item) =>
      postMatchesLink(item, requestedPermalink, postId),
    );
    if (!post) {
      state.pagePosts.delete(page.id);
      throw new Error("Link không thuộc Page đã chọn hoặc bài nằm ngoài danh sách gần đây.");
    }
    ad.storyId = post.id;
    ad.body = post.message || "";
    ad.permalink = post.permalink_url || requestedPermalink;
    ad.detectedFormat = isVideoPost(post, requestedPermalink) ? "VIDEO" : "STATUS";
    const matchedMediaId = attachmentMediaIds(post.attachments).find(
      (id) => id === postId,
    );
    ad.videoId = ad.detectedFormat === "VIDEO" ? matchedMediaId || postId : "";
    ad.pageId = page.id;
    ad.pageName = page.name;
    ad.pageToken = page.access_token || "";
    ad.instagramId = page.instagram_business_account?.id || "";
    const affiliateName = await resolveAffiliateName(ad.body, post.attachments);
    ad.name = affiliateName || value("commonName");
    ad.processedKey = adProcessingKey(ad);
    ad.status = "ready";
    return ad;
  } catch (error) {
    ad.status = "error";
    ad.error = error.message;
    throw error;
  }
}

function value(id) {
  return $(`#${id}`).value.trim();
}

function linksFromInputs() {
  saveVisibleLinkDrafts();
  const activePageIds = state.selectedBulkPageIds.length
    ? state.selectedBulkPageIds
    : [""];
  const seen = new Set();
  return activePageIds.flatMap((pageId) =>
    String(state.pageLinkDrafts.get(pageId) || "")
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean)
      .filter((permalink) => {
        const key = `${pageId}|${permalink}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((permalink) => ({ permalink, pageId })),
  );
}

function syncAdsFromLinkInputs() {
  const links = linksFromInputs();
  const existingByLink = new Map(
    state.ads.map((ad) => [
      `${ad.pageId}|${ad.sourcePermalink || ad.permalink}`,
      ad,
    ]),
  );
  state.ads = links.map(({ permalink, pageId }) => {
    const page = state.pages.find((item) => item.id === pageId);
    const existing =
      existingByLink.get(`${pageId}|${permalink}`) ||
      state.ads.find(
        (ad) =>
          !ad.pageId &&
          (ad.sourcePermalink === permalink || ad.permalink === permalink),
      );
    if (existing) {
      existing.sourcePermalink = permalink;
      if (page) assignPage(existing, page);
      return existing;
    }
    const ad = makeAd({ permalink, sourcePermalink: permalink });
    ad.sourcePermalink = permalink;
    randomizeAd(ad);
    if (page) assignPage(ad, page);
    else if (state.pages.length === 1) assignPage(ad, state.pages[0]);
    return ad;
  });
  applyScheduleToAds();
  renderAds();
  scheduleAutoProcess();
}

function syncLinkInputsFromAds() {
  const activePageIds = state.selectedBulkPageIds.length
    ? state.selectedBulkPageIds
    : [""];
  activePageIds.forEach((pageId) => {
    state.pageLinkDrafts.set(
      pageId,
      state.ads
        .filter((ad) => (pageId ? ad.pageId === pageId : true))
        .map((ad) => ad.sourcePermalink || ad.permalink)
        .join("\n"),
    );
  });
  renderLinkInputs();
}

function randomGender() {
  return ["", "Men", "Women"][randomInteger(0, 2)];
}

function randomizeAd(ad, options = {}) {
  ad.budget = randomStep(
    Number(value("budgetMin")),
    Number(value("budgetMax")),
    Number(value("budgetStep")) || 1,
  );
  ad.ageMin = randomInteger(
    Number(value("ageMinFrom")),
    Number(value("ageMinTo")),
  );
  ad.ageMax = randomInteger(
    Math.max(ad.ageMin, Number(value("ageMaxFrom"))),
    Number(value("ageMaxTo")),
  );
  if (options.gender) ad.gender = randomGender();
}

function tomorrowMidnight(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1 + offsetDays);
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function loadScheduleReservations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCHEDULE_STORAGE_KEY) || "{}");
    return {
      dates: parsed.dates && typeof parsed.dates === "object" ? parsed.dates : {},
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
    };
  } catch {
    return { dates: {}, items: {} };
  }
}

function saveScheduleReservations(reservations) {
  try {
    localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(reservations));
  } catch {
    // Scheduling still works for the current batch when storage is unavailable.
  }
}

function scheduleReservationSignature(ad) {
  return [
    ad.pageId,
    ad.sourcePermalink || ad.permalink,
    ad.storyId,
  ].filter(Boolean).join("|");
}

function reservedScheduleCounts() {
  const reservations = loadScheduleReservations();
  const counts = { ...reservations.dates };
  state.ads.forEach((ad, index) => {
    const signature = scheduleReservationSignature(ad);
    const reservedDate = signature ? reservations.items[signature] : "";
    if (reservedDate && counts[reservedDate]) {
      counts[reservedDate] = Math.max(0, Number(counts[reservedDate]) - 1);
    }
  });
  return counts;
}

function nextAvailableDailyStart(usedCounts, perDay, currentBatchOffset) {
  let offset = currentBatchOffset;
  while (true) {
    const date = tomorrowMidnight(offset);
    const key = localDateKey(date);
    const used = Number(usedCounts[key]) || 0;
    if (used < perDay) {
      usedCounts[key] = used + 1;
      return date;
    }
    offset += 1;
  }
}

function reserveExportedSchedule() {
  if (value("scheduleMode") !== "DAILY") return;
  const reservations = loadScheduleReservations();

  state.ads.forEach((ad) => {
    const signature = scheduleReservationSignature(ad);
    if (!signature || reservations.items[signature] || !ad.startTime) return;

    const date = new Date(ad.startTime);
    if (Number.isNaN(date.getTime())) return;
    const key = localDateKey(date);
    reservations.items[signature] = key;
    reservations.dates[key] = (Number(reservations.dates[key]) || 0) + 1;
    ad.scheduleReservationKey = key;
  });

  saveScheduleReservations(reservations);
}

function applyScheduleToAds() {
  const mode = value("scheduleMode");
  const perDay = Math.max(1, Number(value("postsPerDay")) || 1);
  const intervalMinutes = Math.max(1, Number(value("scheduleStepMinutes")) || 1);
  const baseTime = value("scheduleBaseTime")
    ? new Date(value("scheduleBaseTime"))
    : new Date();
  const now = new Date();
  const usedDailyCounts = mode === "DAILY" ? reservedScheduleCounts() : {};
  let dailyOffset = 0;

  state.ads.forEach((ad) => {
    let start = now;
    if (mode === "TOMORROW") start = tomorrowMidnight();
    if (mode === "DAILY") start = nextAvailableDailyStart(usedDailyCounts, perDay, dailyOffset);
    if (mode === "INTERVAL") {
      start = new Date(baseTime.getTime() + index * intervalMinutes * 60000);
    }
    ad.startTime = localDateTimeValue(start);
    if (mode === "DAILY") {
      dailyOffset = Math.max(
        dailyOffset,
        Math.floor((start.getTime() - tomorrowMidnight().getTime()) / 86400000),
      );
    }
  });
}

function applyBulkGender(showEmptySelectionToast = true) {
  const selectedAds = state.ads.filter((ad) => ad.selected);
  if (!selectedAds.length) {
    if (showEmptySelectionToast) {
      showToast("Hãy tích chọn ít nhất một bài trong bảng.", "error");
    }
    return;
  }

  const gender = value("bulkGender");
  selectedAds.forEach((ad) => {
    ad.gender = gender;
  });
  renderAds();
  showToast(`Đã đổi giới tính cho ${selectedAds.length} bài.`);
}

async function processOneAd(ad) {
  try {
    ad.status = "loading";
    renderAds();
    await enrichAd(ad);
    const commentResult = await postCommentForAd(ad);
    if (!commentResult.ok) throw new Error(commentResult.error);
    showToast(
      commentResult.exists
        ? `Bài từ Page “${ad.pageName}” đã có bình luận giống nội dung này.`
        : commentResult.skipped
        ? `Đã xử lý bài từ Page “${ad.pageName}”.`
        : `Đã xử lý và bình luận bài từ Page “${ad.pageName}”.`,
    );
  } catch (error) {
    showToast(
      error.isRateLimit
        ? "Meta đang giới hạn truy vấn. App đã dừng gọi API; hãy chờ vài phút rồi thử lại."
        : error.message,
      "error",
    );
  } finally {
    renderAds();
  }
}

async function processAllAds() {
  if (state.processing) {
    scheduleAutoProcess();
    return;
  }
  if (!state.ads.length) {
    showToast("Hãy dán ít nhất một link Facebook.", "error");
    return;
  }
  if (!state.pages.length && value("userAccessToken")) {
    await loadManagedPages();
  }
  if (!state.pages.length) {
    showToast("Hãy nhập token và tải danh sách Page trước.", "error");
    return;
  }
  const candidates = state.ads.filter(
    (ad) =>
      ad.status !== "ready" ||
      ad.processedKey !== adProcessingKey(ad) ||
      commentNeedsPosting(ad),
  );
  if (!candidates.length) {
    showToast("Các bài hiện tại đã xử lý xong, không gọi lại Meta API.");
    return;
  }

  const button = $("#processAll");
  state.processing = true;
  button.disabled = true;
  let completed = 0;
  let rateLimited = false;
  let commentFailures = 0;

  try {
    for (const ad of candidates) {
      const needsEnrich = ad.processedKey !== adProcessingKey(ad);
      if (needsEnrich) ad.status = "loading";
      renderAds();
      try {
        if (needsEnrich) {
          await enrichAd(ad);
        }
        const commentResult = await postCommentForAd(ad);
        if (!commentResult.ok) commentFailures += 1;
      } catch (error) {
        if (error.isRateLimit) {
          rateLimited = true;
          break;
        }
      }
      completed += 1;
      setButtonLabel(button, `${completed}/${candidates.length}`);
      renderAds();
    }
  } finally {
    state.processing = false;
    button.disabled = false;
    setButtonLabel(button, "Xử lý tất cả");
  }

  if (rateLimited) {
    showToast(
      "Meta yêu cầu giảm dữ liệu. App đã dừng toàn bộ request để bảo vệ giới hạn API; hãy chờ vài phút rồi thử lại.",
      "error",
    );
    renderAds();
    return;
  }

  const ready = state.ads.filter((ad) => ad.status === "ready").length;
  const failed = state.ads.filter((ad) => ad.status === "error").length;
  showToast(
    failed || commentFailures
      ? `Đã sẵn sàng ${ready} bài; ${failed} lỗi bài viết, ${commentFailures} lỗi bình luận. Di chuột vào trạng thái bình luận để xem lỗi Meta.`
      : `Đã xử lý ${candidates.length} bài mới. Tổng ${ready} bài sẵn sàng.`,
    failed || commentFailures ? "error" : "success",
  );
}

function scheduleAutoProcess() {
  window.clearTimeout(state.autoProcessTimer);
  if (!state.ads.length || state.ads.some((ad) => !ad.pageId)) return;
  const version = ++state.syncVersion;
  state.autoProcessTimer = window.setTimeout(async () => {
    if (version !== state.syncVersion) return;
    if (state.processing) {
      scheduleAutoProcess();
      return;
    }
    await processAllAds();
  }, 650);
}

function setCell(row, field, cellValue) {
  const index = state.headers.indexOf(field);
  if (index !== -1) row[index] = cellValue;
}

function normalizePrefixedId(raw, prefix) {
  if (!raw) return "";
  return raw.startsWith(`${prefix}:`) ? raw : `${prefix}:${raw}`;
}

function storyIdForExcel(raw) {
  if (!raw) return "";
  const clean = String(raw).replace(/^s:/, "");
  const postId = clean.includes("_") ? clean.split("_").at(-1) : clean;
  return normalizePrefixedId(postId, "s");
}

function randomInteger(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function randomStep(min, max, step) {
  const safeStep = Math.max(Number(step) || 1, 0.01);
  const precision = Math.max(
    String(safeStep).split(".")[1]?.length || 0,
    String(min).split(".")[1]?.length || 0,
    String(max).split(".")[1]?.length || 0,
  );
  const factor = 10 ** precision;
  const scaledStep = Math.round(safeStep * factor);
  const low = Math.ceil((Math.min(min, max) * factor) / scaledStep);
  const high = Math.floor((Math.max(min, max) * factor) / scaledStep);
  return (randomInteger(low, high) * scaledStep) / factor;
}

function validate() {
  const commonName = value("commonName");
  const budgetMin = Number(value("budgetMin"));
  const budgetMax = Number(value("budgetMax"));
  const budgetStep = Number(value("budgetStep"));
  const ageMinFrom = Number(value("ageMinFrom"));
  const ageMinTo = Number(value("ageMinTo"));
  const ageMaxFrom = Number(value("ageMaxFrom"));
  const ageMaxTo = Number(value("ageMaxTo"));

  if (!commonName) throw new Error("Vui lòng nhập tên dùng chung.");
  if (budgetMin <= 0 || budgetMax < budgetMin || budgetStep <= 0) {
    throw new Error("Khoảng ngân sách chưa hợp lệ.");
  }
  if (
    ageMinFrom < 18 ||
    ageMinTo < ageMinFrom ||
    ageMaxFrom < ageMinTo ||
    ageMaxTo < ageMaxFrom ||
    ageMaxTo > 65
  ) {
    throw new Error("Khoảng random tuổi chưa hợp lệ.");
  }
  if (!state.ads.length) throw new Error("Cần ít nhất một quảng cáo.");

  state.ads.forEach((ad, index) => {
    if (!ad.permalink) throw new Error(`Quảng cáo ${index + 1} chưa có link bài đăng.`);
    if (!ad.storyId) {
      throw new Error(
        `Quảng cáo ${index + 1} chưa có Story ID. Hãy bấm “Lấy nội dung” để dùng đúng bài viết gốc.`,
      );
    }
    if (ad.status !== "ready" || !ad.pageId || !ad.budget || !ad.ageMin || !ad.ageMax) {
      throw new Error(
        `Quảng cáo ${index + 1} chưa xử lý xong. Hãy chạy “Phân tích danh sách” lại.`,
      );
    }
    const format = value("postFormat") === "AUTO" ? ad.detectedFormat : value("postFormat");
    const videoId = format === "VIDEO" ? ad.videoId || extractPostId(ad.permalink) : "";
    const storyId = String(ad.storyId).replace(/^s:/, "").split("_").at(-1);
    if (format === "VIDEO" && /facebook\.com\/reel\//i.test(ad.permalink) && storyId === videoId) {
      throw new Error(
        `Quảng cáo ${index + 1} đang dùng Video ID làm Story ID nên preview sẽ sai. Hãy chọn đúng Page và bấm “Lấy nội dung” lại.`,
      );
    }
    try {
      new URL(ad.permalink);
    } catch {
      throw new Error(`Link của quảng cáo ${index + 1} chưa đúng định dạng URL.`);
    }
  });
}

function buildRow(ad) {
  const selectedFormat =
    value("postFormat") === "AUTO"
      ? ad.detectedFormat || (/facebook\.com\/reel|\/videos\//i.test(ad.permalink) ? "VIDEO" : "STATUS")
      : value("postFormat");
  const row = [...(state.templates[selectedFormat] || state.templateRows[0])];
  while (row.length < state.headers.length) row.push("");

  const status = value("status");
  const startTime = metaDate(ad.startTime ? new Date(ad.startTime) : new Date());
  const videoId = selectedFormat === "VIDEO" ? ad.videoId || extractPostId(ad.permalink) : "";
  const commonName = ad.name || value("commonName");
  const pageId = ad.pageId || value("pageId").replace(/\D/g, "");

  setCell(row, "Ad Name", commonName);
  setCell(row, "Ad Status", status);
  setCell(row, "Ad Start Time", "");
  setCell(row, "Ad Stop Time", "");
  setCell(row, "Ad Set Name", commonName);
  setCell(row, "Ad Set Run Status", status);
  setCell(row, "Ad Set Time Start", startTime);
  setCell(row, "Campaign ID", "");
  setCell(row, "Campaign Name", commonName);
  setCell(row, "Campaign Status", status);
  setCell(row, "Campaign Start Time", startTime);
  setCell(row, "Campaign Daily Budget", ad.budget);
  setCell(row, "Campaign Objective", value("objective"));
  setCell(row, "Optimization Goal", value("optimizationGoal"));
  setCell(row, "Age Min", ad.ageMin);
  setCell(row, "Age Max", ad.ageMax);
  setCell(row, "Gender", selectedGender(ad));
  setCell(row, "Countries", value("countries"));
  setCell(row, "Locales", value("locales"));
  setCell(row, "Link Object ID", normalizePrefixedId(pageId, "o"));
  setCell(row, "Instagram Account ID", "");
  setCell(row, "Permalink", ad.permalink);
  setCell(row, "Body", ad.body);
  setCell(row, "Creative Type", selectedFormat === "VIDEO" ? "Video Page Post Ad" : "Status Page Post Ad");
  setCell(row, "Video ID", selectedFormat === "VIDEO" ? normalizePrefixedId(videoId, "v") : "");
  setCell(row, "Story ID", storyIdForExcel(ad.storyId));

  // Preview URLs belong to the exported source ads and must not be reused.
  setCell(row, "Preview Link", "");
  setCell(row, "Instagram Preview Link", "");
  setCell(row, "Mockup ID", "");

  return row;
}

function exportWorkbook() {
  try {
    validate();
    const rows = state.ads.map(buildRow);
    const worksheet = XLSX.utils.aoa_to_sheet([state.headers, ...rows]);
    worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(state.headers.length - 1)}${rows.length + 1}` };
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, state.sheetName || "Ads");

    XLSX.writeFile(workbook, `export_${exportTimestamp()}.xlsx`, {
      compression: true,
    });
    reserveExportedSchedule();
    showToast(`Đã xuất ${state.ads.length} quảng cáo.`);
  } catch (error) {
    showToast(error.message || "Không thể tạo file Excel.", "error");
  }
}

async function loadTemplate() {
  try {
    const [videoResponse, statusResponse] = await Promise.all([
      fetch(templateUrl),
      fetch(statusTemplateUrl),
    ]);
    if (!videoResponse.ok || !statusResponse.ok) {
      throw new Error("Không tải được file Excel mẫu.");
    }
    const [videoData, statusData] = await Promise.all([
      videoResponse.arrayBuffer(),
      statusResponse.arrayBuffer(),
    ]);
    state.workbook = XLSX.read(videoData, { type: "array", raw: true });
    const statusWorkbook = XLSX.read(statusData, { type: "array", raw: true });
    state.sheetName = state.workbook.SheetNames[0];
    const sheet = state.workbook.Sheets[state.sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
      blankrows: false,
    });
    const statusMatrix = XLSX.utils.sheet_to_json(
      statusWorkbook.Sheets[statusWorkbook.SheetNames[0]],
      { header: 1, defval: "", raw: true, blankrows: false },
    );

    state.headers = matrix[0];
    state.templateRows = matrix.slice(1).filter((row) => row.some((cell) => cell !== ""));
    if (JSON.stringify(state.headers) !== JSON.stringify(statusMatrix[0])) {
      throw new Error("Hai file mẫu không cùng cấu trúc cột.");
    }
    state.templates = {
      VIDEO: state.templateRows[0],
      STATUS: statusMatrix.slice(1).find((row) => row.some((cell) => cell !== "")),
    };
    if (!state.headers.length || !state.templateRows.length) {
      throw new Error("File mẫu không có đủ header hoặc dòng dữ liệu.");
    }

    const pageIdIndex = state.headers.indexOf("Link Object ID");
    const templatePageId = String(state.templateRows[0][pageIdIndex] || "").replace(/\D/g, "");
    if (templatePageId) $("#pageId").value = templatePageId;

    state.ads = [];
    renderAds();
    $("#exportButton").disabled = false;
    if (value("userAccessToken")) {
      await loadManagedPages();
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

$("#exportButton").addEventListener("click", exportWorkbook);
$("#loadPages").addEventListener("click", loadManagedPages);
$("#exchangeLongLivedToken").addEventListener("click", exchangeLongLivedToken);
$("#pageSelector").addEventListener("change", selectManagedPage);
$("#processAll").addEventListener("click", processAllAds);
function setClearAllModalOpen(open) {
  const modal = $("#clearAllModal");
  modal.hidden = !open;
  document.body.classList.toggle("modal-open", open);
  if (open) {
    window.setTimeout(() => $("#confirmClearAll").focus(), 0);
  }
}

$("#clearAll").addEventListener("click", () => {
  if (!state.ads.length && !linksFromInputs().length) {
    showToast("Danh sách hiện đang trống.");
    return;
  }
  setClearAllModalOpen(true);
});
$$("[data-close-clear-modal]").forEach((button) => {
  button.addEventListener("click", () => setClearAllModalOpen(false));
});
$("#confirmClearAll").addEventListener("click", () => {
  window.clearTimeout(state.autoProcessTimer);
  state.syncVersion += 1;
  state.ads = [];
  const activePageIds = state.selectedBulkPageIds.length
    ? state.selectedBulkPageIds
    : [""];
  activePageIds.forEach((pageId) => state.pageLinkDrafts.set(pageId, ""));
  renderLinkInputs();
  renderAds();
  setClearAllModalOpen(false);
  showToast("Đã xóa toàn bộ bài đăng hiện có.");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#clearAllModal").hidden) {
    setClearAllModalOpen(false);
  }
});
$("#randomAll").addEventListener("click", () => {
  state.ads.forEach((ad) => randomizeAd(ad, { gender: true }));
  renderAds();
  showToast(`Đã random lại ${state.ads.length} dòng.`);
});
$("#scheduleAll").addEventListener("click", () => {
  applyScheduleToAds();
  renderAds();
  showToast(`Đã xếp lịch cho ${state.ads.length} dòng.`);
});
$("#scheduleMode").addEventListener("change", () => {
  updateScheduleFields();
  applyScheduleToAds();
  renderAds();
});
$("#postsPerDay").addEventListener("change", () => {
  if (value("scheduleMode") === "DAILY") {
    applyScheduleToAds();
    renderAds();
  }
});
$("#scheduleBaseTime").addEventListener("change", () => {
  if (value("scheduleMode") === "INTERVAL") {
    applyScheduleToAds();
    renderAds();
  }
});
$("#scheduleStepMinutes").addEventListener("change", () => {
  if (value("scheduleMode") === "INTERVAL") {
    applyScheduleToAds();
    renderAds();
  }
});
$("#currency").addEventListener("change", () => {
  if (value("currency") === "USD" && Number(value("budgetStep")) === 1) {
    $("#budgetStep").value = "0.01";
  }
  if (value("currency") === "VND" && Number(value("budgetStep")) === 0.01) {
    $("#budgetStep").value = "1";
  }
  persistLocalSettings();
  renderAds();
});
$("#gender").addEventListener("change", () => {
  const gender = value("gender");
  state.ads.forEach((ad) => {
    ad.gender = gender;
  });
  persistLocalSettings();
  renderAds();
});
$("#selectAllAds").addEventListener("change", (event) => {
  state.ads.forEach((ad) => {
    ad.selected = event.target.checked;
  });
  renderAds();
});
$("#bulkGender").addEventListener("change", () => applyBulkGender(true));
$("#commentAll").addEventListener("change", (event) => {
  const enabled = event.target.checked;
  const defaultText = valueOrEmpty("commentText");
  state.ads.forEach((ad) => {
    ad.commentEnabled = enabled;
    ad.commentStatus = "idle";
    ad.commentError = "";
    ad.commentCheckedKey = "";
    if (enabled && !ad.commentText) ad.commentText = defaultText;
  });
  persistLocalSettings();
  renderAds();
});
$("#commentMode").addEventListener("change", () => {
  const mode = valueOrEmpty("commentMode") || "BODY";
  state.ads.forEach((ad) => {
    ad.commentMode = mode;
    ad.commentStatus = "idle";
    ad.commentError = "";
    ad.commentPostedKey = "";
    ad.commentCheckedKey = "";
  });
  persistLocalSettings();
  renderAds();
});
$("#commentText").addEventListener("input", () => {
  const defaultText = valueOrEmpty("commentText");
  state.ads.forEach((ad) => {
    ad.commentText = defaultText;
    if (ad.commentMode !== "BODY") ad.commentPostedKey = "";
    if (ad.commentMode !== "BODY") ad.commentCheckedKey = "";
    if (ad.commentMode !== "BODY") ad.commentStatus = "idle";
  });
  persistLocalSettings();
  renderAds();
});
function setSidebarOpen(open) {
  document.body.classList.toggle("sidebar-open", open);
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
}

$("#sidebarClose").addEventListener("click", () => setSidebarOpen(false));
$("#sidebarBackdrop").addEventListener("click", () => setSidebarOpen(false));

function setupDraggableSidebarButton() {
  const button = $("#sidebarOpen");
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const clampPosition = (left, top) => ({
    left: Math.min(Math.max(8, left), window.innerWidth - button.offsetWidth - 8),
    top: Math.min(Math.max(8, top), window.innerHeight - button.offsetHeight - 8),
  });
  const applyPosition = (position) => {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
    const next = clampPosition(position.left, position.top);
    button.style.left = `${next.left}px`;
    button.style.top = `${next.top}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
  };

  try {
    applyPosition(JSON.parse(localStorage.getItem(SIDEBAR_BUTTON_POSITION_KEY) || "null"));
  } catch {
    // Use the default bottom-left position.
  }

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    dragged = false;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    button.classList.add("dragging");
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (!button.hasPointerCapture(event.pointerId)) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.hypot(deltaX, deltaY) > 4) dragged = true;
    if (!dragged) return;
    applyPosition({ left: originLeft + deltaX, top: originTop + deltaY });
  });
  const finishDrag = (event) => {
    if (!button.hasPointerCapture(event.pointerId)) return;
    button.releasePointerCapture(event.pointerId);
    button.classList.remove("dragging");
    if (dragged) {
      const rect = button.getBoundingClientRect();
      localStorage.setItem(
        SIDEBAR_BUTTON_POSITION_KEY,
        JSON.stringify({ left: rect.left, top: rect.top }),
      );
    }
  };
  button.addEventListener("pointerup", finishDrag);
  button.addEventListener("pointercancel", finishDrag);
  button.addEventListener("click", (event) => {
    if (dragged) {
      event.preventDefault();
      dragged = false;
      return;
    }
    setSidebarOpen(true);
  });
  window.addEventListener("resize", () => {
    const rect = button.getBoundingClientRect();
    applyPosition({ left: rect.left, top: rect.top });
  });
}

function setupColumnResizing() {
  $$("th[data-column] .resize-handle").forEach((handle) => handle.remove());
  const visibleColumns = state.columns.filter((column) => column.visible);
  visibleColumns.slice(1).forEach((column) => {
    const header = $(`th[data-column="${column.id}"]`);
    const handle = document.createElement("span");
    handle.className = "resize-handle resize-boundary";
    header.prepend(handle);
  });

  $$(".resize-boundary").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const rightHeader = handle.closest("th");
      const rightIndex = visibleColumns.findIndex(
        (column) => column.id === rightHeader.dataset.column,
      );
      const leftColumn = visibleColumns[rightIndex - 1];
      const rightColumn = visibleColumns[rightIndex];
      if (!leftColumn || !rightColumn) return;

      state.columns
        .filter((column) => column.visible)
        .forEach((column) => {
          const header = $(`th[data-column="${column.id}"]`);
          column.width = Math.round(header.getBoundingClientRect().width);
        });
      const startX = event.clientX;
      const leftStartWidth = leftColumn.width;
      const rightStartWidth = rightColumn.width;
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const minimumDelta = (leftColumn.minWidth || 48) - leftStartWidth;
        const maximumDelta = rightStartWidth - (rightColumn.minWidth || 48);
        const boundedDelta = Math.min(
          maximumDelta,
          Math.max(minimumDelta, Math.round(delta)),
        );
        leftColumn.width = leftStartWidth + boundedDelta;
        rightColumn.width = rightStartWidth - boundedDelta;
        const leftCol = $(`#adsColgroup col[data-column="${leftColumn.id}"]`);
        const rightCol = $(`#adsColgroup col[data-column="${rightColumn.id}"]`);
        if (leftCol) leftCol.style.width = `${leftColumn.width}px`;
        if (rightCol) rightCol.style.width = `${rightColumn.width}px`;
        applyTablePixelWidth();
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        persistLocalSettings();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  });
}

function updateScheduleFields() {
  const mode = value("scheduleMode");
  $("#postsPerDayField").hidden = mode !== "DAILY";
  $("#scheduleIntervalFields").hidden = mode !== "INTERVAL";
  if (mode === "INTERVAL" && !value("scheduleBaseTime")) {
    $("#scheduleBaseTime").value = localDateTimeValue();
  }
}

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".saas-select")) closeCustomSelects();
  $$(".page-combobox").forEach((combobox) => {
    if (combobox.contains(event.target)) return;
    $(".page-dropdown", combobox)?.classList.remove("visible");
    $("input", combobox)?.setAttribute("aria-expanded", "false");
  });
  const multiPicker = $("#multiPagePicker");
  if (!multiPicker.contains(event.target)) multiPicker.closePopup?.();
  $$("details[open]").forEach((details) => {
    if (!details.contains(event.target)) details.removeAttribute("open");
  });
});
$("#userAccessToken").addEventListener("input", persistLocalSettings);
$("#rememberToken").addEventListener("change", persistLocalSettings);
persistedSettingIds.forEach((id) => {
  $(`#${id}`).addEventListener("change", persistLocalSettings);
});
restoreLocalSettings();
setupCustomSelects();
setupMultiPagePicker();
setupDraggableSidebarButton();
updateMultiPageLabel();
renderLinkInputs();
updateScheduleFields();
setupColumnResizing();
new ResizeObserver(() => applyTablePixelWidth()).observe($(".ads-table-wrap"));
loadTemplate();
