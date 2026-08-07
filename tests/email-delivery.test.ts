import { describe, expect, test } from "bun:test";
import {
  configuredEmailDelivery,
  LogEmailDelivery,
  optionalNotificationDelivery,
  SmtpEmailDelivery
} from "../services/api/src/notifications/email-delivery";

describe("email delivery configuration", () => {
  test("restricts log delivery to non-production processes", () => {
    expect(configuredEmailDelivery({})).toBeInstanceOf(LogEmailDelivery);
    expect(() =>
      configuredEmailDelivery({
        EMAIL_DELIVERY: "log",
        NODE_ENV: "production"
      })
    ).toThrow("only outside production");
  });

  test("requires an SMTP URL and sender", () => {
    expect(() =>
      configuredEmailDelivery({ EMAIL_DELIVERY: "smtp" })
    ).toThrow("EMAIL_FROM and SMTP_URL are required");

    expect(() =>
      configuredEmailDelivery({
        EMAIL_DELIVERY: "smtp",
        EMAIL_FROM: "Goalkeeper <noreply@example.com>",
        SMTP_URL: "https://smtp.example.com"
      })
    ).toThrow("valid smtp:// or smtps:// URL");
  });

  test("accepts the deprecated AUTH_-prefixed aliases", () => {
    expect(() =>
      configuredEmailDelivery({
        AUTH_EMAIL_DELIVERY: "log",
        NODE_ENV: "production"
      })
    ).toThrow("only outside production");

    expect(
      configuredEmailDelivery({
        AUTH_EMAIL_DELIVERY: "smtp",
        AUTH_EMAIL_FROM: "Goalkeeper <noreply@example.com>",
        AUTH_SMTP_URL: "smtps://api_token:secret@smtp.example.com"
      })
    ).toBeInstanceOf(SmtpEmailDelivery);
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
      timeout: 5_000
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
      timeout: 5_000
    });
  });

  test("rejects unknown delivery modes", () => {
    expect(() =>
      configuredEmailDelivery({ EMAIL_DELIVERY: "provider-api" })
    ).toThrow("EMAIL_DELIVERY must be one of: log, smtp");
  });
});

describe("optional notification delivery", () => {
  test("degrades to null in production rather than throwing", () => {
    // Registration must fail without a mailer; a notification must not.
    expect(() =>
      configuredEmailDelivery({ NODE_ENV: "production" })
    ).toThrow("only outside production");
    expect(optionalNotificationDelivery({ NODE_ENV: "production" })).toBeNull();
    expect(
      optionalNotificationDelivery({ EMAIL_DELIVERY: "log", NODE_ENV: "production" })
    ).toBeNull();
  });

  test("degrades to null when SMTP is selected but unconfigured", () => {
    expect(
      optionalNotificationDelivery({
        EMAIL_DELIVERY: "smtp",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      optionalNotificationDelivery({
        EMAIL_DELIVERY: "smtp",
        EMAIL_FROM: "Goalkeeper <noreply@example.com>",
        SMTP_URL: "smtps://api_token:secret@smtp.mx.cloudflare.net",
        NODE_ENV: "production"
      })
    ).toBeInstanceOf(SmtpEmailDelivery);
  });

  test("logs outside production so local invitations are visible", () => {
    expect(optionalNotificationDelivery({})).toBeInstanceOf(LogEmailDelivery);
  });
});
