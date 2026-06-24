const DATA_FILES = ["./洛克王国_繁育表_补全BWiki.csv", "./洛克王国_繁育表.csv"];
const ATLAS_FILE = "./d.json";
const EGG_IMAGE_FILE = "./egg-images.json";
const PET_IMAGE_BASE = "https://static.gamecenter.qq.com/xgame/roco-kingdom/compendium/";
const DB_KEY = "roco-incubator-v2";
const ACCOUNTS_KEY = "roco-incubator-accounts-v1";
const LEGACY_KEY = "roco-breeding-manager-v1";

const HONORS = ["无", "大块头婉转声", "大块头粗嗓门", "小不点婉转声", "小不点粗嗓门", "大块头", "小不点", "婉转声", "粗嗓门"];
const LEGACY_HONORS = {
  "普通": "无", "大婉": "大块头婉转声", "大粗": "大块头粗嗓门",
  "小婉": "小不点婉转声", "小粗": "小不点粗嗓门",
  "单大块头": "大块头", "单小不点": "小不点", "单婉转声": "婉转声", "单粗嗓门": "粗嗓门"
};
const NEST_STATUS = { breeding: "孵育中", ready: "可产蛋", paused: "暂停" };
const COVERAGE_NATURES = ["开朗", "胆小", "固执", "聪明", "平和", "踏实", "沉默", "急躁"];
const COVERAGE_HONORS = ["大块头婉转声", "大块头粗嗓门", "小不点婉转声", "小不点粗嗓门"];
const NATURES = [
  ["大胆", "物攻", "物防"], ["固执", "物攻", "魔攻"], ["调皮", "物攻", "魔防"], ["勇敢", "物攻", "速度"], ["逞强", "物攻", "生命"],
  ["稳重", "物攻", "物攻"], ["天真", "物防", "魔攻"], ["懒散", "物防", "魔防"], ["悠闲", "物防", "速度"], ["坦率", "物防", "生命"],
  ["聪明", "魔攻", "物攻"], ["专注", "魔攻", "物防"], ["偏执", "魔攻", "魔攻"], ["冷静", "魔攻", "速度"], ["理性", "魔攻", "生命"],
  ["警惕", "魔防", "物攻"], ["温顺", "魔防", "物防"], ["害羞", "魔防", "魔攻"], ["慎重", "魔防", "速度"], ["焦虑", "魔防", "生命"],
  ["胆小", "速度", "物攻"], ["急躁", "速度", "物防"], ["开朗", "速度", "魔攻"], ["莽撞", "速度", "魔防"], ["热情", "速度", "生命"],
  ["沉默", "生命", "物攻"], ["忧郁", "生命", "物防"], ["平和", "生命", "魔攻"], ["粗心", "生命", "魔防"], ["踏实", "生命", "速度"]
].map(([name, increase, decrease]) => ({ name, increase, decrease }));

const state = {
  view: "parents",
  creatures: [],
  byKey: new Map(),
  eggImages: new Map(),
  eggImagesByBase: new Map(),
  accounts: [],
  currentAccountId: "",
  db: { parents: [], eggs: [], nests: [], demands: [], updatedAt: "" },
  filters: {
    nestSearch: "", nestStatus: "",
    parentSearch: "", parentGroup: "", parentNature: "", parentHonor: "", coverageHonor: COVERAGE_HONORS[0],
    eggSearch: "", eggGroup: "", eggSize: ""
  },
  editor: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [csvText, atlas, eggImageData] = await Promise.all([
      fetchFirst(DATA_FILES),
      fetch(ATLAS_FILE).then(checkResponse).then((r) => r.json()),
      fetch(EGG_IMAGE_FILE).then(checkResponse).then((r) => r.json()).catch(() => ({ items: [] }))
    ]);
    state.creatures = buildCreatures(csvText, atlas);
    state.byKey = new Map(state.creatures.map((item) => [item.key, item]));
    buildEggImageMaps(eggImageData.items || []);
    initializeAccounts();
    state.db = loadDb();
    bindEvents();
    fillStaticOptions();
    renderAll();
  } catch (error) {
    console.error(error);
    showToast("数据读取失败，请通过本地服务器打开");
  }
}

async function fetchFirst(paths) {
  for (const path of paths) {
    try {
      const response = await fetch(path);
      if (response.ok) return response.text();
    } catch {}
  }
  throw new Error("CSV 读取失败");
}

function checkResponse(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function buildEggImageMaps(items) {
  state.eggImages = new Map();
  state.eggImagesByBase = new Map();
  items.forEach((item) => {
    const key = normalizeEggImageName(item.name);
    if (!key || !item.image) return;
    state.eggImages.set(key, item.image);
    const baseKey = eggImageBaseName(key);
    if (!state.eggImagesByBase.has(baseKey)) state.eggImagesByBase.set(baseKey, item.image);
  });
}

function normalizeEggImageName(value) {
  return clean(value)
    .replace(/的蛋/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
}

function eggImageBaseName(value) {
  return normalizeEggImageName(value).replace(/\([^)]*\)$/, "");
}

function buildCreatures(csvText, atlas) {
  const rows = parseCsv(csvText);
  const atlasList = atlas.l || [];
  const atlasDetails = atlas.d || {};
  const byExact = new Map();
  const byName = new Map();

  atlasList.forEach((pet) => {
    byExact.set(`${pet.n}|${pet.fn}`, pet);
    byExact.set(`${pet.n}|${pet.nm}`, pet);
    if (!byName.has(pet.fn)) byName.set(pet.fn, pet);
    if (!byName.has(pet.nm)) byName.set(pet.nm, pet);
  });

  return rows.map((row, index) => {
    const no = clean(row["编号"]);
    const name = clean(row["精灵名"]);
    const eggSpecies = clean(row["蛋种(产蛋形态)"]);
    const groups = splitGroups(row["蛋组"]);
    const atlasPet = byExact.get(`${no}|${name}`) || byName.get(name) || byName.get(eggSpecies);
    const detail = atlasPet ? atlasDetails[String(atlasPet.i)] || {} : {};
    const primary = clean(row["主属性"]) || atlasPet?.e || "";
    const secondary = clean(row["副属性"]) || atlasPet?.e2 || "";
    const stage = clean(row["进化阶段"]) || atlasPet?.s || "";
    const minHeight = num(row["精灵最小身高(m)"]) ?? rangeValue(detail.h, 0);
    const maxHeight = num(row["精灵最大身高(m)"]) ?? rangeValue(detail.h, 1);
    const minWeight = num(row["精灵最小体重(kg)"]) ?? rangeValue(detail.w, 0);
    const maxWeight = num(row["精灵最大体重(kg)"]) ?? rangeValue(detail.w, 1);

    return {
      key: `${no}-${name}-${index}`,
      no, name, eggSpecies, groups, primary, secondary, stage,
      form: clean(row["地区形态名称"]),
      minHeight, maxHeight, minWeight, maxWeight,
      eggMinWeight: num(row["最小蛋重(kg)"]),
      eggMaxWeight: num(row["最大蛋重(kg)"]),
      eggMinHeight: num(row["最小蛋高(m)"]),
      eggMaxHeight: num(row["最大蛋高(m)"]),
      atlas: atlasPet || {}, detail,
      search: `${no} ${name} ${eggSpecies} ${groups.join(" ")} ${primary} ${secondary} ${stage}`.toLowerCase()
    };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

function clean(value) { return String(value || "").trim(); }
function num(value) { const parsed = Number(value); return Number.isFinite(parsed) && clean(value) !== "" ? parsed : null; }
function splitGroups(value) { return clean(value).split(/[、,，/]/).map(clean).filter(Boolean); }
function rangeValue(value, index) {
  const numbers = clean(value).match(/\d+(?:\.\d+)?/g) || [];
  return numbers[index] ? Number(numbers[index]) : null;
}

function initializeAccounts() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "null");
    const rawAccounts = Array.isArray(saved?.accounts) ? saved.accounts : [];
    const migrated = rawAccounts.map((account, index) => {
      const legacyStorageId = normalizeAccountId(account.id || account.guid);
      const id = isValidAccountId(legacyStorageId) ? legacyStorageId : createAccountId();
      const rawGameId = normalizeGameId(account.gameGuid || account.guid);
      const guid = isValidGameId(rawGameId) ? rawGameId : index === 0 ? "000000" : "";
      if (legacyStorageId && legacyStorageId !== id) {
        const oldData = localStorage.getItem(accountDbKey(legacyStorageId));
        if (oldData && !localStorage.getItem(accountDbKey(id))) localStorage.setItem(accountDbKey(id), oldData);
      }
      return { id, nickname: clean(account.nickname), guid, legacyStorageId };
    });
    const accounts = migrated
      .filter((account) => account.nickname && isValidAccountId(account.id))
      .filter((account, index, list) => list.findIndex((item) => item.id === account.id) === index);
    if (accounts.length) {
      const savedCurrentId = normalizeAccountId(saved.currentId || saved.currentGuid);
      const active = accounts.find((account) => account.id === savedCurrentId || account.legacyStorageId === savedCurrentId) || accounts[0];
      state.accounts = accounts.map(({ legacyStorageId, ...account }) => account);
      state.currentAccountId = active.id;
      saveAccountRegistry();
      return;
    }
  } catch {}

  const id = createAccountId();
  state.accounts = [{ id, nickname: "本机档案", guid: "000000" }];
  state.currentAccountId = id;
  const existingDb = localStorage.getItem(DB_KEY);
  if (existingDb) localStorage.setItem(accountDbKey(id), existingDb);
  saveAccountRegistry();
}

function saveAccountRegistry() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({
    accounts: state.accounts,
    currentId: state.currentAccountId
  }));
}

