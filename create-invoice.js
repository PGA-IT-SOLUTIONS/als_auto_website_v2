// create-invoice.js — admin-only invoice creation UI + Firestore save (atomic batch for invoice + booking update)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  setDoc,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

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

// DOM references (unchanged)
const bookingInfoEl = document.getElementById('bookingInfo');
const alertEl = document.getElementById('alert');
const backBtn = document.getElementById('backBtn');
const signOutBtn = document.getElementById('signOutBtn');

const custName = document.getElementById('custName');
const custEmail = document.getElementById('custEmail');
const custPhone = document.getElementById('custPhone');
const bookingIdInput = document.getElementById('bookingId');
const vehicleInput = document.getElementById('vehicle');
const preferredDate = document.getElementById('preferredDate');

const itemsTableBody = document.querySelector('#itemsTable tbody');
const addRowBtn = document.getElementById('addRow');
const subtotalEl = document.getElementById('subtotal');
const taxRateEl = document.getElementById('taxRate');
const taxAmountEl = document.getElementById('taxAmount');
const grandTotalEl = document.getElementById('grandTotal');
const notesEl = document.getElementById('notes');

const saveBtn = document.getElementById('saveInvoice');
const previewBtn = document.getElementById('previewBtn');

let currentBooking = null;
let currentAdmin = null;

// loader / helpers (unchanged)
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
function showAlert(msg, type = 'info') {
  if (!alertEl) return;
  alertEl.hidden = false;
  alertEl.textContent = msg;
  alertEl.className = `notification ${type}`;
  setTimeout(()=> { alertEl.hidden = true; }, 6000);
}
function formatMoney(n) { return Number(n || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}); }
function param(name='bookingId') { try { return new URL(location.href).searchParams.get(name); } catch(e){ return null; } }
function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') }

