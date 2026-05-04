const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SQLITE_PATH = path.join(DATA_DIR, 'barbershop.sqlite');
const BARBERS_PATH = path.join(DATA_DIR, 'barbers.json');
const RESERVATIONS_PATH = path.join(DATA_DIR, 'reservations.json');
const NOTIFICATIONS_PATH = path.join(DATA_DIR, 'notifications.json');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const ADMIN_PATH = path.join(ROOT_DIR, 'admin.html');
const BARBER_PAGE_PATH = path.join(ROOT_DIR, 'barber.html');
const BARBER_ONBOARDING_PATH = path.join(ROOT_DIR, 'barber-onboarding.html');
const DEFAULT_SLOT_INTERVAL_MINUTES = 30;
const DEFAULT_DAY_START = '09:00';
const DEFAULT_DAY_END = '19:00';
const DEFAULT_BREAK_START = '12:00';
const DEFAULT_BREAK_END = '14:00';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BOOKING_WINDOW_DAYS = 21;
const BARBER_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
const SERVICE_DURATIONS = {
  'Classic Haircut — €22': 45,
  'Cut and Beard — €35': 60,
  'Hot Towel Shave — €28': 50,
  'Beard Sculpting — €18': 30,
  'Kids Haircut — €15': 30,
  'VIP Experience — €65': 90
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, { 'Content-Type': contentType });
  response.end(body);
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`Unable to read JSON seed at ${filePath}: ${error.message}`);
    return [];
  }
}

function isValidTime(value) {
  return TIME_PATTERN.test(String(value || ''));
}

function isValidDate(value) {
  return DATE_PATTERN.test(String(value || ''));
}

function timeToMinutes(value) {
  if (!isValidTime(value)) {
    return null;
  }

  const [hours, minutes] = String(value).split(':').map(Number);
  return (hours * 60) + minutes;
}

