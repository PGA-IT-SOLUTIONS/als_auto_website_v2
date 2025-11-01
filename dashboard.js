// dashboard.js - auth + dashboard interactions
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

// Firebase config (same as your other pages)
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

// DOM Elements (guarded)
const signOutButton = document.getElementById('signOutButton');
const userNameElement = document.getElementById('userName');
const cardBooking = document.getElementById('card-booking');
const cardTrack = document.getElementById('card-track');
const cardInvoice = document.getElementById('card-invoice');
const cardProfile = document.getElementById('card-profile');

// Helper: safe navigation
function go(url) {
  if (!url) return;
  // use href so browser history is preserved for back navigation
  window.location.href = url;
}

// Helper: attach click + keyboard activation to cards
function wireCard(cardEl, url) {
  if (!cardEl) return;
  cardEl.addEventListener('click', () => go(url));
  cardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go(url);
    }
  });
}

// Protect page & show user info
onAuthStateChanged(auth, (user) => {
  if (!user) {
    // not authenticated -> redirect to login
    window.location.replace('login.html');
    return;
  }

  // Show best available user label: displayName, email, then uid
  const label = user.displayName || user.email || user.uid || 'User';
  if (userNameElement) userNameElement.textContent = label;

  // Wire cards (only after auth confirmed)
  wireCard(cardBooking, 'booking.html');
  wireCard(cardTrack, 'track.html');
  wireCard(cardInvoice, 'invoices.html');
  wireCard(cardProfile, 'profile.html');
});

// Sign out handler (safe)
if (signOutButton) {
  signOutButton.addEventListener('click', async () => {
    try {
      await signOut(auth);
      // redirect to login after sign out
      window.location.replace('login.html');
    } catch (err) {
      console.error('Sign out error:', err);
      // Friendly fallback
      alert('Could not sign out. Please try again.');
    }
  });
} else {
  console.warn('Sign out button not found (#signOutButton).');
}

// Defensive warnings for missing buttons/cards (helps during integration)
if (!userNameElement) console.warn('#userName not found — user label will not show.');
if (!cardBooking) console.warn('#card-booking not found — booking navigation disabled.');
if (!cardTrack) console.warn('#card-track not found — track navigation disabled.');
if (!cardInvoice) console.warn('#card-invoice not found — invoice navigation disabled.');
if (!cardProfile) console.warn('#card-profile not found — profile navigation disabled.');
