// invoices.js — show all invoices for the signed-in user (more aggressive fallbacks:
// 1) bookingUserId listener
// 2) customer.email listener
// 3) invoices for bookingIds derived from user's bookings (batched 'in' queries)
// 4) final limited client-side fallback)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  limit,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// config (same as other pages)
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
const invoicesListEl = document.getElementById('invoicesList');
const summaryTotalEl = document.getElementById('summaryTotal');
const signOutBtn = document.getElementById('signOutBtn');
const debugEl = document.getElementById('debug'); // optional element for debug text

// loader helpers (same pattern)
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

function formatMoney(n){
  if (n === undefined || n === null) return 'R0.00';
  return 'R' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderEmpty(msg = 'No invoices found for your account.') {
  if (!invoicesListEl) return;
  invoicesListEl.innerHTML = `<div class="empty">${msg}</div>`;
  if (summaryTotalEl) summaryTotalEl.textContent = `Total owed: R0.00`;
}

function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') }

function formatDate(ts){
  if (!ts) return '';
  try {
    if (ts.toDate) return ts.toDate().toLocaleString();
    return new Date(ts).toLocaleString();
  } catch (e) { return String(ts); }
}

let unsubByBooking = null;
let unsubByEmail = null;
let unsubByBookingIdBatches = []; // array of unsubs for bookingId->invoice listeners
let invoicesMap = new Map(); // id -> invoice

function logDebug(s){
  console.debug(s);
  if (debugEl) debugEl.textContent = String(s);
}

// merge and render invoicesMap
function renderMergedInvoices() {
  const items = Array.from(invoicesMap.values())
    .sort((a,b) => {
      const ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
      const tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
      return tb - ta;
    });

  if (!items.length) {
    renderEmpty();
    return;
  }

  // compute total owed
  const totalOwed = items.reduce((acc, it) => acc + ((it.paid) ? 0 : Number(it.total || 0)), 0);
  if (summaryTotalEl) summaryTotalEl.textContent = `Total owed: ${formatMoney(totalOwed)}`;

  invoicesListEl.innerHTML = '';
  for (const inv of items) {
    const paid = !!inv.paid;
    const badge = paid ? `<span class="badge paid">Paid</span>` : `<span class="badge unpaid">Not paid</span>`;
    const amount = formatMoney(inv.total || 0);
    const owedText = paid ? '—' : formatMoney(inv.total || 0);

    const node = document.createElement('div');
    node.className = 'invoice-item';
    const vehicleText = `${inv.vehicleMake || ''} ${inv.vehicleModel || ''}`.trim() || '—';
    const serviceText = inv.serviceType ? (inv.serviceType + (inv.otherService ? ` — ${inv.otherService}` : '')) : '—';
    node.innerHTML = `
      <div class="invoice-left">
        <div class="invoice-meta">
          <h3>${escapeHtml(inv.customer?.name || inv.customer?.email || inv.bookingId || inv.id)}</h3>
          <div class="small">Vehicle: ${escapeHtml(vehicleText)}</div>
          <div class="small">Service: ${escapeHtml(serviceText)}</div>
        </div>
      </div>

      <div class="invoice-right">
        <div style="margin-bottom:8px">${badge}</div>
        <div style="font-weight:700">${amount}</div>
        <div class="small">Amount owed: ${owedText}</div>
        <div style="margin-top:8px; display:flex; gap:8px; justify-content:flex-end;">
          
          <button class="btn download" data-id="${inv.id}"><i class="fas fa-download"></i> Download</button>
        </div>
      </div>
    `;
    invoicesListEl.appendChild(node);
  }

  // attach handlers
  Array.from(invoicesListEl.querySelectorAll('.btn.view')).forEach(b=>{
    b.addEventListener('click', () => {
      const id = b.dataset.id; if (!id) return;
      window.open(`invoice-view.html?invoiceId=${encodeURIComponent(id)}`, '_blank');
    });
  });

  Array.from(invoicesListEl.querySelectorAll('.btn.pay')).forEach(b=>{
    b.addEventListener('click', () => {
      const id = b.dataset.id; if (!id) return;
      window.open(`invoice-view.html?invoiceId=${encodeURIComponent(id)}&pay=1`, '_blank');
    });
  });

  // DOWNLOAD handlers
  Array.from(invoicesListEl.querySelectorAll('.btn.download')).forEach(b=>{
    b.addEventListener('click', async () => {
      const id = b.dataset.id; if (!id) return;
      let inv = invoicesMap.get(id);
      try {
        if (!inv) {
          // fallback: fetch single invoice doc
          const docSnap = await getDoc(doc(db, 'invoices', id));
          if (docSnap && docSnap.exists()) inv = { id: docSnap.id, ...docSnap.data() };
        }
      } catch (err) {
        console.warn('Failed to fetch invoice for download fallback', err);
      }
      if (!inv) {
        alert('Invoice data not available for download.');
        return;
      }
      await downloadInvoicePrintable(inv);
    });
  });
}

// unsubscribe helpers
function clearSubscriptions() {
  if (unsubByBooking) { try { unsubByBooking(); } catch(e){} unsubByBooking = null; }
  if (unsubByEmail) { try { unsubByEmail(); } catch(e){} unsubByEmail = null; }
  if (unsubByBookingIdBatches && unsubByBookingIdBatches.length) {
    unsubByBookingIdBatches.forEach(u => { try { u(); } catch(e){} });
    unsubByBookingIdBatches = [];
  }
  invoicesMap.clear();
}

// fallback fetch targeted queries without broad collection scans
async function fallbackFetchAndFilter(userEmailLower, uid) {
  showLoader('Loading invoices (fallback)...');
  try {
    invoicesMap.clear();

    // A) bookingUserId
    try {
      const qA = query(collection(db, 'invoices'), where('bookingUserId', '==', uid));
      const aSnap = await getDocs(qA);
      aSnap.forEach(s => invoicesMap.set(s.id, { id: s.id, ...s.data() }));
    } catch (e) { console.warn('Fallback bookingUserId failed', e); }

    // B) customer.email
    try {
      const qB = query(collection(db, 'invoices'), where('customer.email', '==', userEmailLower));
      const bSnap = await getDocs(qB);
      bSnap.forEach(s => invoicesMap.set(s.id, { id: s.id, ...s.data() }));
    } catch (e) { console.warn('Fallback email failed', e); }

    // C) user bookings -> invoices by bookingId in batches (<=10)
    try {
      const bookingsQ = query(collection(db, 'bookings'), where('userId', '==', uid));
      const bookingsSnap = await getDocs(bookingsQ);
      const ids = [];
      bookingsSnap.forEach(s => ids.push(s.id));
      const batches = batchArray(ids, 10);
      for (const batchIds of batches) {
        try {
          const qC = query(collection(db, 'invoices'), where('bookingId', 'in', batchIds));
          const cSnap = await getDocs(qC);
          cSnap.forEach(s => invoicesMap.set(s.id, { id: s.id, ...s.data() }));
        } catch (e) {
          console.warn('Fallback bookingId batch failed', e);
        }
      }
    } catch (e) { console.warn('Fallback bookings fetch failed', e); }

    renderMergedInvoices();
  } catch (err) {
    console.error('Fallback fetch failed', err);
    renderEmpty('Failed to load invoices.');
  } finally {
    hideLoader();
  }
}

// Helpers: subscribe invoices by batches of bookingId (Firestore 'in' supports up to 10 values)
function batchArray(arr, size) {
  const batches = [];
  for (let i = 0; i < arr.length; i += size) batches.push(arr.slice(i, i + size));
  return batches;
}

async function subscribeInvoicesForBookingIds(bookingIds) {
  // detach any previous bookingId batch listeners
  if (unsubByBookingIdBatches && unsubByBookingIdBatches.length) {
    unsubByBookingIdBatches.forEach(u => { try { u(); } catch(e){} });
    unsubByBookingIdBatches = [];
  }
  if (!bookingIds || !bookingIds.length) return;

  // Firestore 'in' has max 10 items — split into batches
  const batches = batchArray(bookingIds, 10);
  for (const batchIds of batches) {
    try {
      const q = query(collection(db, 'invoices'), where('bookingId', 'in', batchIds));
      const unsub = onSnapshot(q, (snap) => {
        snap.forEach(s => invoicesMap.set(s.id, { id: s.id, ...s.data() }));
        renderMergedInvoices();
        hideLoader();
      }, (err) => {
        console.error('bookingId batch snapshot failed', err);
      });
      unsubByBookingIdBatches.push(unsub);
    } catch (err) {
      console.warn('Failed to subscribe bookingId batch (will fallback to fetch):', err);
    }
  }
}

/* -------------------------
   PDF DOWNLOAD: generate PDF
   ------------------------- */

function loadScript(url) {
  return new Promise((resolve, reject) => {
    // if script already present, wait a tick and resolve
    const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.indexOf(url) !== -1);
    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + url)));
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => { s.setAttribute('data-loaded', '1'); resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
}