function accountDbKey(id) { return `${DB_KEY}:${normalizeAccountId(id)}`; }
function normalizeAccountId(value) { return clean(value).toLowerCase(); }
function normalizeGameId(value) { return clean(value); }
function isValidAccountId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value)); }
function isValidGameId(value) { return /^\d+$/.test(clean(value)); }
function createAccountId() {
  const generate = () => crypto.randomUUID
    ? crypto.randomUUID().toLowerCase()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = Math.floor(Math.random() * 16);
      return (char === "x" ? random : (random & 3) | 8).toString(16);
    });
  let id = generate();
  while (state.accounts.some((account) => account.id === id)) id = generate();
  return id;
}
function currentAccount() { return state.accounts.find((account) => account.id === state.currentAccountId) || state.accounts[0]; }

function loadDb() {
  try {
    const saved = JSON.parse(localStorage.getItem(accountDbKey(state.currentAccountId)) || "null");
    if (saved) return sanitizeDb(saved);
    const legacy = state.accounts.length === 1
      ? JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]")
      : [];
    if (Array.isArray(legacy) && legacy.length) {
      return sanitizeDb({
        parents: legacy.map((entry) => ({
          id: entry.id || uid(),
          creatureKey: entry.creatureKey,
          sex: entry.sex,
          nickname: entry.nickname || "",
          nature: entry.trait || "",
          size: "无",
          note: entry.note || "",
          favorite: Boolean(entry.favorite)
        })),
        eggs: [], nests: [], demands: []
      });
    }
  } catch {}
  return sanitizeDb({});
}

function sanitizeDb(db) {
  return {
    parents: Array.isArray(db.parents) ? db.parents.filter((item) => state.byKey.has(item.creatureKey)).map(normalizeRecordHonor) : [],
    eggs: Array.isArray(db.eggs) ? db.eggs.filter((item) => state.byKey.has(item.creatureKey)).map(normalizeEggRecord) : [],
    nests: Array.isArray(db.nests) ? db.nests.map(normalizeRecordHonor) : [],
    demands: Array.isArray(db.demands) ? db.demands.map(normalizeRecordHonor) : [],
    updatedAt: db.updatedAt || ""
  };
}

function normalizeRecordHonor(item) {
  const mapped = LEGACY_HONORS[item.size] || item.size || "无";
  return { ...item, size: HONORS.includes(mapped) ? mapped : "无" };
}

function normalizeEggRecord(item) {
  const normalized = normalizeRecordHonor(item);
  return {
    ...normalized,
    motherNature: clean(item.motherNature || item.nature),
    fatherNature: clean(item.fatherNature),
    eggHeight: item.eggHeight == null || item.eggHeight === "" ? null : Number(item.eggHeight),
    eggWeight: item.eggWeight == null || item.eggWeight === "" ? null : Number(item.eggWeight),
    laidAt: clean(item.laidAt || item.createdAt)
  };
}

function saveDb() {
  state.db.updatedAt = new Date().toISOString();
  localStorage.setItem(accountDbKey(state.currentAccountId), JSON.stringify(state.db));
  renderSaveTime();
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function bindEvents() {
  $$(".module-tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.addEventListener("click", handleAction);
  $("#editorForm").addEventListener("submit", submitEditor);
  $("#closeDetail").addEventListener("click", () => $("#detailDialog").close());
  $("#closeAccountDialog").addEventListener("click", () => $("#accountDialog").close());
  $("#closeExportDialog").addEventListener("click", () => $("#exportDialog").close());
  $("#cancelExportDialog").addEventListener("click", () => $("#exportDialog").close());
  $("#exportDownloadLink").addEventListener("click", () => showToast("备份下载已开始"));
  $("#accountCreateForm").addEventListener("submit", createAccount);
  $("#exportBtn").addEventListener("click", exportDb);
  $("#importFile").addEventListener("change", importDb);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".account-switcher")) closeAccountMenu();
  });

  bindParentSearch();
  bindFilter("#eggSearch", "eggSearch", renderEggs);
  bindSelect("#parentGroupFilter", "parentGroup", renderParents);
  bindSelect("#parentNatureFilter", "parentNature", renderParents);
  bindSelect("#parentHonorFilter", "parentHonor", renderParents);
  bindSelect("#eggGroupFilter", "eggGroup", renderEggs);
  bindSelect("#eggSizeFilter", "eggSize", renderEggs);
}

function bindFilter(selector, key, render) {
  $(selector).addEventListener("input", (event) => { state.filters[key] = event.target.value.trim().toLowerCase(); render(); });
}

function bindSelect(selector, key, render) {
  $(selector).addEventListener("change", (event) => { state.filters[key] = event.target.value; render(); });
}

function fillStaticOptions() {
  $("#creatureList").innerHTML = state.creatures.map((item) => `<option value="${esc(item.no)} ${esc(item.name)}">${esc(item.eggSpecies)}</option>`).join("");
  const groups = allGroups();
  $("#parentGroupFilter").innerHTML = optionList([""], ["全部蛋组"], groups, groups);
  const natures = NATURES.map((item) => item.name);
  $("#parentNatureFilter").innerHTML = optionList([""], ["全部性格"], natures, natures);
  $("#parentHonorFilter").innerHTML = optionList([""], ["全部荣誉"], HONORS, HONORS);
  $("#eggGroupFilter").innerHTML = optionList([""], ["全部蛋组"], groups, groups);
  $("#eggSizeFilter").innerHTML = optionList([""], ["全部荣誉"], HONORS, HONORS);
}

function optionList(values, labels, moreValues = [], moreLabels = []) {
  const allValues = [...values, ...moreValues], allLabels = [...labels, ...moreLabels];
  return allValues.map((value, index) => `<option value="${esc(value)}">${esc(allLabels[index])}</option>`).join("");
}

function bindParentSearch() {
  const input = $("#parentSearch");
  const results = $("#parentSearchResults");
  let matches = [];
  let activeIndex = -1;

  const closeResults = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };
  const selectMatch = (creature) => {
    input.value = creature.name;
    state.filters.parentSearch = creature.name.toLowerCase();
    closeResults();
    renderParents();
  };
  const setActive = (nextIndex) => {
    if (!matches.length) return;
    activeIndex = (nextIndex + matches.length) % matches.length;
    results.querySelectorAll(".creature-option").forEach((button, index) => button.classList.toggle("active", index === activeIndex));
  };
  const renderResults = () => {
    const inventoryKeys = new Set(state.db.parents.map((parent) => parent.creatureKey));
    const inventoryCreatures = [...inventoryKeys].map((key) => state.byKey.get(key)).filter(Boolean);
    matches = clean(input.value)
      ? searchCreatures(input.value).filter((creature) => inventoryKeys.has(creature.key)).slice(0, 8)
      : inventoryCreatures.slice(0, 8);
    activeIndex = -1;
    results.innerHTML = matches.length ? matches.map((creature, index) => {
      const count = state.db.parents.filter((parent) => parent.creatureKey === creature.key).length;
      return `<button class="creature-option" type="button" role="option" data-index="${index}">
        <span><strong>${esc(creature.name)}</strong><small>${esc(creature.no)} · ${esc(creature.eggSpecies)}</small></span>
        <span class="creature-option-meta">库存 ${count} 只<small>${esc(creature.groups.join("、"))}</small></span>
      </button>`;
    }).join("") : `<div class="creature-no-result">仓库中没有匹配精灵</div>`;
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
    results.querySelectorAll(".creature-option").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => selectMatch(matches[Number(button.dataset.index)]));
    });
  };

  input.addEventListener("focus", renderResults);
  input.addEventListener("input", () => {
    state.filters.parentSearch = input.value.trim().toLowerCase();
    renderParents();
    renderResults();
  });
  input.addEventListener("blur", () => setTimeout(closeResults, 100));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex + 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex - 1); }
    if (event.key === "Enter" && !results.hidden && matches.length) {
      event.preventDefault();
      selectMatch(matches[activeIndex >= 0 ? activeIndex : 0]);
    }
    if (event.key === "Escape") closeResults();
  });
}

