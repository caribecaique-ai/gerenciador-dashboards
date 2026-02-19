# Central de Controle de Dashboards (ClickUp) - GOLD EDITION

Sistema multitenant de alto desempenho para gestão de clientes, monitoramento de saúde de dashboards e sincronização com ClickUp.

## 🚀 Arquitetura
- **Monorepo**: Gestão simplificada de backend, frontend e pacotes compartilhados.
- **Backend (NestJS)**: Modular, seguro (JWT + RBAC), realtime (WebSockets).
- **Frontend (Next.js 14)**: App Router, shadcn/ui, TanStack Query.
- **Database**: PostgreSQL (Prisma ORM).
- **Cache/Queue**: Redis + BullMQ.

## 📁 Estrutura de Pastas
- `/apps/api`: Servidor NestJS.
- `/apps/web`: Frontend Next.js.
- `/packages/shared`: Tipos e esquemas Zod compartilhados.
- `/infra`: Arquivos de infraestrutura (Docker, Nginx).

## 🛠️ Setup Local

### Pré-requisitos
- Node.js 20+
- Docker e Docker Compose

### 1. Preparar Ambiente
```bash
cp .env.example .env
# Preencha as chaves no .env
```

### 2. Rodar com Docker (Recomendado)
```bash
npm run docker:up
```

### 3. Rodar sem Docker (Modo Dev)
```bash
# Na raiz
npm install
npm run dev
```

### 4. Setup do Banco
```bash
npm run migrate:dev
npm run seed
```

## 🔒 Credenciais Padrão
- **URL**: `http://localhost:3000`
- **User**: `admin@local`
- **Pass**: `admin123`

## 📡 Endpoints Principais
- `GET /docs`: Swagger (OpenAPI)
- `POST /auth/login`: Autenticação
- `POST /public/telemetry/heartbeat`: Recebimento de métricas dos dashboards

## 🎨 Personalização
- **Temas**: Altere em `apps/web/app/globals.css`.
- **Cores**: Use classes Tailwind ou variáveis CSS no `root`.
- **Novos KPIs**: Adicione campos no `schema.prisma` -> `MetricTimeseries` e atualize os componentes no frontend.

---
Desenvolvido com 💜 pela equipe de Engenharia Sênior.
