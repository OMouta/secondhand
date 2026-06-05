# secondhand

Ask something.

## Local Development

Install dependencies:

```bash
pnpm install
```

Start the dev server:

```bash
pnpm dev
```

Required environment:

```bash
DATABASE_URL=postgres://...
```

Postgres must have `pgvector` available. Migrations are managed with Drizzle.
Embeddings run locally with Transformers.js and are cached in Postgres.

Apply migrations before starting the app:

```bash
pnpm db:migrate
```

Build for production:

```bash
pnpm build
```

Run checks:

```bash
pnpm check
```
