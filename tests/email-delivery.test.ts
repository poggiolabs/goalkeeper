import { describe, expect, test } from "bun:test";
import {
  configuredEmailDelivery,
  LogEmailDelivery,
  SmtpEmailDelivery
} from "../services/api/src/auth/email-delivery";

describe("email delivery configuration", () => {
  test("restricts log delivery to non-production processes", () => {
    expect(configuredEmailDelivery({})).toBeInstanceOf(LogEmailDelivery);
    expect(() =>
      configuredEmailDelivery({
        AUTH_EMAIL_DELIVERY: "log",
        NODE_ENV: "production"
      })
    ).toThrow("only outside production");
  });

  test("requires an SMTP URL and sender", () => {
    expect(() =>
      configuredEmailDelivery({ AUTH_EMAIL_DELIVERY: "smtp" })
    ).toThrow("AUTH_EMAIL_FROM and AUTH_SMTP_URL are required");

    expect(() =>
      configuredEmailDelivery({
        AUTH_EMAIL_DELIVERY: "smtp",
        AUTH_EMAIL_FROM: "Goalkeeper <noreply@example.com>",
        AUTH_SMTP_URL: "https://smtp.example.com"
      })
    ).toThrow("valid smtp:// or smtps:// URL");
  });

  test("maps SMTP URLs and authentication messages to emailjs", async () => {
    let implicitTlsOptions: unknown;
    let startTlsOptions: unknown;
    let deliveredMessage: unknown;

    const delivery = new SmtpEmailDelivery(
      "smtps://api_token:p%40ss@smtp.example.com:465",
      "Goalkeeper <noreply@example.com>",
      (options) => {
        implicitTlsOptions = options;
        return {
          async sendAsync(message) {
            deliveredMessage = message;
          }
        };
      }
    );

    await delivery.send({
      to: "user@example.com",
      subject: "Verify your email",
      text: "Open the verification link."
    });

    expect(implicitTlsOptions).toEqual({
      host: "smtp.example.com",
      port: 465,
      user: "api_token",
      password: "p@ss",
      ssl: { servername: "smtp.example.com" },
      tls: false,
      timeout: 30_000
    });
    expect(deliveredMessage).toEqual({
      from: "Goalkeeper <noreply@example.com>",
      to: "user@example.com",
      subject: "Verify your email",
      text: "Open the verification link."
    });

    new SmtpEmailDelivery(
      "smtp://user:password@smtp.example.com",
      "Goalkeeper <noreply@example.com>",
      (options) => {
        startTlsOptions = options;
        return { async sendAsync() {} };
      }
    );
    expect(startTlsOptions).toEqual({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      password: "password",
      ssl: false,
      tls: true,
      timeout: 30_000
    });
  });

  test("rejects unknown delivery modes", () => {
    expect(() =>
      configuredEmailDelivery({ AUTH_EMAIL_DELIVERY: "provider-api" })
    ).toThrow("AUTH_EMAIL_DELIVERY must be one of: log, smtp");
  });
});
