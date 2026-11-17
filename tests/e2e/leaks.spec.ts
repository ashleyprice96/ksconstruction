// End-to-end claim flow, then a search of everything non-named users can reach for
// client rates, client values and margin. Requires a fresh demo seed.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const PASSWORD = "demo-password-1";
// Demo client figures (scripts/seed-demo.ts) and client values they produce in this test.
const SENTINELS = ["4.3217", "3.1979", "2.8643", "37.4129", "4321.97", "4,321.97", "3876.53", "3,876.53", "987.61",
  "518.60", "518.6", "255.83", "2,160.99", "2160.99"];

const tmp = mkdtempSync(join(tmpdir(), "ks-leaks-"));
const photo = join(tmp, "photo.png");
// 1x1 PNG.
writeFileSync(photo, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function login(ctx: BrowserContext, page: Page, email: string) {
  await ctx.clearCookies();
  await page.goto("/login");
  await page.fill("#login", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click(".login-card button[type=submit]")]);
}

async function sign(page: Page) {
  await page.fill("#foreman_name", "Pat Foreman");
  const pad = page.locator("canvas.sigpad");
  await pad.scrollIntoViewIfNeeded();
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 60); await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(b.x + 20 + i * 8, b.y + 60 + Math.sin(i / 2) * 30, { steps: 2 });
  await page.mouse.up();
  await Promise.all([page.waitForURL(/\/split/), page.click("main button:has-text('Sign')")]);
}

async function upload(page: Page, kind: string) {
  const form = page.locator(`form:has(input[name=kind][value=${kind}])`);
  await form.locator("input[type=file]").setInputFiles(photo);
  await page.waitForTimeout(300);
  await Promise.all([page.waitForURL(/ok=/), form.locator("button[type=submit]").click()]);
}

async function newClaim(page: Page, type: string, plotIndex: number) {
  await page.goto("/claims/new");
  await page.selectOption("#type", type);
  await page.selectOption("#job", (await page.locator("#job option", { hasText: "DEMO-001" }).first().getAttribute("value"))!);
  await page.selectOption("#plot", (await page.locator('#plot optgroup[label*="DEMO-001"] option').nth(plotIndex).getAttribute("value"))!);
  await Promise.all([page.waitForURL(/quantities/), page.click("main button[type=submit]")]);
  return page.url().split("/claims/")[1].split("/")[0];
}