function minutesToTime(minutes) {
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function normalizeWorkDays(workDays) {
  const normalized = Array.from(new Set(
    (Array.isArray(workDays) ? workDays : [])
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )).sort((left, right) => left - right);

  return normalized.length ? normalized : [1, 2, 3, 4, 5];
}

function normalizeBlockedSlots(blockedSlots) {
  return (Array.isArray(blockedSlots) ? blockedSlots : []).reduce((accumulator, slot) => {
    if (!slot || typeof slot !== 'object') {
      return accumulator;
    }

    const normalized = {};
    if (slot.time && isValidTime(slot.time)) {
      normalized.time = String(slot.time);
    }
    if (slot.date && isValidDate(slot.date)) {
      normalized.date = String(slot.date);
    }
    if (slot.service && String(slot.service).trim()) {
      normalized.service = String(slot.service).trim();
    }

    if (normalized.time || normalized.date || normalized.service) {
      accumulator.push(normalized);
    }

    return accumulator;
  }, []);
}

function normalizeAvailability(availability = {}) {
  const workDays = normalizeWorkDays(availability.workDays);
  const dayStart = isValidTime(availability.dayStart) ? String(availability.dayStart) : DEFAULT_DAY_START;
  const dayEnd = isValidTime(availability.dayEnd) ? String(availability.dayEnd) : DEFAULT_DAY_END;
  const breakStart = isValidTime(availability.breakStart) ? String(availability.breakStart) : DEFAULT_BREAK_START;
  const breakEnd = isValidTime(availability.breakEnd) ? String(availability.breakEnd) : DEFAULT_BREAK_END;
  const slotIntervalMinutes = Number.isInteger(Number(availability.slotIntervalMinutes))
    ? Math.min(Math.max(Number(availability.slotIntervalMinutes), 15), 120)
    : DEFAULT_SLOT_INTERVAL_MINUTES;

  const safeDayStartMinutes = timeToMinutes(dayStart);
  const safeDayEndMinutes = timeToMinutes(dayEnd);
  const safeBreakStartMinutes = timeToMinutes(breakStart);
  const safeBreakEndMinutes = timeToMinutes(breakEnd);

  const hasValidDayRange = safeDayStartMinutes !== null
    && safeDayEndMinutes !== null
    && safeDayEndMinutes > safeDayStartMinutes;

  const hasValidBreakRange = hasValidDayRange
    && safeBreakStartMinutes !== null
    && safeBreakEndMinutes !== null
    && safeBreakEndMinutes > safeBreakStartMinutes
    && safeBreakStartMinutes > safeDayStartMinutes
    && safeBreakEndMinutes < safeDayEndMinutes;

  return {
    workDays,
    blockedSlots: normalizeBlockedSlots(availability.blockedSlots),
    dayStart: hasValidDayRange ? dayStart : DEFAULT_DAY_START,
    dayEnd: hasValidDayRange ? dayEnd : DEFAULT_DAY_END,
    breakStart: hasValidBreakRange ? breakStart : DEFAULT_BREAK_START,
    breakEnd: hasValidBreakRange ? breakEnd : DEFAULT_BREAK_END,
    slotIntervalMinutes
  };
}

function normalizeBarber(barber = {}) {
  return {
    ...barber,
    id: String(barber.id || '').trim(),
    name: String(barber.name || '').trim(),
    accessCode: String(barber.accessCode || '').trim(),
    role: String(barber.role || '').trim(),
    experience: String(barber.experience || '').trim(),
    bio: String(barber.bio || '').trim(),
    supportedServices: Array.from(new Set((Array.isArray(barber.supportedServices) ? barber.supportedServices : [])
      .map((service) => String(service).trim())
      .filter(Boolean))),
    availability: normalizeAvailability(barber.availability || {}),
    active: barber.active !== false,
    createdAt: barber.createdAt || null,
    updatedAt: barber.updatedAt || null,
    deletedAt: barber.deletedAt || null,
    phoneNumber: barber.phoneNumber || '',
    phoneVerified: barber.phoneVerified === true,
    phoneVerificationRequestedAt: barber.phoneVerificationRequestedAt || null,
    phoneVerifiedAt: barber.phoneVerifiedAt || null,
    phoneVerificationCodeHash: barber.phoneVerificationCodeHash || null,
    notificationPreference: barber.notificationPreference || 'sms',
    email: String(barber.email || '').trim().toLowerCase(),
    passwordHash: barber.passwordHash || null,
    accountCreatedAt: barber.accountCreatedAt || null,
    sessionTokenHash: barber.sessionTokenHash || null,
    sessionExpiresAt: barber.sessionExpiresAt || null
  };
}

function normalizeReservation(reservation = {}) {
  return {
    ...reservation,
    customer: reservation.customer || {},
    durationMinutes: Number(reservation.durationMinutes) || getServiceDuration(reservation.service),
    confirmedAt: reservation.confirmedAt || null
  };
}

function normalizeNotification(notification = {}) {
  return {
    ...notification,
    metadata: notification.metadata || {}
  };
}

const db = new DatabaseSync(SQLITE_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS barbers (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const selectRowsByUpdatedAtDesc = {
  barbers: db.prepare('SELECT payload FROM barbers ORDER BY updated_at DESC, id DESC'),
  reservations: db.prepare('SELECT payload FROM reservations ORDER BY updated_at DESC, id DESC'),
  notifications: db.prepare('SELECT payload FROM notifications ORDER BY updated_at DESC, id DESC')
};
const clearTableStatements = {
  barbers: db.prepare('DELETE FROM barbers'),
  reservations: db.prepare('DELETE FROM reservations'),
  notifications: db.prepare('DELETE FROM notifications')
};
const insertStatements = {
  barbers: db.prepare('INSERT OR REPLACE INTO barbers (id, payload, updated_at) VALUES (?, ?, ?)'),
  reservations: db.prepare('INSERT OR REPLACE INTO reservations (id, payload, updated_at) VALUES (?, ?, ?)'),
  notifications: db.prepare('INSERT OR REPLACE INTO notifications (id, payload, updated_at) VALUES (?, ?, ?)')
};

function countTableRows(tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function writeSnapshot(filePath, rows) {
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
}

function replaceTable(tableName, rows, normalizeRow, snapshotPath) {
  const normalizedRows = rows.map(normalizeRow);
  try {
    db.exec('BEGIN');
    clearTableStatements[tableName].run();
    normalizedRows.forEach((row) => {
      insertStatements[tableName].run(
        row.id,
        JSON.stringify(row),
        row.updatedAt || row.createdAt || new Date(0).toISOString()
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeSnapshot(snapshotPath, normalizedRows);
}

function readTable(tableName, normalizeRow) {
  return selectRowsByUpdatedAtDesc[tableName].all().map((entry) => normalizeRow(JSON.parse(entry.payload)));
}

function initializeStorage() {
  if (countTableRows('barbers') === 0) {
    replaceTable('barbers', readJsonArray(BARBERS_PATH), normalizeBarber, BARBERS_PATH);
  } else {
    writeSnapshot(BARBERS_PATH, readTable('barbers', normalizeBarber));
  }

  if (countTableRows('reservations') === 0) {
    replaceTable('reservations', readJsonArray(RESERVATIONS_PATH), normalizeReservation, RESERVATIONS_PATH);
  } else {
    writeSnapshot(RESERVATIONS_PATH, readTable('reservations', normalizeReservation));
  }

  if (countTableRows('notifications') === 0) {
    replaceTable('notifications', readJsonArray(NOTIFICATIONS_PATH), normalizeNotification, NOTIFICATIONS_PATH);
  } else {
    writeSnapshot(NOTIFICATIONS_PATH, readTable('notifications', normalizeNotification));
  }
}

initializeStorage();

function readBarbers() {
  return readTable('barbers', normalizeBarber);
}

function writeBarbers(barbers) {
  replaceTable('barbers', barbers, normalizeBarber, BARBERS_PATH);
}

function readReservations() {
  return readTable('reservations', normalizeReservation);
}

function writeReservations(reservations) {
  replaceTable('reservations', reservations, normalizeReservation, RESERVATIONS_PATH);
}

function readNotifications() {
  return readTable('notifications', normalizeNotification);
}

function writeNotifications(notifications) {
  replaceTable('notifications', notifications, normalizeNotification, NOTIFICATIONS_PATH);
}

function toPublicBarber(barber) {
  return {
    id: barber.id,
    name: barber.name,
    role: barber.role,
    experience: barber.experience,
    bio: barber.bio,
    supportedServices: barber.supportedServices
  };
}

function toBarberSelf(barber) {
  return {
    id: barber.id,
    name: barber.name,
    email: barber.email,
    role: barber.role,
    experience: barber.experience,
    bio: barber.bio,
    supportedServices: barber.supportedServices,
    availability: barber.availability,
    active: barber.active !== false,
    phoneNumber: barber.phoneNumber,
    phoneVerified: barber.phoneVerified === true,
    phoneVerificationRequestedAt: barber.phoneVerificationRequestedAt,
    phoneVerifiedAt: barber.phoneVerifiedAt,
    notificationPreference: barber.notificationPreference,
    accountCreatedAt: barber.accountCreatedAt,
    hasAccount: Boolean(barber.passwordHash)
  };
}

function getBarberPortalPath(barberId) {
  return `/barber/${barberId}`;
}

function getBarberOnboardingPath(barberId) {
  return `/barber/onboard/${barberId}`;
}

function getAbsoluteUrl(request, pathname) {
  return `http://${request.headers.host || `localhost:${PORT}`}${pathname}`;
}

function toAdminBarber(request, barber) {
  const portalPath = getBarberPortalPath(barber.id);
  const onboardingPath = getBarberOnboardingPath(barber.id);

  return {
    id: barber.id,
    name: barber.name,
    accessCode: barber.accessCode,
    email: barber.email,
    role: barber.role,
    experience: barber.experience,
    bio: barber.bio,
    phoneNumber: barber.phoneNumber,
    phoneVerified: barber.phoneVerified === true,
    phoneVerificationRequestedAt: barber.phoneVerificationRequestedAt,
    phoneVerifiedAt: barber.phoneVerifiedAt,
    notificationPreference: barber.notificationPreference,
    supportedServices: barber.supportedServices,
    availability: barber.availability,
    active: barber.active !== false,
    createdAt: barber.createdAt,
    updatedAt: barber.updatedAt,
    deletedAt: barber.deletedAt,
    status: barber.active === false ? 'deleted' : 'active',
    portalPath,
    portalUrl: getAbsoluteUrl(request, portalPath),
    onboardingPath,
    onboardingUrl: getAbsoluteUrl(request, onboardingPath),
    accountStatus: barber.passwordHash ? 'active' : 'invite_pending',
    hasAccount: Boolean(barber.passwordHash),
    maskedPhoneNumber: maskPhoneNumber(barber.phoneNumber || '')
  };
}

function toReservationSummary(reservation) {
  return {
    id: reservation.id,
    barberId: reservation.barberId,
    barberName: reservation.barberName,
    service: reservation.service,
    durationMinutes: getReservationDuration(reservation),
    date: reservation.date,
    time: reservation.time,
    status: reservation.status,
    customer: reservation.customer,
    notes: reservation.notes,
    barberDecisionNote: reservation.barberDecisionNote || null,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    confirmedAt: reservation.confirmedAt || null
  };
}

function toNotificationSummary(notification) {
  return {
    id: notification.id,
    barberId: notification.barberId,
    type: notification.type,
    channel: notification.channel,
    destination: notification.destination,
    status: notification.status,
    message: notification.message,
    createdAt: notification.createdAt,
    metadata: notification.metadata || {}
  };
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime();
    const rightTime = new Date(right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
}

function getReservationStatusCounts(reservations) {
  return reservations.reduce((counts, reservation) => {
    const status = reservation.status || 'pending';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {
    pending: 0,
    confirmed: 0,
    rejected: 0
  });
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function normalizePhoneNumber(phoneNumber) {
  return String(phoneNumber || '').replace(/\s+/g, '').trim();
}

function maskPhoneNumber(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return '';
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, Math.min(4, normalized.length - 2))}${'*'.repeat(Math.max(2, normalized.length - 6))}${normalized.slice(-2)}`;
}

function validatePhoneNumber(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return true;
  return /^\+?[0-9]{9,15}$/.test(normalized);
}

function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || !String(passwordHash).includes(':')) {
    return false;
  }

  const [salt, storedKey] = String(passwordHash).split(':');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const storedBuffer = Buffer.from(storedKey, 'hex');
  const derivedBuffer = Buffer.from(derivedKey, 'hex');

  if (storedBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, derivedBuffer);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createBarberSession(barber) {
  const token = crypto.randomBytes(24).toString('hex');
  barber.sessionTokenHash = hashSessionToken(token);
  barber.sessionExpiresAt = new Date(Date.now() + BARBER_SESSION_DURATION_MS).toISOString();
  barber.updatedAt = new Date().toISOString();
  return {
    token,
    expiresAt: barber.sessionExpiresAt
  };
}

function clearBarberSession(barber) {
  barber.sessionTokenHash = null;
  barber.sessionExpiresAt = null;
  barber.updatedAt = new Date().toISOString();
}

function hasValidBarberSession(barber, token) {
  if (!token || !barber.sessionTokenHash || !barber.sessionExpiresAt) {
    return false;
  }

  const expiresAt = new Date(barber.sessionExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  return hashSessionToken(token) === barber.sessionTokenHash;
}

function createNotificationId() {
  return `notif_${crypto.randomBytes(4).toString('hex')}`;
}

function isConfirmedReservation(reservation) {
  return reservation.status === 'confirmed';
}

function getConfirmedReservationsForBarber(reservations, barberId) {
  return reservations.filter((reservation) => reservation.barberId === barberId && isConfirmedReservation(reservation));
}

function queueNotification(notification) {
  const notifications = readNotifications();
  const entry = {
    id: createNotificationId(),
    status: 'logged',
    createdAt: new Date().toISOString(),
    ...notification
  };

  notifications.push(entry);
  writeNotifications(notifications);
  console.log(`[notification:${entry.channel}] ${entry.destination} :: ${entry.message}`);
  return entry;
}

function issuePhoneVerification(barber) {
  const normalizedPhone = normalizePhoneNumber(barber.phoneNumber);

  if (!normalizedPhone) {
    barber.phoneVerified = false;
    barber.phoneVerificationRequestedAt = null;
    barber.phoneVerificationCodeHash = null;
    barber.phoneVerifiedAt = null;
    return null;
  }

  const code = createVerificationCode();
  barber.phoneNumber = normalizedPhone;
  barber.phoneVerified = false;
  barber.phoneVerificationRequestedAt = new Date().toISOString();
  barber.phoneVerifiedAt = null;
  barber.phoneVerificationCodeHash = hashVerificationCode(code);

  return queueNotification({
    barberId: barber.id,
    type: 'phone_verification',
    channel: 'sms',
    destination: normalizedPhone,
    message: `Your verification code for The Sharp Cut is ${code}.`,
    metadata: {
      purpose: 'phone_verification'
    }
  });
}

function getWeekday(dateString) {
  return new Date(`${dateString}T12:00:00`).getDay();
}

function getServiceDuration(service) {
  return SERVICE_DURATIONS[String(service).trim()] || 30;
}

function getReservationDuration(reservation) {
  return Number(reservation.durationMinutes) || getServiceDuration(reservation.service);
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function getAvailabilityWindow(availability = {}) {
  const dayStartMinutes = timeToMinutes(availability.dayStart || DEFAULT_DAY_START);
  const dayEndMinutes = timeToMinutes(availability.dayEnd || DEFAULT_DAY_END);
  const breakStartMinutes = timeToMinutes(availability.breakStart || DEFAULT_BREAK_START);
  const breakEndMinutes = timeToMinutes(availability.breakEnd || DEFAULT_BREAK_END);

  return {
    dayStartMinutes: dayStartMinutes ?? timeToMinutes(DEFAULT_DAY_START),
    dayEndMinutes: dayEndMinutes ?? timeToMinutes(DEFAULT_DAY_END),
    breakStartMinutes,
    breakEndMinutes,
    slotIntervalMinutes: Number(availability.slotIntervalMinutes) || DEFAULT_SLOT_INTERVAL_MINUTES
  };
}

function slotConflictsWithBlockedSlot(slot, service, startMinutes, endMinutes) {
  const sameDate = !slot.date || slot.date === service.date;
  const sameService = !slot.service || slot.service === service.name;

  if (!sameDate || !sameService) {
    return false;
  }

  if (!slot.time) {
    return true;
  }

  const blockedStart = timeToMinutes(slot.time);
  if (blockedStart === null) {
    return false;
  }

  return rangesOverlap(startMinutes, endMinutes, blockedStart, blockedStart + DEFAULT_SLOT_INTERVAL_MINUTES);
}

function isBarberAvailable(barber, service, date, time, reservations = []) {
  if (barber.active === false) return false;
  if (!barber.supportedServices.includes(service)) return false;

  const availability = barber.availability || {};
  const workDays = Array.isArray(availability.workDays) ? availability.workDays : [];
  const blockedSlots = Array.isArray(availability.blockedSlots) ? availability.blockedSlots : [];
  const weekday = getWeekday(date);
  const window = getAvailabilityWindow(availability);
  const serviceDuration = getServiceDuration(service);
  const startMinutes = timeToMinutes(time);
  const endMinutes = startMinutes === null ? null : startMinutes + serviceDuration;

  if (!workDays.includes(weekday) || startMinutes === null || endMinutes === null) return false;
  if (startMinutes < window.dayStartMinutes || endMinutes > window.dayEndMinutes) return false;
  if (
    window.breakStartMinutes !== null
    && window.breakEndMinutes !== null
    && rangesOverlap(startMinutes, endMinutes, window.breakStartMinutes, window.breakEndMinutes)
  ) {
    return false;
  }

  const blockedByAvailability = blockedSlots.some((slot) => {
    return slotConflictsWithBlockedSlot(slot, { date, name: service }, startMinutes, endMinutes);
  });

  if (blockedByAvailability) return false;

  return !reservations.some((reservation) => (
    reservation.barberId === barber.id
    && isConfirmedReservation(reservation)
    && reservation.date === date
    && rangesOverlap(
      startMinutes,
      endMinutes,
      timeToMinutes(reservation.time),
      (timeToMinutes(reservation.time) || 0) + getReservationDuration(reservation)
    )
  ));
}

function getAvailableBarbers(barbers, reservations, service, date, time) {
  return barbers.filter((barber) => isBarberAvailable(barber, service, date, time, reservations));
}

function generateTimeOptionsForBarber(barber, service, date) {
  const availability = normalizeAvailability(barber.availability || {});
  const window = getAvailabilityWindow(availability);
  const serviceDuration = getServiceDuration(service);
  const slots = [];

  for (
    let currentStart = window.dayStartMinutes;
    currentStart + serviceDuration <= window.dayEndMinutes;
    currentStart += window.slotIntervalMinutes
  ) {
    const currentEnd = currentStart + serviceDuration;
    if (
      window.breakStartMinutes !== null
      && window.breakEndMinutes !== null
      && rangesOverlap(currentStart, currentEnd, window.breakStartMinutes, window.breakEndMinutes)
    ) {
      continue;
    }

    slots.push(minutesToTime(currentStart));
  }

  return slots.filter((time) => isBarberAvailable(barber, service, date, time, []));
}

function rejectPendingReservationsForBarber(reservations, barber) {
  const now = new Date().toISOString();
  let changed = false;

  reservations.forEach((reservation) => {
    if (reservation.barberId === barber.id && reservation.status === 'pending') {
      reservation.status = 'rejected';
      reservation.updatedAt = now;
      reservation.rejectionReason = 'Barber profile deleted by admin.';
      changed = true;
    }
  });

  return changed;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });

    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    request.on('error', reject);
  });
}

function extractAdminToken(request) {
  const authHeader = request.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return request.headers['x-admin-token'] || '';
}

function requireAdmin(request, response) {
  const token = extractAdminToken(request);
  if (token !== ADMIN_TOKEN) {
    sendJson(response, 401, {
      error: 'Unauthorized',
      message: 'Admin token required to manage barbers.'
    });
    return false;
  }
  return true;
}

function extractBarberToken(request) {
  const authHeader = request.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return request.headers['x-barber-token'] || '';
}

function requireBarberAccess(request, response, barber) {
  const token = extractBarberToken(request);
  if (!token || (token !== barber.accessCode && !hasValidBarberSession(barber, token))) {
    sendJson(response, 401, {
      error: 'Unauthorized',
      message: 'Valid barber account session or access code required.'
    });
    return false;
  }
  return true;
}

function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateBarberPayload(body) {
  const requiredStringFields = ['name', 'role', 'experience', 'bio'];
  const missingField = requiredStringFields.find((field) => !String(body[field] || '').trim());
  if (missingField) {
    return `Missing required field: ${missingField}`;
  }

  if (!Array.isArray(body.supportedServices) || body.supportedServices.length === 0) {
    return 'supportedServices must be a non-empty array.';
  }

  if (!body.availability || !Array.isArray(body.availability.workDays) || body.availability.workDays.length === 0) {
    return 'availability.workDays must be a non-empty array.';
  }

  if (body.availability.workDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return 'availability.workDays must use integers from 0 to 6.';
  }

  if (body.availability.blockedSlots && !Array.isArray(body.availability.blockedSlots)) {
    return 'availability.blockedSlots must be an array when provided.';
  }

  const blockedSlotsError = validateBlockedSlots(body.availability.blockedSlots || []);
  if (blockedSlotsError) {
    return blockedSlotsError;
  }

  const scheduleError = validateScheduleSettings(body.availability);
  if (scheduleError) {
    return scheduleError;
  }

  if (!validatePhoneNumber(body.phoneNumber)) {
    return 'phoneNumber must use a valid mobile number format, for example +351912345678.';
  }

  return null;
}

function validateBlockedSlots(blockedSlots) {
  for (const slot of blockedSlots) {
    if (!slot || typeof slot !== 'object') {
      return 'Each blocked slot must be an object.';
    }

    if (!slot.time && !slot.date && !slot.service) {
      return 'Each blocked slot must include at least a time, date, or service.';
    }

    if (slot.time && !isValidTime(slot.time)) {
      return `Invalid blocked time: ${slot.time}`;
    }

    if (slot.date && !isValidDate(slot.date)) {
      return `Invalid blocked date: ${slot.date}`;
    }

    if (slot.service && !String(slot.service).trim()) {
      return 'Blocked slot service cannot be empty.';
    }
  }

  return null;
}

function validateScheduleSettings(availability = {}) {
  const dayStartMinutes = timeToMinutes(availability.dayStart || DEFAULT_DAY_START);
  const dayEndMinutes = timeToMinutes(availability.dayEnd || DEFAULT_DAY_END);
  const breakStartMinutes = timeToMinutes(availability.breakStart || DEFAULT_BREAK_START);
  const breakEndMinutes = timeToMinutes(availability.breakEnd || DEFAULT_BREAK_END);
  const slotIntervalMinutes = Number(availability.slotIntervalMinutes || DEFAULT_SLOT_INTERVAL_MINUTES);

  if (dayStartMinutes === null || dayEndMinutes === null || dayEndMinutes <= dayStartMinutes) {
    return 'Availability must include valid day start and end times.';
  }

  if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes < 15 || slotIntervalMinutes > 120) {
    return 'slotIntervalMinutes must be an integer between 15 and 120.';
  }

  if (
    availability.breakStart
    || availability.breakEnd
    || breakStartMinutes !== timeToMinutes(DEFAULT_BREAK_START)
    || breakEndMinutes !== timeToMinutes(DEFAULT_BREAK_END)
  ) {
    if (
      breakStartMinutes === null
      || breakEndMinutes === null
      || breakEndMinutes <= breakStartMinutes
      || breakStartMinutes <= dayStartMinutes
      || breakEndMinutes >= dayEndMinutes
    ) {
      return 'Break start and end must sit inside the working day.';
    }
  }

  return null;
}

function validateDate(date) {
  return isValidDate(date);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizeBarberSelection(barberId) {
  const value = String(barberId || '').trim();
  if (!value || value === 'No preference' || value === 'no-preference') {
    return 'no-preference';
  }
  return value;
}

function createReservationId() {
  return `res_${crypto.randomBytes(4).toString('hex')}`;
}

function getAvailableDates(barbers, reservations, service, barberId, days = BOOKING_WINDOW_DAYS, startDate = formatDate(new Date())) {
  const normalizedBarberId = normalizeBarberSelection(barberId);
  const targetBarbers = normalizedBarberId === 'no-preference'
    ? barbers
    : barbers.filter((barber) => barber.id === normalizedBarberId);

  if (!targetBarbers.length) {
    return [];
  }

  const firstDate = validateDate(startDate) ? new Date(`${startDate}T12:00:00`) : new Date();
  const safeStartDate = new Date(firstDate);
  safeStartDate.setHours(12, 0, 0, 0);
  const dates = [];

  for (let index = 0; index < days; index += 1) {
    const currentDate = addDays(safeStartDate, index);
    const dateString = formatDate(currentDate);
    const hasAvailability = targetBarbers.some((barber) => (
      getAvailableTimes(targetBarbers, reservations, service, barber.id, dateString).length > 0
    ));

    if (hasAvailability) {
      dates.push(dateString);
    }
  }

  return dates;
}

function getAvailableTimes(barbers, reservations, service, barberId, date) {
  if (!validateDate(date)) {
    return [];
  }

  const normalizedBarberId = normalizeBarberSelection(barberId);
  const targetBarbers = normalizedBarberId === 'no-preference'
    ? barbers
    : barbers.filter((barber) => barber.id === normalizedBarberId);

  if (!targetBarbers.length) {
    return [];
  }

  const timeSet = new Set();

  targetBarbers.forEach((barber) => {
    const availability = normalizeAvailability(barber.availability || {});
    const window = getAvailabilityWindow(availability);
    const serviceDuration = getServiceDuration(service);

    for (
      let currentStart = window.dayStartMinutes;
      currentStart + serviceDuration <= window.dayEndMinutes;
      currentStart += window.slotIntervalMinutes
    ) {
      const candidateTime = minutesToTime(currentStart);
      if (isBarberAvailable(barber, service, date, candidateTime, reservations)) {
        timeSet.add(candidateTime);
      }
    }
  });

  return [...timeSet].sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
}

function createAccessCode(name) {
  const prefix = slugify(name).replace(/-/g, '').toUpperCase().slice(0, 6) || 'BARBER';
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${suffix}`;
}

function serveHtml(response, filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  sendText(response, 200, html, 'text/html; charset=utf-8');
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/barbers') {
    const barbers = readBarbers().filter((barber) => barber.active !== false);
    sendJson(response, 200, { barbers: barbers.map(toPublicBarber) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/barbers/list') {
    const barbers = readBarbers().filter((barber) => barber.active !== false);
    sendJson(response, 200, {
      barbers: barbers.map((barber) => ({
        id: barber.id,
        name: barber.name,
        role: barber.role
      }))
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/barbers/availability') {
    const service = url.searchParams.get('service');
    const date = url.searchParams.get('date');
    const time = url.searchParams.get('time');

    if (!service || !date || !time) {
      sendJson(response, 400, {
        error: 'Missing query parameters',
        message: 'service, date, and time are required.'
      });
      return;
    }

    const barbers = readBarbers().filter((barber) => barber.active !== false);
    const reservations = readReservations();
    const availableBarbers = getAvailableBarbers(barbers, reservations, service, date, time).map(toPublicBarber);
    sendJson(response, 200, { barbers: availableBarbers });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/booking/options') {
    const service = url.searchParams.get('service');
    const barberId = normalizeBarberSelection(url.searchParams.get('barberId'));
    const date = url.searchParams.get('date');
    const days = Math.min(Number(url.searchParams.get('days') || BOOKING_WINDOW_DAYS), 45);

    if (!service) {
      sendJson(response, 400, {
        error: 'Missing query parameters',
        message: 'service is required.'
      });
      return;
    }

    const barbers = readBarbers().filter((barber) => barber.active !== false);
    const reservations = readReservations();
    const availableDates = getAvailableDates(barbers, reservations, service, barberId, days);
    const availableTimes = date ? getAvailableTimes(barbers, reservations, service, barberId, date) : [];

    sendJson(response, 200, { availableDates, availableTimes });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/bookings') {
    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const requiredFields = ['firstName', 'lastName', 'email', 'phone', 'service', 'date', 'time'];
    const missingField = requiredFields.find((field) => !String(body[field] || '').trim());

    if (missingField) {
      sendJson(response, 400, { error: `Missing required field: ${missingField}` });
      return;
    }

    if (!validateEmail(body.email)) {
      sendJson(response, 400, { error: 'Please enter a valid email address.' });
      return;
    }

    if (!validateDate(body.date)) {
      sendJson(response, 400, { error: 'Please choose a valid booking date.' });
      return;
    }

    const barbers = readBarbers().filter((barber) => barber.active !== false);
    const reservations = readReservations();
    const availableTimes = getAvailableTimes(barbers, reservations, body.service, body.barberId || body.barber, body.date);

    if (!availableTimes.includes(String(body.time).trim())) {
      sendJson(response, 400, { error: 'Please choose a valid booking time.' });
      return;
    }

    const normalizedBarberId = normalizeBarberSelection(body.barberId || body.barber);
    const targetBarbers = normalizedBarberId === 'no-preference'
      ? getAvailableBarbers(barbers, reservations, body.service, body.date, body.time)
      : getAvailableBarbers(barbers, reservations, body.service, body.date, body.time)
        .filter((barber) => barber.id === normalizedBarberId);

    if (!targetBarbers.length) {
      sendJson(response, 409, {
        error: 'No availability',
        message: 'That slot is no longer available. Please choose another date or time.'
      });
      return;
    }

    const assignedBarber = targetBarbers[0];
    const reservation = {
      id: createReservationId(),
      barberId: assignedBarber.id,
      barberName: assignedBarber.name,
      service: String(body.service).trim(),
      durationMinutes: getServiceDuration(body.service),
      date: String(body.date).trim(),
      time: String(body.time).trim(),
      status: 'pending',
      customer: {
        firstName: String(body.firstName).trim(),
        lastName: String(body.lastName).trim(),
        email: String(body.email).trim(),
        phone: String(body.phone).trim()
      },
      notes: String(body.notes || '').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    reservations.push(reservation);
    writeReservations(reservations);

    let notification = null;
    if (assignedBarber.phoneVerified && assignedBarber.phoneNumber) {
      notification = queueNotification({
        barberId: assignedBarber.id,
        type: 'pending_booking',
        channel: 'sms',
        destination: assignedBarber.phoneNumber,
        message: `New pending booking: ${reservation.date} at ${reservation.time} for ${reservation.service}.`,
        metadata: {
          reservationId: reservation.id,
          customerName: `${reservation.customer.firstName} ${reservation.customer.lastName}`
        }
      });
    }

    sendJson(response, 201, {
      message: 'Booking request created successfully.',
      reservation: toReservationSummary(reservation),
      notification: notification ? toNotificationSummary(notification) : null
    });
    return;
  }

  if (request.method === 'GET' && /^\/api\/barber\/[^/]+\/invite$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];
    const barber = readBarbers().find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    sendJson(response, 200, {
      barber: {
        id: barber.id,
        name: barber.name,
        role: barber.role,
        experience: barber.experience,
        hasAccount: Boolean(barber.passwordHash),
        onboardingUrl: getAbsoluteUrl(request, getBarberOnboardingPath(barber.id)),
        loginUrl: getAbsoluteUrl(request, '/barber')
      }
    });
    return;
  }

  if (request.method === 'POST' && /^\/api\/barber\/[^/]+\/account-setup$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const accessCode = String(body.accessCode || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!accessCode) {
      sendJson(response, 400, { error: 'Access code is required.' });
      return;
    }

    if (!validateEmail(email)) {
      sendJson(response, 400, { error: 'Please provide a valid email address.' });
      return;
    }

    if (password.length < 8) {
      sendJson(response, 400, { error: 'Password must be at least 8 characters long.' });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (barber.accessCode !== accessCode) {
      sendJson(response, 401, { error: 'Invalid invite access code.' });
      return;
    }

    if (barber.passwordHash) {
      sendJson(response, 409, { error: 'This barber account has already been created. Please use the barber login page.' });
      return;
    }

    if (barbers.some((item) => item.id !== barber.id && item.email === email)) {
      sendJson(response, 409, { error: 'Another barber account already uses that email address.' });
      return;
    }

    barber.email = email;
    barber.passwordHash = hashPassword(password);
    barber.accountCreatedAt = barber.accountCreatedAt || new Date().toISOString();
    const session = createBarberSession(barber);
    writeBarbers(barbers);

    sendJson(response, 201, {
      message: 'Barber account created successfully.',
      barber: toBarberSelf(barber),
      session,
      redirectPath: getBarberPortalPath(barber.id),
      loginPath: '/barber'
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/barber/login') {
    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!validateEmail(email)) {
      sendJson(response, 400, { error: 'Please provide a valid email address.' });
      return;
    }

    if (!password) {
      sendJson(response, 400, { error: 'Password is required.' });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.email === email);

    if (!barber || !barber.passwordHash || !verifyPassword(password, barber.passwordHash)) {
      sendJson(response, 401, { error: 'Invalid barber credentials.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    const session = createBarberSession(barber);
    writeBarbers(barbers);

    sendJson(response, 200, {
      message: 'Barber login successful.',
      barber: toBarberSelf(barber),
      session,
      redirectPath: getBarberPortalPath(barber.id)
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/barbers') {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, {
      barbers: readBarbers().map((barber) => toAdminBarber(request, barber))
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    if (!requireAdmin(request, response)) return;

    const barbers = readBarbers();
    const reservations = readReservations();
    const notifications = readNotifications();
    const reservationCounts = getReservationStatusCounts(reservations);

    sendJson(response, 200, {
      metrics: {
        totalBarbers: barbers.length,
        activeBarbers: barbers.filter((barber) => barber.active !== false).length,
        deletedBarbers: barbers.filter((barber) => barber.active === false).length,
        verifiedPhones: barbers.filter((barber) => barber.phoneVerified === true).length,
        pendingReservations: reservationCounts.pending,
        confirmedReservations: reservationCounts.confirmed,
        rejectedReservations: reservationCounts.rejected,
        totalNotifications: notifications.length
      },
      recentReservations: sortByCreatedAtDesc(reservations).slice(0, 6).map(toReservationSummary),
      recentNotifications: sortByCreatedAtDesc(notifications).slice(0, 6).map(toNotificationSummary)
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/reservations') {
    if (!requireAdmin(request, response)) return;

    const status = String(url.searchParams.get('status') || 'all').trim();
    const limit = Number(url.searchParams.get('limit') || 20);
    const reservations = sortByCreatedAtDesc(readReservations())
      .filter((reservation) => status === 'all' ? true : reservation.status === status)
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20)
      .map(toReservationSummary);

    sendJson(response, 200, { reservations });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/notifications') {
    if (!requireAdmin(request, response)) return;

    const type = String(url.searchParams.get('type') || 'all').trim();
    const limit = Number(url.searchParams.get('limit') || 20);
    const notifications = sortByCreatedAtDesc(readNotifications())
      .filter((notification) => type === 'all' ? true : notification.type === type)
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20)
      .map(toNotificationSummary);

    sendJson(response, 200, { notifications });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/barbers') {
    if (!requireAdmin(request, response)) return;

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const validationError = validateBarberPayload(body);
    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    const barbers = readBarbers();
    const id = slugify(body.name);

    if (barbers.some((barber) => barber.id === id)) {
      sendJson(response, 409, { error: 'A barber with that name already exists.' });
      return;
    }

    const newBarber = {
      id,
      name: body.name.trim(),
      accessCode: String(body.accessCode || '').trim() || createAccessCode(body.name),
      role: body.role.trim(),
      experience: body.experience.trim(),
      bio: body.bio.trim(),
      phoneNumber: normalizePhoneNumber(body.phoneNumber),
      phoneVerified: false,
      phoneVerificationRequestedAt: null,
      phoneVerifiedAt: null,
      phoneVerificationCodeHash: null,
      email: '',
      passwordHash: null,
      accountCreatedAt: null,
      sessionTokenHash: null,
      sessionExpiresAt: null,
      notificationPreference: 'sms',
      supportedServices: body.supportedServices.map((service) => String(service).trim()).filter(Boolean),
      availability: normalizeAvailability(body.availability || {}),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };

    const verificationNotification = issuePhoneVerification(newBarber);
    barbers.push(newBarber);
    writeBarbers(barbers);

    sendJson(response, 201, {
      message: 'Barber created successfully.',
      barber: toAdminBarber(request, newBarber),
      verificationNotification: verificationNotification ? toNotificationSummary(verificationNotification) : null
    });
    return;
  }

  if (request.method === 'PATCH' && /^\/api\/admin\/barbers\/[^/]+$/.test(url.pathname)) {
    if (!requireAdmin(request, response)) return;

    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[3];

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const validationError = validateBarberPayload(body);
    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    const nextId = slugify(body.name);
    if (nextId !== barber.id && barbers.some((item) => item.id === nextId)) {
      sendJson(response, 409, { error: 'Another barber already uses that name.' });
      return;
    }

    const preservedDeletedState = barber.active === false;
    const previousPhoneNumber = barber.phoneNumber || '';
    barber.id = nextId;
    barber.name = body.name.trim();
    barber.accessCode = String(body.accessCode || '').trim() || barber.accessCode || createAccessCode(body.name);
    barber.role = body.role.trim();
    barber.experience = body.experience.trim();
    barber.bio = body.bio.trim();
    barber.phoneNumber = normalizePhoneNumber(body.phoneNumber);
    barber.email = barber.email || '';
    barber.passwordHash = barber.passwordHash || null;
    barber.accountCreatedAt = barber.accountCreatedAt || null;
    barber.sessionTokenHash = barber.sessionTokenHash || null;
    barber.sessionExpiresAt = barber.sessionExpiresAt || null;
    barber.supportedServices = body.supportedServices.map((service) => String(service).trim()).filter(Boolean);
    barber.availability = normalizeAvailability(body.availability || {});
    barber.updatedAt = new Date().toISOString();
    barber.active = body.active === false ? false : !preservedDeletedState;
    if (barber.active) {
      barber.deletedAt = null;
    }

    let verificationNotification = null;
    if (normalizePhoneNumber(previousPhoneNumber) !== barber.phoneNumber) {
      verificationNotification = issuePhoneVerification(barber);
    }

    const reservations = readReservations();
    reservations.forEach((reservation) => {
      if (reservation.barberId === barberId) {
        reservation.barberId = barber.id;
        reservation.barberName = barber.name;
        reservation.updatedAt = new Date().toISOString();
      }
    });
    writeReservations(reservations);
    writeBarbers(barbers);

    sendJson(response, 200, {
      message: 'Barber updated successfully.',
      barber: toAdminBarber(request, barber),
      verificationNotification: verificationNotification ? toNotificationSummary(verificationNotification) : null
    });
    return;
  }

  if (request.method === 'PATCH' && /^\/api\/admin\/barbers\/[^/]+\/restore$/.test(url.pathname)) {
    if (!requireAdmin(request, response)) return;

    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[3];
    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    barber.active = true;
    barber.deletedAt = null;
    barber.updatedAt = new Date().toISOString();
    writeBarbers(barbers);

    sendJson(response, 200, {
      message: 'Barber restored successfully.',
      barber: toAdminBarber(request, barber)
    });
    return;
  }

  if (request.method === 'DELETE' && /^\/api\/admin\/barbers\/[^/]+$/.test(url.pathname)) {
    if (!requireAdmin(request, response)) return;

    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[3];
    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    barber.active = false;
    barber.deletedAt = new Date().toISOString();
    barber.updatedAt = new Date().toISOString();
    writeBarbers(barbers);

    const reservations = readReservations();
    if (rejectPendingReservationsForBarber(reservations, barber)) {
      writeReservations(reservations);
    }

    sendJson(response, 200, {
      message: 'Barber deleted successfully.',
      barber: toAdminBarber(request, barber)
    });
    return;
  }

  if (request.method === 'GET' && /^\/api\/barber\/[^/]+$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    sendJson(response, 200, {
      barber: toBarberSelf(barber)
    });
    return;
  }

  if (request.method === 'POST' && /^\/api\/barber\/[^/]+\/logout$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    clearBarberSession(barber);
    writeBarbers(barbers);

    sendJson(response, 200, {
      message: 'Barber logged out successfully.'
    });
    return;
  }

  if (request.method === 'GET' && /^\/api\/barber\/[^/]+\/reservations$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    const reservations = readReservations()
      .filter((reservation) => reservation.barberId === barberId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    sendJson(response, 200, {
      reservations: reservations.map(toReservationSummary)
    });
    return;
  }

  if (request.method === 'GET' && /^\/api\/barber\/[^/]+\/notifications$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    const notifications = readNotifications()
      .filter((notification) => notification.barberId === barberId)
      .slice(-20)
      .reverse();

    sendJson(response, 200, {
      notifications: notifications.map(toNotificationSummary)
    });
    return;
  }

  if (request.method === 'PATCH' && url.pathname.startsWith('/api/admin/barbers/')) {
    if (!requireAdmin(request, response)) return;

    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[3];

    if (!barberId || pathParts[4] !== 'availability') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    const nextAvailability = normalizeAvailability({
      ...barber.availability,
      ...body
    });
    const scheduleError = validateScheduleSettings(nextAvailability);
    const blockedSlotsError = validateBlockedSlots(nextAvailability.blockedSlots);
    if (scheduleError || blockedSlotsError) {
      sendJson(response, 400, { error: scheduleError || blockedSlotsError });
      return;
    }

    barber.availability = nextAvailability;

    writeBarbers(barbers);
    sendJson(response, 200, {
      message: 'Barber availability updated successfully.',
      barber
    });
    return;
  }

  if (request.method === 'PATCH' && /^\/api\/barber\/[^/]+\/availability$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    const nextAvailability = normalizeAvailability({
      ...barber.availability,
      ...body
    });
    const scheduleError = validateScheduleSettings(nextAvailability);
    const blockedSlotsError = validateBlockedSlots(nextAvailability.blockedSlots);
    if (scheduleError || blockedSlotsError) {
      sendJson(response, 400, { error: scheduleError || blockedSlotsError });
      return;
    }

    barber.availability = nextAvailability;

    writeBarbers(barbers);
    sendJson(response, 200, {
      message: 'Your availability was updated successfully.',
      barber: toBarberSelf(barber)
    });
    return;
  }

  if (request.method === 'POST' && /^\/api\/barber\/[^/]+\/phone-verification\/resend$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];
    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    if (!barber.phoneNumber) {
      sendJson(response, 400, { error: 'This barber profile has no mobile number registered yet.' });
      return;
    }

    const notification = issuePhoneVerification(barber);
    barber.updatedAt = new Date().toISOString();
    writeBarbers(barbers);

    sendJson(response, 200, {
      message: 'Phone verification code sent successfully.',
      barber: toBarberSelf(barber),
      notification: notification ? toNotificationSummary(notification) : null
    });
    return;
  }

  if (request.method === 'POST' && /^\/api\/barber\/[^/]+\/verify-phone$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    const code = String(body.code || '').trim();
    if (!code) {
      sendJson(response, 400, { error: 'Verification code is required.' });
      return;
    }

    if (!barber.phoneVerificationCodeHash || hashVerificationCode(code) !== barber.phoneVerificationCodeHash) {
      sendJson(response, 401, { error: 'Invalid verification code.' });
      return;
    }

    barber.phoneVerified = true;
    barber.phoneVerifiedAt = new Date().toISOString();
    barber.phoneVerificationCodeHash = null;
    barber.updatedAt = new Date().toISOString();
    writeBarbers(barbers);

    sendJson(response, 200, {
      message: 'Phone number verified successfully.',
      barber: toBarberSelf(barber)
    });
    return;
  }

  if (request.method === 'PATCH' && /^\/api\/barber\/[^/]+\/reservations\/[^/]+$/.test(url.pathname)) {
    const pathParts = url.pathname.split('/').filter(Boolean);
    const barberId = pathParts[2];
    const reservationId = pathParts[4];

    let body;
    try {
      body = await parseBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    const nextStatus = String(body.status || '').trim().toLowerCase();
    const decisionNote = String(body.decisionNote || '').trim();
    if (!['confirmed', 'rejected'].includes(nextStatus)) {
      sendJson(response, 400, { error: 'status must be confirmed or rejected.' });
      return;
    }

    if (decisionNote.length > 280) {
      sendJson(response, 400, { error: 'Decision note must stay under 280 characters.' });
      return;
    }

    const barbers = readBarbers();
    const barber = barbers.find((item) => item.id === barberId);

    if (!barber) {
      sendJson(response, 404, { error: 'Barber not found.' });
      return;
    }

    if (barber.active === false) {
      sendJson(response, 403, { error: 'Barber profile is inactive.' });
      return;
    }

    if (!requireBarberAccess(request, response, barber)) return;

    const reservations = readReservations();
    const reservation = reservations.find((item) => item.id === reservationId && item.barberId === barberId);

    if (!reservation) {
      sendJson(response, 404, { error: 'Reservation not found.' });
      return;
    }

    if (reservation.status !== 'pending') {
      sendJson(response, 409, { error: 'Only pending reservations can be updated.' });
      return;
    }

    if (nextStatus === 'confirmed') {
      const otherReservations = reservations.filter((item) => item.id !== reservation.id);
      if (!isBarberAvailable(barber, reservation.service, reservation.date, reservation.time, otherReservations)) {
        sendJson(response, 409, {
          error: 'Slot no longer available.',
          message: 'This slot has already been blocked or confirmed elsewhere.'
        });
        return;
      }
      reservation.confirmedAt = new Date().toISOString();
    }

    reservation.status = nextStatus;
    reservation.barberDecisionNote = decisionNote || null;
    reservation.updatedAt = new Date().toISOString();
    writeReservations(reservations);

    sendJson(response, 200, {
      message: `Reservation ${nextStatus} successfully.`,
      reservation: toReservationSummary(reservation)
    });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      sendJson(response, 500, { error: 'Internal server error', details: error.message });
    }
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    serveHtml(response, INDEX_PATH);
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin.html')) {
    serveHtml(response, ADMIN_PATH);
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/barber/onboard' || url.pathname.startsWith('/barber/onboard/'))) {
    serveHtml(response, BARBER_ONBOARDING_PATH);
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/barber' || url.pathname.startsWith('/barber/'))) {
    serveHtml(response, BARBER_PAGE_PATH);
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`The Sharp Cut server running at http://localhost:${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing server or start this one with PORT=${PORT + 1} ADMIN_TOKEN=your-token npm start.`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
