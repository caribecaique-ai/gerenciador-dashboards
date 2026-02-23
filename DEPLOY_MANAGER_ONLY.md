# Deploy Manager-Only (Sem Viewer Separado)

Este modo publica somente:

- `manager_api` (porta `3005`)
- `manager_frontend` (porta `3010`)

O dashboard passa a ser servido pelo proprio gerenciador via `GET /api/dashboard`.

## 1) Backend (`apps/api/backend/.env`)

Campos obrigatorios:

```env
PORT=3005
DATABASE_URL="postgresql://..."
PRIMARY_DASHBOARD_MODE="internal"
```

Campos opcionais:

```env
DASHBOARD_PUBLIC_URL="https://manager.seudominio.com/"
DASHBOARD_PUBLIC_HOST=""
ALERT_EMAIL_WEBHOOK_URL=""
ALERT_WHATSAPP_WEBHOOK_URL=""
```

## 2) Frontend (`frontend/.env`)

Campos obrigatorios:

```env
VITE_API_URL=https://manager-api.seudominio.com/api
VITE_PRIMARY_DASHBOARD_MODE=internal
```

Em `internal`, os links de dashboard sao gerados como:

- `https://manager.seudominio.com/?slug=<slug-do-cliente>`

## 3) Build e start

Backend:

```bash
cd apps/api/backend
npm install
node server.js
```

Frontend:

```bash
cd frontend
npm install
npm run build
npm run preview -- --host 0.0.0.0 --port 3010
```

## 4) Reverse proxy (Nginx)

- `manager.seudominio.com` -> `http://127.0.0.1:3010`
- `manager-api.seudominio.com` -> `http://127.0.0.1:3005`

Com TLS (HTTPS) ativo em ambos.

## 5) Validacao rapida

- `GET https://manager-api.seudominio.com/api/health`
- Abrir `https://manager.seudominio.com`
- Conectar um cliente
- Clicar em `Open` e validar URL com `?slug=...`
