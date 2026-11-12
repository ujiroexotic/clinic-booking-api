// Apex Clinic Booking App

let currentApiKey = localStorage.getItem('clinic_api_key') || '';
let allSlots = [];
let nextCursor = null;
let currentLookupEmail = '';

// DOM Elements
const slotsContainer = document.getElementById('slotsContainer');
const emptyState = document.getElementById('emptyState');
const providerFilter = document.getElementById('providerFilter');
const slotsCountBadge = document.getElementById('slotsCountBadge');
const refreshSlotsBtn = document.getElementById('refreshSlotsBtn');

// Settings Elements
const configToggleBtn = document.getElementById('configToggleBtn');
const settingsPanel = document.getElementById('settingsPanel');
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const seedDataBtn = document.getElementById('seedDataBtn');
const initSlotsBtn = document.getElementById('initSlotsBtn');

// Booking Modal Elements
const bookingModal = document.getElementById('bookingModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const bookingForm = document.getElementById('bookingForm');
const selectedSlotId = document.getElementById('selectedSlotId');
const summaryProvider = document.getElementById('summaryProvider');
const summaryTime = document.getElementById('summaryTime');
const patientName = document.getElementById('patientName');
const patientEmail = document.getElementById('patientEmail');
const bookingError = document.getElementById('bookingError');
const submitBookingBtn = document.getElementById('submitBookingBtn');

// Confirmation Modal Elements
const confirmationModal = document.getElementById('confirmationModal');
const closeConfirmationBtn = document.getElementById('closeConfirmationBtn');
const receiptId = document.getElementById('receiptId');
const receiptProvider = document.getElementById('receiptProvider');
const receiptTime = document.getElementById('receiptTime');
const receiptName = document.getElementById('receiptName');
const receiptEmail = document.getElementById('receiptEmail');

// My Bookings Elements
const viewMyBookingsBtn = document.getElementById('viewMyBookingsBtn');
const myBookingsModal = document.getElementById('myBookingsModal');
const closeMyBookingsBtn = document.getElementById('closeMyBookingsBtn');
const lookupEmail = document.getElementById('lookupEmail');
const searchBookingsBtn = document.getElementById('searchBookingsBtn');
const userBookingsList = document.getElementById('userBookingsList');
const paginationBar = document.getElementById('paginationBar');
const nextPageBtn = document.getElementById('nextPageBtn');
const toastContainer = document.getElementById('toastContainer');

// Initialize
async function init() {
  try {
    if (!currentApiKey) {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        currentApiKey = data.defaultApiKey || 'clinic-secret-key-2026';
        localStorage.setItem('clinic_api_key', currentApiKey);
      }
    }
  } catch (err) {
    console.warn('Could not fetch default key, using fallback');
  }

  apiKeyInput.value = currentApiKey;
  await loadSlots();
}

// Helpers
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    return {
      date: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    };
  } catch {
    return { date: isoString, time: '' };
  }
}

// Load Slots
async function loadSlots() {
  slotsCountBadge.textContent = 'Loading...';
  try {
    const provider = providerFilter.value;
    const url = provider ? `/slots?provider=${encodeURIComponent(provider)}` : '/slots';

    const res = await fetch(url, {
      headers: { 'X-API-Key': currentApiKey }
    });

    if (res.status === 401) {
      showToast('Unauthorized: Check your API Key in Settings', 'error');
      settingsPanel.classList.remove('hidden');
      slotsCountBadge.textContent = 'Unauthorized';
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to load slots', 'error');
      return;
    }

    const data = await res.json();
    allSlots = data.slots || [];

    // Populate provider dropdown if empty
    if (providerFilter.options.length <= 1) {
      const providers = [...new Set(allSlots.map(s => s.provider))];
      providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        providerFilter.appendChild(opt);
      });
    }

    renderSlots();
  } catch (err) {
    console.error('Error loading slots:', err);
    showToast('Failed to connect to server', 'error');
  }
}