function switchView(view) {
  state.view = view;
  $$(".module-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
}

function renderAll() {
  renderAccounts();
  renderSaveTime();
  renderParents();
  renderCoverage();
  renderEggs();
}

function renderSaveTime() {
  $("#saveTime").textContent = state.db.updatedAt
    ? new Date(state.db.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })
    : "尚未修改";
}

function renderAccounts() {
  const active = currentAccount();
  if (!active) return;
  $("#currentAccountName").textContent = active.nickname;
  $("#accountSwitchBtn").title = `${active.nickname}\n游戏 ID：${active.guid || "未设置"}`;
  $("#accountQuickList").innerHTML = state.accounts.map((account) => `
    <button class="account-quick-option ${account.id === active.id ? "active" : ""}" type="button" role="menuitem" data-action="switch-account" data-account-id="${esc(account.id)}">
      <span><strong>${esc(account.nickname)}</strong><small>游戏 ID：${esc(account.guid || "未设置")}</small></span>
      ${account.id === active.id ? '<b aria-label="当前账号">当前</b>' : ""}
    </button>`).join("");
  renderAccountManagerList();
}

function renderAccountManagerList() {
  const container = $("#accountManagerList");
  if (!container) return;
  container.innerHTML = state.accounts.map((account) => `
    <article class="account-manager-row" data-account-id="${esc(account.id)}">
      <div class="account-row-head">
        <strong>${account.id === state.currentAccountId ? "当前账号" : "本机账号"}</strong>
        ${account.id === state.currentAccountId ? '<span class="tag teal">使用中</span>' : ""}
      </div>
      <label><span>昵称</span><input data-account-nickname maxlength="24" value="${esc(account.nickname)}"></label>
      <label><span>游戏 ID</span><input data-account-guid-input inputmode="numeric" pattern="[0-9]+" spellcheck="false" autocomplete="off" value="${esc(account.guid)}" placeholder="输入纯数字 ID"></label>
      <div class="account-row-actions">
        <button class="secondary-button" type="button" data-action="save-account">保存修改</button>
        <button class="danger-button" type="button" data-action="delete-account" ${state.accounts.length === 1 ? "disabled" : ""}>删除</button>
      </div>
    </article>`).join("");
}

function closeAccountMenu() {
  const menu = $("#accountMenu");
  if (!menu) return;
  menu.hidden = true;
  $("#accountSwitchBtn").setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  const menu = $("#accountMenu");
  menu.hidden = !menu.hidden;
  $("#accountSwitchBtn").setAttribute("aria-expanded", String(!menu.hidden));
}

function openAccountManager() {
  closeAccountMenu();
  const form = $("#accountCreateForm");
  form.reset();
  renderAccountManagerList();
  $("#accountDialog").showModal();
}

function createAccount(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const nickname = clean(data.get("nickname"));
  const guid = normalizeGameId(data.get("guid"));
  if (!nickname) return showToast("请输入账号昵称");
  if (!isValidGameId(guid)) return showToast("游戏 ID 只能填写数字");
  if (state.accounts.some((account) => account.guid === guid)) return showToast("该游戏 ID 已存在");
  const id = createAccountId();
  state.accounts.push({ id, nickname, guid });
  localStorage.setItem(accountDbKey(id), JSON.stringify(sanitizeDb({})));
  saveAccountRegistry();
  event.currentTarget.reset();
  renderAccounts();
  showToast("账号已新增");
}

function switchAccount(id) {
  const next = state.accounts.find((account) => account.id === normalizeAccountId(id));
  if (!next || next.id === state.currentAccountId) return closeAccountMenu();
  state.currentAccountId = next.id;
  saveAccountRegistry();
  state.db = loadDb();
  closeAccountMenu();
  renderAll();
  showToast(`已切换到 ${next.nickname}`);
}

function saveAccount(button) {
  const row = button.closest(".account-manager-row");
  const id = normalizeAccountId(row?.dataset.accountId);
  const account = state.accounts.find((item) => item.id === id);
  if (!row || !account) return;
  const nickname = clean(row.querySelector("[data-account-nickname]").value);
  const newGuid = normalizeGameId(row.querySelector("[data-account-guid-input]").value);
  if (!nickname) return showToast("请输入账号昵称");
  if (!isValidGameId(newGuid)) return showToast("游戏 ID 只能填写数字");
  if (newGuid !== account.guid && state.accounts.some((item) => item.guid === newGuid)) return showToast("该游戏 ID 已存在");
  account.nickname = nickname;
  account.guid = newGuid;
  saveAccountRegistry();
  renderAccounts();
  showToast("账号已更新");
}

function deleteAccount(button) {
  if (state.accounts.length === 1) return showToast("至少保留一个账号");
  const row = button.closest(".account-manager-row");
  const id = normalizeAccountId(row?.dataset.accountId);
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  if (!window.confirm(`删除账号“${account.nickname}”及其全部本地档案？`)) return;
  const deletingCurrent = id === state.currentAccountId;
  state.accounts = state.accounts.filter((item) => item.id !== id);
  localStorage.removeItem(accountDbKey(id));
  if (deletingCurrent) {
    state.currentAccountId = state.accounts[0].id;
    state.db = loadDb();
  }
  saveAccountRegistry();
  renderAll();
  showToast("账号已删除");
}

function metric(label, value, note, color) {
  return `<article class="metric-card ${color}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
}

function renderNestMetrics() {
  const ready = state.db.nests.filter((item) => item.status === "ready").length;
  const active = state.db.nests.filter((item) => item.status === "breeding").length;
  const pairs = compatiblePairs().length;
  $("#nestMetrics").innerHTML = [
    metric("总父母本精灵", state.db.parents.length, `种公 ${parentBySex("male").length} / 种母 ${parentBySex("female").length}`, "teal"),
    metric("现有蛋窝", state.db.nests.length, `${active} 窝孵育中`, "violet"),
    metric("可产蛋窝", ready, "可进入产蛋登记", "amber"),
    metric("库存可配组合", pairs, "按共同蛋组计算", "coral")
  ].join("");
}

function renderNests() {
  const search = state.filters.nestSearch;
  const list = state.db.nests.filter((nest) => {
    const male = parentById(nest.maleId), female = parentById(nest.femaleId);
    const text = `${nest.name} ${parentLabel(male)} ${parentLabel(female)} ${nest.target || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!state.filters.nestStatus || nest.status === state.filters.nestStatus);
  });
  $("#nestGrid").innerHTML = list.length ? list.map(nestCard).join("") : emptyState("还没有蛋窝", "先登记种公种母，再新建繁育组合");
}

function nestCard(nest) {
  const male = parentById(nest.maleId), female = parentById(nest.femaleId);
  const maleCreature = creatureOf(male), femaleCreature = creatureOf(female);
  const groups = sharedGroups(maleCreature, femaleCreature);
  const progress = nest.status === "ready" ? 100 : nest.status === "breeding" ? 55 : 18;
  return `
    <article class="nest-card">
      <div class="nest-top">
        <div><h3>${esc(nest.name || `${femaleCreature?.eggSpecies || "未命名"}蛋窝`)}</h3><p>${esc(NEST_STATUS[nest.status] || "孵育中")} · 目标 ${esc(nest.target || femaleCreature?.eggSpecies || "-")}</p></div>
        <span class="tag ${nest.status === "ready" ? "amber" : nest.status === "paused" ? "coral" : "teal"}">${esc(NEST_STATUS[nest.status] || "孵育中")}</span>
      </div>
      <div class="pair-visual">
        ${parentSide(male, "male")}
        <div class="pair-link">×</div>
        ${parentSide(female, "female")}
      </div>
      <div class="tag-row">${groups.map((group) => `<span class="tag tone-tag" style="${toneStyle(group, "group")}">${esc(group)}</span>`).join("")}${nest.size ? `<span class="tag tone-tag" style="${toneStyle(nest.size, "honor")}">${esc(nest.size)}</span>` : ""}</div>
      <div class="progress-track"><span style="width:${progress}%"></span></div>
      <div class="card-footer">
        <span>已产 ${Number(nest.produced || 0)} 枚</span>
        <div class="card-actions">
          ${nest.status === "ready" ? `<button class="text-button" data-action="lay-egg" data-id="${nest.id}">产蛋</button>` : ""}
          <button class="text-button" data-action="edit-nest" data-id="${nest.id}">编辑</button>
          <button class="text-button" data-action="delete-nest" data-id="${nest.id}">删除</button>
        </div>
      </div>
    </article>`;
}