test("claims flow, approvals, and no client figures outside the named list", async ({ page, context }) => {
  // Substructure claim.
  await login(context, page, "gang1@demo.test");
  const sub = await newClaim(page, "substructure", 1);
  const items = page.locator("input[name^=item_]");
  await items.nth(0).fill("80"); await items.nth(1).fill("120");
  await page.fill("#wall_ref_0", "Front A"); await page.fill("#wall_courses_0", "6");
  await Promise.all([page.waitForURL(/evidence/), page.click("main button:has-text('Save and continue')")]);
  // Submitting without evidence is refused.
  await page.goto(`/claims/${sub}/split`);
  await page.click("text=Split equally");
  await Promise.all([page.waitForURL(/error=/), page.click("main button:has-text('Submit claim')")]);
  await expect(page.locator(".alert.error")).toContainText("work photo");
  await expect(page.locator(".alert.error")).toContainText("foundation drawing");
  await expect(page.locator(".alert.error")).toContainText("foreman must sign");
  await page.goto(`/claims/${sub}/evidence`);
  await upload(page, "photo"); await upload(page, "drawing");
  await page.goto(`/claims/${sub}/sign`);
  await expect(page.locator("main")).not.toContainText("£");
  await sign(page);
  await page.click("text=Split equally");
  await Promise.all([page.waitForURL(/ok=/), page.click("main button:has-text('Submit claim')")]);

  // Superstructure: 50% of the 1st lift, then an over-claim of 60% is refused.
  const sup = await newClaim(page, "superstructure", 2);
  await page.locator("input[name^=lift_]").first().fill("50");
  await Promise.all([page.waitForURL(/evidence/), page.click("main button:has-text('Save and continue')")]);
  await upload(page, "photo");
  await page.goto(`/claims/${sup}/sign`); await sign(page);
  await page.click("text=Split equally");
  await Promise.all([page.waitForURL(/ok=/), page.click("main button:has-text('Submit claim')")]);
  const over = await newClaim(page, "superstructure", 2);
  await expect(page.locator("text=50% left to claim").first()).toBeVisible();
  await page.locator("input[name^=lift_]").first().evaluate((el: HTMLInputElement) => el.removeAttribute("max"));
  await page.locator("input[name^=lift_]").first().fill("60");
  await Promise.all([page.waitForURL(/evidence/), page.click("main button:has-text('Save and continue')")]);
  await upload(page, "photo");
  await page.goto(`/claims/${over}/sign`); await sign(page);
  await page.click("text=Split equally");
  await Promise.all([page.waitForURL(/error=/), page.click("main button:has-text('Submit claim')")]);
  await expect(page.locator(".alert.error")).toContainText("50% of this lift is left");

  // Management: pay-less reduction on the substructure claim, approve both, invoices.
  await login(context, page, "manager@demo.test");
  await page.goto(`/claims/${sub}`);
  await page.locator("summary", { hasText: "Pay-less reduction" }).click();
  await page.fill("#rq", "100");
  await page.fill("#rn", "Ten blocks not laid on inspection.");
  await Promise.all([page.waitForURL(/ok=/), page.click("button:has-text('Record reduction')")]);
  await expect(page.locator("main")).toContainText("Reductions");
  for (const id of [sub, sup]) {
    await page.goto(`/claims/${id}`);
    await Promise.all([page.waitForURL(/ok=/), page.click("main button:has-text('Approve')")]);
  }
  await page.goto("/payments");
  const runHref = (await page.locator("main table a").last().getAttribute("href"))!;
  await page.goto(runHref);
  await Promise.all([page.waitForURL(/ok=/), page.click("button:has-text('Generate or refresh invoices')")]);

  // Search everything each non-named user can reach.
  for (const email of ["gang1@demo.test", "gang2@demo.test", "cm@demo.test", "manager@demo.test"]) {
    await login(context, page, email);
    const seen = new Set<string>();
    const queue = ["/", "/claims", "/payments", "/payments/mine", "/payments/backup", "/rates", "/setup?s=sites", "/setup?s=gangs", "/setup?s=users",
      "/setup?s=settings", "/issues", "/notices", `/claims/${sub}`, `/claims/${sup}`, `/claims/${over}`];
    const downloads = new Set<string>();
    while (queue.length && seen.size < 120) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const res = await page.goto(url);
      if (!res || res.status() >= 400) continue;
      const html = await page.content();
      for (const s of SENTINELS) expect(html, `${email} saw ${s} on ${url}`).not.toContain(s);
      expect(await page.locator('a[href="/commercial"]').count(), `${email} has a margin link on ${url}`).toBe(0);
      for (const href of await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
        if (href.startsWith("/api/files")) continue;
        if (href.startsWith("/api/")) downloads.add(href);
        else if (!seen.has(href)) queue.push(href);
      }
    }
    if (email === "manager@demo.test") {
      const run = runHref.split("/").pop();
      const client = await page.request.get("/payments/backup");
      expect(client.ok()).toBeTruthy();
      downloads.add(`/api/payruns/${run}/export?format=xlsx`);
      downloads.add(`/api/payruns/${run}/export?format=csv`);
      await page.goto("/payments/backup");
      const opt = await page.locator("#client option").nth(1).getAttribute("value");
      downloads.add(`/api/backup?client=${opt}&from=2026-01-01&to=2030-12-31&part=1`);
    }
    for (const href of downloads) {
      const r = await page.request.get(href);
      if (!r.ok()) continue;
      const body = Buffer.from(await r.body());
      const text = await extractText(body, r.headers()["content-type"] ?? "");
      for (const s of SENTINELS) expect(text, `${email} found ${s} in ${href}`).not.toContain(s);
      expect(text.toLowerCase(), `${email} found margin in ${href}`).not.toContain("margin");
    }
    // The commercial area does not exist for them.
    expect((await page.goto("/commercial"))!.status()).toBe(404);
    expect((await page.request.get("/api/commercial/export?from=2026-01-01&to=2030-12-31")).status()).toBe(404);
  }

  // Positive control: the named-list user sees the figures.
  await login(context, page, "director@demo.test");
  await page.goto("/commercial?group=gang&from=2026-01-01&to=2030-12-31");
  await expect(page.locator(".restricted-banner")).toBeVisible();
  expect(await page.content()).toContain("4.3217");
  const exp = await page.request.get("/api/commercial/export?from=2026-01-01&to=2030-12-31");
  expect(exp.status()).toBe(200);
  expect(await extractText(Buffer.from(await exp.body()), exp.headers()["content-type"] ?? "")).toContain("margin");
});

async function extractText(body: Buffer, type: string): Promise<string> {
  if (type.includes("spreadsheetml")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as unknown as ArrayBuffer);
    const out: string[] = [];
    wb.eachSheet((ws) => { out.push(ws.name); ws.eachRow((row) => row.eachCell((c) => out.push(String(c.value ?? "")))); });
    return out.join("\n");
  }
  if (type.includes("pdf")) return pdfText(body);
  if (type.includes("zip")) {
    const zip = await JSZip.loadAsync(body);
    const parts: string[] = Object.keys(zip.files);
    for (const name of parts.filter((n) => n.endsWith(".pdf"))) parts.push(pdfText(await zip.file(name)!.async("nodebuffer")));
    return parts.join("\n");
  }
  return body.toString("utf8");
}

function pdfText(pdf: Buffer): string {
  const f = join(tmp, `doc-${Date.now()}.pdf`);
  writeFileSync(f, pdf);
  try { return execFileSync("pdftotext", ["-layout", f, "-"]).toString(); }
  catch { return readFileSync(f).toString("latin1"); }
}