// Render Slots Grid
function renderSlots() {
  slotsContainer.innerHTML = '';
  const availableCount = allSlots.filter(s => s.available).length;
  slotsCountBadge.textContent = `${availableCount} available / ${allSlots.length} total`;

  if (allSlots.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  allSlots.forEach(slot => {
    const startFmt = formatDateTime(slot.start);
    const endFmt = formatDateTime(slot.end);

    const card = document.createElement('div');
    card.className = `slot-card ${slot.available ? '' : 'booked'}`;

    card.innerHTML = `
      <div class="slot-header">
        <h4 class="provider-name">${escapeHtml(slot.provider)}</h4>
        <span class="badge ${slot.available ? 'badge-success' : 'badge-danger'}">
          ${slot.available ? 'Available' : 'Booked'}
        </span>
      </div>
      <div class="slot-timing">
        <div class="slot-date">📅 ${startFmt.date}</div>
        <div class="slot-hours">⏰ ${startFmt.time} – ${endFmt.time}</div>
      </div>
      <div class="slot-footer">
        <small class="text-muted">ID: ${escapeHtml(slot.id)}</small>
        ${
          slot.available
            ? `<button class="btn btn-sm btn-primary book-slot-btn" data-id="${escapeHtml(slot.id)}">Book Slot</button>`
            : `<button class="btn btn-sm btn-secondary" disabled>Unavailable</button>`
        }
      </div>
    `;

    slotsContainer.appendChild(card);
  });

  // Attach button click events
  document.querySelectorAll('.book-slot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const slotId = e.currentTarget.getAttribute('data-id');
      openBookingModal(slotId);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Open Booking Modal
function openBookingModal(slotId) {
  const slot = allSlots.find(s => s.id === slotId);
  if (!slot) return;

  selectedSlotId.value = slot.id;
  summaryProvider.textContent = slot.provider;
  const startFmt = formatDateTime(slot.start);
  const endFmt = formatDateTime(slot.end);
  summaryTime.textContent = `${startFmt.date} (${startFmt.time} - ${endFmt.time})`;

  bookingError.classList.add('hidden');
  bookingError.textContent = '';
  bookingModal.classList.remove('hidden');
  patientName.focus();
}

function closeBookingModal() {
  bookingModal.classList.add('hidden');
  bookingForm.reset();
}

// Handle Booking Submit
bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  bookingError.classList.add('hidden');
  submitBookingBtn.disabled = true;

  const slotId = selectedSlotId.value;
  const name = patientName.value.trim();
  const email = patientEmail.value.trim();

  // Generate idempotency key for this submission attempt
  const idempotencyKey = 'web_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

  try {
    const res = await fetch('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': currentApiKey,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({ slot_id: slotId, name, email })
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 201) {
      closeBookingModal();
      openConfirmationModal(data);
      await loadSlots();
      showToast('Booking successfully confirmed!', 'success');
      return;
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') || '60';
      bookingError.textContent = `Too many booking attempts. Please wait ${retryAfter} seconds before trying again.`;
      bookingError.classList.remove('hidden');
      return;
    }

    bookingError.textContent = data.error || 'Failed to complete booking';
    bookingError.classList.remove('hidden');
  } catch (err) {
    bookingError.textContent = 'Network error. Please try again.';
    bookingError.classList.remove('hidden');
  } finally {
    submitBookingBtn.disabled = false;
  }
});

// Confirmation Modal
function openConfirmationModal(booking) {
  receiptId.textContent = booking.id;
  const slot = allSlots.find(s => s.id === booking.slot_id);
  receiptProvider.textContent = slot ? slot.provider : '-';
  if (slot) {
    const startFmt = formatDateTime(slot.start);
    receiptTime.textContent = `${startFmt.date} at ${startFmt.time}`;
  } else {
    receiptTime.textContent = formatDateTime(booking.created_at).date;
  }
  receiptName.textContent = booking.name;
  receiptEmail.textContent = booking.email;

  confirmationModal.classList.remove('hidden');
}

closeConfirmationBtn.addEventListener('click', () => {
  confirmationModal.classList.add('hidden');
});

// Settings & Config
configToggleBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

toggleKeyVisibility.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyVisibility.textContent = 'Hide';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyVisibility.textContent = 'Show';
  }
});

saveKeyBtn.addEventListener('click', () => {
  currentApiKey = apiKeyInput.value.trim();
  localStorage.setItem('clinic_api_key', currentApiKey);
  showToast('API Key saved!', 'success');
  loadSlots();
});