function parentSide(parent, sex) {
  const creature = creatureOf(parent);
  return `<div class="parent-side"><small class="${sex === "male" ? "sex-male" : "sex-female"}">${sex === "male" ? "♂ 父方配置" : "♀ 母方配置"}</small><strong>${esc(parentLabel(parent))}</strong><span>${esc(parent?.nature || "未设置性格")} · ${esc(parent?.size || "无")}</span></div>`;
}

function renderDemands() {
  $("#demandCount").textContent = `${state.db.demands.length} 条需求`;
  $("#demandGrid").innerHTML = state.db.demands.length ? state.db.demands.map((item) => `
    <article class="demand-card">
      <div class="nest-top"><h3>${esc(item.creature)}</h3><button class="text-button" data-action="delete-demand" data-id="${item.id}">删除</button></div>
      <p>${esc(item.note || "暂无附加说明")}</p>
      <div class="tag-row">
        ${item.nature ? `<span class="tag tone-tag" style="${toneStyle(item.nature, "nature")}">${esc(item.nature)}</span>` : ""}
        <span class="tag tone-tag" style="${toneStyle(item.size || "无", "honor")}">${esc(item.size || "无")}</span>
        ${item.threeV ? `<span class="tag teal">3V</span>` : ""}
        ${item.extreme ? `<span class="tag coral">极限</span>` : ""}
      </div>
    </article>`).join("") : emptyState("暂无换蛋需求", "在上方填写条件后加入需求墙");
}

function renderParents() {
  const list = state.db.parents.filter((parent) => {
    const creature = creatureOf(parent);
    const text = `${parentLabel(parent)} ${creature?.no || ""} ${creature?.name || ""} ${creature?.eggSpecies || ""}`.toLowerCase();
    return (!state.filters.parentSearch || text.includes(state.filters.parentSearch))
      && (!state.filters.parentGroup || creature?.groups.includes(state.filters.parentGroup))
      && (!state.filters.parentNature || parent.nature === state.filters.parentNature)
      && (!state.filters.parentHonor || parent.size === state.filters.parentHonor);
  });
  const mothers = list.filter((parent) => parent.sex === "female");
  const fathers = list.filter((parent) => parent.sex === "male");
  $("#parentCount").textContent = `${list.length} 只`;
  $("#motherCount").textContent = `${mothers.length} 只母本`;
  $("#fatherCount").textContent = `${fathers.length} 只父本`;
  $("#motherParentList").innerHTML = mothers.length ? mothers.map(parentCard).join("") : emptyState("暂无母本", "点击上方按钮添加母本");
  $("#fatherParentList").innerHTML = fathers.length ? fathers.map(parentCard).join("") : emptyState("暂无父本", "点击上方按钮添加父本");
  bindParentCardControls();
}

function parentCard(parent) {
  const creature = creatureOf(parent);
  const imageUrl = creatureImageUrl(creature);
  const weightPercent = rangePercent(parent.weight, creature?.minWeight, creature?.maxWeight);
  const fullStatus = parentFullStatus(parent, creature);
  const natureOptions = [`<option value="">未设置性格</option>`, ...NATURES.map((item) => `<option value="${item.name}" ${selected(parent.nature, item.name)}>${item.name}</option>`)].join("");
  return `
    <article class="parent-card ${parent.sex === "female" ? "mother-card" : "father-card"}" data-parent-id="${parent.id}">
      <button class="icon-button compact danger parent-delete-button" type="button" data-action="delete-parent" data-id="${parent.id}" title="删除" aria-label="删除 ${esc(creature?.name || "父母本")}">×</button>

      <div class="parent-card-body">
        <div class="parent-card-profile">
          <div class="pet-avatar parent-pet-image">
            <span class="avatar-fallback">${esc(creature?.name?.slice(0, 1) || "?")}</span>
            ${imageUrl ? `<img src="${esc(imageUrl)}" alt="${esc(creature?.name || "精灵")}" loading="lazy" decoding="async">` : ""}
            <span class="parent-sex-badge">${parent.sex === "female" ? "♀" : "♂"}</span>
          </div>
          <div class="parent-creature-combobox parent-name-combobox">
            <textarea class="parent-name-input" data-creature-input rows="2" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-label="修改 ${esc(creature?.name || "精灵")}" title="点击修改精灵" placeholder="选择精灵">${esc(creature?.name || "")}</textarea>
            <div class="creature-results" role="listbox" hidden></div>
          </div>
          <small>${esc(creature?.no || "")} · ${esc(creature?.stage || "未知阶段")}</small>
        </div>

        <div class="parent-card-fields">
          <label class="parent-inline-field full"><span>荣誉</span>
            <select class="tone-select" style="${toneStyle(parent.size || "无", "honor")}" data-parent-field="size">${HONORS.map((item) => `<option value="${item}" ${selected(parent.size, item)}>${item}</option>`).join("")}</select>
          </label>
          <label class="parent-inline-field full"><span>性格</span>
            <select class="tone-select" style="${toneStyle(parent.nature || "未设置性格", "nature")}" data-parent-field="nature">${natureOptions}</select>
          </label>
          <label class="parent-inline-field"><span>身高（m）</span>
            <input data-parent-field="height" type="number" min="0" step="0.01" inputmode="decimal" value="${optionalNumber(parent.height)}" placeholder="选填">
            <small>${measurementRangeText(creature, "height")}</small>
          </label>
          <label class="parent-inline-field"><span>体重（kg）</span>
            <input data-parent-field="weight" type="number" min="0" step="0.01" inputmode="decimal" value="${optionalNumber(parent.weight)}" placeholder="选填">
            <small>${measurementRangeText(creature, "weight")}</small>
          </label>
        </div>
      </div>

      <div class="parent-card-footer">
        <div class="footer-tag-groups">
          <div class="tag-row footer-egg-groups">
            ${(creature?.groups || []).map((group) => `<span class="tag tone-tag" style="${toneStyle(group, "group")}">${esc(group)}</span>`).join("")}
          </div>
          <div class="tag-row footer-attributes">
            ${[creature?.primary, creature?.secondary].filter(Boolean).map((item) => `<span class="tag teal">${esc(item)}</span>`).join("")}
          </div>
        </div>
        ${fullStatus
          ? `<span class="full-status-badge ${fullStatus.type}">${fullStatus.label}</span>`
          : weightPercent == null ? "" : `<span class="weight-percent-badge">${formatPercent(weightPercent)}%</span>`}
      </div>
    </article>`;
}

function bindParentCardControls() {
  $$(".parent-pet-image img").forEach((image) => {
    image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  });

  $$(".parent-card [data-parent-field]").forEach((control) => {
    let saveTimer;
    const commitValue = () => {
      clearTimeout(saveTimer);
      const card = control.closest(".parent-card");
      if (!card) return;
      const fieldName = control.dataset.parentField;
      const value = fieldName === "height" || fieldName === "weight" ? optionalValue(control.value) : control.value;
      updateParentInline(card.dataset.parentId, { [fieldName]: value });
    };
    control.addEventListener("change", commitValue);
    if (control.matches('input[type="number"]')) {
      control.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(commitValue, 500);
      });
    }
  });

  $$(".parent-creature-combobox").forEach((combobox) => {
    const card = combobox.closest(".parent-card");
    const input = combobox.querySelector("[data-creature-input]");
    const results = combobox.querySelector(".creature-results");
    let matches = [];
    let activeIndex = -1;

    const closeResults = () => {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    };
    const chooseCreature = (creature) => {
      input.value = creature.name;
      closeResults();
      updateParentInline(card.dataset.parentId, { creatureKey: creature.key });
    };
    const setActive = (nextIndex) => {
      if (!matches.length) return;
      activeIndex = (nextIndex + matches.length) % matches.length;
      results.querySelectorAll(".creature-option").forEach((button, index) => button.classList.toggle("active", index === activeIndex));
    };
    const renderResults = () => {
      matches = searchCreatures(input.value).slice(0, 8);
      activeIndex = -1;
      results.innerHTML = matches.length ? matches.map((creature, index) => `
        <button class="creature-option" type="button" role="option" data-index="${index}">
          <span><strong>${esc(creature.name)}</strong><small>${esc(creature.no)} · ${esc(creature.eggSpecies)}</small></span>
          <span class="creature-option-meta">${esc([creature.primary, creature.secondary].filter(Boolean).join(" / ") || "未知属性")}</span>
        </button>`).join("") : `<div class="creature-no-result">没有匹配精灵</div>`;
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
      results.querySelectorAll(".creature-option").forEach((button) => {
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => chooseCreature(matches[Number(button.dataset.index)]));
      });
    };

    input.addEventListener("focus", renderResults);
    input.addEventListener("input", renderResults);
    input.addEventListener("blur", () => setTimeout(closeResults, 100));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex + 1); }
      if (event.key === "ArrowUp") { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex - 1); }
      if (event.key === "Enter" && !results.hidden && matches.length) {
        event.preventDefault();
        chooseCreature(matches[activeIndex >= 0 ? activeIndex : 0]);
      }
      if (event.key === "Escape") closeResults();
    });
  });
}

