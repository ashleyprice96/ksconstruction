import { describe, expect, it } from "vitest";
import { normaliseEmail, normaliseUsername } from "../../src/lib/usernames";

describe("usernames", () => {
  it("accepts a gang-lead style username and rejects anything else", () => {
    expect(normaliseUsername(" Andrew.Shaw ")).toBe("andrew.shaw");
    expect(normaliseUsername("gang-1")).toBe("gang-1");
    expect(normaliseUsername("")).toBeNull();
    expect(normaliseUsername("bad_name")).toBeNull();
    expect(normaliseUsername(".shaw")).toBeNull();
    expect(normaliseUsername("andrew.")).toBeNull();
    expect(normaliseUsername("andrew..shaw")).toBeNull();
    expect(normaliseUsername("andrew@ks")).toBeNull();
  });

  it("treats a blank email as absent and rejects a broken one", () => {
    expect(normaliseEmail("  ")).toBeNull();
    expect(normaliseEmail("Alex@Demo.Test")).toBe("alex@demo.test");
    expect(normaliseEmail("not-an-email")).toBeNull();
  });
});
