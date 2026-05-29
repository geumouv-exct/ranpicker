import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, setDoc, updateDoc, writeBatch, query, orderBy, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, accessConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const workspaceId = accessConfig.workspaceId || "company";
const employeeCollectionRef = () => collection(db, "workspaces", workspaceId, "employees");
const employeeDocRef = (id) => doc(db, "workspaces", workspaceId, "employees", id);
const projectCollectionRef = () => collection(db, "workspaces", workspaceId, "projects");
const projectDocRef = (id) => doc(db, "workspaces", workspaceId, "projects", id);

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  canEdit: false,
  employees: [],
  pendingResult: null,
  projects: [],
  unsubEmployees: null,
  unsubProjects: null,
  isSavingResult: false,
  employeesLoaded: false,
  initialXlsxValid: false,
  initialParsedEmployees: [],
  legacyMigrationTried: false
};

const els = {
  loginBtn: $("loginBtn"), heroLoginBtn: $("heroLoginBtn"), guestLoginBtn: $("guestLoginBtn"), heroGuestLoginBtn: $("heroGuestLoginBtn"), logoutBtn: $("logoutBtn"), userInfo: $("userInfo"), lockedView: $("lockedView"), appView: $("appView"),
  readonlyNotice: $("readonlyNotice"), onboardingModal: $("onboardingModal"), initialCsvInput: $("initialCsvInput"), initialImportBtn: $("initialImportBtn"),
  csvInput: $("csvInput"), poolBody: $("poolBody"), randomForm: $("randomForm"), resultBody: $("resultBody"), resultMeta: $("resultMeta"), saveResultBtn: $("saveResultBtn"), replaceUnavailableBtn: $("replaceUnavailableBtn"),
  editModal: $("editModal"), editForm: $("editForm"), cancelEditBtn: $("cancelEditBtn"), projectList: $("projectList"), historyBody: $("historyBody"), historyMeta: $("historyMeta"), toast: $("toast")
};

