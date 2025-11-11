// signup.js (module) - improved validation, fixed name handling, writes firstName & surname to Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Firebase config (adjust if you have a different bucket)
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

// DOM (guarded)
const form = document.getElementById("signupForm");
const submitBtn = document.getElementById("submitBtn");
const buttonText = document.getElementById("buttonText");
const togglePassword = document.getElementById('togglePassword');
const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const phoneInput = document.getElementById('phone');
const errorBox = document.getElementById('error');

//  Loaders
function showLoader(text = 'Loading') {
  if (document.getElementById('global-loader-overlay')) return; // already visible

  const overlay = document.createElement('div');
  overlay.id = 'global-loader-overlay';

  const wrap = document.createElement('div');
  wrap.className = 'loader-wrap';

  const loader = document.createElement('div');
  loader.className = 'loader'; // uses your CSS

  const t = document.createElement('div');
  t.className = 'loader-text';
  t.textContent = text;

  wrap.appendChild(loader);
  wrap.appendChild(t);
  overlay.appendChild(wrap);
  document.body.appendChild(overlay);
}

function hideLoader() {
  const el = document.getElementById('global-loader-overlay');
  if (el) el.remove();
}


// safe error UI
function showError(msg) {
  if (errorBox) {
    errorBox.textContent = msg;
    errorBox.style.display = msg ? 'block' : 'none';
  } else {
    alert(msg);
  }
}
function clearError() {
  if (errorBox) errorBox.style.display = 'none';
}

// simple validators
function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isPhoneValid(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 7;
}
function isPasswordStrong(pw) {
  if (!pw || pw.length < 6) return false;
  const hasDigit = /\d/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
  return hasDigit && hasSpecial;
}

function setLoading(loading) {
  if (!submitBtn || !buttonText) return;
  submitBtn.disabled = loading;
  buttonText.textContent = loading ? 'Creating account...' : 'Sign Up';
}

// toggle show/hide
if (togglePassword && passwordInput) {
  togglePassword.addEventListener('click', () => {
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
    const i = togglePassword.querySelector('i');
    if (i) {
      i.classList.toggle('fa-eye');
      i.classList.toggle('fa-eye-slash');
    }
    passwordInput.focus();
  });
}

// phone input: format as 3-3-4 (XXX-XXX-XXXX)
if (phoneInput) {
  phoneInput.addEventListener('input', () => {
    const digits = phoneInput.value.replace(/\D/g, '').slice(0, 10);
    let formatted = digits;
    if (digits.length > 6) {
      formatted = `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    } else if (digits.length > 3) {
      formatted = `${digits.slice(0,3)}-${digits.slice(3)}`;
    }
    phoneInput.value = formatted;
  });
}
if (toggleConfirmPassword && confirmPasswordInput) {
  toggleConfirmPassword.addEventListener('click', () => {
    confirmPasswordInput.type = confirmPasswordInput.type === 'password' ? 'text' : 'password';
    const i = toggleConfirmPassword.querySelector('i');
    if (i) {
      i.classList.toggle('fa-eye');
      i.classList.toggle('fa-eye-slash');
    }
    confirmPasswordInput.focus();
  });
}

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const firstName = (document.getElementById("first-name")?.value || '').trim();
    const surname = (document.getElementById("surname")?.value || '').trim();
    const email = (document.getElementById("email")?.value || '').trim().toLowerCase();
    const phone = (document.getElementById("phone")?.value || '').trim();
    const password = (passwordInput?.value || '');
    const confirmPassword = (confirmPasswordInput?.value || '');

    if (!firstName) { showError('Please enter your first name.'); return; }
    if (!surname) { showError('Please enter your surname.'); return; }
    if (!email) { showError('Please enter your email.'); return; }
    if (!isEmailValid(email)) { showError('Please enter a valid email address.'); return; }
    if (!phone) { showError('Please enter your phone number.'); return; }
    if (!isPhoneValid(phone)) { showError('Please enter a valid phone number.'); return; }

    if (!isPasswordStrong(password)) {
      showError('Password must be at least 6 characters and include at least one number and one special character.');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match.');
      return;
    }

    setLoading(true);
    showLoader('Creating account...');

    try {
      // create auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // set displayName from separate firstName & surname
      const displayName = `${firstName} ${surname}`.trim();
      try {
        await updateProfile(user, { displayName });
      } catch (updErr) {
        // non-fatal
        console.warn('updateProfile failed', updErr);
      }

      // write user doc with firstName & surname (clients expect name split)
      try {
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          firstName,
          surname,
          email,
          phone,
          role: 'user',
          createdAt: serverTimestamp()
        });
      } catch (dbErr) {
        console.warn('Failed to write user document:', dbErr);
      }

      // Reset + redirect to confirmation (use displayName & email)
      form.reset();
      window.location.href = `confirmation.html?name=${encodeURIComponent(displayName)}&email=${encodeURIComponent(email)}`;
    } catch (err) {
      console.error('signup error', err);
      let msg = 'Sign up failed. Please try again.';
      if (err?.code) {
        switch (err.code) {
          case 'auth/email-already-in-use': msg = 'This email is already in use. Try logging in.'; break;
          case 'auth/invalid-email': msg = 'Invalid email address.'; break;
          case 'auth/weak-password': msg = 'Weak password. Use at least 6 chars, a number and a special character.'; break;
          case 'auth/network-request-failed': msg = 'Network error. Check your connection.'; break;
        }
      } else if (err?.message) {
        msg = err.message;
      }
      showError(msg);
    } finally {
      setLoading(false);
      hideLoader();
    }
  });
} else {
  console.error('signupForm not found in DOM. Signup script not attached.');
}
