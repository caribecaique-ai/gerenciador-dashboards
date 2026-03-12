# Gerenciador de Dashboards

Gerenciador interno dos dashboards ClickUp, com modo por `slug`, proxy para APIs e dashboard nativo embutido.

## Estrutura esperada

Este repositorio foi desenhado para funcionar ao lado do repositorio `clickup_dashboard`.

```text
workspace/
  dashboard_manager/
  clickup_dashboard/
```

Os scripts em `scripts/launchers/` assumem exatamente essa estrutura.

## Portas

- Gerenciador frontend: `3010`
- Gerenciador API: `3005`
- Dashboard frontend legado: `5173`
- Dashboard API legado: `3001`

## Setup rapido

### 1. Clonar os dois repositorios lado a lado

```powershell
git clone https://github.com/caribecaique-ai/gerenciador-dashboards.git dashboard_manager
git clone https://github.com/caribecaique-ai/clickup-dashboards.git clickup_dashboard
```

### 2. Configurar ambientes

```powershell
cd dashboard_manager
Copy-Item apps/api/backend/.env.example apps/api/backend/.env
Copy-Item frontend/.env.example frontend/.env
```

No repositorio `clickup_dashboard`:

```powershell
cd ..\clickup_dashboard
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Preencha principalmente:

- `dashboard_manager/apps/api/backend/.env`
  - `DATABASE_URL`
  - `PRIMARY_DASHBOARD_MODE`
  - `PRIMARY_DASHBOARD_API_URL`
- `clickup_dashboard/backend/.env`
  - `CLICKUP_API_KEY`

## Subir localmente

### Apenas o gerenciador

```powershell
$env:MANAGER_ONLY_MODE="1"
powershell -ExecutionPolicy Bypass -File .\scripts\launchers\start_dashboard_stack.ps1
```

### Gerenciador + dashboards legados

```powershell
$env:MANAGER_ONLY_MODE="0"
$env:MANAGER_NETWORK_MODE="1"
powershell -ExecutionPolicy Bypass -File .\scripts\launchers\start_dashboard_stack.ps1
```

Ou:

```powershell
.\scripts\launchers\start_dashboard_stack.bat
```

## Autostart no Windows

Registrar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launchers\register_dashboard_autostart.ps1
```

Remover:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launchers\unregister_dashboard_autostart.ps1
```

## URLs

Local:

- `http://localhost:3010`
- `http://localhost:3010/?slug=qgbet`
- `http://localhost:3010/?slug=caique`
- `http://localhost:5173`

## Observacoes

- O dashboard interno por `slug` roda no frontend do gerenciador.
- O frontend de `5173` continua existindo como dashboard legado separado.
- Os scripts usam `vite preview` para os frontends, porque ficou mais estavel em ambiente Windows local.