function toast(message){ els.toast.textContent = message; els.toast.classList.remove("hidden"); setTimeout(()=>els.toast.classList.add("hidden"), 2600); }
function escapeHtml(v=""){ return String(v).replace(/[&<>'"]/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[s])); }
function today(){ return new Date().toISOString().slice(0,10); }
function isPositiveInt(value){ return Number.isInteger(Number(value)) && Number(value) > 0; }
function emailAllowed(email){
  const normalized = (email || "").toLowerCase();
  const companyGmail = (accessConfig.companyGmail || "").toLowerCase();
  const admins = (accessConfig.adminEmails || []).map(v => v.toLowerCase());
  if(companyGmail) return normalized === companyGmail;
  if(admins.length) return admins.includes(normalized);
  return false;
}
function setReadonly(disabled){
  const writeControlIds = [
    "initialCsvInput", "initialImportBtn", "csvInput",
    "projectName", "evaluationDate", "pickCount", "excludeDays", "drawBtn", "saveResultBtn",
    "editName", "editDept", "editTitle", "editPhone", "editEmail", "editActive",
    "editParticipationCount", "editLastParticipationDate"
  ];
  writeControlIds.forEach(id => {
    const el = $(id);
    if(!el) return;
    if(disabled) el.setAttribute("disabled", "disabled"); else el.removeAttribute("disabled");
  });
  document.querySelectorAll("[data-edit], .file-label").forEach(el => {
    if(disabled) el.setAttribute("disabled", "disabled"); else el.removeAttribute("disabled");
  });
  els.readonlyNotice.classList.toggle("hidden", !disabled);
}

function cacheEmployees(){
  try { localStorage.setItem(`ranpicker_employees_cache_${workspaceId}`, JSON.stringify(state.employees || [])); } catch (_) {}
}

function readCachedEmployees(){
  try {
    const raw = localStorage.getItem(`ranpicker_employees_cache_${workspaceId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function cacheProjects(){
  try { localStorage.setItem(`ranpicker_projects_cache_${workspaceId}`, JSON.stringify(state.projects || [])); } catch (_) {}
}

function readCachedProjects(){
  try {
    const raw = localStorage.getItem(`ranpicker_projects_cache_${workspaceId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}


async function tryMigrateLegacyRootData(){
  state.legacyMigrationTried = true;
  try {
    const [legacyEmployees, legacyProjects] = await Promise.all([
      getDocs(query(collection(db, "employees"), orderBy("name"))).catch(() => null),
      getDocs(collection(db, "projects")).catch(() => null)
    ]);
    const hasEmployees = legacyEmployees && !legacyEmployees.empty;
    const hasProjects = legacyProjects && !legacyProjects.empty;
    if(!hasEmployees && !hasProjects) return;

    const batch = writeBatch(db);
    legacyEmployees?.docs.forEach(d => batch.set(employeeDocRef(d.id), d.data(), { merge: true }));
    legacyProjects?.docs.forEach(d => batch.set(projectDocRef(d.id), d.data(), { merge: true }));
    await batch.commit();
    toast("이전 버전의 저장 데이터를 새 영구 저장소로 옮겼습니다.");
  } catch (error) {
    console.warn("이전 데이터 이전 실패", error);
  }
}

function stopRealtimeSync(){
  if(typeof state.unsubEmployees === "function") state.unsubEmployees();
  if(typeof state.unsubProjects === "function") state.unsubProjects();
  state.unsubEmployees = null;
  state.unsubProjects = null;
}

function startRealtimeSync(){
  stopRealtimeSync();

  state.unsubEmployees = onSnapshot(
    query(employeeCollectionRef(), orderBy("name")),
    (snap) => {
      state.employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if(state.employees.length) cacheEmployees();
      renderPool();
      setReadonly(!state.canEdit);
      state.employeesLoaded = true;
      if(state.canEdit && state.employees.length === 0 && !state.legacyMigrationTried){
        tryMigrateLegacyRootData();
      }
      handleOnboardingVisibility();
    },
    (error) => {
      console.error("employees 실시간 동기화 오류", error);
      const cached = readCachedEmployees();
      if(cached.length){
        state.employees = cached;
        renderPool();
        toast("Firestore에서 Pool을 불러오지 못해 이 브라우저의 백업 데이터를 표시했습니다.");
      } else {
        toast("Pool 데이터를 불러오지 못했습니다. Firestore 규칙과 인터넷 연결을 확인해주세요.");
      }
    }
  );

  state.unsubProjects = onSnapshot(
    projectCollectionRef(),
    (snap) => {
      state.projects = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const aTime = timestampToMillis(a.updatedAt) || timestampToMillis(a.updatedAtClient) || timestampToMillis(a.createdAt) || timestampToMillis(a.createdAtClient) || 0;
          const bTime = timestampToMillis(b.updatedAt) || timestampToMillis(b.updatedAtClient) || timestampToMillis(b.createdAt) || timestampToMillis(b.createdAtClient) || 0;
          return bTime - aTime;
        });
      cacheProjects();
      renderProjects();
    },
    (error) => {
      console.error("projects 실시간 동기화 오류", error);
      const cached = readCachedProjects();
      if(cached.length){
        state.projects = cached;
        renderProjects();
        toast("Firestore에서 이력관리를 불러오지 못해 이 브라우저의 백업 이력을 표시했습니다.");
      } else {
        toast("이력관리 데이터를 불러오지 못했습니다. Firestore 규칙을 확인해주세요.");
      }
    }
  );

  refreshFromServerOnce().catch(error => {
    console.warn("서버 직접 불러오기 실패", error);
  });
}

async function refreshFromServerOnce(){
  try {
    await Promise.all([loadEmployees(), loadProjects()]);
    state.employeesLoaded = true;
    handleOnboardingVisibility();
  } catch (error) {
    console.warn("서버 직접 동기화 실패", error);
  }
}

async function login(){ await signInWithPopup(auth, provider); }
async function guestLogin(){ await signInAnonymously(auth); }
els.loginBtn.onclick = login; els.heroLoginBtn.onclick = login;
els.guestLoginBtn.onclick = guestLogin; els.heroGuestLoginBtn.onclick = guestLogin;
els.logoutBtn.onclick = () => signOut(auth);

document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active"); $(btn.dataset.tab).classList.add("active");
}));

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if(!user){
    stopRealtimeSync();
    state.employees = []; state.projects = []; state.pendingResult = null;
    els.lockedView.classList.remove("hidden"); els.appView.classList.add("hidden"); els.userInfo.classList.add("hidden"); els.logoutBtn.classList.add("hidden"); els.loginBtn.classList.remove("hidden"); els.guestLoginBtn.classList.remove("hidden");
    return;
  }
  state.canEdit = emailAllowed(user.email);
  els.lockedView.classList.add("hidden"); els.appView.classList.remove("hidden"); els.logoutBtn.classList.remove("hidden"); els.loginBtn.classList.add("hidden"); els.guestLoginBtn.classList.add("hidden");
  const label = user.isAnonymous ? "게스트 사용자" : (user.displayName || user.email);
  els.userInfo.innerHTML = user.isAnonymous
    ? `<span class="guest-avatar">G</span><span>${escapeHtml(label)}</span>`
    : `<img src="${escapeHtml(user.photoURL || '')}" alt="프로필"/><span>${escapeHtml(label)}</span>`;
  els.userInfo.classList.remove("hidden");
  state.employeesLoaded = false;
  state.initialXlsxValid = false;
  state.initialParsedEmployees = [];
  state.legacyMigrationTried = false;
  setReadonly(!state.canEdit);
  if(state.canEdit && els.onboardingModal && !els.onboardingModal.open){
    els.onboardingModal.showModal();
  }
  startRealtimeSync();
});