async function ensurePdfLibsLoaded() {
  // UMD builds expose window.jspdf and window.html2canvas
  if (window.jspdf && window.html2canvas) return;
  const jspdfUrl = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const html2canvasUrl = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  await Promise.all([loadScript(jspdfUrl), loadScript(html2canvasUrl)]);
}

async function downloadInvoicePrintable(inv) {
  showLoader('Generating PDF...');
  try {
    await ensurePdfLibsLoaded();
  } catch (e) {
    console.error('Failed to load PDF libraries', e);
    hideLoader();
    alert('Unable to load PDF generator libraries. Please try again later.');
    return;
  }

  // safe field extraction
  const cust = inv.customer || {};
  const customerName = cust.name || cust.email || 'Customer';
  const vehicleMake = inv.vehicleMake || inv.vehicle?.make || '';
  const vehicleModel = inv.vehicleModel || inv.vehicle?.model || '';
  const serviceType = inv.serviceType || inv.otherService || '';
  const currentBooking = inv.bookingId ? { id: inv.bookingId } : (inv.booking || null);
  const notes = inv.notes || inv.note || '';

  // logo: try invoice-level logo, fallback to common paths
  const logoUrl = inv.logoUrl || inv.companyLogo || '/img/ALS AUTO.png';

  // Prepare items array in the shape { description, unit, lineTotal }
  let rawItems = [];
  if (Array.isArray(inv.items) && inv.items.length) rawItems = inv.items;
  else if (Array.isArray(inv.lineItems) && inv.lineItems.length) rawItems = inv.lineItems;
  else if (Array.isArray(inv.charges) && inv.charges.length) rawItems = inv.charges;
  else rawItems = []; // empty

  const items = rawItems.map(it => {
    const description = it.description || it.name || it.title || '';
    const unitVal = (typeof it.unit !== 'undefined') ? Number(it.unit)
      : (typeof it.price !== 'undefined' ? Number(it.price)
      : (typeof it.unitPrice !== 'undefined' ? Number(it.unitPrice)
      : (typeof it.amount !== 'undefined' ? Number(it.amount) : 0)));
    const qty = typeof it.quantity !== 'undefined' ? Number(it.quantity) : 1;
    const lineTotalVal = (typeof it.lineTotal !== 'undefined') ? Number(it.lineTotal)
      : (typeof it.total !== 'undefined' ? Number(it.total)
      : Number(qty * unitVal));
    return {
      description: description,
      unit: unitVal,
      qty,
      lineTotal: lineTotalVal
    };
  });

  // compute subtotal (sum of line totals)
  const subtotalVal = items.reduce((acc, it) => acc + Number(it.lineTotal || 0), 0);

  // tax/vat — default to 15% if invoice doesn't provide tax
  let taxVal = 0;
  if (typeof inv.taxAmount !== 'undefined') {
    taxVal = Number(inv.taxAmount || 0);
  } else if (typeof inv.vat !== 'undefined') {
    taxVal = Number(inv.vat || 0);
  } else if (typeof inv.taxPercent !== 'undefined') {
    taxVal = subtotalVal * (Number(inv.taxPercent || 0) / 100);
  } else {
    // default VAT 15%
    taxVal = subtotalVal * 0.15;
  }

  // total: prefer invoice total if present
  let totalVal = (typeof inv.total !== 'undefined') ? Number(inv.total) : (subtotalVal + taxVal);

  // Format strings
  const subtotal = formatMoney(subtotalVal);
  const tax = formatMoney(taxVal);
  const total = formatMoney(totalVal);

  // Build HTML using the exact format supplied by user
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
            123 Example Road, Cape Town<br>
            Phone: +27 21 555 0123<br>
            Email: info@alsauto.co.za
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

  // Create a hidden container and populate it with HTML
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '0';
  container.style.width = '900px';
  container.style.background = '#fff';
  container.innerHTML = html;
  document.body.appendChild(container);

  // Wait for images to load (logo etc.)
  await new Promise(resolve => {
    const imgs = container.querySelectorAll('img');
    if (!imgs.length) return resolve();
    let loaded = 0;
    imgs.forEach(img => {
      // try to allow cross-origin images
      try { img.crossOrigin = 'anonymous'; } catch (e) {}
      if (img.complete) {
        loaded++;
        if (loaded === imgs.length) resolve();
      } else {
        img.addEventListener('load', () => {
          loaded++;
          if (loaded === imgs.length) resolve();
        });
        img.addEventListener('error', () => {
          // continue even if image fails
          loaded++;
          if (loaded === imgs.length) resolve();
        });
      }
    });
  });

  // Render with html2canvas
  try {
    const canvas = await window.html2canvas(container, { scale: 2, useCORS: true, allowTaint: false, logging: false });
    const imgData = canvas.toDataURL('image/png');

    const pdfLib = window.jspdf;
    const { jsPDF } = pdfLib;
    const pdf = new jsPDF('p', 'pt', 'a4');

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Fit full canvas width to page width
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    } else {
      // multi-page: slice canvas vertically into page-sized chunks
      const ratio = canvas.width / pageWidth; // px per PDF point horizontally
      const sliceHeightPx = Math.floor(pageHeight * ratio);
      let y = 0;
      while (y < canvas.height) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = Math.min(sliceHeightPx, canvas.height - y);
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, y, canvas.width, tempCanvas.height, 0, 0, tempCanvas.width, tempCanvas.height);
        const sliceData = tempCanvas.toDataURL('image/png');
        const sliceHeightPts = (tempCanvas.height * imgWidth) / canvas.width;
        pdf.addImage(sliceData, 'PNG', 0, 0, imgWidth, sliceHeightPts);
        y += tempCanvas.height;
        if (y < canvas.height) pdf.addPage();
      }
    }

    const filename = `Invoice-${inv.id || Date.now()}.pdf`;
    pdf.save(filename);
  } catch (err) {
    console.error('PDF generation failed', err);
    alert('Failed to generate PDF. Try enabling cross-origin image loading or use a different browser.');
  } finally {
    container.remove();
    hideLoader();
  }
}

