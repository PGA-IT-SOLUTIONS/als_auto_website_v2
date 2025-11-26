// quote.js — navigation, UI helpers, and Firebase-backed form submission (compat SDK)

/* =======================
   NAV / INTERACTIONS
   ======================= */
const hamburger = document.getElementById('hamburger');
const nav = document.getElementById('main-nav');

if (hamburger && nav) {
  function openNav() {
    hamburger.classList.add('open');
    nav.classList.add('show');
    hamburger.setAttribute('aria-expanded','true');
    nav.setAttribute('aria-hidden','false');
    document.addEventListener('click', outsideClick);
    document.addEventListener('keydown', onKey);
  }
  function closeNav() {
    hamburger.classList.remove('open');
    nav.classList.remove('show');
    hamburger.setAttribute('aria-expanded','false');
    nav.setAttribute('aria-hidden','true');
    document.removeEventListener('click', outsideClick);
    document.removeEventListener('keydown', onKey);
  }
  function toggleNav(e){
    e.stopPropagation();
    const expanded = hamburger.getAttribute('aria-expanded') === 'true';
    if (expanded) closeNav(); else openNav();
  }
  function outsideClick(e){
    if (!nav.contains(e.target) && e.target !== hamburger) closeNav();
  }
  function onKey(e){
    if (e.key === 'Escape') closeNav();
  }

  hamburger.addEventListener('click', toggleNav);

  // ensure nav links close the menu when clicked (mobile)
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    if (nav.classList.contains('show')) closeNav();
  }));
}

/* =====================================
   IntersectionObserver reveal for .two-col
   ===================================== */
(function () {
  const nodes = document.querySelectorAll('.two-col');
  if (!nodes.length) return;

  if (!('IntersectionObserver' in window)) {
    nodes.forEach(n => n.classList.add('in-view'));
    return;
  }

  const obs = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

  nodes.forEach(n => obs.observe(n));
})();

/* =======================
   Loader helpers
   ======================= */
function createLoader() {
  let overlay = document.getElementById('global-loader-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'global-loader-overlay';
    overlay.innerHTML = `
      <div>
        <div class="loader" aria-hidden="true"></div>
        <div class="loader-text" style="color:#fff;text-align:center;margin-top:8px">Sending…</div>
      </div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}
function showLoader() { createLoader().classList.add('active'); }
function hideLoader() { const o = document.getElementById('global-loader-overlay'); if (o) o.classList.remove('active'); }

/* =======================
   FIREBASE: dynamic load (compat) and init
   - Uses compat scripts so no change to HTML is required
   - Add your firebaseConfig below
   ======================= */
const firebaseConfig = {
  apiKey: "AIzaSyAckRXgR-_vShOB5f6VVfN9Ls01Ql9aVnI",
  authDomain: "alsauto-eeef4.firebaseapp.com",
  projectId: "alsauto-eeef4",
  storageBucket: "alsauto-eeef4.appspot.com",
  messagingSenderId: "941750657381",
  appId: "1:941750657381:web:4afd710b817bdb47fb418c",
  measurementId: "G-42ZCLHYR29"
};

function loadFirebaseCompat() {
  return new Promise((resolve, reject) => {
    if (window.firebase && window.firebase.firestore) return resolve(window.firebase);

    // load app-compat first
    const base = 'https://www.gstatic.com/firebasejs/9.22.2/';
    const urls = [base + 'firebase-app-compat.js', base + 'firebase-firestore-compat.js'];

    let loaded = 0;
    urls.forEach(url => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => {
        loaded += 1;
        if (loaded === urls.length) {
          try {
            // initialize only if not already initialized
            if (!window.firebase.apps || !window.firebase.apps.length) {
              window.firebase.initializeApp(firebaseConfig);
            }
            resolve(window.firebase);
          } catch (err) {
            reject(err);
          }
        }
      };
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    });
  });
}

/* =======================
   FORM SUBMIT: collect + validate + save to Firestore
   ======================= */
const form = document.getElementById('quote-form');
if (form) {
  const submitBtn = form.querySelector('button[type="submit"]');

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }
    showLoader();

    try {
      // collect fields
      const name = (document.getElementById('q-name')?.value || '').trim();
      const surname = (document.getElementById('q-surname')?.value || '').trim();
      const make = (document.getElementById('q-make')?.value || '').trim();
      const model = (document.getElementById('q-model')?.value || '').trim();
      const serviceType = (document.getElementById('service-type')?.value || '').trim();
      const email = (document.getElementById('q-email')?.value || '').trim();

      // if "other" is selected there may be an other-service input
      const otherEl = document.getElementById('other-service');
      const otherService = (serviceType === 'other' && otherEl) ? (otherEl.value || '').trim() : null;

      // basic validation
      if (!name) throw new Error('Please enter your first name.');
      if (!surname) throw new Error('Please enter your surname.');
      if (!make) throw new Error('Please enter the vehicle make.');
      if (!model) throw new Error('Please enter the vehicle model.');
      if (!serviceType) throw new Error('Please select a service type.');
      if (serviceType === 'other' && !otherService) throw new Error('Please describe the specific issue for \"Other\".');
      if (!email) throw new Error('Please enter an email address.');
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(email)) throw new Error('Please enter a valid email address.');

      // prepare payload
      const payload = {
        name,
        surname,
        make,
        model,
        serviceType,
        otherService: otherService || null,
        email,
        userAgent: navigator.userAgent || null,
        // createdAt will be set by server timestamp on write
      };

      // ensure firebase is loaded & initialized
      if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
        // no config provided -> save locally and proceed
        const fakeId = 'local-' + Date.now();
        sessionStorage.setItem('quote:' + fakeId, JSON.stringify({ ...payload, createdAt: new Date().toISOString() }));
        hideLoader();
        window.location.href = `quote-confirmation.html?id=${encodeURIComponent(fakeId)}`;
        return;
      }

      await loadFirebaseCompat();
      const db = firebase.firestore();

      // attach server timestamp and write
      const dataToSave = Object.assign({}, payload, { createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      const docRef = await db.collection('quotes').add(dataToSave);

      // success -> redirect with id
      hideLoader();
      window.location.href = `quote-confirmation.html?id=${encodeURIComponent(docRef.id)}`;

    } catch (err) {
      console.error('Quote submit failed:', err);
      alert(err.message || 'Failed to submit quote. Please try again.');
      hideLoader();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Quote'; }
    }
  }

  form.addEventListener('submit', handleSubmit);
}