async function loadAll(){ await Promise.all([loadEmployees(), loadProjects()]); }
async function loadEmployees(){
  const q = query(employeeCollectionRef(), orderBy("name"));
  const snap = await getDocsFromServer(q).catch(() => getDocs(q));
  state.employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if(state.employees.length) cacheEmployees();
  renderPool();
}
async function loadProjects(selectedProjectId = null){
  const snap = await getDocsFromServer(projectCollectionRef()).catch(() => getDocs(projectCollectionRef()));
  state.projects = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aTime = timestampToMillis(a.updatedAt) || timestampToMillis(a.updatedAtClient) || timestampToMillis(a.createdAt) || timestampToMillis(a.createdAtClient) || 0;
      const bTime = timestampToMillis(b.updatedAt) || timestampToMillis(b.updatedAtClient) || timestampToMillis(b.createdAt) || timestampToMillis(b.createdAtClient) || 0;
      return bTime - aTime;
    });
  cacheProjects();
  renderProjects(selectedProjectId);
}

function timestampToMillis(value){
  if(!value) return 0;
  if(typeof value.toMillis === "function") return value.toMillis();
  if(typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeCell(value){
  return String(value ?? "").trim();
}

function looksLikeEmail(value){
  return /.+@.+\..+/.test(String(value || "").trim());
}

function parseEmployeesFromRows(rows){
  const cleanedRows = rows
    .map(row => row.map(normalizeCell))
    .filter(row => row.some(value => value));

  const first = cleanedRows[0] || [];
  const firstText = first.join(" ").toLowerCase();
  const hasHeader = firstText.includes("이름") || firstText.includes("소속") || firstText.includes("직위") || firstText.includes("이메일") || firstText.includes("name") || firstText.includes("email");
  const dataRows = hasHeader ? cleanedRows.slice(1) : cleanedRows;

  return dataRows.map((r, idx) => {
    const fourth = r[3] || "";
    const fifth = r[4] || "";
    const isFourColumnFormat = looksLikeEmail(fourth) || !fifth;

    return {
      name: r[0] || "",
      department: r[1] || "",
      title: r[2] || "",
      phone: isFourColumnFormat ? "" : fourth,
      email: isFourColumnFormat ? fourth : fifth,
      active: true,
      participationCount: 0,
      lastParticipationDate: "",
      createdAt: Date.now() + idx
    };
  }).filter(e => e.name && e.email);
}

async function parseXlsx(file){
  if(!window.XLSX) throw new Error("XLSX 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.");
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if(!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  return parseEmployeesFromRows(rows);
}

async function importXlsxFromInput(input, { closeOnSuccess = false, requireValidForModal = false } = {}){
  if(!state.canEdit) { toast("회사 메일 사용자만 수정할 수 있습니다."); return false; }
  const file = input.files?.[0];
  if(!file){ toast("XLSX 파일을 선택해주세요."); return false; }
  if(!/\.(xlsx|xls)$/i.test(file.name)){ toast("엑셀 파일(.xlsx 또는 .xls)만 업로드할 수 있습니다."); return false; }

  try {
    const employees = await parseXlsx(file);
    if(employees.length === 0){
      state.initialXlsxValid = false;
      state.initialParsedEmployees = [];
      toast("읽을 수 있는 임직원 데이터가 없습니다. A열 이름, B열 소속, C열 직위, D열 이메일 순서인지 확인해주세요.");
      return false;
    }

    state.initialXlsxValid = true;
    state.initialParsedEmployees = employees;

    const batch = writeBatch(db);
    employees.forEach(emp => {
      const safeId = (emp.email || emp.name).toLowerCase().replace(/[^a-z0-9가-힣_-]/gi, "_").slice(0, 120);
      batch.set(employeeDocRef(safeId), emp, { merge: true });
    });
    await batch.commit();

    // 다른 컴퓨터/휴대폰에서도 보이도록 서버에 실제로 반영됐는지 한 번 더 확인합니다.
    // 서버 확인에 실패하면 팝업을 닫지 않고 사용자에게 Firebase 연결/규칙 오류를 알려줍니다.
    await getDocsFromServer(query(employeeCollectionRef(), orderBy("name")));

    state.employees = employees
      .map(emp => ({ ...emp, id: (emp.email || emp.name).toLowerCase().replace(/[^a-z0-9가-힣_-]/gi, "_").slice(0, 120) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    cacheEmployees();
    renderPool();
    toast(`${employees.length}명의 임직원 정보를 Firebase 서버에 영구 저장했습니다.`);

    if(closeOnSuccess && els.onboardingModal.open) els.onboardingModal.close();
    await loadEmployees().catch(() => {});
    return true;
  } catch (error) {
    console.error(error);
    state.initialXlsxValid = false;
    state.initialParsedEmployees = [];
    toast(error.message || "엑셀 파일을 읽는 중 오류가 발생했습니다.");
    return false;
  }
}

function handleOnboardingVisibility(){
  if(!state.canEdit || !els.onboardingModal) return;
  if(!state.employeesLoaded) return;
  if(state.employees.length > 0){
    if(els.onboardingModal.open) els.onboardingModal.close();
    return;
  }
  if(!els.onboardingModal.open) els.onboardingModal.showModal();
}

els.onboardingModal.addEventListener("cancel", (ev) => {
  if(state.canEdit && state.employees.length === 0){
    ev.preventDefault();
    toast("올바른 XLSX 파일을 저장해야 초기 설정을 완료할 수 있습니다.");
  }
});

els.initialCsvInput.onchange = async () => {
  const file = els.initialCsvInput.files?.[0];
  state.initialXlsxValid = false;
  state.initialParsedEmployees = [];
  if(!file) return;
  if(!/\.(xlsx|xls)$/i.test(file.name)){
    toast("엑셀 파일(.xlsx 또는 .xls)만 선택해주세요.");
    return;
  }
  try{
    const employees = await parseXlsx(file);
    if(!employees.length){
      toast("올바른 임직원 데이터가 없습니다. A열 이름, B열 소속, C열 직위, D열 이메일 순서인지 확인해주세요.");
      return;
    }
    state.initialXlsxValid = true;
    state.initialParsedEmployees = employees;
    toast(`${employees.length}명의 임직원 데이터를 확인했습니다. 초기값 저장을 눌러주세요.`);
  }catch(error){
    console.error(error);
    toast(error.message || "엑셀 파일을 읽는 중 오류가 발생했습니다.");
  }
};

els.initialImportBtn.onclick = async () => {
  if(!state.initialXlsxValid){
    toast("올바른 XLSX 파일을 먼저 선택해주세요.");
    return;
  }
  const ok = await importXlsxFromInput(els.initialCsvInput, { closeOnSuccess: true, requireValidForModal: true });
  if(!ok && !els.onboardingModal.open) els.onboardingModal.showModal();
};
els.csvInput.onchange = async () => { await importXlsxFromInput(els.csvInput); els.csvInput.value = ""; };

function renderPool(){
  if(!state.employees.length){ els.poolBody.innerHTML = `<tr><td colspan="9" class="empty">아직 등록된 임직원이 없습니다.</td></tr>`; return; }
  els.poolBody.innerHTML = state.employees.map(e => `<tr>
    <td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.department)}</td><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.phone)}</td><td>${escapeHtml(e.email)}</td>
    <td><span class="badge ${e.active ? 'on':'off'}">${e.active ? '활성':'제외'}</span></td><td>${Number(e.participationCount || 0)}</td><td>${escapeHtml(e.lastParticipationDate || '-')}</td>
    <td><button class="btn secondary" data-edit="${e.id}">수정</button></td></tr>`).join("");
  document.querySelectorAll("[data-edit]").forEach(btn => btn.onclick = () => openEdit(btn.dataset.edit));
}
function openEdit(id){
  if(!state.canEdit) return toast("회사 메일 사용자만 수정할 수 있습니다.");
  const e = state.employees.find(x => x.id === id); if(!e) return;
  $("editId").value = e.id; $("editName").value = e.name || ""; $("editDept").value = e.department || ""; $("editTitle").value = e.title || ""; $("editPhone").value = e.phone || ""; $("editEmail").value = e.email || ""; $("editActive").checked = !!e.active; $("editParticipationCount").value = Number(e.participationCount || 0); $("editLastParticipationDate").value = e.lastParticipationDate || "";
  els.editModal.showModal();
}
els.cancelEditBtn.onclick = () => els.editModal.close();
els.editForm.onsubmit = async (ev) => {
  ev.preventDefault(); if(!state.canEdit) return toast("회사 메일 사용자만 수정할 수 있습니다.");
  const id = $("editId").value;
  const data = { name: $("editName").value.trim(), department: $("editDept").value.trim(), title: $("editTitle").value.trim(), phone: $("editPhone").value.trim(), email: $("editEmail").value.trim(), active: $("editActive").checked, participationCount: Number($("editParticipationCount").value || 0), lastParticipationDate: $("editLastParticipationDate").value || "" };
  await updateDoc(employeeDocRef(id), data); els.editModal.close(); toast("수정되었습니다."); await loadEmployees();
};

els.randomForm.onsubmit = async (ev) => {
  ev.preventDefault();
  if(!state.canEdit) return toast("회사 메일 사용자만 랜덤설정을 실행하고 저장할 수 있습니다.");
  if(state.isSavingResult) return;

  const projectName = $("projectName").value.trim();
  const evaluationDate = $("evaluationDate").value;
  const pickCount = $("pickCount").value;
  const excludeDays = $("excludeDays").value;
  if(!projectName || !evaluationDate) return toast("사업명과 평가일을 입력해주세요.");
  if(!isPositiveInt(pickCount)) return alert("추출 인원 수는 양수로 입력해야 합니다.");
  if(!isPositiveInt(excludeDays)) return alert("최근참여 제외일수는 양수로 입력해야 합니다.");

  const cutoff = new Date(evaluationDate);
  cutoff.setDate(cutoff.getDate() - Number(excludeDays));
  const eligible = state.employees.filter(e => {
    if(!e.active) return false;
    if(!e.lastParticipationDate) return true;
    return new Date(e.lastParticipationDate) < cutoff;
  });
  if(eligible.length < Number(pickCount)) return alert(`조건 충족 가능인원이 부족합니다. 가능인원: ${eligible.length}명`);

  const previousResult = state.pendingResult;
  const selected = chooseRandomSelection({
    eligible,
    pickCount: Number(pickCount),
    projectName,
    evaluationDate,
    excludeDays: Number(excludeDays),
    previousResult
  });

  state.pendingResult = {
    projectName,
    evaluationDate,
    excludeDays: Number(excludeDays),
    pickCount: Number(pickCount),
    selected,
    eligible,
    eligibleCount: eligible.length,
    // 추가선정 과정에서 사업진행 불가로 체크된 사람은 누적 보관합니다.
    // 같은 랜덤 결과 안에서 여러 번 추가선정을 눌러도 이전에 체크했던 사람은 다시 뽑히지 않습니다.
    excludedFinalDecisionKeys: []
  };
  renderResult(selected, projectName, evaluationDate, eligible.length);
  els.saveResultBtn.classList.remove("hidden");
  els.replaceUnavailableBtn.classList.remove("hidden");

  if(eligible.length === Number(pickCount)){
    toast("조건 충족 가능인원과 추출 인원 수가 같아서 다시 눌러도 같은 목록이 나옵니다.");
  } else {
    toast("새 랜덤 선정이 완료되었습니다. 다시 누르면 조건에 맞춰 다시 뽑습니다.");
  }
};

function employeeRandomKey(employee){
  return String(employee.id || employee.email || employee.name || "");
}

function selectionSignature(selected){
  return selected.map(employeeRandomKey).sort().join("|");
}

function sameRandomCondition(previous, current){
  if(!previous) return false;
  return normalizeProjectKeyPart(previous.projectName) === normalizeProjectKeyPart(current.projectName)
    && String(previous.evaluationDate) === String(current.evaluationDate)
    && Number(previous.pickCount) === Number(current.pickCount)
    && Number(previous.excludeDays) === Number(current.excludeDays);
}

function chooseRandomSelection({ eligible, pickCount, projectName, evaluationDate, excludeDays, previousResult }){
  const shouldAvoidPrevious = sameRandomCondition(previousResult, { projectName, evaluationDate, pickCount, excludeDays })
    && eligible.length > pickCount
    && previousResult.selected?.length === pickCount;

  const previousSignature = shouldAvoidPrevious ? selectionSignature(previousResult.selected) : "";
  let selected = [];

  for(let attempt = 0; attempt < 100; attempt++){
    selected = shuffle([...eligible]).slice(0, pickCount);
    if(!shouldAvoidPrevious || selectionSignature(selected) !== previousSignature){
      return selected;
    }
  }

  // 혹시 매우 작은 Pool에서 100번 모두 같은 조합이 나온 경우,
  // 마지막 한 명을 가능한 다른 사람으로 바꿔서 체감상 반드시 다시 뽑히게 합니다.
  if(shouldAvoidPrevious){
    const previousKeys = new Set(previousResult.selected.map(employeeRandomKey));
    const selectedKeys = new Set(selected.map(employeeRandomKey));
    const replacement = eligible.find(e => !selectedKeys.has(employeeRandomKey(e)));
    if(replacement && selected.length){
      const replaceIndex = selected.findIndex(e => previousKeys.has(employeeRandomKey(e)));
      if(replaceIndex >= 0) selected[replaceIndex] = replacement;
    }
  }
  return selected;
}

function randomIndex(max){
  if(window.crypto?.getRandomValues){
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = randomIndex(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function renderResult(selected, projectName, evaluationDate, eligibleCount){
  els.resultMeta.textContent = `${projectName} · 평가일 ${evaluationDate} · 조건 충족 가능인원 ${eligibleCount}명`;
  els.resultBody.innerHTML = selected.map(e => `<tr>
    <td class="center"><input type="checkbox" class="final-decision-check" data-person="${escapeHtml(employeeRandomKey(e))}" title="사업진행 불가 시 체크" /></td>
    <td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.department)}</td><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.email)}</td><td>${escapeHtml(e.phone)}</td><td>${escapeHtml(e.lastParticipationDate || '-')}</td>
  </tr>`).join("");
}

function getCheckedFinalDecisionKeys(){
  return Array.from(document.querySelectorAll(".final-decision-check:checked"))
    .map(input => input.dataset.person)
    .filter(Boolean);
}

function replaceCheckedUnavailable(){
  if(!state.pendingResult) return toast("먼저 랜덤 선정을 실행해주세요.");

  const checkedKeys = new Set(getCheckedFinalDecisionKeys());
  const replaceCount = checkedKeys.size;
  if(replaceCount === 0) return toast("사업진행이 불가한 사람을 먼저 체크해주세요.");

  const currentSelected = state.pendingResult.selected || [];
  const previouslyExcludedKeys = new Set(state.pendingResult.excludedFinalDecisionKeys || []);

  // 이번에 체크한 사람도 누적 제외 목록에 추가합니다.
  // 따라서 추가선정을 여러 번 진행해도 이전에 체크했던 사람은 다시 선정 후보에 들어가지 않습니다.
  checkedKeys.forEach(key => previouslyExcludedKeys.add(key));

  const keptSelected = currentSelected.filter(e => !checkedKeys.has(employeeRandomKey(e)));

  const keptSelectedKeys = new Set(keptSelected.map(employeeRandomKey));
  const replacementPool = (state.pendingResult.eligible || []).filter(e => {
    const key = employeeRandomKey(e);
    if(previouslyExcludedKeys.has(key)) return false; // 이전/현재 체크자는 제외
    if(keptSelectedKeys.has(key)) return false;      // 현재 최종 후보자는 중복 제외
    return true;
  });

  if(replacementPool.length < replaceCount){
    state.pendingResult.excludedFinalDecisionKeys = Array.from(previouslyExcludedKeys);
    return alert(`추가선정 가능인원이 부족합니다. 필요한 인원: ${replaceCount}명, 가능인원: ${replacementPool.length}명`);
  }

  const additions = shuffle([...replacementPool]).slice(0, replaceCount);
  state.pendingResult.selected = [...keptSelected, ...additions];
  state.pendingResult.excludedFinalDecisionKeys = Array.from(previouslyExcludedKeys);

  renderResult(state.pendingResult.selected, state.pendingResult.projectName, state.pendingResult.evaluationDate, state.pendingResult.eligibleCount);
  els.saveResultBtn.classList.remove("hidden");
  els.replaceUnavailableBtn.classList.remove("hidden");
  toast(`${replaceCount}명을 추가선정했습니다. 이전에 체크한 사람은 다시 선정되지 않습니다.`);
}
function normalizeProjectKeyPart(value){
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function makeProjectHistoryId({ projectName, evaluationDate, excludeDays, pickCount }){
  const key = [
    normalizeProjectKeyPart(projectName),
    normalizeProjectKeyPart(evaluationDate),
    Number(pickCount),
    Number(excludeDays)
  ].join("|");
  let hash = 2166136261;
  for(let i = 0; i < key.length; i++){
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `project_${(hash >>> 0).toString(16)}`;
}

function calculateParticipationStats(projects){
  const stats = new Map();

  (projects || []).forEach(project => {
    const evaluationDate = project.evaluationDate || "";
    (project.selected || []).forEach(person => {
      const keys = [person.employeeId, person.email].filter(Boolean);
      keys.forEach(key => {
        const current = stats.get(key) || { count: 0, lastDate: "" };
        current.count += 1;
        if(evaluationDate && (!current.lastDate || evaluationDate > current.lastDate)){
          current.lastDate = evaluationDate;
        }
        stats.set(key, current);
      });
    });
  });

  return stats;
}

function applyParticipationStatsLocally(projects){
  const stats = calculateParticipationStats(projects);
  state.employees = (state.employees || []).map(employee => {
    const byId = stats.get(employee.id);
    const byEmail = employee.email ? stats.get(employee.email) : null;
    const next = byId || byEmail || { count: 0, lastDate: "" };
    return {
      ...employee,
      participationCount: next.count,
      lastParticipationDate: next.lastDate
    };
  });
  cacheEmployees();
  renderPool();
  return stats;
}

function recomputeEmployeeParticipation(){
  // Firestore가 offline 상태여도 랜덤 버튼이 멈추지 않도록
  // 화면/브라우저 백업을 먼저 갱신하고, 서버 동기화는 백그라운드로만 시도합니다.
  const stats = applyParticipationStatsLocally(state.projects || []);

  try {
    const batch = writeBatch(db);
    state.employees.forEach(employee => {
      if(!employee.id) return;
      batch.set(employeeDocRef(employee.id), {
        participationCount: Number(employee.participationCount || 0),
        lastParticipationDate: employee.lastParticipationDate || ""
      }, { merge: true });
    });
    batch.commit().catch(error => {
      console.warn("참여횟수 Firestore 백그라운드 동기화 실패", error);
    });
  } catch (error) {
    console.warn("참여횟수 Firestore 동기화 준비 실패", error);
  }
}

function upsertProjectLocally(project){
  const idx = state.projects.findIndex(p => p.id === project.id);
  if(idx >= 0) state.projects[idx] = { ...state.projects[idx], ...project };
  else state.projects.unshift(project);
  state.projects.sort((a, b) => {
    const aTime = timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt) || 0;
    const bTime = timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt) || 0;
    return bTime - aTime;
  });
  cacheProjects();
  renderProjects(project.id);
  showProject(project.id);
}

async function saveCurrentResult({ stayOnRandomTab = false } = {}){
  if(!state.pendingResult || !state.canEdit) return;
  if(state.isSavingResult) return;
  state.isSavingResult = true;
  const drawBtn = $("drawBtn");
  if(drawBtn) drawBtn.setAttribute("disabled", "disabled");

  const { projectName, evaluationDate, excludeDays, pickCount, selected } = state.pendingResult;
  const projectId = makeProjectHistoryId({ projectName, evaluationDate, excludeDays, pickCount });
  const nowMillis = Date.now();
  const existedLocally = state.projects.some(p => p.id === projectId);
  const previousProject = state.projects.find(p => p.id === projectId);
  const savedSelected = selected.map(e => ({
    employeeId: e.id,
    name: e.name,
    department: e.department,
    title: e.title,
    phone: e.phone || "",
    email: e.email,
    lastParticipationDate: e.lastParticipationDate || ""
  }));

  const localProjectData = {
    id: projectId,
    projectName,
    evaluationDate,
    excludeDays,
    pickCount,
    selected: savedSelected,
    conditionKey: `${normalizeProjectKeyPart(projectName)}|${evaluationDate}|${pickCount}|${excludeDays}`,
    createdAt: previousProject?.createdAt || nowMillis,
    updatedAt: nowMillis,
    createdBy: previousProject?.createdBy || state.user.email || "guest",
    updatedBy: state.user.email || "guest"
  };

  const nextProjects = (() => {
    const copy = [...(state.projects || [])];
    const idx = copy.findIndex(p => p.id === projectId);
    if(idx >= 0) copy[idx] = { ...copy[idx], ...localProjectData };
    else copy.unshift(localProjectData);
    return copy;
  })();

  try {
    // 휴대폰/다른 컴퓨터에서도 같은 계정으로 바로 보이도록 Firebase 서버 저장을 먼저 완료합니다.
    // 저장 실패 시 로컬 화면에만 저장됐다고 착각하지 않도록 이력관리 반영을 중단합니다.
    const stats = calculateParticipationStats(nextProjects);
    const batch = writeBatch(db);
    batch.set(projectDocRef(projectId), {
      projectName,
      evaluationDate,
      excludeDays,
      pickCount,
      selected: savedSelected,
      conditionKey: localProjectData.conditionKey,
      createdAtClient: localProjectData.createdAt,
      updatedAtClient: nowMillis,
      updatedAt: serverTimestamp(),
      createdBy: localProjectData.createdBy,
      updatedBy: localProjectData.updatedBy
    }, { merge: true });

    state.employees.forEach(employee => {
      if(!employee.id) return;
      const byId = stats.get(employee.id);
      const byEmail = employee.email ? stats.get(employee.email) : null;
      const next = byId || byEmail || { count: 0, lastDate: "" };
      batch.set(employeeDocRef(employee.id), {
        participationCount: Number(next.count || 0),
        lastParticipationDate: next.lastDate || ""
      }, { merge: true });
    });

    await batch.commit();

    // 서버에서 다시 읽어 실제 원격 저장 여부를 확인합니다. 여기서 실패하면 다른 기기 동기화가 보장되지 않습니다.
    const serverSaved = await getDocFromServer(projectDocRef(projectId));
    if(!serverSaved.exists()) throw new Error("Firebase 서버에 이력 문서가 확인되지 않았습니다.");

    state.projects = nextProjects.sort((a, b) => {
      const aTime = timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt) || 0;
      const bTime = timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt) || 0;
      return bTime - aTime;
    });
    cacheProjects();
    applyParticipationStatsLocally(state.projects);
    renderProjects(projectId);
    showProject(projectId);

    state.pendingResult = null;
    els.saveResultBtn.classList.add("hidden");
    els.replaceUnavailableBtn.classList.add("hidden");
    document.querySelector('[data-tab="historyTab"]')?.click();
    toast(existedLocally ? "같은 조건의 이전 이력을 마지막 결과로 서버에 저장했습니다." : "랜덤 결과를 Firebase 서버와 이력관리에 저장했습니다.");
  } catch (error) {
    console.error("서버 저장 실패", error);
    toast("서버 저장에 실패했습니다. Firebase 규칙, 인터넷 연결, 로그인 계정을 확인해주세요. 다른 기기에는 아직 반영되지 않았습니다.");
  } finally {
    state.isSavingResult = false;
    if(drawBtn && state.canEdit) drawBtn.removeAttribute("disabled");
  }
}

els.saveResultBtn.onclick = () => {
  if(!state.pendingResult) return toast("먼저 랜덤 선정을 실행해주세요.");
  saveCurrentResult();
};
els.replaceUnavailableBtn.onclick = replaceCheckedUnavailable;

function renderProjects(selectedProjectId = null){
  if(!selectedProjectId){
    selectedProjectId = document.querySelector(".project-item.active")?.dataset.project || null;
  }
  if(!state.projects.length){
    els.projectList.innerHTML = `<div class="empty">아직 저장된 사업 이력이 없습니다.</div>`;
    els.historyMeta.textContent = "사업을 선택해주세요.";
    els.historyBody.innerHTML = `<tr><td colspan="6" class="empty">표시할 결과가 없습니다.</td></tr>`;
    return;
  }
  els.projectList.innerHTML = state.projects.map(p => `<button class="project-item" data-project="${p.id}"><strong>${escapeHtml(p.projectName)}</strong><small>평가일 ${escapeHtml(p.evaluationDate || '-')} · 추출 ${escapeHtml(p.pickCount || '-')}명 · 제외 ${escapeHtml(p.excludeDays || '-')}일 · ${p.selected?.length || 0}명 선정</small></button>`).join("");
  document.querySelectorAll("[data-project]").forEach(btn => btn.onclick = () => showProject(btn.dataset.project));
  const idToShow = selectedProjectId || state.projects[0]?.id;
  if(idToShow) showProject(idToShow);
}
function showProject(id){
  document.querySelectorAll(".project-item").forEach(b => b.classList.remove("active"));
  document.querySelector(`[data-project="${id}"]`)?.classList.add("active");
  const p = state.projects.find(x => x.id === id); if(!p) return;
  els.historyMeta.textContent = `${p.projectName} · 평가일 ${p.evaluationDate} · 추출 ${p.pickCount}명 · 제외일수 ${p.excludeDays}일`;
  const selected = p.selected || [];
  els.historyBody.innerHTML = selected.length ? selected.map(e => `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.department)}</td><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.email)}</td><td>${escapeHtml(e.phone)}</td><td>${escapeHtml(e.lastParticipationDate || '-')}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">선정 결과가 없습니다.</td></tr>`;
}
