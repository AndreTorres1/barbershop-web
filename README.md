# The Sharp Cut

Premium barbershop website with a public booking experience, a protected admin backoffice, and private barber workflows.

This project now goes beyond a static landing page. It includes:

- a public website with booking flow and live availability
- a protected admin dashboard for barber CRUD and operational review
- a barber access hub and private barber workspace
- onboarding links for new barber accounts
- SQLite-backed persistence with JSON snapshots for demo-friendly data

## Main areas

- Public website: `http://localhost:3000/`
- Admin dashboard: `http://localhost:3000/admin`
- Barber access hub: `http://localhost:3000/barber`
- Barber onboarding pattern: `http://localhost:3000/barber/onboard/:barberId`
- Private barber workspace pattern: `http://localhost:3000/barber/:barberId`

If port `3000` is busy, start on another port, for example `3001`.

## Run locally

Start the project with an admin token:

```bash
ADMIN_TOKEN=your-secret-token npm start
```

Examples:

```bash
npm start
PORT=3001 npm start
ADMIN_TOKEN=adminRWRE PORT=3001 npm start
```

If `ADMIN_TOKEN` is not set, the server falls back to `change-me-admin-token`.

## Current architecture

- Frontend:
  - `index.html` for the public website and booking journey
  - `admin.html` for the backoffice
  - `barber.html` for barber access hub and private workspace
  - `barber-onboarding.html` for account setup
- Backend:
  - `server.js`
- Persistence:
  - primary runtime storage in `data/barbershop.sqlite`
  - JSON snapshots kept in sync:
    - `data/barbers.json`
    - `data/reservations.json`
    - `data/notifications.json`

## What the project supports now

### Public website

- premium landing page
- live booking options by service, barber, date, and time
- slot availability based on:
  - working days
  - day start and end
  - break windows
  - slot interval
  - blocked dates
  - blocked times
  - existing confirmed bookings

### Admin dashboard

- gated access with admin token before the real dashboard opens
- overview cards for:
  - total barbers
  - active barbers
  - pending bookings
  - verification pending
- barber CRUD:
  - create
  - edit
  - soft delete
  - restore
- onboarding invite handling:
  - onboarding link preview
  - open invite
  - copy invite link
  - copy access code
- bookings module with:
  - search
  - status filter
  - barber filter
  - pagination
  - booking detail drawer
- notifications overview
- settings and route notes

### Barber access and workspace

- cleaner `/barber` access hub with a barber directory table
- private workspace only shown in barber-specific context
- login with:
  - email + password after onboarding
  - access code fallback on private barber route
- upcoming confirmed schedule highlight
- request filtering by:
  - search
  - status
  - selected day
  - selected week
  - upcoming only
- decision notes when confirming or rejecting requests
- schedule controls:
  - working days
  - day hours
  - break hours
  - slot interval
  - blocked dates
  - blocked times
  - vacation range helper
  - extra blocked date helper
  - recurring blocked time helper

### Notifications

- phone verification flow
- logged notification records
- provider-ready structure for future SMS/email integration

## Admin flow

1. Start the server with `ADMIN_TOKEN`.
2. Open `/admin`.
3. Enter the admin token.
4. Create or edit a barber.
5. Copy the onboarding link and access code.
6. Send those to the barber.

The admin does not create the barber password directly.

## Barber onboarding flow

1. The barber receives:
   - onboarding URL
   - access code
2. The barber opens `/barber/onboard/:barberId`.
3. The barber creates their own email and password.
4. After that, they use `/barber` or their private route to enter the workspace.

If the account already exists, the onboarding page now blocks account creation and sends the barber to the login flow instead.

## Demo seed

Current seeded access codes in `data/barbers.json`:

- `Ricardo Fonseca`: `RICARDO-2026`
- `Tomás Alves`: `TOMAS-2026`
- `Miguel Costa`: `MIGUEL-2026`
- `André Goncalves`: `ANDREG-67AC68`

## API overview

### Public endpoints

- `GET /api/health`
- `GET /api/barbers`
- `GET /api/barbers/list`
- `GET /api/barbers/availability?service=...&date=YYYY-MM-DD&time=HH:MM`
- `GET /api/booking/options?service=...&barberId=...&date=YYYY-MM-DD`
- `POST /api/bookings`

### Admin endpoints

- `GET /api/admin/barbers`
- `GET /api/admin/dashboard`
- `GET /api/admin/reservations`
- `GET /api/admin/notifications`
- `POST /api/admin/barbers`
- `PATCH /api/admin/barbers/:id`
- `PATCH /api/admin/barbers/:id/restore`
- `DELETE /api/admin/barbers/:id`
- `PATCH /api/admin/barbers/:id/availability`

### Barber endpoints

- `GET /api/barber/:id/invite`
- `POST /api/barber/:id/account-setup`
- `POST /api/barber/login`
- `GET /api/barber/:id`
- `POST /api/barber/:id/logout`
- `GET /api/barber/:id/reservations`
- `PATCH /api/barber/:id/reservations/:reservationId`
- `GET /api/barber/:id/notifications`
- `PATCH /api/barber/:id/availability`
- `POST /api/barber/:id/verify-phone`
- `POST /api/barber/:id/phone-verification/resend`

## Auth headers

Admin requests accept:

- `Authorization: Bearer <ADMIN_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>`

Barber private requests accept:

- `Authorization: Bearer <BARBER_SESSION_OR_ACCESS_CODE>`
- `x-barber-token: <BARBER_SESSION_OR_ACCESS_CODE>`

## Notes about notifications

The project includes notification logging and verification flow, but delivery is still local/provider-ready.

Right now:

- phone verification events are logged
- pending booking notifications can be recorded
- SMS is not yet sent through Twilio, Vonage, or another external provider

That makes the project easier to run locally while preserving a realistic future integration path.

## Suggested manual QA

### Admin

1. Open `/admin`
2. Unlock with the admin token
3. Create or edit a barber
4. Copy invite link and access code
5. Check bookings filters and the detail drawer

### Barber

1. Open `/barber`
2. Use the directory to open a barber route or onboarding link
3. Complete onboarding if needed
4. Login to the workspace
5. Edit schedule, blocked dates, and vacation range
6. Review requests and add a decision note

### Public booking

1. Open `/`
2. Choose a service and barber
3. Check available dates and times
4. Create a booking request
5. Confirm the request shows up in the barber workspace

## Portfolio-ready next steps

- add screenshots of public site, admin, barber hub, and onboarding
- add a short GIF of `admin -> invite -> onboarding -> login -> booking`
- wire notifications to a real provider
- split backend logic into services/modules for larger-scale growth
