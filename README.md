# VIScon Hackathon Template

Welcome, hackers, to the VIScon Hackathon!

This repository is a small but complete example app: a React frontend, a
Python (FastAPI) backend with an AI-powered endpoint, and a web server (Caddy)
that ties them together. It's meant to show you all the moving parts, so
read it, change it, or yeet it completely :)

## Quick Start

```bash
cp .env.sample .env
# In .env: add your team's API key
docker compose up --build
```

Then open:

- **App:** http://localhost:8080
- **API docs:** http://localhost:8080/api/docs

## On Your Team VM

The template is already running on your team VM, in `~/template`, at your
team's address (see your team page in the portal). Its `.env` is prefilled,
including a shared LLM key.

> [!IMPORTANT]
> The shared LLM key is only for trying out the demo and has a very limited
> quota. For development and for your deployed app, use your team's own key:
> set it as `LLM_API_KEY` in `.env`.

After changing code or `.env`, redeploy with:

```bash
cd ~/template
docker compose up -d --build
```

- The portal forwards your team's address to port 8080 on the VM. If you
  change the port, change it in the portal's network configuration too.
- If you set the portal's access control to "Disabled", your app is public
  and receives no user headers, so all visitors share one "Guest" user and
  its todo list. Change `extract_user()` in [`backend/app.py`](backend/app.py)
  if you want something else.
- Dev servers on the VM aren't reachable from outside. Forward the port over
  SSH, e.g. `ssh -L 5173:localhost:5173 viscon@<your VM>` (VS Code Remote-SSH
  does this automatically).

The portal's documentation covers the network configuration in more detail.

## Configuration

All configuration lives in the `.env` file in the project root (see [`.env.sample`](.env.sample)).

| Variable       | Description                                                             |
| :------------- | :---------------------------------------------------------------------- |
| `LLM_API_BASE` | URL of an OpenAI-compatible API. Defaults to the hackathon's LLM proxy. |
| `LLM_API_KEY`  | Your team's API key. The prefilled shared key is for the demo only.     |
| `LLM_MODEL`    | The model id to use.                                                    |

Want to use OpenAI (or any other OpenAI-compatible provider) directly? Set
`LLM_API_BASE=https://api.openai.com/v1` and use your own key.

## Local Development (without Docker)

For fast iteration with hot reloading, run the backend and frontend directly
in two terminals. The team VMs come with the right versions (Python 3.14,
Node 24).

**Backend** (reads the root `.env` automatically):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python app.py
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173. The dev server forwards all `/api` requests
to the backend on port 8000 (see [`vite.config.ts`](frontend/vite.config.ts)).

No authentication headers are added locally, so you're logged in as "Guest".
To test as a specific user, send `X-User-Id` and `X-User-Name` yourself, e.g.
`curl localhost:8000/api/me -H 'X-User-Id: einstein@ethz.ch' -H 'X-User-Name: Albert Einstein'`.

## Backend