// Seed Data
async function seedSampleSlots() {
  const now = new Date();
  const slots = [];
  const providers = ['Dr Ade', 'Dr Bello', 'Dr Fatima', 'Dr Okafor'];

  let idCounter = 1;
  for (let day = 1; day <= 4; day++) {
    for (let hour = 9; hour <= 14; hour += 2) {
      const provider = providers[(day + hour) % providers.length];
      const start = new Date(Date.now() + (day * 24 + hour) * 3600 * 1000);
      const end = new Date(start.getTime() + 45 * 60 * 1000);

      slots.push({
        id: `slot_${idCounter++}`,
        provider,
        start: start.toISOString(),
        end: end.toISOString()
      });
    }
  }

  try {
    const res = await fetch('/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': currentApiKey
      },
      body: JSON.stringify({ slots })
    });

    if (res.ok) {
      showToast(`Loaded ${slots.length} sample appointment slots!`, 'success');
      providerFilter.innerHTML = '<option value="">All Doctors</option>';
      await loadSlots();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to seed slots', 'error');
    }
  } catch (err) {
    showToast('Network error during reset', 'error');
  }
}

seedDataBtn.addEventListener('click', seedSampleSlots);
initSlotsBtn.addEventListener('click', seedSampleSlots);

// My Bookings lookup
viewMyBookingsBtn.addEventListener('click', () => {
  myBookingsModal.classList.remove('hidden');
  lookupEmail.focus();
});

closeMyBookingsBtn.addEventListener('click', () => {
  myBookingsModal.classList.add('hidden');
});

searchBookingsBtn.addEventListener('click', async () => {
  currentLookupEmail = lookupEmail.value.trim();
  if (!currentLookupEmail) {
    showToast('Please enter an email address', 'error');
    return;
  }
  nextCursor = null;
  userBookingsList.innerHTML = '<p class="text-muted">Searching...</p>';
  await fetchUserBookings(false);
});

nextPageBtn.addEventListener('click', async () => {
  if (nextCursor) {
    await fetchUserBookings(true);
  }
});

async function fetchUserBookings(isNextPage = false) {
  try {
    let url = `/bookings?email=${encodeURIComponent(currentLookupEmail)}&limit=5`;
    if (isNextPage && nextCursor) {
      url += `&cursor=${encodeURIComponent(nextCursor)}`;
    }

    const res = await fetch(url, {
      headers: { 'X-API-Key': currentApiKey }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to fetch bookings', 'error');
      return;
    }

    const data = await res.json();
    const bookings = data.bookings || [];
    nextCursor = data.next_cursor;

    if (!isNextPage) {
      userBookingsList.innerHTML = '';
    }

    if (bookings.length === 0 && !isNextPage) {
      userBookingsList.innerHTML = '<p class="text-muted">No bookings found for this email.</p>';
      paginationBar.classList.add('hidden');
      return;
    }

    bookings.forEach(b => {
      const item = document.createElement('div');
      item.className = `user-booking-item ${b.status === 'cancelled' ? 'cancelled' : ''}`;
      const createdFmt = formatDateTime(b.created_at);

      item.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 0.9rem;">Slot ID: ${escapeHtml(b.slot_id)}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Ref: ${escapeHtml(b.id)} • Booked: ${createdFmt.date}</div>
          <span class="badge ${b.status === 'confirmed' ? 'badge-success' : 'badge-danger'}">
            ${b.status}
          </span>
        </div>
        <div>
          ${
            b.status === 'confirmed'
              ? `<button class="btn btn-sm btn-danger-outline cancel-btn" data-id="${escapeHtml(b.id)}">Cancel</button>`
              : `<span class="badge badge-danger">Cancelled</span>`
          }
        </div>
      `;

      userBookingsList.appendChild(item);
    });

    // Attach cancel handler
    userBookingsList.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to cancel this booking?')) {
          await cancelUserBooking(id);
        }
      };
    });

    if (nextCursor) {
      paginationBar.classList.remove('hidden');
    } else {
      paginationBar.classList.add('hidden');
    }
  } catch (err) {
    showToast('Failed to load user bookings', 'error');
  }
}

async function cancelUserBooking(id) {
  try {
    const res = await fetch(`/bookings/${id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': currentApiKey }
    });

    if (res.ok) {
      showToast('Booking successfully cancelled and slot freed', 'success');
      await fetchUserBookings(false);
      await loadSlots();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to cancel booking', 'error');
    }
  } catch (err) {
    showToast('Error cancelling booking', 'error');
  }
}

// Event Listeners
closeModalBtn.addEventListener('click', closeBookingModal);
cancelModalBtn.addEventListener('click', closeBookingModal);
refreshSlotsBtn.addEventListener('click', loadSlots);
providerFilter.addEventListener('change', loadSlots);

// Start
init();

