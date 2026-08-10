import { describe, expect, test } from "bun:test";
import {
  isEmailAddress,
  maximumEmailAddressLength
} from "../services/api/src/email-address";

describe("email address validation", () => {
  test("accepts ordinary addresses and rejects obvious malformation", () => {
    for (const value of [
      "ada@example.com",
      "ada+invites@mail.example.co.uk",
      "a@b.c"
    ]) {
      expect(isEmailAddress(value)).toBe(true);
    }

    for (const value of [
      "",
      "ada",
      "ada@example",
      "@example.com",
      "ada@@example.com",
      "ada @example.com",
      "ada@exam ple.com",
      "ada@example.com\n",
      123,
      null,
      undefined
    ]) {
      expect(isEmailAddress(value)).toBe(false);
    }
  });

  test("enforces the default and a caller-supplied length cap", () => {
    const long = `${"a".repeat(maximumEmailAddressLength - 12)}@example.com`;
    expect(long.length).toBe(maximumEmailAddressLength);
    expect(isEmailAddress(long)).toBe(true);
    expect(isEmailAddress(`a${long}`)).toBe(false);

    // The email auth backend passes a stricter cap than the default.
    expect(isEmailAddress("ada@example.com", 254)).toBe(true);
    expect(isEmailAddress(long, 254)).toBe(false);
  });
});
