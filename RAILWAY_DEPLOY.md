# Deploy no Railway (GitHub)

Este repositório é um monorepo com:
- frontend React/Vite na raiz
- backend Flask em `backend/`

## 1) Pré-requisitos no repositório

Garanta que as alterações deste branch foram commitadas e enviadas ao GitHub.

## 2) Criar projeto no Railway

1. Acesse Railway e crie um novo projeto.
2. Clique em `New` e conecte este repositório do GitHub.

## 3) Serviço de banco (MySQL)

1. No projeto, adicione `MySQL`.
2. Railway cria variáveis de conexão automaticamente para o serviço.

## 4) Serviço do backend (Flask)

1. Crie um serviço a partir do mesmo repositório.
2. Configure `Root Directory` para `backend`.
3. O `Procfile` já define o start:
   - `gunicorn --bind 0.0.0.0:$PORT app.main:app`
4. Em `Variables`, configure:

```env
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}

SECRET_KEY=<valor-forte>
JWT_SECRET_KEY=<valor-forte>
CORS_ORIGINS=https://SEU_FRONTEND.up.railway.app

# Opcional, recomendado com volume:
STORAGE_ROOT=/app/storage
```

5. Se usa upload de arquivos, adicione `Volume` no backend:
   - Mount path: `/app/storage`

## 5) Serviço do frontend (Vite)

1. Crie outro serviço do mesmo repositório.
2. Configure `Root Directory` para `/` (raiz).
3. Em `Variables`, configure:

```env
VITE_API_URL=https://SEU_BACKEND.up.railway.app/api
```

4. Build/Start (se quiser setar manualmente):
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`

## 6) Ordem recomendada de deploy

1. Suba backend e MySQL.
2. Copie o domínio público do backend.
3. Configure `VITE_API_URL` no frontend e faça novo deploy do frontend.
4. Copie o domínio público do frontend.
5. Atualize `CORS_ORIGINS` no backend e redeploy.

## 7) Migração de dados

Para banco existente local:
- exporte com `mysqldump`
- importe no MySQL do Railway usando as credenciais do serviço

## 8) Checklist rápido

- backend online em `/api/health`
- frontend abre sem erro de CORS
- login funciona com `VITE_API_URL` apontando para backend Railway
- upload persiste após redeploy (com volume configurado)