// main listener setup: subscribe to invoices by bookingUserId and by email, plus bookingIds derived from user's bookings
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  userInfoEl && (userInfoEl.textContent = user.displayName || user.email || user.uid);
  const uid = user.uid;
  const rawEmail = (user.email || '').trim();
  const userEmailLower = rawEmail.toLowerCase();
  if (!rawEmail) {
    renderEmpty('No email available for this account.');
    return;
  }

  showLoader('Loading invoices...');
  clearSubscriptions();
  invoicesMap.clear();

  try {
    // 1) Subscribe to invoices where bookingUserId == uid (reliable, indexed)
    try {
      const qBooking = query(collection(db, 'invoices'), where('bookingUserId', '==', uid));
      unsubByBooking = onSnapshot(qBooking, (snap) => {
        snap.forEach(s => invoicesMap.set(s.id, { id: s.id, ...s.data() }));
        renderMergedInvoices();
        hideLoader();
      }, async (err) => {
        console.error('Booking-based snapshot failed', err);
        // fallback: nothing here yet; we'll try bookingId batch & general fallback below
      });
    } catch (err) {
      console.warn('Failed to start booking-based listener, will fallback', err);
    }

    // 2) Subscribe to invoices where customer.email == userEmailLower
    try {
      const qEmail = query(collection(db, 'invoices'), where('customer.email', '==', userEmailLower));
      unsubByEmail = onSnapshot(qEmail, (snap) => {
        snap.forEach(s => invoicesMap.set(s.id, { id: s.id, ...s.data() }));
        renderMergedInvoices();
        hideLoader();
      }, (err) => {
        console.error('Email-based snapshot failed', err);
      });
    } catch (err) {
      console.warn('Failed to start email-based listener (possibly requires index).', err);
    }

    // 3) Aggressive: fetch user's bookings and subscribe to invoices using bookingId 'in' queries (batches)
    try {
      const bookingsQ = query(collection(db, 'bookings'), where('userId', '==', uid));
      const bookingsSnap = await getDocs(bookingsQ);
      const bookingIds = [];
      bookingsSnap.forEach(s => bookingIds.push(s.id));
      if (bookingIds.length) {
        logDebug(`Found ${bookingIds.length} bookings for user — subscribing invoice batches by bookingId`);
        await subscribeInvoicesForBookingIds(bookingIds);
      } else {
        logDebug('No bookings found for user (bookingId subscription skipped).');
      }
    } catch (err) {
      console.warn('Failed to fetch user bookings for aggressive invoice subscription', err);
      // ignore — fallback below will run
    }

    // 4) If none of the above produced any invoices within a short period, do a fallback fetch
    setTimeout(async () => {
      if (invoicesMap.size === 0) {
        logDebug('No invoices observed yet — running fallback fetch/filter.');
        await fallbackFetchAndFilter(userEmailLower, uid);
      } else {
        hideLoader();
      }
    }, 900);

  } catch (err) {
    console.error('Invoices setup failed', err);
    await fallbackFetchAndFilter(userEmailLower, uid);
  } finally {
    // don't hideLoader here; individual listeners or fallbackFetch will hide it
  }
});

if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    try { clearSubscriptions(); await signOut(auth); } catch(e){ console.warn(e); }
    window.location.replace('login.html');
  });
}
