// booking.js - modular Firebase usage, auth protection, form handling, loader
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Use the same firebaseConfig as your other pages
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
const form = document.getElementById('booking-form');
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const phoneInput = document.getElementById('phone');
const preferredInput = document.getElementById('preferred');
const serviceType = document.getElementById('service-type');
const otherWrap = document.getElementById('other-service-wrap') || document.getElementById('other-service-container');
const otherInput = document.getElementById('other-service');
const makeInput = document.getElementById('make');
const modelInput = document.getElementById('model');
const mileageInput = document.getElementById('mileage');

// robust submit button lookup: prefer id, fallback to class
let submitBtn = document.getElementById('submitBtn') || document.querySelector('.submit-btn');
let btnText = document.getElementById('btnText');

// If there is no explicit btnText element, we'll update the button text itself
function setButtonText(txt) {
  if (btnText) {
    btnText.textContent = txt;
  } else if (submitBtn) {
    // keep innerHTML safe (no spinner markup here)
    submitBtn.textContent = txt;
  }
}

// store original button label so we can restore later
const originalButtonLabel = (btnText && btnText.textContent) || (submitBtn && (submitBtn.textContent || submitBtn.innerText)) || 'Submit Booking';

// loader helpers (same overlay markup used by login/signup)
function showLoader(text = 'Processing...') {
  if (document.getElementById('global-loader-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'global-loader-overlay';

  const wrap = document.createElement('div');
  wrap.className = 'loader-wrap';

  const loader = document.createElement('div'); loader.className = 'loader';
  const t = document.createElement('div'); t.className = 'loader-text'; t.textContent = text;

  wrap.appendChild(loader); wrap.appendChild(t); overlay.appendChild(wrap);
  document.body.appendChild(overlay);
}
function hideLoader() {
  const el = document.getElementById('global-loader-overlay'); if (el) el.remove();
}

// format mileage with commas
function formatMileageRaw(val) {
  const digits = (val || '').toString().replace(/\D/g, '');
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString();
}

// simple validation
function isFilled(v) { return typeof v === 'string' ? v.trim().length > 0 : !!v; }

// prefill user info when signed in
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  // prefer users collection fields: firstName + surname OR displayName
  try {
    const udoc = await getDoc(doc(db, 'users', user.uid));
    const udata = udoc.exists() ? udoc.data() : {};
    const displayName = (udata.firstName && udata.surname) ? `${udata.firstName} ${udata.surname}` :
                        (udata.name || user.displayName || user.email || user.uid);
    if (nameInput) nameInput.value = displayName || '';
    if (emailInput) emailInput.value = udata.email || user.email || '';
    if (phoneInput) phoneInput.value = udata.phone || '';
  } catch (err) {
    // still allow page to function but log
    console.error('Failed to prefill user data:', err);
  }
});

// toggle other-service input
if (serviceType && otherWrap && otherInput) {
  serviceType.addEventListener('change', () => {
    if (serviceType.value === 'other') {
      otherWrap.classList.remove('hidden');
      otherInput.required = true;
    } else {
      otherWrap.classList.add('hidden');
      otherInput.required = false;
      otherInput.value = '';
    }
  });
}

// mileage input formatting
if (mileageInput) {
  mileageInput.addEventListener('input', (e) => {
    const formatted = formatMileageRaw(e.target.value);
    e.target.value = formatted;
  });
}

// helper to safely disable/enable submit button
function setSubmitting(isSubmitting) {
  if (submitBtn) submitBtn.disabled = isSubmitting;
  setButtonText(isSubmitting ? 'Processing...' : originalButtonLabel);
}

// submit handler
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setSubmitting(true);
    showLoader('Submitting booking...');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('You must be signed in to make a booking.');

      // gather values
      const preferredRaw = preferredInput ? preferredInput.value : '';
      const serviceVal = serviceType ? serviceType.value : '';
      const otherVal = otherInput ? (otherInput.value.trim() || null) : null;
      const vehicleMake = makeInput ? makeInput.value.trim() : '';
      const vehicleModel = modelInput ? modelInput.value.trim() : '';
      const mileageRaw = mileageInput ? mileageInput.value.replace(/,/g, '').trim() : '';

      // basic validation
      if (!isFilled(preferredRaw) || !isFilled(serviceVal) || (serviceVal === 'other' && !isFilled(otherVal))
          || !isFilled(vehicleMake) || !isFilled(vehicleModel) || !isFilled(mileageRaw)) {
        throw new Error('Please complete all required fields.');
      }

      // convert date
      let preferredDate = null;
      if (preferredRaw) {
        const d = new Date(preferredRaw + 'T00:00:00');
        if (isNaN(d.getTime())) throw new Error('Preferred date is invalid.');
        preferredDate = Timestamp.fromDate(d);
      }

      // get latest user doc for names/phone/email
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};

      const bookingData = {
        userId: user.uid,
        userName: userData.firstName && userData.surname ? `${userData.firstName} ${userData.surname}` : (userData.name || user.displayName || ''),
        userEmail: userData.email || user.email || '',
        userPhone: userData.phone || user.phone || '',
        preferredDate: preferredDate,
        preferredDateString: preferredRaw,
        serviceType: serviceVal,
        otherService: otherVal,
        vehicleMake,
        vehicleModel,
        mileage: Number(mileageRaw),
        status: 'pending',
        createdAt: serverTimestamp()
      };

      // save booking
      const colRef = collection(db, 'bookings');
      const docRef = await addDoc(colRef, bookingData);

      // prepare confirmation payload
      const confirmPayload = {
        id: docRef.id,
        userName: bookingData.userName,
        userEmail: bookingData.userEmail,
        userPhone: bookingData.userPhone,
        preferredDate: bookingData.preferredDateString,
        serviceType: bookingData.serviceType,
        otherService: bookingData.otherService,
        vehicleMake: bookingData.vehicleMake,
        vehicleModel: bookingData.vehicleModel,
        mileage: bookingData.mileage,
        createdAt: new Date().toISOString()
      };

      sessionStorage.setItem('bookingConfirmation', JSON.stringify(confirmPayload));
      // redirect to confirmation page
      window.location.href = 'booking-confirmation.html';

    } catch (err) {
      alert(err.message || 'Failed to submit booking.');
      console.error('Booking save error', err);
    } finally {
      hideLoader();
      setSubmitting(false);
    }
  });
} else {
  console.warn('booking-form not found; booking script not attached.');
}
