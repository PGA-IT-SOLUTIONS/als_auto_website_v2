// create-quote.js — admin-only quote creation UI + Firestore save (atomic batch for quote + request update)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
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

// DOM references (matching create-quote.html updated form)
const bookingInfoEl = document.getElementById('bookingInfo');
const alertEl = document.getElementById('alert');
const backBtn = document.getElementById('backBtn');
const signOutBtn = document.getElementById('signOutBtn');

const custName = document.getElementById('custName');       // may be duplicated in markup
const custSurname = document.getElementById('custSurname'); // if present
const custEmail = document.getElementById('custEmail');
const serviceInput = document.getElementById('serviceType');
const quoteIdInput = document.getElementById('quoteId'); // readonly field
const vehicleInput = document.getElementById('vehicle');

const itemsTableBody = document.querySelector('#itemsTable tbody');
const addRowBtn = document.getElementById('addRow');
const subtotalEl = document.getElementById('subtotal');
const taxRateEl = document.getElementById('taxRate');
const taxAmountEl = document.getElementById('taxAmount');
const grandTotalEl = document.getElementById('grandTotal');
const notesEl = document.getElementById('notes'); // optional

const saveBtn = document.getElementById('saveInvoice'); // button id re-used
const previewBtn = document.getElementById('previewBtn');

let currentRequest = null;
let currentAdmin = null;

// loader / helpers
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
function hideLoader() { const el = document.getElementById('global-loader-overlay'); if (el) el.remove(); }
function showAlert(msg, type = 'info') { if (!alertEl) return; alertEl.hidden = false; alertEl.textContent = msg; alertEl.className = `notification ${type}`; setTimeout(()=> { alertEl.hidden = true; }, 6000); }
function formatMoney(n) { return Number(n || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}); }
function param(name='requestId') { try { return new URL(location.href).searchParams.get(name); } catch(e){ return null; } }
function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') }

// Line item helpers (same behaviour as invoice)
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
  const taxRate = Number(taxRateEl ? taxRateEl.value : 0) || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  if (subtotalEl) subtotalEl.value = formatMoney(subtotal);
  if (taxAmountEl) taxAmountEl.value = formatMoney(tax);
  if (grandTotalEl) grandTotalEl.value = formatMoney(total);
}

// load quote request and populate the form fields
async function loadRequest(requestId) {
  showLoader('Loading request...');
  try {
    const ref = doc(db, 'quotes', requestId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      showAlert('Quote request not found', 'error');
      hideLoader();
      return false;
    }
    currentRequest = { id: snap.id, ...snap.data() };

    // Build display name text (first + last if available)
    const reqFirst = currentRequest.name || '';
    const reqSurname = currentRequest.surname || '';

    bookingInfoEl.textContent = `Request ${currentRequest.id} — ${reqFirst} ${reqSurname}`.trim();

    // Fill name & surname defensively:
    // 1) If there's a dedicated custSurname element, populate it.
    // 2) If there are two elements with id="custName" (markup duplication), populate first->name, second->surname.
    // 3) Otherwise populate custName only.
    try {
      const custNameNodes = Array.from(document.querySelectorAll('#custName'));
      if (custNameNodes.length >= 2) {
        custNameNodes[0].value = reqFirst || '';
        custNameNodes[1].value = reqSurname || '';
      } else {
        if (custName) custName.value = reqFirst || '';
        if (custSurname) custSurname.value = reqSurname || '';
        // If there is only one and surname exists, and a distinct surname input absent, try to find a second text input in same row
        if (!custSurname && custNameNodes.length === 1 && reqSurname) {
          // try to set the next input sibling in the same .row (best-effort)
          const parentRow = custNameNodes[0].closest('.row');
          if (parentRow) {
            const inputs = parentRow.querySelectorAll('input');
            if (inputs.length >= 2) {
              // try to set the second input (commonly surname)
              inputs[1].value = reqSurname;
            }
          }
        }
      }
    } catch (e) {
      // ignore; best-effort population only
      console.warn('populate name/surname failed', e);
    }

    // Email
    if (custEmail) custEmail.value = currentRequest.email || '';

    // Service type
    if (serviceInput) serviceInput.value = currentRequest.serviceType || '';

    // Vehicle
    if (vehicleInput) vehicleInput.value = `${currentRequest.make || ''} ${currentRequest.model || ''}`.trim();

    // Quote id
    if (quoteIdInput) quoteIdInput.value = currentRequest.quoteId || '';

    // notify if already created
    if (currentRequest.quoteId) {
      showAlert('A formal quote already exists for this request. You can view it or update it below.', 'info');
    }

    // initialize line items if empty
    itemsTableBody.innerHTML = '';
    addLineItem('', 1, 0);
    recalcTotals();
    hideLoader();
    return true;
  } catch (err) {
    console.error('loadRequest', err);
    showAlert('Failed to load request', 'error');
    hideLoader();
    return false;
  }
}