// line item helpers (unchanged)
function addLineItem(desc='', qty=1, unit=0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="li-desc" value="${escapeHtml(desc)}" placeholder="Description"></td>
    <td><input class="li-qty" type="number" min="1" value="${qty}"></td>
    <td><input class="li-unit" type="number" min="0" step="0.01" value="${unit}"></td>
    <td><input class="li-total" readonly></td>
    <td><button class="remove-btn" title="Remove">&times;</button></td>
  `;
  const qtyEl = tr.querySelector('.li-qty');
  const unitEl = tr.querySelector('.li-unit');
  const totalEl = tr.querySelector('.li-total');
  const descEl = tr.querySelector('.li-desc');
  const removeBtn = tr.querySelector('.remove-btn');

  function recalcLine() {
    const q = Number(qtyEl.value || 0);
    const u = Number(unitEl.value || 0);
    totalEl.value = formatMoney(q * u);
    recalcTotals();
  }
  qtyEl.addEventListener('input', recalcLine);
  unitEl.addEventListener('input', recalcLine);
  descEl.addEventListener('input', () => {});
  removeBtn.addEventListener('click', () => { tr.remove(); recalcTotals(); });

  itemsTableBody.appendChild(tr);
  recalcLine();
}
function recalcTotals() {
  const rows = Array.from(itemsTableBody.querySelectorAll('tr'));
  let subtotal = 0;
  for (const r of rows) {
    const q = Number(r.querySelector('.li-qty').value || 0);
    const u = Number(r.querySelector('.li-unit').value || 0);
    subtotal += (q * u);
  }
  const taxRate = Number(taxRateEl.value || 0);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  subtotalEl.value = formatMoney(subtotal);
  taxAmountEl.value = formatMoney(tax);
  grandTotalEl.value = formatMoney(total);
}

// load booking (unchanged except leaving invoiceId notice)
async function loadBooking(bookingId) {
  showLoader('Loading booking...');
  try {
    const ref = doc(db, 'bookings', bookingId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      showAlert('Booking not found', 'error');
      hideLoader();
      return false;
    }
    currentBooking = { id: snap.id, ...snap.data() };
    bookingInfoEl.textContent = `Booking ${currentBooking.id} — ${currentBooking.userName || currentBooking.userEmail || ''}`;
    bookingIdInput.value = currentBooking.id;
    custName.value = currentBooking.userName || '';
    custEmail.value = currentBooking.userEmail || '';
    custPhone.value = currentBooking.userPhone || '';
    vehicleInput.value = `${currentBooking.vehicleMake || ''} ${currentBooking.vehicleModel || ''}`.trim();
    preferredDate.value = currentBooking.preferredDateString || '';

    if (currentBooking.invoiceId) {
      showAlert('An invoice already exists for this booking. You can view it or update it below.', 'info');
    }

    itemsTableBody.innerHTML = '';
    addLineItem('', 1, 0);
    recalcTotals();
    hideLoader();
    return true;
  } catch (err) {
    console.error('loadBooking', err);
    showAlert('Failed to load booking', 'error');
    hideLoader();
    return false;
  }
}

// CREATE INVOICE: use writeBatch to atomically write invoice and update booking
async function createInvoice() {
  if (!currentBooking) { showAlert('No booking loaded', 'error'); return; }

  // prevent duplicate invoice creation
  if (currentBooking.invoiceId) {
    showAlert('Invoice already created for this booking. Opening invoice...', 'info');
    window.open(`invoice-view.html?invoiceId=${encodeURIComponent(currentBooking.invoiceId)}`, '_blank');
    return;
  }

  // gather items
  const rows = Array.from(itemsTableBody.querySelectorAll('tr'));
  const items = rows.map(r => ({
    description: r.querySelector('.li-desc').value.trim(),
    qty: Number(r.querySelector('.li-qty').value || 0),
    unit: Number(r.querySelector('.li-unit').value || 0),
    lineTotal: Number((r.querySelector('.li-qty').value || 0) * (r.querySelector('.li-unit').value || 0))
  })).filter(it => it.qty > 0 && it.unit >= 0 && it.description.length > 0);

  if (!items.length) {
    showAlert('Add at least one line item with a description, qty and price.', 'error');
    return;
  }

  const subtotal = Number((subtotalEl.value || '0').replace(/,/g,''));
  const taxRate = Number(taxRateEl.value || 0);
  const taxAmount = Number((taxAmountEl.value || '0').replace(/,/g,''));
  const total = Number((grandTotalEl.value || '0').replace(/,/g,'')) || 0;
  const notes = notesEl.value.trim();

  const bookingUserId = currentBooking.userId || null;
  // Use booking's original userEmail as primary, fallback to form field
  const bookingEmailLower = (currentBooking.userEmail || '').trim().toLowerCase();
  const formEmailLower = (custEmail.value || '').trim().toLowerCase();
  const customerEmailLower = bookingEmailLower || formEmailLower;

  // Build invoice payload (note: we will set createdAt to serverTimestamp() via batch.set)
  const invoicePayload = {
    bookingId: currentBooking.id,
    bookingRef: doc(db, 'bookings', currentBooking.id),
    bookingUserId: bookingUserId,
    customer: {
      name: custName.value.trim(),
      email: customerEmailLower,
      phone: custPhone.value.trim()
    },
    vehicleMake: currentBooking.vehicleMake || '',
    vehicleModel: currentBooking.vehicleModel || '',
    serviceType: currentBooking.serviceType || '',
    otherService: currentBooking.otherService || null,
    items,
    subtotal,
    taxRate,
    taxAmount,
    total,
    notes,
    paid: false,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser ? auth.currentUser.uid : null
  };

  showLoader('Creating invoice ...');

  try {
    // create a new invoice doc reference with auto id, but use set via batch so we can update booking in same commit
    const invoicesCol = collection(db, 'invoices');
    const newInvRef = doc(invoicesCol); // generates a new doc ref with id but not written yet
    const bookingRef = doc(db, 'bookings', currentBooking.id);

    const batch = writeBatch(db);
    batch.set(newInvRef, invoicePayload);
    batch.update(bookingRef, {
      invoiceId: newInvRef.id,
      invoiceCreated: true,
      invoiceCreatedAt: serverTimestamp(),
      invoiceCreatedBy: auth.currentUser ? auth.currentUser.uid : null,
      updatedAt: serverTimestamp()
    });

    // commit
    await batch.commit();

    // update local booking copy so UI knows invoice exists
    currentBooking.invoiceId = newInvRef.id;
    currentBooking.invoiceCreated = true;

    // redirect to confirmation page
    window.location.href = `invoice-confirmation.html?invoiceId=${encodeURIComponent(newInvRef.id)}`;
  } catch (err) {
    console.error('createInvoice (batch) failed', err);
    showAlert('Failed to create invoice. See console for details.', 'error');
  } finally {
    hideLoader();
  }
}

// preview (unchanged)
function previewInvoice() {
  const rows = Array.from(itemsTableBody.querySelectorAll('tr'));
  const items = rows.map(r => ({
    description: r.querySelector('.li-desc').value.trim(),
    qty: Number(r.querySelector('.li-qty').value || 0),
    unit: Number(r.querySelector('.li-unit').value || 0),
    lineTotal: Number((r.querySelector('.li-qty').value || 0) * (r.querySelector('.li-unit').value || 0))
  })).filter(it => it.qty > 0 && it.description.length);

  const subtotal = subtotalEl.value;
  const tax = taxAmountEl.value;
  const total = grandTotalEl.value;
  const notes = notesEl.value.trim();

  // logo path 
  const logoUrl = 'img/ALS AUTO.png';

  // greeting name fallback: form field -> booking -> empty
  const customerName = (custName && custName.value) ? custName.value.trim() : (currentBooking?.userName || '');

  // vehicle + service info (safely extracted)
  const vehicleMake = currentBooking?.vehicleMake || '';
  const vehicleModel = currentBooking?.vehicleModel || '';
  const serviceType = currentBooking?.serviceType || '';

  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Invoice Preview</title>
    <style>
      :root{--brand:#08417a;--muted:#666;--pad:18px;font-family:Inter, system-ui, Arial, Helvetica, sans-serif}
      body{padding:30px;color:#111}
      .inv{max-width:900px;margin:0 auto;border:1px solid #eee;padding:24px;border-radius:8px}
      /* Header layout */
      .inv-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .logo{display:inline-block;max-width:110px}
      .logo img{display:block;max-width:100%;height:auto}
      .company-info{text-align:right;line-height:1.25}
      .company-info .name{font-weight:700;color:var(--brand);font-size:18px}
      .company-info .meta{font-size:13px;color:var(--muted)}
      hr{border:none;border-top:1px solid #f1f4f8;margin:18px 0}

      h1{color:var(--brand);font-size:20px;margin:6px 0}
      .greeting{margin:12px 0 6px 0}
      .vehicle-info{margin-bottom:12px;color:var(--muted)}

      table{width:100%;border-collapse:collapse;margin-top:8px}
      thead th{background:#fafafa;text-align:left;padding:10px;border-bottom:1px solid #eee;font-size:13px}
      td, th{padding:10px;border-bottom:1px solid #f6f8fb}
      .right{text-align:right}
      .totals{margin-top:16px;display:flex;justify-content:flex-end;gap:14px;font-size:14px}
      .totals .col{min-width:220px;padding:8px;background:#fff;border:1px solid #f1f4f8;border-radius:6px}
      .notes{margin-top:14px;font-size:13px;color:var(--muted)}

      .actions{margin-top:18px}
      button.print-btn{padding:8px 12px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer}
    </style>
  </head>
  <body>
    <div class="inv">
      <div class="inv-header">
        <div class="logo">
          <img src="${escapeHtml(logoUrl)}" alt="Company logo">
        </div>
        <div class="company-info">
          <div class="name">ALS Auto Services</div>
          <div class="meta">
            34a Central Avenue, Eastleigh, Edenvale<br>
            Phone: +27 073 299 2009<br>
            Email: allwynsewell@gmail.com
          </div>
        </div>
      </div>

      <hr>

      <h1>Invoice for Services Rendered</h1>

      <div class="greeting">
        <strong>Dear ${escapeHtml(customerName)},</strong>
        <div style="margin-top:6px">Below is an invoice for the work that has been done on the vehicle. The cost does include the cost of parts and labour.</div>
      </div>

      <div class="vehicle-info">
        <div><strong>Vehicle:</strong> ${escapeHtml(vehicleMake)} ${escapeHtml(vehicleModel)}</div>
        <div><strong>Service:</strong> ${escapeHtml(serviceType)}</div>
        <div style="margin-top:6px"><strong>Booking:</strong> ${escapeHtml(currentBooking?.id || '')}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:60%">Description</th>
            <th style="width:20%" class="right">Cost per Unit</th>
            <th style="width:20%" class="right">Price (R)</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${escapeHtml(it.description)}</td>
              <td class="right">${formatMoney(it.unit)}</td>
              <td class="right">${formatMoney(it.lineTotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="totals">
        <div class="col">
          <div style="display:flex;justify-content:space-between"><span>Subtotal</span><strong>${escapeHtml(subtotal)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px"><span>VAT</span><strong>${escapeHtml(tax)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:16px"><span>Total</span><strong>${escapeHtml(total)}</strong></div>
        </div>
      </div>

      ${notes ? `<div class="notes"><strong>Notes:</strong><div>${escapeHtml(notes)}</div></div>` : ''}

      
    </div>
  </body>
  </html>
  `;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}


// AUTH & load booking
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }
  currentAdmin = user;
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (!adminSnap.exists()) {
      await signOut(auth);
      window.location.replace('admin-dashboard.html');
      return;
    }
  } catch (err) {
    console.error('admin check failed', err);
    await signOut(auth);
    window.location.replace('login.html');
    return;
  }

  const id = param('bookingId');
  if (!id) {
    showAlert('Booking ID not provided in URL', 'error');
    return;
  }
  const ok = await loadBooking(id);
  if (!ok) return;
});

// wiring UI
addRowBtn.addEventListener('click', () => addLineItem('',1,0));
taxRateEl.addEventListener('input', recalcTotals);
itemsTableBody.addEventListener('input', recalcTotals);
saveBtn.addEventListener('click', createInvoice);
previewBtn.addEventListener('click', previewInvoice);

signOutBtn.addEventListener('click', async () => {
  try { await signOut(auth); } catch(e) { console.warn(e); }
  window.location.replace('login.html');
});
