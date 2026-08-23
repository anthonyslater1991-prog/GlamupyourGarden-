# PRD — Glam up your Garden 🌿

## Original Problem Statement
Garden makeover app: users photograph their garden, choose changes, and generate an AI-improved version with shoppable product hotspots linking to retailers (future affiliate links). Membership scheme (free tier), member messaging, community chat & wall, contractor directory with reviews + auto-generated contracts + job completion tracking, weekly polls with home popup, visit counters, social links, always-on AI garden chatbot, QR share, green/tranquil themed UI.

## User Choices (v1)
- Focus: Photo upload + AI garden redesign with shoppable product links
- AI engine: Gemini Nano Banana (gemini-3.1-flash-image-preview)
- Payments: skipped (everything free in v1)
- Auth: both email/password + Emergent Google login
- Design: bright tranquil garden theme (greens + sky blue + sunny accents)

## Architecture
- Frontend: Expo Router (React Native), tabs (Home/Projects/Community/Pros/Profile), Fraunces + Nunito fonts, react-native-keyboard-controller, gorhom provider, expo-image, blur hotspots.
- Backend: FastAPI + MongoDB (motor), session-token auth (bcrypt for email/pw + Emergent Google), Emergent Object Storage for images, emergentintegrations LlmChat for Nano Banana image gen + GPT text (hotspots + chatbot).

## User Personas
- Garden Owner: redesigns their garden, shops the look, hires pros.
- Contractor: listed in directory, receives jobs/reviews.

## Core Requirements (static)
- AI garden redesign from a real photo, shoppable hotspots, projects with saved designs, community wall, contractor directory w/ reviews & contracts & progress, weekly poll, visit stats, AI assistant, QR share.

## Implemented (2026-08-23)
- Auth (email/password + Google), profile (bio, allow-messages toggle)
- Photo upload/capture with permission handling → Object Storage
- Projects CRUD; AI redesign (Nano Banana) with before/after + shoppable + hotspots → retailer search links
- AI Garden Assistant chatbot (Bloom), always-accessible FAB
- Community wall (post + image + like)
- Contractors directory + detail (call, services, job progress tracker, auto-draft contract modal, reviews)
- Weekly poll popup + voting, visit counter + live stats, social links top bar, QR share + copy link
- Member Messaging: 1:1 DMs (opt-out aware, 403 blocked), conversations + unread counts
- Community Rooms: General / Design / Plants / Help live chat (4s auto-refresh)
- Admin Dashboard: seeded admin (admin@glamgarden.app), live visitor/active-user stats, all projects w/ owner info + redesign counts + detail modal, weekly poll rotation between presets
- Verified: 39 backend tests + frontend e2e passed (iterations 1 & 2).

## Implemented (2026-08-23) — iteration 3
- Message Alerts: unread DM badge on Community tab (UnreadContext polls /api/unread)
- Photo Sharing: images in direct messages and community rooms (image_path on messages)
- Report & Block: block (bidirectional, hides from members/conversations/rooms), report with reasons; admin sees reports
- Custom Polls: admin create + set-live + delete (non-active) from dashboard
- Registration captures phone, address, postcode; editable in Profile
- Map & pins: postcodes.io geocoding + haversine distances; Contractors map + distance badges; Admin location map (customers vs contractors). Static OSM map image (keyless) with graceful fallback; interactive native maps intentionally avoided (needs dev build/keys)
- Verified: 16/16 backend tests + frontend e2e passed (iteration 3)

## Implemented (2026-08-23) — iteration 4
- Message Photos Preview: tap any shared photo (DM or room) → full-screen zoomable viewer (pinch/double-tap)
- Nearby Alerts: Home banner when a top-rated (≥4.7) contractor covers the member's postcode area
- Contractor Coverage: coverage_miles per contractor, editable by admin/contractor; drives reachable/"near you"
- Report Actions: admin Warn / Suspend / Clear on reports; suspended members blocked from login + sessions revoked
- Verified: 12/12 backend tests + frontend flows passed (iteration 4)

## Implemented (2026-08-23) — iteration 5
- Read Receipts in DMs (Sent → Seen)
- Save Shared Photos: tap chat photo → full-screen zoom viewer → save to an existing project's gallery or a new project
- Coverage Map Ring: SVG map on /map drawing each contractor's travel radius (green = reaches you) + distance list
- Wall likes + comments with emojis (reaction bar ❤️🌿😍👏🐝 + comments modal with emoji quick-insert)
- Highly personalised AI redesign: garden type, mood, colour scheme, ornaments, must-haves note, and a "exact items/brands you want" wishlist (each becomes a shoppable B&Q supplier pin)
- Crowdsourced product prices: buyers add the price they paid (no scraping); shown as community avg to the next person
- Verified: backend curl + frontend lint/e2e (iteration 5)

## Implemented (2026-06 fork) — iteration 6: Automated Contracts + Job Tracker
- Auto-drafted service agreement per contractor: pre-filled scope/price/timeline/deposit/payment/materials/guarantee + 9 fair plain-English standard clauses protecting BOTH parties
- Fully editable terms (edit resets both signatures); collapsible standard terms
- Dual e-signature: customer (creator) signs customer side; contractor/admin signs contractor side → status draft → awaiting_signatures → active
- Discussion thread on each agreement (both parties)
- Job completion tracker (5 stages) — only contractor/admin updates; last stage → completed; customer sees live progress
- My Agreements list (/contracts) reachable from Projects tab + contractor detail
- Verified: 22/22 backend + frontend E2E passed (iteration 6)

## Implemented (2026-06 fork) — iteration 7: Reviews w/ photos + Legal pages
- Contractor reviews now accept up to 6 photos (upload + thumbnails + remove); review cards show photo strip → full-screen zoom viewer
- Legal pages: Terms & Conditions, Privacy & Data Protection, Chat & Data Safety (/legal/[doc]) linked from Profile
- Fixed admin `/admin` deep-link auth race (guard load on user.role === admin)
- Confirmed existing admin visit/active counters (now/5m/1h/24h), home social links (FB/IG/TT/YT), and QR share all working
- Verified: frontend E2E passed (iteration 7); reviews-with-photos backend curl-verified

## Backlog
### P1
- Real member-to-member messaging + community chat room (opt-out aware)
- Membership tiers with Stripe/RevenueCat (free vs premium AI limits)
- Real affiliate links + curated retailer product catalog with images
- Admin dashboard (poll rotation, active users on projects, project inspection)
### P2
- Contractor onboarding + assign contractor to a project, contract e-sign persistence
- Hotspot positions mapped to actual detected products
- Terms/Privacy full content, data-safety controls
