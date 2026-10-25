# HyperLocal Event Discovery (LocalLoop)

LocalLoop is a modern, real-time hyperlocal event discovery and community engagement platform. It empowers users to explore nearby activities, workshops, meetups, and local happenings with an interactive map, streamlined ticketing, QR-code based ticket validation, and community-driven event hosting.

---

## 🌟 Key Features

- 📍 **Hyperlocal Event Discovery**: Filter and search events by location, distance, categories, date, and interests.
- 🗺️ **Interactive Maps**: Real-time map powered by Leaflet to explore events taking place around your neighborhood.
- 🎟️ **Ticketing & RSVPs**: Reserve tickets, track upcoming events, and view order history.
- 📱 **QR Code Check-in**: Integrated QR code generation and live camera scanner (`@zxing`) for organizers to verify attendee check-ins smoothly.
- 👥 **Community Hubs**: Join and follow local interest groups, neighborhoods, and club circles.
- ✍️ **Organizer Dashboard**: Create events, manage draft/published listings, set ticket pricing, and track attendee metrics.
- 🔐 **Modern Authentication**: Seamless user onboarding and authentication powered by Clerk.

---

## 🛠️ Tech Stack

### Frontend (`artifacts/localloop`)
- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS v4 + Radix UI Primitives + Lucide Icons
- **State & Data Fetching**: TanStack React Query v5
- **Routing**: Wouter
- **Maps**: Leaflet & React-Leaflet
- **QR Utilities**: `qrcode.react` & `@zxing/browser`

### Backend (`artifacts/api-server`)
- **Runtime**: Node.js
- **API Framework**: Express 5
- **Database & ORM**: PostgreSQL with Drizzle ORM
- **Validation**: Zod schema validation
- **Logging**: Pino HTTP logger

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/) (v9+)
- [PostgreSQL](https://www.postgresql.org/) database (optional for frontend preview)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Ojas37/HyperLocal-Event-Discovery.git
   cd HyperLocal-Event-Discovery
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

### Running the Application

#### 1. Start the Frontend Website
```bash
pnpm --filter @workspace/localloop run dev
```
The website will be running locally at `http://localhost:5173`.

#### 2. Start the API Server (Optional / Full-Stack)
Make sure you have your PostgreSQL database connection set:
```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/localloop"
pnpm --filter @workspace/api-server run dev
```

---

## 📂 Project Structure

```plaintext
├── artifacts/
│   ├── localloop/         # Vite + React frontend web application
│   ├── api-server/        # Express API backend
│   └── mockup-sandbox/    # Component mockup workspace
├── lib/
│   ├── api-client-react/  # Auto-generated React query hooks and fetch client
│   ├── api-spec/          # OpenAPI specifications
│   ├── api-zod/           # Zod validation schemas
│   └── db/                # Drizzle ORM schema and database setup
├── pnpm-workspace.yaml    # Monorepo workspace configuration
└── package.json           # Workspace scripts and root tools
```

---

## 📄 License
This project is licensed under the MIT License.