function updateParentInline(id, values) {
  const parent = parentById(id);
  if (!parent) return;
  Object.assign(parent, values);
  saveDb();
  renderAll();
  showToast("已自动保存");
}

function renderPairSuggestions() {
  const pairs = compatiblePairs().slice(0, 8);
  $("#pairSuggestions").innerHTML = pairs.length ? pairs.map(({ male, female, groups }) => {
    const femaleCreature = creatureOf(female);
    return `<article class="suggestion-card"><h3>${esc(parentLabel(male))} × ${esc(parentLabel(female))}</h3><p>${esc(groups.join("、"))} · 可产 ${esc(femaleCreature?.eggSpecies || "-")}</p><button class="text-button" data-action="nest-from-pair" data-male="${male.id}" data-female="${female.id}">建立蛋窝</button></article>`;
  }).join("") : emptyState("暂无可配组合", "至少登记一只拥有共同蛋组的种公和种母");
}

function renderCoverageLegacy() {
  $("#coverageBody").innerHTML = allGroups().map((group) => {
    const males = parentBySex("male").filter((parent) => creatureOf(parent)?.groups.includes(group));
    const females = parentBySex("female").filter((parent) => creatureOf(parent)?.groups.includes(group));
    const pairs = males.length * females.length;
    const status = pairs ? "完整覆盖" : males.length || females.length ? "单侧缺口" : "未覆盖";
    return `<tr><td><span class="tag tone-tag" style="${toneStyle(group, "group")}">${esc(group)}</span></td><td>${males.length}</td><td>${females.length}</td><td>${pairs}</td><td><span class="tag ${pairs ? "teal" : males.length || females.length ? "amber" : "coral"}">${status}</span></td></tr>`;
  }).join("");
}

function renderCoverage() {
  const honor = COVERAGE_HONORS.includes(state.filters.coverageHonor)
    ? state.filters.coverageHonor
    : COVERAGE_HONORS[0];

  $$("[data-action='coverage-honor']").forEach((button) => {
    const active = button.dataset.honor === honor;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  $("#coverageHead").innerHTML = `<tr><th>蛋组 \\ 性格</th>${COVERAGE_NATURES.map((nature) => `<th><span class="coverage-nature" style="${toneStyle(nature, "nature")}">${esc(nature)}</span></th>`).join("")}</tr>`;
  $("#coverageBody").innerHTML = allGroups().map((group) => {
    const cells = COVERAGE_NATURES.map((nature) => {
      const matches = state.db.parents.filter((parent) => parent.size === honor
        && parent.nature === nature
        && creatureOf(parent)?.groups.includes(group));
      const males = matches.filter((parent) => parent.sex === "male").length;
      const females = matches.filter((parent) => parent.sex === "female").length;
      const coverageClass = males && females ? "both-sexes" : males ? "male-only" : females ? "female-only" : "no-stock";
      const label = males && females
        ? `<span class="female-count">♀${females}</span><span class="male-count">♂${males}</span>`
        : females ? `<span class="female-count">♀${females}</span>`
          : males ? `<span class="male-count">♂${males}</span>`
            : `<span class="coverage-empty">无记录</span>`;
      return `<td class="coverage-cell ${coverageClass}" title="${esc(group)} · ${esc(nature)} · ${esc(honor)}">${label}</td>`;
    }).join("");
    return `<tr><th scope="row"><span class="tag tone-tag" style="${toneStyle(group, "group")}">${esc(group)}</span></th>${cells}</tr>`;
  }).join("");
}

function renderEggs() {
  const list = state.db.eggs.filter((egg) => {
    const creature = creatureOf(egg);
    const text = `${creature?.search || ""} ${egg.motherNature || ""} ${egg.fatherNature || ""} ${egg.size || ""}`.toLowerCase();
    return (!state.filters.eggSearch || text.includes(state.filters.eggSearch))
      && (!state.filters.eggGroup || creature?.groups.includes(state.filters.eggGroup))
      && (!state.filters.eggSize || egg.size === state.filters.eggSize);
  });
  $("#eggGrid").innerHTML = list.length ? list.map(eggCard).join("") : emptyState("精灵蛋库为空", "登记后会在这里显示尺寸、双亲性格与产蛋时间");
  bindEggCardControls();
}

function eggCard(egg) {
  const creature = creatureOf(egg);
  const imageUrl = eggImageUrl(creature);
  const fallbackImageUrl = creatureImageUrl(creature);
  const fullStatus = eggFullStatus(egg, creature);
  const natureOptions = (value) => [`<option value="">未设置</option>`, ...NATURES.map((item) => `<option value="${item.name}" ${selected(value, item.name)}>${item.name}</option>`)].join("");
  return `
    <article class="egg-card parent-card" data-egg-id="${egg.id}">
      <button class="icon-button compact danger parent-delete-button" type="button" data-action="delete-egg" data-id="${egg.id}" title="删除" aria-label="删除 ${esc(creature?.eggSpecies || "精灵蛋")}">×</button>
      <div class="parent-card-body egg-card-body">
        <div class="parent-card-profile">
          <div class="pet-avatar parent-pet-image">
            <span class="avatar-fallback">${esc((creature?.name || "?").slice(0, 1))}</span>
            ${imageUrl ? `<img src="${esc(imageUrl)}" data-fallback-src="${esc(fallbackImageUrl)}" alt="${esc(creature?.eggSpecies || creature?.name || "精灵蛋")}" loading="lazy">` : ""}
          </div>
          <strong class="egg-card-name">${esc(creature?.eggSpecies || creature?.name || "未知精灵蛋")}</strong>
          <small>${esc(creature?.no || "")} · ${esc(creature?.stage || "未知阶段")}</small>
        </div>
        <div class="parent-card-fields">
          <label class="parent-inline-field full"><span>荣誉</span><select class="tone-select" style="${toneStyle(egg.size || "无", "honor")}" data-egg-field="size">${HONORS.map((item) => `<option value="${item}" ${selected(egg.size, item)}>${item}</option>`).join("")}</select></label>
          <label class="parent-inline-field"><span>母性格</span><select class="tone-select" style="${toneStyle(egg.motherNature || "未设置性格", "nature")}" data-egg-field="motherNature">${natureOptions(egg.motherNature)}</select></label>
          <label class="parent-inline-field"><span>父性格</span><select class="tone-select" style="${toneStyle(egg.fatherNature || "未设置性格", "nature")}" data-egg-field="fatherNature">${natureOptions(egg.fatherNature)}</select></label>
          <label class="parent-inline-field"><span>蛋高（m）</span><input type="number" min="0" step="0.01" inputmode="decimal" value="${optionalNumber(egg.eggHeight)}" placeholder="选填" data-egg-field="eggHeight"><small>${eggRangeText(creature, "height")}</small></label>
          <label class="parent-inline-field"><span>蛋重（kg）</span><input type="number" min="0" step="0.01" inputmode="decimal" value="${optionalNumber(egg.eggWeight)}" placeholder="选填" data-egg-field="eggWeight"><small>${eggRangeText(creature, "weight")}</small></label>
          <label class="parent-inline-field full"><span>产蛋时间</span><input class="egg-time-input" type="datetime-local" value="${esc(dateTimeInputValue(egg.laidAt))}" data-egg-field="laidAt"></label>
        </div>
      </div>
      <div class="parent-card-footer">
        <div class="footer-tag-groups">
          <div class="tag-row footer-egg-groups">
            ${(creature?.groups || []).map((group) => `<span class="tag tone-tag" style="${toneStyle(group, "group")}">${esc(group)}</span>`).join("")}
          </div>
          <div class="tag-row footer-attributes">
            ${[creature?.primary, creature?.secondary].filter(Boolean).map((item) => `<span class="tag teal">${esc(item)}</span>`).join("")}
          </div>
        </div>
        ${fullStatus ? `<span class="full-status-badge ${fullStatus.type}">${fullStatus.label}</span>` : ""}
      </div>
    </article>`;
}

function bindEggCardControls() {
  $$(".egg-card .parent-pet-image img").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallbackSrc;
      if (fallback && image.src !== fallback) {
        image.removeAttribute("data-fallback-src");
        image.src = fallback;
      } else image.hidden = true;
    });
  });
  $$(".egg-card [data-egg-field]").forEach((control) => {
    let saveTimer;
    const commitValue = () => {
      clearTimeout(saveTimer);
      const card = control.closest(".egg-card");
      if (!card) return;
      const fieldName = control.dataset.eggField;
      const value = fieldName === "eggHeight" || fieldName === "eggWeight" ? optionalValue(control.value) : control.value;
      updateEggInline(card.dataset.eggId, { [fieldName]: value });
    };
    control.addEventListener("change", commitValue);
    if (control.matches('input[type="number"]')) {
      control.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(commitValue, 500);
      });
    }
  });
}

