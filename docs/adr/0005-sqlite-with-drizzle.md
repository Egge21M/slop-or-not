# SQLite with Drizzle

The single-instance pilot uses SQLite through Bun's native `bun:sqlite` driver, with Drizzle for database access and schema migrations. This keeps durable application state with the one server instead of operating a separate database service; the database must live on a persistent Fly Volume rather than the Machine's ephemeral root filesystem.

Versioned SQL migrations run on the volume-owning server before it accepts traffic. Expiry and Inbox deletion remove application records; forensic disk erasure is outside the pilot scope.
