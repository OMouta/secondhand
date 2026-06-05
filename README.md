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
OPENAI_API_KEY=...
```

Postgres must have `pgvector` available. The app creates its tables on startup.

Build for production:

```bash
pnpm build
```

Run checks:

```bash
pnpm check
```
