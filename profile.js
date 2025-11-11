
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* Firebase config  */
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

/*  DOM  */
const userNameEl = document.getElementById('user-name');
const userEmailEl = document.getElementById('user-email');
const notifEl = document.getElementById('notification');
const form = document.getElementById('profile-form');
const nameInput = document.getElementById('name');
const surnameInput = document.getElementById('surname');
const emailInput = document.getElementById('email');
const phoneInput = document.getElementById('phone');
const commSelect = document.getElementById('communication');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const avatarEl = document.getElementById('profile-avatar');

let originalData = {};

/*  Loader  */
function showLoader(text = 'Loading...') {
  if (document.getElementById('global-loader-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'global-loader-overlay';
  const wrap = document.createElement('div'); wrap.className = 'loader-wrap';
  const loader = document.createElement('div'); loader.className = 'loader';
  const t = document.createElement('div'); t.className = 'loader-text'; t.textContent = text;
  wrap.appendChild(loader); wrap.appendChild(t); overlay.appendChild(wrap);
  document.body.appendChild(overlay);
}
function hideLoader() {
  const el = document.getElementById('global-loader-overlay'); if (el) el.remove();
}

/*  Notifications  */
function showNotification(message, type = 'info') {
  if (!notifEl) return;
  notifEl.textContent = message;
  notifEl.className = `notification ${type}`;
  notifEl.style.display = 'block';
  const timeout = type === 'error' ? 6000 : 3500;
  setTimeout(() => { if (notifEl) notifEl.style.display = 'none'; }, timeout);
}

/*  Helpers  */
function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function isValidPhoneNumber(phone) {
    if (!phone) return false;
    const cleaned = phone.trim();
    const pattern = /^\d{3}-\d{3}-\d{4}$/;
    return pattern.test(cleaned);
  }
  
/* Load & populate profile  */
async function loadProfile(uid, user) {
  showLoader('Loading profile...');
  try {
    userNameEl.textContent = user.displayName || user.email || 'User';
    userEmailEl.textContent = user.email || '';
    if (emailInput) { emailInput.value = user.email || ''; emailInput.readOnly = true; }

    const userDocRef = doc(db, 'users', uid);
    const snapshot = await getDoc(userDocRef);
    const data = snapshot && snapshot.exists() ? snapshot.data() : {};

    const firstName = data.firstName || data.name || (user.displayName ? user.displayName.split(' ')[0] : '') || '';
    const surname = data.lastName || data.surname || (user.displayName ? user.displayName.split(' ').slice(1).join(' ') : '') || '';

    if (nameInput) nameInput.value = firstName;
    if (surnameInput) surnameInput.value = surname;
    if (phoneInput) phoneInput.value = data.phone || user.phoneNumber || '';
    if (commSelect) commSelect.value = data.communication || data.preferredCommunication || 'email';

    originalData = {
      firstName: nameInput?.value || '',
      surname: surnameInput?.value || '',
      email: emailInput?.value || '',
      phone: phoneInput?.value || '',
      communication: commSelect?.value || 'email'
    };

    // set avatar initials if displayName available
    if (avatarEl) {
      const nameForAvatar = user.displayName || data.name || '';
      if (nameForAvatar) {
        const parts = nameForAvatar.trim().split(' ').filter(Boolean);
        const initials = (parts[0] ? parts[0][0] : '') + (parts[1] ? parts[1][0] : '');
        avatarEl.innerHTML = `<span style="font-weight:700;color:var(--brand)">${escapeHtml(initials.toUpperCase())}</span>`;
      }
    }
  } catch (err) {
    console.error('Failed to load profile', err);
    showNotification('Failed to load profile data.', 'error');
  } finally {
    hideLoader();
  }
}

/*  Save handler  */
form && form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const communication = commSelect ? commSelect.value : 'email';

  if (!isValidPhoneNumber(phone)) {
    showNotification('Please enter a valid phone number (7–15 digits, optional +).', 'error');
    phoneInput.focus();
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  showLoader('Saving...');

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const userDocRef = doc(db, 'users', user.uid);
    await setDoc(userDocRef, {
      phone,
      communication,
      updatedAt: serverTimestamp()
    }, { merge: true });

    originalData.phone = phone;
    originalData.communication = communication;
    showNotification('Phone number updated successfully.', 'success');
  } catch (err) {
    console.error('Failed to save profile', err);
    showNotification('Failed to save phone number. Try again.', 'error');
  } finally {
    hideLoader();
    if (saveBtn) saveBtn.disabled = false;
  }
});

/*  Cancel handler */
cancelBtn && cancelBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (phoneInput) phoneInput.value = originalData.phone || '';
  if (commSelect) commSelect.value = originalData.communication || 'email';
  showNotification('Changes canceled.', 'info');
});

/* Auth guard & init */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }
  loadProfile(user.uid, user);
});

/*  signout contingency  - */
const signOutEl = document.querySelector('[data-signout]');
if (signOutEl) {
  signOutEl.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await signOut(auth); window.location.replace('login.html'); }
    catch (err) { console.error('Sign out failed', err); }
  });
}
