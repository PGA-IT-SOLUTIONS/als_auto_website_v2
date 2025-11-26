// admin.js - Admin dashboard with real-time bookings + invoices management
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
  serverTimestamp,
  where,
  limit
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';

// firebase config (same as other pages)
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
const functionsClient = getFunctions(app);

// DOM
const userInfoEl = document.getElementById('userInfo');
const adminsListEl = document.getElementById('adminsList');
const bookingsListEl = document.getElementById('bookingsList');
const bookingsCountEl = document.getElementById('bookingsCount');
const bookingFilter = document.getElementById('bookingFilter');
const signOutBtn = document.getElementById('signOutBtn');

// invoices DOM (admin view)
const invoicesListEl = document.getElementById('invoicesList');
const invoicesCountEl = document.getElementById('invoicesCount');

// QUOTES DOM (new)
const quotesListEl = document.getElementById('quotesList');
const quotesCountEl = document.getElementById('quotesCount');
const quotesFilter = document.getElementById('quotesFilter');

let bookingsUnsub = null;
let invoicesUnsub = null;
let quotesUnsub = null;
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
  if (!container) return;
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
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>\"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
}

// load a script by URL (simple singleton loader)
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`) || document.querySelector(`script[src="${src}"]`)) {
      return setTimeout(resolve, 20);
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.setAttribute('data-src', src);
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

// currency helper
function fmtCurrency(n = 0) {
  return `R ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Render admins list
