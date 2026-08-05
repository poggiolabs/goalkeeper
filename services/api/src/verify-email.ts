import { SQL } from "bun";
import { migrateApiDatabase } from "./api-tokens/postgres";
import { AuthError } from "./auth/types";
import { verifyEmailByOperator } from "./auth/email";

if (process.env.NODE_ENV === "production") {
  throw new Error("Operator email verification is disabled in production");
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: bun run auth:verify-email -- user@example.com");
  process.exit(1);
}

const database = new SQL(
  process.env.DATABASE_URL ??
    "postgresql://goalkeeper:goalkeeper@127.0.0.1:5432/goalkeeper"
);

try {
  await migrateApiDatabase(database);
  const result = await verifyEmailByOperator(database, email);
  console.log(`Verified ${result.email}`);
} catch (error) {
  if (error instanceof AuthError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await database.close();
}
