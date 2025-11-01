// admin.js - Admin dashboard with real-time bookings management (workflow statuses updated)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

// --- firebase config (use your project) ---
const firebaseConfig = {
  apiKey: "AIzaSyAckRXgR-_vShOB5f6VVfN9Ls01Ql9aVnI",
  authDomain: "alsauto-eeef4.firebaseapp.com",
  projectId: "alsauto-eeef4",
  storageBucket: "alsauto-eeef4.appspot.com",
  messagingSenderId: "941750657381",
  appId: "1:941750657381:web:4afd710b817bdb47fb418c",
  measurementId: "G-42ZCLHYR29"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM
const userInfoEl = document.getElementById('userInfo');
const adminsListEl = document.getElementById('adminsList');
const bookingsListEl = document.getElementById('bookingsList');
const bookingsCountEl = document.getElementById('bookingsCount');
const bookingFilter = document.getElementById('bookingFilter');
const signOutBtn = document.getElementById('signOutBtn');

let bookingsUnsub = null;
let currentAdminUid = null;

// Workflow status constants (DB values)
const STATUS = {
  PENDING: 'pending',
  RECEIVED: 'received',
  WORK: 'work_in_progress',
  COMPLETE: 'complete_repair'
};

// helpers
function renderEmpty(container, text) {
  container.innerHTML = `<div class="empty">${text}</div>`;
}
function formatDate(ts) {
  if (!ts) return '';
  try {
    if (ts.toDate) return ts.toDate().toLocaleString();
    return new Date(ts).toLocaleString();
  } catch (e) { return String(ts); }
}
function statusBadge(status){
  const map = {
    [STATUS.PENDING]: '<span class="badge pending">Pending</span>',
    [STATUS.RECEIVED]: '<span class="badge received">Received</span>',
    [STATUS.WORK]: '<span class="badge work">Work in progress</span>',
    [STATUS.COMPLETE]: '<span class="badge complete">Complete waiting for collection</span>'
  };
  return map[status] || `<span class="badge">${status}</span>`;
}

// Render admins list
async function loadAdmins(){
  try{
    adminsListEl.innerHTML = '<div class="empty">Loading admins <span class="small-spinner"></span></div>';
    const snap = await getDocs(collection(db, 'admins'));
    if (snap.empty) { renderEmpty(adminsListEl, 'No admins found.'); return; }
    adminsListEl.innerHTML = '';
    snap.forEach(d=>{
      const data = d.data();
      const row = document.createElement('div');
      row.className = 'admin-item';
      row.innerHTML = `<div>
          <div style="font-weight:600;color:#0f172a">${data.email || d.id}</div>
          <div class="admin-meta">UID: ${d.id}</div>
        </div>
        <div style="text-align:right">
          <div class="admin-meta">${data.role || 'admin'}</div>
          <div class="muted">${data.createdAt ? formatDate(data.createdAt) : ''}</div>
        </div>`;
      adminsListEl.appendChild(row);
    });
  } catch (err) {
    console.error('loadAdmins:', err);
    renderEmpty(adminsListEl, 'Failed to load admins.');
  }
}

// Bookings list (real-time)
function listenBookings(){
  if (bookingsUnsub) bookingsUnsub();
  const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
  bookingsUnsub = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(docSnap => {
      items.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderBookings(items);
  }, (err) => {
    console.error('bookings snapshot error', err);
    renderEmpty(bookingsListEl, 'Failed to listen for bookings.');
  });
}

function renderBookings(items){
  const filter = bookingFilter?.value || STATUS.PENDING;
  const filtered = items.filter(it => filter === 'all' ? true : (it.status === filter));
  bookingsListEl.innerHTML = '';
  bookingsCountEl.textContent = `${filtered.length} shown (${items.length} total)`;

  if (filtered.length === 0) {
    renderEmpty(bookingsListEl, 'No bookings matching that filter.');
    return;
  }

  for (const b of filtered){
    const el = document.createElement('div');
    el.className = 'admin-item booking-item';
    el.innerHTML = `
      <div style="flex:1">
        <div style="display:flex; gap:12px; align-items:center;">
          <div style="min-width:200px">
            <div style="font-weight:700;color:#0f172a">${b.userName || b.userEmail || b.userId}</div>
            <div class="admin-meta">Email: ${b.userEmail || '—'}</div>
            <div class="admin-meta">Phone: ${b.userPhone || '—'}</div>
          </div>
          <div style="min-width:180px">
            <div><strong>Service:</strong> ${b.serviceType}${b.otherService ? ` — ${b.otherService}` : ''}</div>
            <div><strong>Date:</strong> ${b.preferredDateString || formatDate(b.preferredDate)}</div>
            <div><strong>Vehicle:</strong> ${b.vehicleMake || ''} ${b.vehicleModel || ''}</div>
            <div class="admin-meta">Mileage: ${b.mileage ?? '—'}</div>
          </div>
        </div>
      </div>

      <div style="text-align:right; min-width:170px;">
        <div style="margin-bottom:10px">${statusBadge(b.status)}</div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          ${b.status === STATUS.PENDING ? `<button class="btn action-receive" data-id="${b.id}">Mark Received</button>` : ''}
          ${b.status === STATUS.RECEIVED ? `<button class="btn action-start" data-id="${b.id}">Start Work</button>` : ''}
          ${b.status === STATUS.WORK ? `<button class="btn action-complete" data-id="${b.id}">Mark Complete Repair</button>` : ''}
          <button class="btn action-view" data-id="${b.id}">View Doc</button>
        </div>
        <div class="muted" style="margin-top:8px">ID: ${b.id}</div>
      </div>
    `;
    bookingsListEl.appendChild(el);
  }

  // attach actions
  Array.from(bookingsListEl.querySelectorAll('.action-receive')).forEach(btn=>{
    btn.addEventListener('click', () => handleUpdateStatus(btn.dataset.id, STATUS.RECEIVED, btn));
  });
  Array.from(bookingsListEl.querySelectorAll('.action-start')).forEach(btn=>{
    btn.addEventListener('click', () => handleUpdateStatus(btn.dataset.id, STATUS.WORK, btn));
  });
  Array.from(bookingsListEl.querySelectorAll('.action-complete')).forEach(btn=>{
    btn.addEventListener('click', () => handleUpdateStatus(btn.dataset.id, STATUS.COMPLETE, btn));
  });
  Array.from(bookingsListEl.querySelectorAll('.action-view')).forEach(btn=>{
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const docJson = items.find(x=>x.id===id);
      const w = window.open('', '_blank');
      w.document.body.style.fontFamily = 'system-ui, Inter, Arial';
      w.document.title = `Booking ${id}`;
      w.document.body.innerHTML = `<pre style="white-space:pre-wrap">${JSON.stringify(docJson, null, 2)}</pre>`;
    });
  });
}