async function loadAdmins(){
  try{
    if (!adminsListEl) return;
    adminsListEl.innerHTML = '<div class="empty">Loading admins <span class="small-spinner"></span></div>';
    const snap = await getDocs(collection(db, 'admins'));
    if (snap.empty) { renderEmpty(adminsListEl, 'No admins found.'); return; }
    adminsListEl.innerHTML = '';
    snap.forEach(d=>{
      const data = d.data();
      const row = document.createElement('div');
      row.className = 'admin-item';
      row.innerHTML = `<div>
          <div style="font-weight:600;color:#0f172a">${escapeHtml(data.email || d.id)}</div>
          <div class="admin-meta">UID: ${escapeHtml(d.id)}</div>
        </div>
        <div style="text-align:right">
          <div class="admin-meta">${escapeHtml(data.role || 'admin')}</div>
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
  if (!bookingsListEl) return;
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

// Render bookings with invoice-aware actions
function renderBookings(items){
  if (!bookingsListEl) return;
  const filter = bookingFilter?.value || STATUS.PENDING;
  const filtered = items.filter(it => filter === 'all' ? true : (it.status === filter));
  bookingsListEl.innerHTML = '';
  if (bookingsCountEl) bookingsCountEl.textContent = `${filtered.length} shown (${items.length} total)`;

  if (filtered.length === 0) {
    renderEmpty(bookingsListEl, 'No bookings matching that filter.');
    return;
  }

  for (const b of filtered){
    const invoiceExists = !!b.invoiceId;
    const el = document.createElement('div');
    el.className = 'admin-item booking-item';
    el.innerHTML = `
      <div style="flex:1">
        <div style="display:flex; gap:12px; align-items:center;">
          <div style="min-width:200px">
            <div style="font-weight:700;color:#0f172a">${escapeHtml(b.userName || b.userEmail || b.userId)}</div>
            <div class="admin-meta">Email: ${escapeHtml(b.userEmail || '—')}</div>
            <div class="admin-meta">Phone: ${escapeHtml(b.userPhone || '—')}</div>
          </div>
          <div style="min-width:180px">
            <div><strong>Service:</strong> ${escapeHtml(b.serviceType)}${b.otherService ? ` — ${escapeHtml(b.otherService)}` : ''}</div>
            <div><strong>Date:</strong> ${escapeHtml(b.preferredDateString || formatDate(b.preferredDate))}</div>
            <div><strong>Vehicle:</strong> ${escapeHtml(b.vehicleMake || '')} ${escapeHtml(b.vehicleModel || '')}</div>
            <div class="admin-meta">Mileage: ${b.mileage ?? '—'}</div>
          </div>
        </div>
      </div>

      <div style="text-align:right; min-width:220px;">
        <div style="margin-bottom:10px">${statusBadge(b.status)} ${invoiceExists ? '<span class="badge invoice">Invoice Created</span>' : ''}</div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          ${b.status === STATUS.PENDING ? `<button class="btn action-receive" data-id="${b.id}">Mark Received</button>` : ''}
          ${b.status === STATUS.RECEIVED ? `<button class="btn action-start" data-id="${b.id}">Start Work</button>` : ''}
          ${b.status === STATUS.WORK ? `<button class="btn action-complete" data-id="${b.id}">Mark Complete Repair</button>` : ''}
          ${(!invoiceExists && b.status === STATUS.COMPLETE) ? `<button class="btn action-invoice" data-id="${b.id}">Create Invoice</button>` : ''}
          ${ (b.status === STATUS.COMPLETE) ? `<button class="btn action-view-invoice" data-invoice-id="${b.invoiceId || ''}" data-booking-id="${b.id}">View Invoice</button>` : ''}
        </div>
        <div class="muted" style="margin-top:8px">ID: ${escapeHtml(b.id)}</div>
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

  // Create Invoice -> opens create-invoice page (only if no invoice exists)
  Array.from(bookingsListEl.querySelectorAll('.action-invoice')).forEach(btn=>{
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      window.open(`create-invoice.html?bookingId=${encodeURIComponent(id)}`, '_blank');
    });
  });

  // View Invoice (always available on completed bookings). If invoiceId present open it; else query invoices by bookingId.
  Array.from(bookingsListEl.querySelectorAll('.action-view-invoice')).forEach(btn=>{
    btn.addEventListener('click', async () => {
      const invoiceId = (btn.dataset.invoiceId || '').trim();
      const bookingId = btn.dataset.bookingId;
      if (invoiceId) {
        window.open(`invoice-view.html?invoiceId=${encodeURIComponent(invoiceId)}`, '_blank');
        return;
      }
      if (!bookingId) return;

      try {
        // Attempt to find invoice document with bookingId == bookingId (most recent)
        const qInv = query(collection(db, 'invoices'), where('bookingId', '==', bookingId), orderBy('createdAt', 'desc'), limit(1));
        const snap = await getDocs(qInv);
        if (!snap.empty) {
          const invDoc = snap.docs[0];
          window.open(`invoice-view.html?invoiceId=${encodeURIComponent(invDoc.id)}`, '_blank');
          return;
        }

        // Fallback: open booking JSON (older behavior)
        const bSnap = await getDoc(doc(db, 'bookings', bookingId));
        const bData = bSnap.exists() ? bSnap.data() : { id: bookingId };
        const w = window.open('', '_blank');
        w.document.body.style.fontFamily = 'system-ui, Inter, Arial';
        w.document.title = `Booking ${bookingId}`;
        w.document.body.innerHTML = `<pre style="white-space:pre-wrap">${JSON.stringify(bData, null, 2)}</pre>`;
      } catch (err) {
        console.error('Failed to open invoice for booking', bookingId, err);
        alert('Failed to open invoice. See console for details.');
      }
    });
  });
}

// INVOICES: listen + render + handlers (admin view)
function listenInvoices(){
  if (!invoicesListEl) return;
  if (invoicesUnsub) invoicesUnsub();
  const q = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
  invoicesUnsub = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(s => items.push({ id: s.id, ...s.data() }));
    renderInvoices(items);
  }, (err) => {
    console.error('invoices snapshot error', err);
    renderEmpty(invoicesListEl, 'Failed to load invoices.');
  });
}