// CREATE QUOTE: write officialQuotes doc and update original request in same batch
async function createQuote() {
  if (!currentRequest) { showAlert('No request loaded', 'error'); return; }

  // prevent duplicate
  if (currentRequest.quoteId) {
    showAlert('Quote already created for this request. Opening quote...', 'info');
    window.open(`quote-view.html?quoteId=${encodeURIComponent(currentRequest.quoteId)}`, '_blank');
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

  const subtotal = Number((subtotalEl.value || '0').replace(/,/g,'')) || 0;
  const taxRate = Number(taxRateEl ? taxRateEl.value : 0) || 0;
  const taxAmount = Number((taxAmountEl ? taxAmountEl.value : '0').replace(/,/g,'')) || 0;
  const total = Number((grandTotalEl ? grandTotalEl.value : '0').replace(/,/g,'')) || 0;
  const notes = (notesEl && notesEl.value) ? notesEl.value.trim() : '';

  // Determine customer first/last name from the form (prefer form values)
  const firstNameFromForm = (() => {
    try {
      const nodes = Array.from(document.querySelectorAll('#custName'));
      return (nodes.length >= 1) ? (nodes[0].value || '') : (custName ? (custName.value || '') : '');
    } catch (e) { return ''; }
  })();
  const lastNameFromForm = (() => {
    try {
      if (custSurname) return custSurname.value || '';
      const nodes = Array.from(document.querySelectorAll('#custName'));
      if (nodes.length >= 2) return nodes[1].value || '';
      // try sibling input
      const parentRow = custName ? custName.closest('.row') : null;
      if (parentRow) {
        const inputs = parentRow.querySelectorAll('input');
        if (inputs.length >= 2) return inputs[1].value || '';
      }
      return currentRequest.surname || '';
    } catch (e) { return currentRequest.surname || ''; }
  })();

  const fullName = `${(firstNameFromForm || currentRequest.name || '').trim()} ${(lastNameFromForm || currentRequest.surname || '').trim()}`.trim();

  // Build payload
  const requestUserEmail = (currentRequest.email || '').trim().toLowerCase();
  const payload = {
    requestId: currentRequest.id,
    requestRef: doc(db, 'quotes', currentRequest.id),
    customer: {
      firstName: (firstNameFromForm || currentRequest.name || '').trim(),
      lastName: (lastNameFromForm || currentRequest.surname || '').trim(),
      name: fullName || (currentRequest.name || '')
    },
    vehicleMake: currentRequest.make || '',
    vehicleModel: currentRequest.model || '',
    serviceType: currentRequest.serviceType || (serviceInput ? serviceInput.value : ''),
    otherService: currentRequest.otherService || null,
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

  showLoader('Creating quote ...');

  try {
    const quotesCol = collection(db, 'officialQuotes'); // collection for formal quotes
    const newQuoteRef = doc(quotesCol); // generate id
    const requestRef = doc(db, 'quotes', currentRequest.id);

    const batch = writeBatch(db);
    batch.set(newQuoteRef, payload);
    batch.update(requestRef, {
      quoteId: newQuoteRef.id,
      quoteCreated: true,
      quoteCreatedAt: serverTimestamp(),
      quoteCreatedBy: auth.currentUser ? auth.currentUser.uid : null,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    // update local object
    currentRequest.quoteId = newQuoteRef.id;
    currentRequest.quoteCreated = true;

    // redirect to confirmation or view page
    window.location.href = `quote-made.html?quoteId=${encodeURIComponent(newQuoteRef.id)}`;
  } catch (err) {
    console.error('createQuote (batch) failed', err);
    showAlert('Failed to create quote. See console for details.', 'error');
  } finally {
    hideLoader();
  }
}

// preview (similar to invoice preview)
function previewQuote() {
  const rows = Array.from(itemsTableBody.querySelectorAll('tr'));
  const items = rows.map(r => ({
    description: r.querySelector('.li-desc').value.trim(),
    qty: Number(r.querySelector('.li-qty').value || 0),
    unit: Number(r.querySelector('.li-unit').value || 0),
    lineTotal: Number((r.querySelector('.li-qty').value || 0) * (r.querySelector('.li-unit').value || 0))
  })).filter(it => it.qty > 0 && it.description.length);

  const subtotal = subtotalEl ? subtotalEl.value : '';
  const tax = taxAmountEl ? taxAmountEl.value : '';
  const total = grandTotalEl ? grandTotalEl.value : '';
  const notes = notesEl ? notesEl.value.trim() : '';

  const logoUrl = 'img/ALS AUTO.png';
  const customerName = (() => {
    const nodes = Array.from(document.querySelectorAll('#custName'));
    if (nodes.length >= 1 && nodes[0].value) {
      const first = nodes[0].value.trim();
      const last = (nodes.length >= 2 && nodes[1].value) ? nodes[1].value.trim() : (custSurname ? custSurname.value.trim() : '');
      return `${first} ${last}`.trim();
    }
    if (custName && custName.value) return custName.value.trim();
    return currentRequest?.name || '';
  })();

  const vehicleMake = currentRequest?.make || '';
  const vehicleModel = currentRequest?.model || '';
  const serviceType = currentRequest?.serviceType || (serviceInput ? serviceInput.value : '');

  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Quote Preview</title>
    <style>
      :root{--brand:#08417a;--muted:#666;--pad:18px;font-family:Inter, system-ui, Arial, Helvetica, sans-serif}
      body{padding:30px;color:#111}
      .inv{max-width:900px;margin:0 auto;border:1px solid #eee;padding:24px;border-radius:8px}
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

      <h1>Quote for Services</h1>

      <div class="greeting">
        <strong>Dear ${escapeHtml(customerName)},</strong>
        <div style="margin-top:6px">Below is a quote prepared for the requested service. This is an estimate and may be subject to change following inspection.</div>
      </div>

      <div class="vehicle-info">
        <div><strong>Vehicle:</strong> ${escapeHtml(vehicleMake)} ${escapeHtml(vehicleModel)}</div>
        <div><strong>Service:</strong> ${escapeHtml(serviceType)}</div>
        <div style="margin-top:6px"><strong>Request:</strong> ${escapeHtml(currentRequest?.id || '')}</div>
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

// AUTH & load request
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

  const id = param('requestId');
  if (!id) {
    showAlert('Request ID not provided in URL', 'error');
    return;
  }
  const ok = await loadRequest(id);
  if (!ok) return;
});

// wiring UI
if (addRowBtn) addRowBtn.addEventListener('click', () => addLineItem('',1,0));
if (taxRateEl) taxRateEl.addEventListener('input', recalcTotals);
if (itemsTableBody) itemsTableBody.addEventListener('input', recalcTotals);
if (saveBtn) saveBtn.addEventListener('click', createQuote);
if (previewBtn) previewBtn.addEventListener('click', previewQuote);

if (signOutBtn) signOutBtn.addEventListener('click', async () => {
  try { await signOut(auth); } catch(e) { console.warn(e); }
  window.location.replace('login.html');
});
