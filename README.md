# Web Tools

A React toolbox with a TOTP generator and a persistent URL shortener. Production is one Node container on port 8080.

## Run locally

```bash
npm install
cp .env.example .env
npm run fe:dev
```

```bash
npm run be:dev
```

`be:dev` loads `.env`. Docker and production do not.

## Docs

- [TOTP](docs/totp.md)
- [URL shortener](docs/url-shortener.md)
- [Development](docs/development.md)
- [Server operations](docs/server-operations.md)
