import { afterEach, describe, expect, it } from "vitest";
import { shareNotifyTo } from "../../src/lib/share";

describe("share sign email", () => {
  const prev = {
    host: process.env.SMTP_HOST,
    sign: process.env.SIGN_NOTIFY_EMAIL,
    reset: process.env.RESET_REQUEST_EMAIL,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries({ SMTP_HOST: prev.host, SIGN_NOTIFY_EMAIL: prev.sign, RESET_REQUEST_EMAIL: prev.reset })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("stays quiet unless SMTP and a recipient are set, and prefers SIGN_NOTIFY_EMAIL", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SIGN_NOTIFY_EMAIL;
    delete process.env.RESET_REQUEST_EMAIL;
    expect(shareNotifyTo()).toBeNull();
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.RESET_REQUEST_EMAIL = "office@example.test";
    expect(shareNotifyTo()).toBe("office@example.test");
    process.env.SIGN_NOTIFY_EMAIL = "signs@example.test";
    expect(shareNotifyTo()).toBe("signs@example.test");
  });
});
