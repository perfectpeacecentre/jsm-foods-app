import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- Editable lists (change these as the business changes) ---------- */
const PRODUCTS = [
  "Dough Master Bread Softener",
  "Select Baker Bread Improver",
  "Calcium Propionate",
  "Milk Flavour",
  "Other",
];
const STATUSES = ["Current", "Prospective", "Former", "Not interested"];
const STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta",
  "Ebonyi","Edo","Ekiti","Enugu","FCT (Abuja)","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina",
  "Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers",
  "Sokoto","Taraba","Yobe","Zamfara",
];

/* ---------- Firebase ---------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// A second app instance, used only to create staff logins so the admin/owner stays signed in.
const secondaryApp = initializeApp(firebaseConfig, "secondary");
const secondaryAuth = getAuth(secondaryApp);

// Firebase Auth needs an email and a password of 6+ characters.
// We hide that: username becomes username@jsmfoods.app, and the PIN is padded.
const toEmail = (username) => `${username.trim().toLowerCase()}@jsmfoods.app`;
const toPassword = (pin) => `jsm-${pin}`;

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isManager = () => me && ["admin", "owner"].includes(me.role);

let me = null;            // { uid, displayName, username, role, active }
let customers = [];       // latest snapshot
let unsubCustomers = null;
let unsubUsers = null;

/* ---------- Fill dropdowns and checkboxes ---------- */
function fillStatic() {
  const stateSel = $("state-select");
  stateSel.innerHTML = `<option value="">Select...</option>` +
    STATES.map((s) => `<option>${esc(s)}</option>`).join("");
  $("f-state").innerHTML += STATES.map((s) => `<option>${esc(s)}</option>`).join("");
  $("f-status").innerHTML += STATUSES.map((s) => `<option>${esc(s)}</option>`).join("");
  $("product-boxes").innerHTML = PRODUCTS.map((p) =>
    `<label><input type="checkbox" name="products" value="${esc(p)}"> ${esc(p)}</label>`).join("");
}
fillStatic();

/* ---------- Login / logout ---------- */
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error");
  err.textContent = "";
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, toEmail($("login-username").value), toPassword($("login-pin").value));
  } catch (ex) {
    err.textContent = ex.code === "auth/too-many-requests"
      ? "Too many attempts. Wait a few minutes and try again."
      : "Wrong username or PIN.";
  } finally {
    btn.disabled = false;
    $("login-pin").value = "";
  }
});

$("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  stopListeners();
  if (!user) {
    me = null;
    $("app-view").hidden = true;
    $("login-view").hidden = false;
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active !== true) {
      await signOut(auth);
      $("login-error").textContent = "This account is not active. Contact the admin.";
      return;
    }
    me = { uid: user.uid, ...snap.data() };
  } catch {
    await signOut(auth);
    $("login-error").textContent = "Could not load your profile. Try again.";
    return;
  }
  $("who").textContent = `${me.displayName} (${me.role})`;
  $("users-tab").hidden = !isManager();
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  showTab("add");
  startCustomers();
  if (isManager()) startUsers();
});

function stopListeners() {
  if (unsubCustomers) { unsubCustomers(); unsubCustomers = null; }
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
  customers = [];
}