async function handleUpdateStatus(bookingId, newStatus, btn){
  if (!bookingId) return;
  const labelMap = {
    [STATUS.RECEIVED]: 'received',
    [STATUS.WORK]: 'work in progress',
    [STATUS.COMPLETE]: 'complete repair'
  };
  const pretty = labelMap[newStatus] || newStatus;
  const ok = window.confirm(`Mark booking ${bookingId} as "${pretty}"?`);
  if (!ok) return;
  try {
    btn.disabled = true;
    btn.textContent = pretty.includes('work') ? 'Updating...' : `Updating...`;
    const docRef = doc(db, 'bookings', bookingId);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: serverTimestamp(),
      handledBy: auth.currentUser ? auth.currentUser.uid : null
    });
  } catch (err) {
    console.error('Failed to update status', err);
    alert('Failed to update booking status.');
  } finally {
    // UI is updated by snapshot
  }
}

// Auth + admin check
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }
  currentAdminUid = user.uid;
  userInfoEl.textContent = user.displayName || user.email || user.uid;

  try {
    const adminDocRef = doc(db, 'admins', user.uid);
    const adminSnap = await getDoc(adminDocRef);
    if (!adminSnap.exists()) {
      await signOut(auth);
      window.location.replace('dashboard.html');
      return;
    }

    // load admin list and start bookings listener
    loadAdmins();
    listenBookings();

  } catch (err) {
    console.error('admin auth check failed', err);
    await signOut(auth);
    window.location.replace('login.html');
  }
});

// sign out
if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    try { await signOut(auth); } catch(e){ console.warn(e); }
    window.location.replace('login.html');
  });
}

// filter control
if (bookingFilter) {
  bookingFilter.addEventListener('change', () => {
    listenBookings();
  });
}
