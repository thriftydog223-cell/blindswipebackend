# Wyndr API Server

Express + Socket.io backend for the Wyndr dating app.

## Features

- Email/password authentication with JWT
- Blind swiping & matching system
- Bidirectional photo reveal after 5 messages each
- Real-time chat via Socket.io
- Voice message support
- Message requests (accept before chatting)
- Unmatch with grayed conversation history
- Reporting & admin moderation system
- Ban/suspend system
- Forgot-password / email-verification flow
- Push notifications via Expo
- Conversation health nudge job (hourly background job)
- Nationwide discovery with orientation, height & lifestyle filters
- Admin dashboard endpoints

## Deploy to Railway

### 1. Create a new Railway project

```bash
railway login
railway new
```

### 2. Add a Postgres database

In the Railway dashboard → **New Service → Database → PostgreSQL**.  
Railway will inject `DATABASE_URL` automatically.

### 3. Set environment variables

Copy `.env.example` to Railway's **Variables** tab and fill in the values
(you can skip `DATABASE_URL` — Railway sets it for you).

### 4. Deploy

Push this folder to a GitHub repo and connect it in Railway, **or** use the
Railway CLI:

```bash
railway up
```

Railway will run `npm install && npm run build` then `npm start`.

### 5. Run database migrations

After the first deploy, open a Railway shell and run:

```bash
npm run db:push
```

This uses Drizzle Kit to sync the schema to your Postgres instance.

## Local development

```bash
cp .env.example .env
# fill in .env values
npm install
npm run dev
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Long random string for signing JWTs |
| `PORT` | auto | Injected by Railway |
| `NODE_ENV` | ✅ | Set to `production` |
| `SMTP_HOST` | ✅ | SMTP server host for email |
| `SMTP_PORT` | ✅ | SMTP port (587 for TLS) |
| `SMTP_USER` | ✅ | SMTP username |
| `SMTP_PASS` | ✅ | SMTP password / API key |
| `SMTP_FROM` | ✅ | Sender email address |
| `EXPO_ACCESS_TOKEN` | optional | For push notifications |
| `UPLOAD_DIR` | optional | Path for uploaded photos (default `/app/uploads`) |

## API routes

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login |
| POST | `/auth/forgot-password` | Send reset email |
| POST | `/auth/reset-password` | Reset password with token |
| GET | `/discover` | Get swipe candidates |
| POST | `/swipes` | Record a swipe |
| GET | `/matches` | Get matches list |
| POST | `/matches/:id/unmatch` | Unmatch |
| POST | `/matches/:id/accept` | Accept message request |
| GET | `/matches/:id/messages` | Get chat messages |
| POST | `/matches/:id/messages` | Send message |
| POST | `/matches/:id/messages/:msgId/voice` | Upload voice message |
| POST | `/reports` | Report a user |
| GET | `/admin/users` | List users (admin) |
| POST | `/admin/users/:id/ban` | Ban user (admin) |
| POST | `/admin/users/:id/suspend` | Suspend user (admin) |
| POST | `/upload/photo` | Upload profile photo |
| GET | `/health` | Health check |

## Socket.io events

| Event | Direction | Description |
|---|---|---|
| `join_match` | client→server | Join a match room |
| `send_message` | client→server | Send a chat message |
| `typing_start` | client→server | Start typing indicator |
| `typing_stop` | client→server | Stop typing indicator |
| `messages_read` | client→server | Mark messages as read |
| `new_message` | server→client | New message received |
| `typing` | server→client | Typing indicator update |
| `unmatched` | server→client | Match was removed |
| `match_accepted` | server→client | Message request accepted |