/* ---------- Tabs ---------- */
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
}
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------- Add customer ---------- */
$("customer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("customer-msg");
  const fd = new FormData(form);
  const phone = String(fd.get("phone")).replace(/[\s-]/g, "");
  if (!/^(\+234|0)\d{10}$/.test(phone)) {
    msg.textContent = "Enter a valid Nigerian phone number, e.g. 08012345678.";
    return;
  }
  const btn = e.submitter;
  btn.disabled = true;
  msg.textContent = "Saving...";
  try {
    await addDoc(collection(db, "customers"), {
      name: String(fd.get("name")).trim(),
      type: fd.get("type"),
      state: fd.get("state"),
      city: String(fd.get("city")).trim(),
      phone,
      flourBags: Number(fd.get("flourBags")),
      status: fd.get("status"),
      products: fd.getAll("products"),
      createdBy: me.uid,
      createdByName: me.displayName,
      createdAt: serverTimestamp(),
    });
    form.reset();
    msg.textContent = "Saved.";
  } catch {
    msg.textContent = "Could not save. Check your connection and try again.";
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Customer list ---------- */
function startCustomers() {
  const q = query(collection(db, "customers"), orderBy("createdAt", "desc"));
  unsubCustomers = onSnapshot(q, (snap) => {
    customers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCustomers();
  }, () => { $("count").textContent = "Could not load customers."; });
}

["f-search", "f-status", "f-type", "f-state"].forEach((id) =>
  $(id).addEventListener("input", renderCustomers));

function canEdit(c) { return isManager() || c.createdBy === me.uid; }

function renderCustomers() {
  const term = $("f-search").value.trim().toLowerCase();
  const fs = $("f-status").value, ft = $("f-type").value, fst = $("f-state").value;
  const rows = customers.filter((c) =>
    (!fs || c.status === fs) && (!ft || c.type === ft) && (!fst || c.state === fst) &&
    (!term || [c.name, c.city, c.phone].some((v) => String(v ?? "").toLowerCase().includes(term))));
  $("count").textContent = `${rows.length} of ${customers.length} customers`;
  $("customer-rows").innerHTML = rows.map((c) => {
    const statusCell = canEdit(c)
      ? `<select data-status="${esc(c.id)}">${STATUSES.map((s) =>
          `<option${s === c.status ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`
      : esc(c.status);
    const del = isManager() ? `<button class="danger" data-del="${esc(c.id)}">Delete</button>` : "";
    return `<tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.type)}</td>
      <td>${esc(c.city)}, ${esc(c.state)}</td>
      <td><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></td>
      <td>${esc(c.flourBags)}</td>
      <td>${statusCell}</td>
      <td>${esc((c.products || []).join(", "))}</td>
      <td>${esc(c.createdByName)}</td>
      <td>${del}</td>
    </tr>`;
  }).join("");
}

$("customer-rows").addEventListener("change", async (e) => {
  const id = e.target.dataset.status;
  if (!id) return;
  try { await updateDoc(doc(db, "customers", id), { status: e.target.value }); }
  catch { alert("Could not update status."); }
});

$("customer-rows").addEventListener("click", async (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  if (!confirm("Delete this customer record? This cannot be undone.")) return;
  try { await deleteDoc(doc(db, "customers", id)); }
  catch { alert("Could not delete."); }
});

/* ---------- Staff management (admin / owner) ---------- */
function startUsers() {
  unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
    $("user-rows").innerHTML = snap.docs.map((d) => {
      const u = d.data();
      const self = d.id === me.uid;
      return `<tr>
        <td>${esc(u.displayName)}</td>
        <td>${esc(u.username)}</td>
        <td>${esc(u.role)}</td>
        <td><input type="checkbox" data-active="${esc(d.id)}" ${u.active ? "checked" : ""} ${self ? "disabled" : ""}></td>
      </tr>`;
    }).join("");
  });
}

$("user-rows").addEventListener("change", async (e) => {
  const id = e.target.dataset.active;
  if (!id) return;
  try { await updateDoc(doc(db, "users", id), { active: e.target.checked }); }
  catch { alert("Could not update."); e.target.checked = !e.target.checked; }
});

$("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("user-msg");
  const fd = new FormData(form);
  const username = String(fd.get("username")).trim().toLowerCase();
  const pin = String(fd.get("pin"));
  if (!/^\d{4}$/.test(pin)) { msg.textContent = "PIN must be exactly 4 digits."; return; }
  const btn = e.submitter;
  btn.disabled = true;
  msg.textContent = "Creating...";
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, toEmail(username), toPassword(pin));
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: String(fd.get("displayName")).trim(),
      username,
      role: fd.get("role"),
      active: true,
      createdAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    form.reset();
    msg.textContent = `Login created for ${username}.`;
  } catch (ex) {
    msg.textContent = ex.code === "auth/email-already-in-use"
      ? "That username is already taken."
      : "Could not create the login. Try again.";
  } finally {
    btn.disabled = false;
  }
});
