import { SQL } from "bun";
import { migrateApiDatabase } from "./api-tokens/postgres";

const database = new SQL(
  process.env.DATABASE_URL ??
    "postgresql://goalkeeper:goalkeeper@127.0.0.1:5432/goalkeeper"
);

try {
  await migrateApiDatabase(database);
  console.log("API database migrations are current");
} finally {
  await database.close();
}
