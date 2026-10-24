# LocalLoop

LocalLoop is a hyperlocal event discovery and community engagement platform for
finding nearby events, saving or RSVP'ing to them, and helping organizers publish
and manage events.

This repository contains the current MVP implementation for the LocalLoop
product described in the accompanying PRD. The product direction is:

> Discover -> RSVP -> attend -> connect -> rediscover

## Current implementation

### Attendees

- Browse featured and upcoming published events.
- Search events by title, description, city, venue, organizer, and category.
- Filter by category, city, mode, and free/paid status.
- Sort by soonest, newest, or popularity.
- View event details including schedule, venue, organizer, price, capacity, and
  registration status.
- Sign in with Clerk.
- RSVP for an event or join its waitlist when capacity is reached.
- Cancel an RSVP.
- Save and unsave events.
- View personal RSVPs and saved events.

### Organizers

- Create an organizer profile.
- Create event drafts with structured event details.
- Validate event dates, venue, city, and required publishing fields.
- Publish owned event drafts.
- View organizer events, publication counts, RSVP counts, and waitlist counts.

### Platform foundations

- Responsive React/Vite web client with mobile navigation.
- Express 5 API under the `/api` base path.
- Clerk authentication and optional Clerk proxy support.
- PostgreSQL persistence through Drizzle ORM.
- Shared OpenAPI, Zod, and generated React Query API clients.
- Pino request logging and API error responses.
- Seed utilities for local/demo event data.

The full PRD also describes future work such as map-based discovery, advanced
personalization, poster-to-event AI extraction, notifications, QR check-in,
communities, moderation, ingestion, analytics, and monetization. Those are
roadmap items unless listed above as implemented.

## Repository layout

```text
.
├── artifacts/
│   ├── api-server/       Express API and route handlers
│   ├── localloop/        Main React/Vite application
│   └── mockup-sandbox/   UI mockup and preview workspace
├── lib/
│   ├── api-client-react/ Generated React Query API client
│   ├── api-spec/         OpenAPI source and Orval configuration
│   ├── api-zod/          Generated Zod schemas and API types
│   └── db/               Drizzle client and PostgreSQL schema
├── scripts/               Workspace utility scripts
├── package.json           Root scripts and workspace metadata
├── pnpm-workspace.yaml    Workspace packages and dependency catalog
└── pnpm-lock.yaml         Locked dependency versions
```

## Technology stack

- Node.js 24 and pnpm workspaces
- TypeScript 5.9
- React 19, Vite, Wouter, and TanStack React Query
- Express 5
- PostgreSQL, `pg`, Drizzle ORM, and Drizzle Zod
- Clerk for authentication
- OpenAPI 3.1, Orval, and Zod
- Tailwind CSS, Radix UI primitives, Lucide icons, Leaflet, and Recharts
- Pino and Pino HTTP for structured logging

## Prerequisites

- Node.js 24 or a compatible current Node.js release
- pnpm
- PostgreSQL database
- Clerk application credentials for authenticated flows

Install pnpm if needed, then install dependencies from the repository root:

```bash
corepack enable
pnpm install
```

The repository enforces pnpm and applies a minimum package release age through
`.npmrc` and `pnpm-workspace.yaml` as a supply-chain protection.

## Environment variables

Create the environment variables required by the process you are running. Do
not commit secrets.

### API server and database

```env
DATABASE_URL=postgresql://user:password@localhost:5432/localloop
CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NODE_ENV=development
LOG_LEVEL=info
```

`DATABASE_URL` is required by the database package and Drizzle configuration.
`CLERK_SECRET_KEY` is used for the production Clerk proxy path; development can
use the direct Clerk flow.

### Web client

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_...
VITE_CLERK_PROXY_URL=
```

The Vite configuration also recognizes `PORT` and `BASE_PATH` when supplied by
the hosting environment.

## Running locally

From the repository root:

```bash
# Start the web client
pnpm --filter @workspace/localloop run dev

# Build and start the API server
pnpm --filter @workspace/api-server run dev
```

The API listens on port `5000` by default. The Vite development server prints
its assigned local URL. The frontend expects the API to be available through
the configured deployment/proxy environment.

For production-style local checks:

```bash
pnpm run typecheck
pnpm run build
```

## Database workflow

After setting `DATABASE_URL`, apply the current Drizzle schema in a development
database:

```bash
pnpm --filter @workspace/db run push
```

The source of truth for tables is
`lib/db/src/schema/index.ts` and the schema files it exports. The main current
entities include organizers, events, RSVPs, saved events, access control,
communities, reviews, notifications, follows, preferences, and reports.

## API and code generation

The OpenAPI source of truth is `lib/api-spec/openapi.yaml`. Generated API
artifacts are consumed by the frontend through the workspace packages.

After changing the OpenAPI specification:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

The generated packages are:

- `@workspace/api-zod` for runtime validation and shared types
- `@workspace/api-client-react` for generated React Query hooks

The API health endpoint is:

```text
GET /api/healthz
```

Important API groups currently include:

| Group | Examples |
| --- | --- |
| Events | `GET /api/events`, `GET /api/events/featured`, `GET /api/events/:eventId` |
| Attendee actions | `POST/DELETE /api/events/:eventId/rsvp`, `POST/DELETE /api/events/:eventId/save` |
| Personal events | `GET /api/me/events` |
| Organizer profile | `GET/POST /api/organizer/me` |
| Organizer dashboard | `GET /api/organizer/dashboard` |
| Organizer publishing | `POST /api/organizer/events`, `POST /api/organizer/events/:eventId/publish` |

Authenticated endpoints require a valid Clerk session. The API validates
request input and response shapes with the generated Zod schemas.

## Architecture notes

- The OpenAPI document, generated Zod schemas, generated client hooks, and
  server handlers are kept as separate workspace packages so API contracts are
  shared rather than duplicated.
- Event list responses join organizer data and enrich events with the current
  user's RSVP and saved state when authenticated.
- RSVP creation uses a database transaction and row locking to avoid
  overbooking when capacity is configured.
- Organizer ownership is resolved from the authenticated Clerk user ID; event
  publishing is restricted to the owning organizer.
- The frontend uses TanStack Query for server state and invalidates affected
  event and personal-event queries after RSVP/save mutations.
- Event discovery currently uses PostgreSQL filtering and sorting. The
  recommendation, semantic search, and geospatial ranking approach in the PRD
  remains a planned evolution.

## Quality checks

Run the narrowest applicable check after changes:

```bash
pnpm run typecheck
pnpm run build
```

If the API contract changes, regenerate clients before typechecking. If the
database schema changes, review the generated migration/push plan against a
development database before applying it.

## Product direction

The PRD targets a city-by-city launch focused first on students, early-career
professionals, campus clubs, meetup communities, and startup/corporate event
organizers. The north-star metric is verified event attendance by returning
users, rather than registrations alone.

Planned phases include:

1. **Find it, post it, show up:** authentication, discovery, event publishing,
   RSVP, reminders, sharing, and check-in.
2. **Engagement:** communities, social proof, ratings, recurring events, and
   attendance badges.
3. **Scale and monetization:** boosts, advanced analytics, native ticketing,
   and additional cities.

## Security and privacy

- Never commit `.env` files, Clerk keys, database credentials, or other
  secrets.
- Use HTTPS in deployed environments.
- Keep location, messaging, and social visibility opt-in.
- Review aggregation and ingestion sources for permission and terms compliance.
- The PRD calls for DPDP Act 2023 and GDPR-aligned privacy practices as the
  product expands.

## License

This project is licensed under the MIT License.