function updateEggInline(id, values) {
  const egg = state.db.eggs.find((item) => item.id === id);
  if (!egg) return;
  Object.assign(egg, values);
  saveDb();
  renderAll();
  showToast("已自动保存");
}

function handleAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "toggle-account-menu") toggleAccountMenu();
  if (action === "manage-accounts") openAccountManager();
  if (action === "switch-account") switchAccount(button.dataset.accountId);
  if (action === "save-account") saveAccount(button);
  if (action === "delete-account") deleteAccount(button);
  if (action === "add-parent") openParentEditor(null, button.dataset.sex);
  if (action === "delete-parent") deleteRecord("parents", button.dataset.id);
  if (action === "add-nest") openNestEditor();
  if (action === "edit-nest") openNestEditor(button.dataset.id);
  if (action === "nest-from-pair") openNestEditor(null, button.dataset.male, button.dataset.female);
  if (action === "delete-nest") deleteRecord("nests", button.dataset.id);
  if (action === "lay-egg") layEgg(button.dataset.id);
  if (action === "add-egg") openEggEditor();
  if (action === "edit-egg") openEggEditor(button.dataset.id);
  if (action === "delete-egg") deleteRecord("eggs", button.dataset.id);
  if (action === "delete-demand") deleteRecord("demands", button.dataset.id);
  if (action === "detail-creature") openDetail(button.dataset.key);
  if (action === "coverage-honor") {
    state.filters.coverageHonor = button.dataset.honor;
    renderCoverage();
  }
}

function openParentEditor(id, presetSex) {
  const record = state.db.parents.find((item) => item.id === id);
  state.editor = { type: "parent", id: record?.id || null };
  setEditor("父母本", record ? "编辑父母本" : "登记父母本", `
    ${field("精灵", creatureSearchControl(creatureOf(record)), true, true)}
    ${field("性别", `<select name="sex" required><option value="male" ${selected(record?.sex || presetSex || "male", "male")}>种公</option><option value="female" ${selected(record?.sex || presetSex, "female")}>种母</option></select>`, false, true)}
    ${field("别名", `<input name="nickname" value="${esc(record?.nickname || "")}" placeholder="仓库中的辨识名称">`)}
    ${field("性格", natureControl(record?.nature))}
    ${field("荣誉", `<select name="size" required>${HONORS.map((item) => `<option value="${item}" ${selected(record?.size, item)}>${item}</option>`).join("")}</select>`, false, true)}
    ${field("身高（m）", measurementControl("height", record?.height, creatureOf(record)))}
    ${field("体重（kg）", measurementControl("weight", record?.weight, creatureOf(record)))}
  `);
}

function openNestEditor(id, presetMale, presetFemale) {
  const record = state.db.nests.find((item) => item.id === id);
  const males = parentBySex("male"), females = parentBySex("female");
  if (!males.length || !females.length) { showToast("请先登记至少一只种公和种母"); switchView("parents"); return; }
  state.editor = { type: "nest", id: record?.id || null };
  setEditor("蛋窝", record ? "编辑蛋窝" : "新建蛋窝", `
    ${field("蛋窝名称", `<input name="name" value="${esc(record?.name || "")}" placeholder="例如：喵喵大粗蛋窝">`, true)}
    ${field("父方种公", `<select name="maleId">${males.map((item) => `<option value="${item.id}" ${selected(record?.maleId || presetMale, item.id)}>${esc(parentLabel(item))}</option>`).join("")}</select>`)}
    ${field("母方种母", `<select name="femaleId">${females.map((item) => `<option value="${item.id}" ${selected(record?.femaleId || presetFemale, item.id)}>${esc(parentLabel(item))}</option>`).join("")}</select>`)}
    ${field("目标荣誉", `<select name="size">${HONORS.map((item) => `<option value="${item}" ${selected(record?.size, item)}>${item}</option>`).join("")}</select>`)}
    ${field("状态", `<select name="status">${Object.entries(NEST_STATUS).map(([value,label]) => `<option value="${value}" ${selected(record?.status || "breeding", value)}>${label}</option>`).join("")}</select>`)}
    ${field("目标蛋", `<input name="target" value="${esc(record?.target || "")}" placeholder="留空则采用母方蛋种">`)}
    ${field("备注", `<textarea name="note">${esc(record?.note || "")}</textarea>`, true)}
  `);
}

function openEggEditor(id, preset = {}) {
  const record = state.db.eggs.find((item) => item.id === id) || preset;
  state.editor = { type: "egg", id: id || null };
  setEditor("精灵蛋", id ? "编辑精灵蛋" : "登记精灵蛋", `
    ${field("精灵 / 蛋种", creatureSearchControl(creatureOf(record)), true, true)}
    ${field("荣誉", `<select name="size" required>${HONORS.map((item) => `<option value="${item}" ${selected(record?.size, item)}>${item}</option>`).join("")}</select>`, false, true)}
    ${field("蛋高（m）", eggMeasurementControl("eggHeight", record?.eggHeight, creatureOf(record)))}
    ${field("蛋重（kg）", eggMeasurementControl("eggWeight", record?.eggWeight, creatureOf(record)))}
    ${field("母性格", namedNatureControl("motherNature", record?.motherNature))}
    ${field("父性格", namedNatureControl("fatherNature", record?.fatherNature))}
    ${field("产蛋时间", `<input name="laidAt" type="datetime-local" required value="${esc(dateTimeInputValue(record?.laidAt || new Date()))}">`, true, true)}
  `);
}

function setEditor(eyebrow, title, fields) {
  $("#editorEyebrow").textContent = eyebrow;
  $("#editorTitle").textContent = title;
  $("#editorFields").innerHTML = fields;
  $("#editorDialog").showModal();
  bindEditorControls();
}

function bindEditorControls() {
  $$("#editorFields .creature-combobox").forEach((combobox) => {
    const input = combobox.querySelector('input[name="creature"]');
    const keyInput = combobox.querySelector('input[name="creatureKey"]');
    const results = combobox.querySelector(".creature-results");
    let matches = [];
    let activeIndex = -1;

    const closeResults = () => {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    };
    const selectMatch = (creature) => {
      input.value = creatureInputValue(creature);
      keyInput.value = creature.key;
      updateMeasurementRanges(creature);
      closeResults();
    };
    const setActive = (nextIndex) => {
      if (!matches.length) return;
      activeIndex = (nextIndex + matches.length) % matches.length;
      results.querySelectorAll(".creature-option").forEach((button, index) => button.classList.toggle("active", index === activeIndex));
    };
    const renderResults = () => {
      matches = searchCreatures(input.value).slice(0, 10);
      activeIndex = -1;
      results.innerHTML = matches.length ? matches.map((creature, index) => `
        <button class="creature-option" type="button" role="option" data-index="${index}">
          <span><strong>${esc(creature.name)}</strong><small>${esc(creature.no)} · 蛋种 ${esc(creature.eggSpecies)}</small></span>
          <span class="creature-option-meta">${esc([creature.primary, creature.secondary].filter(Boolean).join(" / ") || "未知属性")}<small>${esc(creature.groups.join("、"))}</small></span>
        </button>`).join("") : `<div class="creature-no-result">没有匹配精灵，请换个名称或编号</div>`;
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
      results.querySelectorAll(".creature-option").forEach((button) => {
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => selectMatch(matches[Number(button.dataset.index)]));
      });
    };

    input.addEventListener("focus", renderResults);
    input.addEventListener("input", () => { keyInput.value = ""; updateMeasurementRanges(null); renderResults(); });
    input.addEventListener("blur", () => setTimeout(closeResults, 100));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex + 1); }
      if (event.key === "ArrowUp") { event.preventDefault(); if (results.hidden) renderResults(); setActive(activeIndex - 1); }
      if (event.key === "Enter" && !results.hidden && matches.length) {
        event.preventDefault();
        selectMatch(matches[activeIndex >= 0 ? activeIndex : 0]);
      }
      if (event.key === "Escape") closeResults();
    });
  });

  $$("#editorFields .nature-control select").forEach((select) => {
    select.addEventListener("change", () => {
      select.closest(".nature-control").querySelector(".nature-effect").textContent = select.value ? natureEffect(select.value) : "选择后显示属性变化";
    });
  });
}

