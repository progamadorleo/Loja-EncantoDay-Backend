# Encanto Day - Backend API

API Backend para a loja de maquiagem Encanto Day.

## Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **TypeScript** - Tipagem estática
- **Helmet** - Segurança HTTP
- **CORS** - Cross-Origin Resource Sharing
- **Morgan** - Logger de requisições

## Instalação

```bash
# Entrar na pasta do backend
cd backend

# Instalar dependências
npm install

# Copiar arquivo de ambiente
cp .env.example .env

# Editar variáveis de ambiente
nano .env
```

## Scripts

```bash
# Desenvolvimento (com hot reload)
npm run dev

# Build para produção
npm run build

# Rodar em produção
npm start

# Limpar pasta dist
npm run clean
```

## Rotas

### Health Check

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Status completo da API |
| GET | `/api/health/ping` | Resposta simples (pong) |

## Estrutura de Pastas

```
backend/
├── src/
│   ├── routes/        # Rotas da API
│   │   └── health.ts  # Rota de health check
│   └── server.ts      # Entrada da aplicação
├── dist/              # Build compilado
├── .env               # Variáveis de ambiente
├── .env.example       # Exemplo de variáveis
├── package.json
├── tsconfig.json
└── README.md
```

## Desenvolvido por

**LS STUDIO** - [@ls_dev](https://instagram.com/ls_dev)
