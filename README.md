# The Sharp Cut

Public landing page plus a lightweight Node backend for barber availability, admin management, and private barber portals.

## Run locally

```bash
npm start
```

The site will be available at `http://localhost:3000`.

If port `3000` is already busy, start on another port:

```bash
PORT=3001 npm start
```

## Admin protection

Set an admin token before starting the server:

```bash
ADMIN_TOKEN=your-secret-token npm start
```

If you do not set one, the server uses `change-me-admin-token` by default.

## API

Public endpoints:

- `GET /api/health`
- `GET /api/barbers`
- `GET /api/barbers/list`
- `GET /api/barbers/availability?service=...&date=YYYY-MM-DD&time=HH:MM`
- `GET /api/booking/options?service=...&barberId=...&date=YYYY-MM-DD`
- `POST /api/bookings`

Admin-only endpoints:

- `GET /api/admin/barbers`
- `POST /api/admin/barbers`
- `PATCH /api/admin/barbers/:id`
- `PATCH /api/admin/barbers/:id/restore`
- `DELETE /api/admin/barbers/:id`
- `PATCH /api/admin/barbers/:id/availability`

Barber self-service endpoints:

- `GET /api/barber/:id`
- `GET /api/barber/:id/notifications`
- `GET /api/barber/:id/reservations`
- `POST /api/barber/:id/verify-phone`
- `POST /api/barber/:id/phone-verification/resend`
- `PATCH /api/barber/:id/availability`
- `PATCH /api/barber/:id/reservations/:reservationId`

Admin requests accept either:

- `Authorization: Bearer <ADMIN_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>`

Barber self-service requests accept either:

- `Authorization: Bearer <BARBER_ACCESS_CODE>`
- `x-barber-token: <BARBER_ACCESS_CODE>`

## URLs

- Public website: `http://localhost:3000/`
- Admin area: `http://localhost:3000/admin`
- Barber portal pattern: `http://localhost:3000/barber/<barber-id>`

## Accessing the admin and barber areas

1. Start the project with an admin token:

```bash
ADMIN_TOKEN=your-secret-token npm start
```

2. Open `http://localhost:3000/admin` or your custom `PORT`.
3. Use the same `ADMIN_TOKEN` from the terminal to:
   - load the current barber list
   - create new barbers
   - edit existing barbers
   - soft delete and restore barber profiles
   - register the barber mobile number
   - see the private portal URL generated for each barber
4. Send each barber their own private portal URL, for example:

```text
http://localhost:3000/barber/ricardo-fonseca
```

5. The barber opens that URL and signs in with their access code to manage only their own availability.
6. If a mobile number was registered, the backend logs a phone verification message with a 6-digit code.
7. The barber confirms that phone number in the private portal before SMS-style notifications are enabled.
8. Client booking requests are created from the public website as `pending`.
9. The barber sees those requests in the private portal and can confirm or reject them.
10. Once a request is confirmed, that slot becomes unavailable to future clients.
11. When a verified barber receives a new pending booking, the backend creates a notification entry for that mobile number.

## Notification note

This project now includes a provider-ready notification flow with:

- barber mobile numbers
- phone verification codes
- notification logging in `data/notifications.json`

At the moment, notification delivery is logged locally by the backend instead of being sent through a real SMS provider like Twilio. That keeps the project dependency-free while leaving the workflow in place for a future provider integration.

Seeded demo barber access codes in `data/barbers.json`:

- `Ricardo Fonseca`: `RICARDO-2026`
- `Tomás Alves`: `TOMAS-2026`
- `Miguel Costa`: `MIGUEL-2026`
