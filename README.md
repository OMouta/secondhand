# secondhand

Ask something.

## Local Development

Install dependencies:

```bash
pnpm install
```

Start Postgres:

```bash
docker compose up -d
```

Start the dev server:

```bash
pnpm dev
```

Required environment:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/secondhand
```

Postgres must have `pgvector` available. Migrations are managed with Drizzle.
Embeddings run locally with Transformers.js and are cached in Postgres.

Create the local database, enable `pgvector`, and apply migrations:

```bash
pnpm db:setup
```

Build for production:

```bash
pnpm build
```

Run checks:

```bash
pnpm check
```