function renderInvoices(items){
  if (!invoicesListEl) return;
  invoicesListEl.innerHTML = '';
  if (invoicesCountEl) invoicesCountEl.textContent = `${items.length} invoices`;

  if (!items.length) { renderEmpty(invoicesListEl, 'No invoices yet.'); return; }

  for (const inv of items) {
    const el = document.createElement('div');
    el.className = 'admin-item invoice-item';
    const paidBadge = inv.paid ? `<span class="badge paid">Paid</span>` : `<span class="badge unpaid">Not paid</span>`;

    el.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:700;color:#0f172a">${(inv.customer && inv.customer.name) ? escapeHtml(inv.customer.name) : (inv.customer && inv.customer.email) || escapeHtml(inv.bookingId)}</div>
        <div class="admin-meta">Booking: ${escapeHtml(inv.bookingId || '—')}</div>
        <div class="admin-meta">Total: ${inv.total !== undefined ? Number(inv.total).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</div>
      </div>
      <div style="text-align:right; min-width:200px;">
        <div style="margin-bottom:8px">${paidBadge}</div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn action-paid" data-id="${inv.id}">Paid</button>
          <button class="btn action-notpaid" data-id="${inv.id}">Not paid</button>
          <button class="btn action-view-inv" data-id="${inv.id}">View Invoice</button>
        </div>
        <div class="muted" style="margin-top:8px">ID: ${escapeHtml(inv.id)}</div>
      </div>
    `;
    invoicesListEl.appendChild(el);
  }

  // attach handlers
  Array.from(invoicesListEl.querySelectorAll('.action-paid')).forEach(btn=>{
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      try {
        btn.disabled = true;
        await updateDoc(doc(db, 'invoices', id), {
          paid: true,
          paidAt: serverTimestamp(),
          paidBy: auth.currentUser ? auth.currentUser.uid : null,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error('mark paid error', err);
        alert('Failed to mark invoice as paid.');
      } finally { btn.disabled = false; }
    });
  });

  Array.from(invoicesListEl.querySelectorAll('.action-notpaid')).forEach(btn=>{
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      try {
        btn.disabled = true;
        await updateDoc(doc(db, 'invoices', id), {
          paid: false,
          paidAt: null,
          paidBy: null,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error('mark not paid error', err);
        alert('Failed to mark invoice as not paid.');
      } finally { btn.disabled = false; }
    });
  });

  Array.from(invoicesListEl.querySelectorAll('.action-view-inv')).forEach(btn=>{
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      window.open(`invoice-view.html?invoiceId=${encodeURIComponent(id)}`, '_blank');
    });
  });
}

// --------- QUOTES: listen + render (new) ---------
function listenQuotes(){
  if (!quotesListEl) return;
  if (quotesUnsub) quotesUnsub();

  const filter = quotesFilter?.value || 'all';
  let q;
  if (filter === 'recent') {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    q = query(collection(db, 'quotes'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'));
  } else {
    q = query(collection(db, 'quotes'), orderBy('createdAt', 'desc'));
  }

  quotesUnsub = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(s => items.push({ id: s.id, ...s.data() }));
    renderQuotes(items);
  }, (err) => {
    console.error('quotes snapshot error', err);
    renderEmpty(quotesListEl, 'Failed to load quotes.');
    if (quotesCountEl) quotesCountEl.textContent = '—';
  });
}

function renderQuotes(items){
  if (!quotesListEl) return;
  quotesListEl.innerHTML = '';

  if (!items || items.length === 0) {
    renderEmpty(quotesListEl, 'No quotes found.');
    if (quotesCountEl) quotesCountEl.textContent = '0';
    return;
  }

  // Update count
  if (quotesCountEl) quotesCountEl.textContent = String(items.length);

  // Render each quote using same two-column pattern as bookings
  for (const q of items) {
    const el = document.createElement('div');
    el.className = 'admin-item quote-item';
    const dateStr = q.createdAt ? formatDate(q.createdAt) : '—';

    // Determine if a formal quote has already been created for this request
    const hasQuote = !!(q.quoteId || q.quoteCreated);
    const quoteId = q.quoteId || '';

    el.innerHTML = `
      <div style="flex:1">
        <div style="display:flex; gap:12px; align-items:center;">
          <div style="min-width:200px">
            <div style="font-weight:700;color:#0f172a">${escapeHtml(q.name)} ${escapeHtml(q.surname)}</div>
            <div class="admin-meta">Email: ${escapeHtml(q.email || '—')}</div>
          </div>

          <div style="min-width:220px">
            <div><strong>Vehicle:</strong> ${escapeHtml(q.make || '—')} ${escapeHtml(q.model || '')}</div>
            <div><strong>Service:</strong> ${escapeHtml(q.serviceType || '—')}${q.otherService ? ' — ' + escapeHtml(q.otherService) : ''}</div>
            <div class="admin-meta">Requested: ${escapeHtml(dateStr)}</div>
          </div>
        </div>
      </div>

      <div style="text-align:right; min-width:200px">
        <div style="margin-bottom:10px">
          ${hasQuote ? '<span class="badge quote-created">Quote Created</span>' : ''}
        </div>

        <div style="display:flex; gap:8px; justify-content:flex-end;">
          ${hasQuote
            ? `<button class="btn action-view-quote" data-quote-id="${escapeHtml(quoteId)}" data-id="${escapeHtml(q.id)}">View Quote</button>
               <button class="btn action-download-quote" data-quote-id="${escapeHtml(quoteId)}" data-id="${escapeHtml(q.id)}">Download</button>`
            : `<button class="btn action-create-quote" data-id="${escapeHtml(q.id)}">Create Quote</button>`
          }
        </div>

        <div class="muted" style="margin-top:8px">ID: ${escapeHtml(q.id)}</div>
      </div>
    `;

    quotesListEl.appendChild(el);
  }

  // attach handlers
  Array.from(quotesListEl.querySelectorAll('.action-create-quote')).forEach(btn=>{
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      // open create-quote page in new tab, provide the request id so it can pre-fill
      window.open(`create-quote.html?requestId=${encodeURIComponent(id)}`, '_blank');
    });
  });

  Array.from(quotesListEl.querySelectorAll('.action-view-quote')).forEach(btn=>{
    btn.addEventListener('click', () => {
      const qid = (btn.dataset.quoteId || '').trim();
      const requestId = btn.dataset.id;
      if (qid) {
        window.open(`quote-view.html?quoteId=${encodeURIComponent(qid)}`, '_blank');
      } else if (requestId) {
        // fallback: open a page that can fetch by request id
        window.open(`quote-view.html?requestId=${encodeURIComponent(requestId)}`, '_blank');
      }
    });
  });

  // Attach download handlers for quotes
  Array.from(quotesListEl.querySelectorAll('.action-download-quote')).forEach(btn => {
    btn.addEventListener('click', async () => {
      const quoteId = (btn.dataset.quoteId || '').trim();
      const requestId = (btn.dataset.id || '').trim();
      const fetchId = quoteId || requestId;
      if (!fetchId) return;
      const originalText = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = 'Generating PDF...';

        // Prefer officialQuotes/{quoteId} if quoteId present
        let snapshot;
        if (quoteId) {
          const qRef = doc(db, 'officialQuotes', quoteId);
          snapshot = await getDoc(qRef);
        } else {
          const qRef = doc(db, 'quotes', requestId);
          snapshot = await getDoc(qRef);
        }

        if (!snapshot || !snapshot.exists()) {
          alert('Quote document not found.');
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }

        const data = snapshot.data();

        // Load libraries
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js');

        const { jsPDF } = window.jspdf;
        const docPdf = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageWidth = docPdf.internal.pageSize.getWidth();
        const margin = 40;
        let y = margin;

        // Header - Match invoice-view styling
        docPdf.setFontSize(18);
        docPdf.setTextColor('#08417a');
        docPdf.text('ALS Auto Services — Quote', margin, y);
        
        // Company info (right aligned like invoice-view)
        docPdf.setFontSize(10);
        const companyLines = [
          'ALS Auto Services',
          '34a Central Avenue, Eastleigh, Edenvale',
          'Phone: +27 073 299 2009',
          'Email: allwynsewell@gmail.com'
        ];
        const rightX = pageWidth - margin;
        companyLines.forEach((line, i) => {
          docPdf.text(line, rightX, y + (i * 12), { align: 'right' });
        });
        y += 28;

        // Meta information
        docPdf.setFontSize(11);
        docPdf.setTextColor(40);
        docPdf.text(`Quote ID: ${fetchId}`, margin, y);
        const createdAt = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toLocaleString() : String(data.createdAt)) : '—';
        docPdf.text(`Created: ${createdAt}`, margin + 260, y);
        y += 20;

        // Separator line
        docPdf.setDrawColor(230);
        docPdf.setLineWidth(0.5);
        docPdf.line(margin, y, pageWidth - margin, y);
        y += 14;

        // Customer block
        docPdf.setFontSize(12);
        docPdf.setTextColor(30);
        docPdf.text('Customer / Account', margin, y);
        y += 14;
        docPdf.setFontSize(10);
        const custName = (data.customer && data.customer.name) ? data.customer.name : (data.name || `${data.name || ''} ${data.surname || ''}`.trim() || '—');
        const custEmail = (data.customer && data.customer.email) ? data.customer.email : (data.email || '—');
        const custPhone = (data.customer && data.customer.phone) ? data.customer.phone : '—';
        docPdf.text(`Name: ${custName}`, margin, y);
        docPdf.text(`Email: ${custEmail}`, margin + 260, y);
        y += 14;
        if (custPhone !== '—') {
          docPdf.text(`Phone: ${custPhone}`, margin, y);
          y += 18;
        } else {
          y += 4;
        }

        // Vehicle & service
        docPdf.setFontSize(12);
        docPdf.text('Vehicle & Service', margin, y);
        y += 14;
        docPdf.setFontSize(10);
        const vehicle = `${data.vehicleMake || data.make || ''} ${data.vehicleModel || data.model || ''}`.trim() || '—';
        const service = `${data.serviceType || ''}${data.otherService ? ' — ' + (data.otherService || '') : ''}`;
        docPdf.text(`Vehicle: ${vehicle}`, margin, y);
        docPdf.text(`Service: ${service}`, margin + 260, y);
        y += 22;

        // Items table (if present)
        const items = Array.isArray(data.items) ? data.items : (data.items || []);
        if (items.length) {
          const tableBody = items.map(it => [
            it.description || '',
            it.qty || 0,
            Number(it.unit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Number(it.lineTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          ]);

          docPdf.autoTable({
            startY: y,
            head: [['Description','Qty','Unit (R)','Price (R)']],
            body: tableBody,
            margin: { left: margin, right: margin },
            styles: { fontSize: 10, cellPadding: 6 },
            headStyles: { fillColor: [245,245,245], textColor: 20, fontStyle: 'bold' },
            columnStyles: {
              1: { halign: 'center', cellWidth: 40 },
              2: { halign: 'right', cellWidth: 80 },
              3: { halign: 'right', cellWidth: 90 }
            }
          });
          y = docPdf.lastAutoTable ? docPdf.lastAutoTable.finalY + 10 : (y + 120);
        }

        // Totals if present
        if (data.subtotal !== undefined || data.total !== undefined) {
          const totalsX = pageWidth - margin - 240;
          docPdf.setFontSize(10);
          docPdf.text('Subtotal:', totalsX, y);
          docPdf.text(fmtCurrency(data.subtotal || 0), pageWidth - margin, y, { align: 'right' });
          y += 14;
          docPdf.text('Tax:', totalsX, y);
          docPdf.text(fmtCurrency(data.taxAmount || 0), pageWidth - margin, y, { align: 'right' });
          y += 14;
          docPdf.setFontSize(12);
          docPdf.setFont(undefined, 'bold');
          docPdf.text('Total:', totalsX, y);
          docPdf.text(fmtCurrency(data.total || 0), pageWidth - margin, y, { align: 'right' });
          y += 22;
        }

        // Notes (if any)
        if (data.notes) {
          docPdf.setFontSize(11);
          docPdf.setFont(undefined, 'normal');
          docPdf.text('Notes', margin, y);
          y += 12;
          docPdf.setFontSize(10);
          const notesLines = docPdf.splitTextToSize(String(data.notes || ''), pageWidth - margin * 2);
          docPdf.text(notesLines, margin, y);
          y += (notesLines.length * 12) + 8;
        }

        // Footer info
        const createdBy = data.createdBy || '—';
        const updatedAt = data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate().toLocaleString() : String(data.updatedAt)) : '—';
        docPdf.setFontSize(9);
        docPdf.setTextColor(110);
        docPdf.text(`Created by: ${createdBy}`, margin, docPdf.internal.pageSize.getHeight() - 60);
        docPdf.text(`Updated: ${updatedAt}`, margin + 200, docPdf.internal.pageSize.getHeight() - 60);

        // Trigger download
        const filename = quoteId ? `quote-${quoteId}.pdf` : `quote-request-${requestId}.pdf`;
        docPdf.save(filename);

        btn.textContent = 'Downloaded';
      } catch (err) {
        console.error('Quote PDF generation failed', err);
        alert('Failed to generate PDF. See console for details.');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });
}

// ---------------------- end quotes section ----------------------

// INVOICES section listener already present above

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
    btn.textContent = `Updating...`;
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
    // UI is updated by snapshot automatically
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

    // load admin list and start bookings & invoices listeners
    loadAdmins();
    listenBookings();
    listenInvoices();

    // start quotes listener (new)
    listenQuotes();

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
if (quotesFilter) {
  quotesFilter.addEventListener('change', () => {
    listenQuotes();
  });
}

/* -------------------------
   COLLAPSIBLE SECTIONS
   - Adds a right-aligned toggle button to each .section
   - Collapses/expands everything in the section except the <h2>
   - Persists state in localStorage under keys: admin_section_<sanitized-title>
   ------------------------- */
function sanitizeKey(s) {
  return (s || 'section').toLowerCase().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
}

function setupCollapsibles() {
  try {
    const sections = Array.from(document.querySelectorAll('.section'));
    sections.forEach((sectionEl, idx) => {
      const heading = sectionEl.querySelector('h2');
      if (!heading) return;

      // Create a header wrapper (flex row: title left, toggle right)
      const headerWrap = document.createElement('div');
      headerWrap.className = 'section-header';
      // inline styles so it works without touching admin.css
      headerWrap.style.cssText = 'display:flex;align-items:center;gap:12px;justify-content:space-between;margin-bottom:8px;';

      // Move existing h2 into wrapper
      heading.style.margin = '0';
      headerWrap.appendChild(heading);

      // Create toggle button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-toggle';
      btn.setAttribute('aria-expanded', 'true');
      btn.style.cssText = 'margin-left:12px;padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0;background:transparent;cursor:pointer';
      // icon: triangle pointing down (expanded) or right (collapsed)
      const titleText = heading.textContent.trim();
      const storageKey = `admin_section_${sanitizeKey(titleText || `section_${idx}`)}`;

      function setButtonState(expanded) {
        btn.innerHTML = expanded ? 'Collapse ▼' : 'Expand ►';
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }

      // Build content container: move all children except the (now moved) heading into contentDiv
      const contentDiv = document.createElement('div');
      contentDiv.className = 'section-content';
      // Move all remaining children of sectionEl into contentDiv
      while (sectionEl.children.length > 0) {
        // after moving heading into headerWrap, first child is headerWrap (we will re-attach)
        break;
      }
      // We need to re-attach headerWrap and then move everything else into contentDiv
      // Remove all current children, we'll re-append headerWrap then contentDiv
      const originalChildren = Array.from(sectionEl.childNodes);
      sectionEl.innerHTML = '';
      sectionEl.appendChild(headerWrap);

      // Move original children except the h2 (now inside headerWrap) into contentDiv
      originalChildren.forEach(node => {
        // skip the heading node if present in the list (we already moved it into headerWrap)
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'h2') {
          return;
        }
        contentDiv.appendChild(node);
      });

      // Append the toggle button into headerWrap (to the right)
      headerWrap.appendChild(btn);

      // Append the contentDiv into section
      sectionEl.appendChild(contentDiv);

      // Read saved state or default to expanded for 'Admins' and 'Bookings' and 'Invoices' (can customize)
      let saved = null;
      try { saved = localStorage.getItem(storageKey); } catch (e) { /* ignore */ }
      const isCollapsed = saved === 'collapsed';
      if (isCollapsed) {
        contentDiv.style.display = 'none';
        setButtonState(false);
      } else {
        contentDiv.style.display = '';
        setButtonState(true);
      }

      // Toggle handler
      btn.addEventListener('click', () => {
        const currentlyCollapsed = contentDiv.style.display === 'none';
        if (currentlyCollapsed) {
          // expand
          contentDiv.style.display = '';
          setButtonState(true);
          try { localStorage.setItem(storageKey, 'expanded'); } catch (e) {}
        } else {
          // collapse
          contentDiv.style.display = 'none';
          setButtonState(false);
          try { localStorage.setItem(storageKey, 'collapsed'); } catch (e) {}
        }
      });

      // keyboard accessibility: space/enter should toggle (button already supports this by default)
    });
  } catch (err) {
    // Fail silently; collapsible feature should not break the rest of the admin dashboard
    console.error('setupCollapsibles error', err);
  }
}

// run collapsibles setup after a short tick so the DOM is ready and other code above can attach
// (This script is loaded at end of body as module, so DOM is ready; small delay ensures listeners created earlier run first)
setTimeout(setupCollapsibles, 50);