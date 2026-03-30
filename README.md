# Cortex

A clean AI chat platform built with FastAPI and React, powered by Anthropic Claude Sonnet 4.6.

## Features

- **AI Chat** — Conversational interface with real-time token streaming (SSE)
- **File Upload** — Upload PDF, DOCX, TXT files for AI analysis with text extraction
- **Artifact Generation** — Ask the AI to write documents (thesis, essays, reports) with dedicated artifact cards
- **DOCX Export** — Download AI-generated content as formatted Word documents
- **Authentication** — JWT-based auth with login, register, profile management, password change
- **Session Management** — Persistent chat history with pinning, sharing, search, and auto-delete
- **Responsive UI** — Works on desktop and mobile

## Tech Stack

| Layer    | Technology                            |
| -------- | ------------------------------------- |
| Frontend | React + Vite, vanilla CSS             |
| Backend  | FastAPI (Python), async               |
| Database | MongoDB (Motor)                       |
| AI Model | Anthropic Claude Sonnet 4.6           |
| Auth     | JWT (access + refresh tokens), bcrypt |

## License

MIT
