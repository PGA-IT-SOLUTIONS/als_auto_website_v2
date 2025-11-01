// track.js - modular Firebase usage: auth check + booking subscription + UI updates
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Firebase config (alsauto-eeef4 - same across app)
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
const trackForm = document.getElementById('track-form');
const trackingIdInput = document.getElementById('tracking-id');
const trackButton = document.getElementById('track-button');
const resultArea = document.getElementById('result-area');
const notification = document.getElementById('notification');
const clearBtn = document.getElementById('clearBtn');

let unsubSnapshot = null;
let currentUser = null;

// status mapping (DB string keys)
const STATUS = {
  PENDING: 'pending',
  RECEIVED: 'received',
  WORK: 'work_in_progress',
  COMPLETE: 'complete_repair'
};

function showNotification(msg, type = 'info') {
  if (!notification) return;
  notification.textContent = msg;
  notification.className = `notification ${type}`;
  notification.hidden = false;
  setTimeout(() => {
    notification.hidden = true;
  }, 6000);
}

function clearResult() {
  if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }
  if (resultArea) resultArea.innerHTML = '';
}

function buildResultSkeleton() {
  if (!resultArea) return;
  resultArea.innerHTML = `<div class="loading"><div class="spinner" role="status" aria-hidden="true"></div></div>`;
}

function humanStatus(s) {
  switch ((s || '').toLowerCase()) {
    case STATUS.RECEIVED: return { label: 'Vehicle Received', cls: 'status-received', pct: 33, step: 1 };
    case STATUS.WORK: return { label: 'Work in Progress', cls: 'status-progress', pct: 66, step: 2 };
    case STATUS.COMPLETE: return { label: 'Complete Repair', cls: 'status-complete', pct: 100, step: 3 };
    default: return { label: 'Pending', cls: 'status-pending', pct: 0, step: 0 };
  }
}

function renderBooking(docId, data) {
  if (!resultArea) return;
  const s = humanStatus(data?.status);
  const vehicleTitle = `${data?.vehicleMake || 'Unknown'} ${data?.vehicleModel || ''}`.trim();
  resultArea.innerHTML = `
    <div class="result-card" role="region" aria-labelledby="vehicle-title">
      <div class="vehicle-info">
        <div class="vehicle-details">
          <h2 id="vehicle-title">${vehicleTitle}</h2>
          <div class="service-type">${data?.serviceType || 'Service'}</div>
        </div>
        <div class="status-container">
          <div class="status-label">Current Status</div>
          <div class="status-value ${s.cls}">${s.label}</div>
        </div>
      </div>

      <div class="progress-bar" aria-hidden="true">
        <div class="progress-fill" style="width:${s.pct}%;"></div>
      </div>

      <div class="progress-steps" aria-hidden="true">
        <div class="progress-step ${s.step >= 0 ? 'step-active' : ''}">
          <div class="step-icon"><i class="fas fa-clock"></i></div>
          <div class="step-label">Pending</div>
        </div>
        <div class="progress-step ${s.step >= 1 ? 'step-active' : ''}">
          <div class="step-icon"><i class="fas fa-car"></i></div>
          <div class="step-label">Vehicle Received</div>
        </div>
        <div class="progress-step ${s.step >= 2 ? 'step-active' : ''}">
          <div class="step-icon"><i class="fas fa-tools"></i></div>
          <div class="step-label">Work in Progress</div>
        </div>
        <div class="progress-step ${s.step >= 3 ? 'step-active' : ''}">
          <div class="step-icon"><i class="fas fa-check-circle"></i></div>
          <div class="step-label">Complete Repair Awaiting Collection</div>
        </div>
      </div>

      <div style="margin-top:16px;">
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <div><strong>Tracking ID:</strong> <code>${docId}</code></div>
          <div><strong>Preferred date:</strong> ${data?.preferredDateString || '—'}</div>
          <div><strong>Mileage:</strong> ${data?.mileage ?? '—'} km</div>
        </div>
        
      </div>
    </div>
  `;
}

// basic HTML escape for the <pre>
function escapeHtml(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') }

// ----------------------
// Loader overlay helpers (same DOM structure used by login.js)
// ----------------------
function showLoader(text = 'Loading') {
  if (document.getElementById('global-loader-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'global-loader-overlay';

  const loader = document.createElement('div');
  loader.className = 'loader';

  const t = document.createElement('div');
  t.className = 'loader-text';
  t.textContent = text;

  overlay.appendChild(loader);
  overlay.appendChild(t);
  document.body.appendChild(overlay);
}

function hideLoader() {
  const el = document.getElementById('global-loader-overlay');
  if (el) el.remove();
}
// ----------------------

// Fetch booking once, then subscribe for realtime updates
async function inspectBookingOnce(id) {
  clearResult();
  buildResultSkeleton();
  try {
    const ref = doc(db, 'bookings', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      showNotification('No booking found with that tracking ID', 'error');
      clearResult();
      return;
    }
    const data = snap.data();

    // owner or admin check: if booking has userId and it differs, verify admin
    if (data.userId && currentUser && data.userId !== currentUser.uid) {
      try {
        const adminDoc = await getDoc(doc(db, 'admins', currentUser.uid));
        if (!adminDoc.exists()) {
          showNotification('This booking does not belong to your account', 'error');
          clearResult();
          return;
        }
      } catch (e) {
        console.error('admin check failed', e);
        showNotification('Authorization check failed', 'error');
        clearResult();
        return;
      }
    }

    // render once and then subscribe for live update
    renderBooking(id, data);

    // detach previous snapshot
    if (unsubSnapshot) unsubSnapshot();
    unsubSnapshot = onSnapshot(doc(db, 'bookings', id), (s) => {
      if (!s.exists()) {
        showNotification('Booking was removed or not found', 'error');
        clearResult();
        return;
      }
      renderBooking(id, s.data());
    }, (err) => {
      console.error('snapshot error', err);
      showNotification('Realtime subscription failed', 'error');
    });

  } catch (err) {
    console.error('fetch booking error', err);
    showNotification('Error fetching booking details', 'error');
    clearResult();
  }
}

// ----------------------
// Form handling (show overlay while fetching initial booking)
// ----------------------
if (trackForm) {
  trackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (trackingIdInput?.value || '').trim();
    if (!id) { showNotification('Please enter a tracking ID', 'error'); return; }

    // UI state
    if (trackButton) {
      trackButton.disabled = true;
      trackButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Tracking...';
    }

    // show global overlay loader
    showLoader('Tracking...');

    try {
      await inspectBookingOnce(id);
    } finally {
      // hide overlay after initial fetch/subscribe step completes (whether success or error)
      hideLoader();
      if (trackButton) {
        trackButton.disabled = false;
        trackButton.innerHTML = '<i class="fas fa-search"></i> Track Vehicle';
      }
    }
  });
} else {
  console.warn('track-form not found; track script not attached.');
}

// clear button (guarded)
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (trackingIdInput) trackingIdInput.value = '';
    clearResult();
  });
}

// support ?id=DOCID on load (auto-fill & auto-run)
function paramBookingId(){
  try { const u = new URL(location.href); return u.searchParams.get('id'); } catch(e){ return null; }
}

// require auth; if not signed in redirect to login
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    // Redirect to login to enforce rules (firestore rules require auth)
    window.location.replace('login.html');
    return;
  }

  // if ?id query param exists, auto-run
  const paramId = paramBookingId();
  if (paramId) {
    if (trackingIdInput) trackingIdInput.value = paramId;
    // allow brief UI settle before running
    setTimeout(()=> {
      if (trackForm) trackForm.requestSubmit();
    }, 200);
  }
});