function searchCreatures(query) {
  const terms = clean(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return state.creatures.slice(0, 10);
  return state.creatures
    .map((creature) => ({ creature, score: creatureSearchScore(creature, terms) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.creature.no.localeCompare(b.creature.no, "zh-CN", { numeric: true }))
    .map((item) => item.creature);
}

function creatureSearchScore(creature, terms) {
  const name = creature.name.toLowerCase();
  const no = creature.no.toLowerCase();
  const eggSpecies = creature.eggSpecies.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (name === term || no === term) total += 0;
    else if (name.startsWith(term)) total += 1;
    else if (name.includes(term)) total += 2;
    else if (eggSpecies.startsWith(term)) total += 3;
    else if (creature.search.includes(term)) total += 4;
    else if (isSubsequence(term, creature.search)) total += 7;
    else return Infinity;
  }
  return total;
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const char of haystack) if (char === needle[index]) index += 1;
  return index === needle.length;
}

function field(label, control, full = false, required = false) {
  return `<label class="${full ? "full" : ""}"><span>${label}${required ? '<b class="required-mark">必填</b>' : ""}</span>${control}</label>`;
}

function submitEditor(event) {
  if (event.submitter?.value === "cancel") { state.editor = null; return; }
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  const editor = state.editor;
  if (!editor) return;

  if (editor.type === "parent") {
    const creature = selectedCreature(data);
    if (!creature) return showToast("请从搜索结果中选择精灵");
    upsert("parents", editor.id, {
      creatureKey: creature.key, sex: data.sex, nickname: clean(data.nickname),
      nature: clean(data.nature), size: data.size,
      height: optionalValue(data.height), weight: optionalValue(data.weight)
    });
  }

  if (editor.type === "nest") {
    const male = parentById(data.maleId), female = parentById(data.femaleId);
    if (!sharedGroups(creatureOf(male), creatureOf(female)).length) return showToast("这对父母本没有共同蛋组");
    upsert("nests", editor.id, {
      name: clean(data.name), maleId: data.maleId, femaleId: data.femaleId,
      size: data.size, status: data.status, target: clean(data.target),
      note: clean(data.note), produced: state.db.nests.find((item) => item.id === editor.id)?.produced || 0
    });
  }

  if (editor.type === "egg") {
    const creature = selectedCreature(data);
    if (!creature) return showToast("请从搜索结果中选择精灵");
    upsert("eggs", editor.id, {
      creatureKey: creature.key, size: data.size,
      eggHeight: optionalValue(data.eggHeight), eggWeight: optionalValue(data.eggWeight),
      motherNature: clean(data.motherNature), fatherNature: clean(data.fatherNature),
      laidAt: clean(data.laidAt)
    });
  }

  $("#editorDialog").close();
  state.editor = null;
  saveDb();
  renderAll();
  showToast("已保存");
}

function upsert(collection, id, values) {
  const index = state.db[collection].findIndex((item) => item.id === id);
  const record = { id: id || uid(), ...values };
  if (index >= 0) state.db[collection][index] = record;
  else state.db[collection].push(record);
}

function addDemand(event) {
  event.preventDefault();
  const creature = findCreature($("#demandCreature").value);
  state.db.demands.push({
    id: uid(),
    creature: creature?.eggSpecies || creature?.name || clean($("#demandCreature").value),
    nature: clean($("#demandNature").value),
    size: $("#demandSize").value,
    note: clean($("#demandNote").value),
    threeV: $("#demand3v").checked,
    extreme: $("#demandExtreme").checked
  });
  event.currentTarget.reset();
  saveDb(); renderAll(); showToast("已加入需求墙");
}

function deleteRecord(collection, id) {
  state.db[collection] = state.db[collection].filter((item) => item.id !== id);
  if (collection === "parents") {
    state.db.nests = state.db.nests.filter((nest) => nest.maleId !== id && nest.femaleId !== id);
  }
  saveDb(); renderAll(); showToast("已删除");
}

function layEgg(nestId) {
  const nest = state.db.nests.find((item) => item.id === nestId);
  const female = parentById(nest?.femaleId);
  const creature = creatureOf(female);
  if (!nest || !creature) return;
  nest.produced = Number(nest.produced || 0) + 1;
  saveDb();
  renderAll();
  openEggEditor(null, { creatureKey: creature.key, nature: female.nature, size: nest.size, quantity: 1, note: `来自蛋窝：${nest.name || creature.eggSpecies}` });
}

function openDetail(key) {
  const creature = state.byKey.get(key);
  if (!creature) return;
  $("#detailTitle").textContent = creature.name;
  $("#detailContent").innerHTML = `
    <div class="detail-body">
      <div class="detail-summary">
        <div class="pet-avatar">${esc(creature.name.slice(0, 1))}</div>
        <div><h3>${esc(creature.name)}</h3><p>${esc(creature.no)} · ${esc(creature.stage)} · 蛋种 ${esc(creature.eggSpecies)}</p><div class="tag-row">${creature.groups.map((group) => `<span class="tag tone-tag" style="${toneStyle(group, "group")}">${esc(group)}</span>`).join("")}${[creature.primary, creature.secondary].filter(Boolean).map((item) => `<span class="tag teal">${esc(item)}</span>`).join("")}</div></div>
      </div>
      <div class="detail-stats">
        <div class="data-cell">精灵身高<strong>${range(creature.minHeight, creature.maxHeight, "m")}</strong></div>
        <div class="data-cell">精灵体重<strong>${range(creature.minWeight, creature.maxWeight, "kg")}</strong></div>
        <div class="data-cell">蛋高<strong>${range(creature.eggMinHeight, creature.eggMaxHeight, "m")}</strong></div>
        <div class="data-cell">蛋重<strong>${range(creature.eggMinWeight, creature.eggMaxWeight, "kg")}</strong></div>
      </div>
      ${creature.detail?.desc ? `<p style="margin-top:16px;color:var(--muted);font-size:12px;line-height:1.7">${esc(creature.detail.desc)}</p>` : ""}
    </div>`;
  $("#detailDialog").showModal();
}

function exportDb() {
  const archives = Object.fromEntries(state.accounts.map((account) => {
    try {
      const stored = JSON.parse(localStorage.getItem(accountDbKey(account.id)) || "null");
      return [account.id, sanitizeDb(account.id === state.currentAccountId ? state.db : stored || {})];
    } catch {
      return [account.id, sanitizeDb({})];
    }
  }));
  const backup = {
    format: "roco-breeding-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: state.accounts,
    currentId: state.currentAccountId,
    archives
  };
  const json = JSON.stringify(backup, null, 2);
  const link = $("#exportDownloadLink");
  link.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  link.download = `roco-breeding-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const parentCount = Object.values(archives).reduce((sum, archive) => sum + archive.parents.length, 0);
  const eggCount = Object.values(archives).reduce((sum, archive) => sum + archive.eggs.length, 0);
  $("#exportSummary").textContent = `${state.accounts.length} 个账号 · ${parentCount} 只父母本 · ${eggCount} 枚精灵蛋`;
  $("#exportDialog").showModal();
}

function importDb(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      if (imported?.format === "roco-breeding-archive" && Array.isArray(imported.accounts) && imported.archives) {
        const accounts = imported.accounts
          .map((account) => ({
            id: normalizeAccountId(account.id),
            nickname: clean(account.nickname),
            guid: normalizeGameId(account.guid)
          }))
          .filter((account) => account.nickname && isValidAccountId(account.id) && (!account.guid || isValidGameId(account.guid)))
          .filter((account, index, list) => list.findIndex((item) => item.id === account.id || (account.guid && item.guid === account.guid)) === index);
        if (!accounts.length) throw new Error("备份中没有有效账号");
        accounts.forEach((account) => {
          localStorage.setItem(accountDbKey(account.id), JSON.stringify(sanitizeDb(imported.archives[account.id] || {})));
        });
        state.accounts = accounts;
        state.currentAccountId = accounts.some((account) => account.id === normalizeAccountId(imported.currentId))
          ? normalizeAccountId(imported.currentId)
          : accounts[0].id;
        saveAccountRegistry();
        state.db = loadDb();
        renderAll();
        showToast(`已恢复 ${accounts.length} 个账号`);
      } else {
        state.db = sanitizeDb(imported);
        saveDb();
        renderAll();
        showToast("旧版档案已导入当前账号");
      }
    } catch { showToast("导入文件格式错误"); }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function parentBySex(sex) { return state.db.parents.filter((item) => item.sex === sex); }
function parentById(id) { return state.db.parents.find((item) => item.id === id); }
function creatureOf(record) { return record ? state.byKey.get(record.creatureKey) : null; }
function parentLabel(parent) { return parent ? parent.nickname || creatureOf(parent)?.name || "未知" : "未选择"; }
function creatureInputValue(creature) { return creature ? `${creature.no} ${creature.name}` : ""; }
function creatureImageUrl(creature) {
  const fallbackPath = creature?.no && creature?.name ? `a/i/${creature.no}_${creature.name}.png` : "";
  const path = (clean(creature?.atlas?.img) || fallbackPath).replace(/^\/+/, "");
  return path ? PET_IMAGE_BASE + path.split("/").map(encodeURIComponent).join("/") : "";
}
function eggImageUrl(creature) {
  if (!creature) return "";
  const key = normalizeEggImageName(creature.eggSpecies || creature.name);
  return state.eggImages.get(key)
    || state.eggImagesByBase.get(eggImageBaseName(key))
    || creatureImageUrl(creature);
}
function optionalNumber(value) { return value == null || value === "" ? "" : esc(value); }
function optionalValue(value) { return clean(value) === "" ? null : Number(value); }
function measurementControl(type, value, creature) {
  const isHeight = type === "height";
  return `<div class="measurement-control">
    <input name="${type}" type="number" min="0" step="0.01" inputmode="decimal" value="${optionalNumber(value)}" placeholder="${isHeight ? "选填，例如 0.68" : "选填，例如 4.25"}">
    <small data-measurement-range="${type}">${measurementRangeText(creature, type)}</small>
  </div>`;
}
function measurementRangeText(creature, type) {
  if (!creature) return "选择精灵后显示该形态范围";
  const isHeight = type === "height";
  const min = isHeight ? creature.minHeight : creature.minWeight;
  const max = isHeight ? creature.maxHeight : creature.maxWeight;
  return min == null || max == null ? "该形态暂无范围数据" : `该形态范围：${min} - ${max}${isHeight ? "m" : "kg"}`;
}
function eggMeasurementControl(name, value, creature) {
  const type = name === "eggHeight" ? "height" : "weight";
  return `<div class="measurement-control">
    <input name="${name}" type="number" min="0" step="0.01" inputmode="decimal" value="${optionalNumber(value)}" placeholder="选填">
    <small data-egg-measurement-range="${type}">${eggRangeText(creature, type)}</small>
  </div>`;
}
function eggRangeText(creature, type) {
  if (!creature) return "选择精灵后显示蛋尺寸范围";
  const isHeight = type === "height";
  const min = isHeight ? creature.eggMinHeight : creature.eggMinWeight;
  const max = isHeight ? creature.eggMaxHeight : creature.eggMaxWeight;
  return min == null || max == null ? "该蛋种暂无尺寸范围" : `蛋种范围：${min} - ${max}${isHeight ? "m" : "kg"}`;
}
function updateMeasurementRanges(creature) {
  $$("#editorFields [data-measurement-range]").forEach((hint) => {
    hint.textContent = measurementRangeText(creature, hint.dataset.measurementRange);
  });
  $$("#editorFields [data-egg-measurement-range]").forEach((hint) => {
    hint.textContent = eggRangeText(creature, hint.dataset.eggMeasurementRange);
  });
}
function rangePercent(value, min, max) {
  if (value == null || min == null || max == null) return null;
  const numericValue = Number(value), numericMin = Number(min), numericMax = Number(max);
  if (![numericValue, numericMin, numericMax].every(Number.isFinite)) return null;
  if (numericMax === numericMin) return numericValue >= numericMax ? 100 : 0;
  return Math.min(100, Math.max(0, ((numericValue - numericMin) / (numericMax - numericMin)) * 100));
}
function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
function parentFullStatus(parent, creature) {
  if (!parent || !creature) return null;
  const honor = clean(parent.size);
  const isHeavyHonor = honor.includes("大块头") || ["大婉", "大碗", "大粗"].includes(honor);
  const isLightHonor = honor.includes("小不点") || ["小婉", "小粗"].includes(honor);
  if (isHeavyHonor && sameMeasurement(parent.height, creature.maxHeight) && sameMeasurement(parent.weight, creature.maxWeight)) {
    return { label: "满重", type: "heavy" };
  }
  if (isLightHonor && sameMeasurement(parent.height, creature.minHeight) && sameMeasurement(parent.weight, creature.minWeight)) {
    return { label: "满轻", type: "light" };
  }
  return null;
}
function eggFullStatus(egg, creature) {
  if (!egg || !creature) return null;
  const honor = clean(egg.size);
  const isHeavyHonor = honor.includes("大块头") || ["大婉", "大碗", "大粗"].includes(honor);
  const isLightHonor = honor.includes("小不点") || ["小婉", "小粗"].includes(honor);
  if (isHeavyHonor
    && sameMeasurement(egg.eggHeight, creature.eggMaxHeight)
    && sameMeasurement(egg.eggWeight, creature.eggMaxWeight)) {
    return { label: "满重", type: "heavy" };
  }
  if (isLightHonor
    && sameMeasurement(egg.eggHeight, creature.eggMinHeight)
    && sameMeasurement(egg.eggWeight, creature.eggMinWeight)) {
    return { label: "满轻", type: "light" };
  }
  return null;
}
function sameMeasurement(value, target) {
  if (value == null || target == null) return false;
  return Math.abs(Number(value) - Number(target)) < 1e-6;
}
function toneStyle(value, type) {
  const text = clean(value);
  if (!text || text === "无" || text === "未设置性格") return "--tone-h:215;--tone-s:16%";
  const values = type === "honor" ? HONORS : type === "nature" ? NATURES.map((item) => item.name) : allGroups();
  let index = values.indexOf(text);
  if (index < 0) index = [...text].reduce((sum, char) => sum + char.codePointAt(0), 0) % 37;
  const offset = type === "honor" ? 274 : type === "nature" ? 8 : 154;
  const step = type === "honor" ? 43 : type === "nature" ? 47 : 29;
  return `--tone-h:${(offset + index * step) % 360};--tone-s:${type === "group" ? 64 : 58}%`;
}
function natureMeta(name) { return NATURES.find((item) => item.name === name); }
function natureEffect(name) {
  const nature = natureMeta(name);
  if (!nature) return "性格 / 配置";
  return `${nature.increase}▲ · ${nature.decrease}▼`;
}
function natureControl(value = "") {
  const options = [`<option value="">未设置性格</option>`, ...NATURES.map((item) => `<option value="${item.name}" ${selected(value, item.name)}>${item.name} · ${item.increase}▲ / ${item.decrease}▼</option>`)];
  return `<div class="nature-control"><select name="nature">${options.join("")}</select><small class="nature-effect">${esc(value ? natureEffect(value) : "选择后显示属性变化")}</small></div>`;
}
function namedNatureControl(name, value = "") {
  const options = [`<option value="">未设置性格</option>`, ...NATURES.map((item) => `<option value="${item.name}" ${selected(value, item.name)}>${item.name} · ${item.increase}▲ / ${item.decrease}▼</option>`)];
  return `<select name="${name}">${options.join("")}</select>`;
}
function dateTimeInputValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function localDateKey(value) {
  const localValue = dateTimeInputValue(value);
  return localValue ? localValue.slice(0, 10) : "";
}
function creatureSearchControl(creature) {
  return `<div class="creature-combobox">
    <input name="creature" value="${esc(creatureInputValue(creature))}" required autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="输入名称、编号或蛋种搜索">
    <input name="creatureKey" type="hidden" value="${esc(creature?.key || "")}">
    <div class="creature-results" role="listbox" hidden></div>
  </div>`;
}
function selectedCreature(data) {
  return state.byKey.get(clean(data.creatureKey)) || findExactCreature(data.creature);
}
function findExactCreature(value) {
  const normalized = clean(value).toLowerCase();
  return state.creatures.find((item) => `${item.no} ${item.name}`.toLowerCase() === normalized)
    || state.creatures.find((item) => item.no.toLowerCase() === normalized || item.name.toLowerCase() === normalized || item.eggSpecies.toLowerCase() === normalized);
}
function sharedGroups(a, b) { return a && b ? a.groups.filter((group) => b.groups.includes(group)) : []; }
function compatiblePairs() {
  const result = [];
  parentBySex("male").forEach((male) => parentBySex("female").forEach((female) => {
    const groups = sharedGroups(creatureOf(male), creatureOf(female));
    if (groups.length) result.push({ male, female, groups });
  }));
  return result;
}
function allGroups() { return [...new Set(state.creatures.flatMap((item) => item.groups))].sort((a,b) => a.localeCompare(b, "zh-CN")); }
function findCreature(value) {
  const normalized = clean(value).toLowerCase();
  return state.creatures.find((item) => `${item.no} ${item.name}`.toLowerCase() === normalized)
    || state.creatures.find((item) => item.no.toLowerCase() === normalized || item.name.toLowerCase() === normalized || item.eggSpecies.toLowerCase() === normalized)
    || state.creatures.find((item) => item.search.includes(normalized));
}
function selected(value, option) { return value === option ? "selected" : ""; }
function range(min, max, unit) { return min == null || max == null ? "-" : `${min} - ${max}${unit}`; }
function emptyState(title, text) { return `<div class="empty-state"><div><strong>${esc(title)}</strong>${esc(text)}</div></div>`; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char])); }
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 1800);
}