A Python [FastAPI](https://fastapi.tiangolo.com/) app that provides a REST API
for a multi-user todo list. Todos are stored in memory, so they're gone after a
restart. Plug in a database when you need one.

| File                             | Purpose                                     |
| :------------------------------- | :------------------------------------------ |
| [`app.py`](backend/app.py)       | API endpoints, authentication and app state |
| [`models.py`](backend/models.py) | Data models (Pydantic)                      |
| [`ai.py`](backend/ai.py)         | LLM call that turns a prompt into a todo    |

### API Endpoints

All backend routes start with `/api`. Interactive docs are available at `/api/docs`.

| Method   | Path                   | Description                                         |
| :------- | :--------------------- | :-------------------------------------------------- |
| `GET`    | `/api/me`              | Get the current user.                               |
| `GET`    | `/api/todos`           | Get all todos for the current user.                 |
| `POST`   | `/api/todos`           | Create a new todo for the current user.             |
| `DELETE` | `/api/todos/{todo_id}` | Delete a specific todo by its ID.                   |
| `GET`    | `/api/todos/generate`  | Suggests a new todo from a natural language prompt. |
| `GET`    | `/api/todos/events`    | Event stream that tells you when your todos change. |

### Authentication

When deployed, authentication is handled by the VIScon portal. When a user
logs in, the portal adds these headers to every request forwarded to your app:

- `X-User-Id`: The user's email address, which uniquely identifies them.
- `X-User-Name`: The user's full name, with non-ASCII characters
  percent-encoded (`Zo%C3%AB` for "Zoë").

The backend reads and decodes them in `extract_user()` and uses `X-User-Id`
to keep a separate todo list for each user. Requests without these headers
(locally, or with the portal's access control disabled) all share one "Guest"
user.

Only trust these headers while port 8080 is reachable through the portal
alone, which is the default. If you open the port in your VM's firewall,
anyone can call your app directly and send fake headers.

### AI-Powered Todo Generation

`GET /api/todos/generate` sends your prompt to an LLM using the
[`openai`](https://github.com/openai/openai-python) Python package and asks for
an answer in the shape of a todo item (structured output). The prompt includes
a few examples to show the model what we expect ("few-shot prompting").

If the LLM can't be reached (e.g. the API key is missing), the endpoint logs
the error and returns a todo prefilled with your prompt, so the app keeps
working.

### Live Updates (Server-Sent Events)

Open the app in two tabs side by side and add a todo in one: it shows up in
the other right away. Each tab keeps a request to `/api/todos/events` open.
When a todo is created or deleted, the backend sends
`{"type": "todos_changed"}` to all open streams of that user, and the tabs
reload their todos over the normal REST API.

- Backend: `todo_events()` and `notify_todos_changed()` in
  [`app.py`](backend/app.py), using FastAPI's `EventSourceResponse`. FastAPI
  also sends a keep-alive ping every 15 seconds so proxies don't close idle
  streams.
- Frontend: `subscribeToTodoChanges()` in
  [`api.ts`](frontend/src/api.ts) uses the browser's
  `EventSource`, which reconnects by itself (e.g. when the backend restarts).

Why not WebSockets? Server-Sent Events are plain HTTP, so they pass every
proxy between the browser and your VM. WebSockets currently don't make it
through the hackathon's network (you get a `502 Bad Gateway` when deployed),
even though they work locally. For server-to-browser updates like these, you
don't need them: send data the other way with normal `fetch` requests.

Prefer a library? [Socket.IO](https://socket.io/) works too, e.g. for chat
rooms. When deployed, it automatically uses its built-in HTTP long-polling
transport. A few tips to get it running:

- **Keep the default transports**, so Socket.IO can pick long-polling by
  itself. Many tutorials set `transports: ["websocket"]`; just leave that out.
- **Mount it under `/api`**, so its requests reach the backend:
  `socketio_path="/api/socket.io"` on the server and
  `path: "/api/socket.io"` on the client.
- **Run a single backend process**, as the template already does, so all
  requests of a connection reach the same process.
- Each message is a regular HTTP request, which is plenty for chats,
  notifications and similar features.

Open streams live in memory in the backend process, like the todos. With
several workers or replicas, each only knows its own streams. Locally, browsers
allow only 6 open connections per host, so with many tabs open on the dev
server, requests start to hang (deployed, HTTP/2 lifts this limit).

## Frontend

A [React](https://react.dev/) app written in TypeScript and built with
[Vite](https://vite.dev/). It talks to the backend with the browser's `fetch`
API and gets live updates with `EventSource`.

| File                                         | Purpose                                   |
| :------------------------------------------- | :---------------------------------------- |
| [`src/App.tsx`](frontend/src/App.tsx)        | Main component, loads the current user    |
| [`src/api.ts`](frontend/src/api.ts)          | All backend requests and their types      |
| [`src/components/`](frontend/src/components) | UI components (header, todo form & table) |
| [`public/`](frontend/public)                 | Static files like images, served as-is    |

Useful commands (run in `frontend/`):

- `npm run dev`: start the dev server with hot reloading
- `npm run build`: type-check and build for production into `dist/`
- `npm run lint`: check the code with ESLint

## Project Structure

```
.
├── docker-compose.yml   # The two services: backend and frontend
├── .env.sample          # Configuration template, copy to .env
├── backend/             # FastAPI app (see "Backend")
│   └── Dockerfile
└── frontend/            # React app (see "Frontend")
    ├── Caddyfile        # Routing: /api to the backend, the rest to the React app
    └── Dockerfile       # Builds the app, then serves it with Caddy
```

## Adding a Service

All traffic enters through Caddy on port 8080, configured in
[`frontend/Caddyfile`](frontend/Caddyfile). To add a service (say, a second
API under `/ml`), add it to [`docker-compose.yml`](docker-compose.yml) and
give it its own `handle` block in the Caddyfile, next to the `/api` one:

```
handle /ml/* {
	reverse_proxy ml:5000
}
```

Containers reach each other by their service name (`backend`, `ml`, …).
Rebuild with `docker compose up --build`. For local development, add the
same prefix to the proxy in [`vite.config.ts`](frontend/vite.config.ts).
