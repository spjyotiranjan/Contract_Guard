import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

async function main() {
  const base = process.env.TEST_BASE_URL;
  if (!base) throw new Error("Set TEST_BASE_URL to a running app using an isolated test database.");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || undefined });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = randomUUID();
  const apiName = `quote-${suffix}`;
  const serviceName = `mobile-${suffix}`;
  try {
    await page.goto(base);
    await page.getByRole("link", { name: "New API" }).click();
    await page.locator("#name").fill(apiName);
    await page.locator("#owner").fill("API team");
    await page.getByRole("button", { name: "Create API" }).click();
    await page.getByRole("heading", { name: `${apiName}.` }).waitFor();
    await page.getByRole("button", { name: "Add version", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles("specs/quote-api/1-initial.yaml");
    await page.getByText("Version detected from YAML:").waitFor();
    assert.equal(await page.locator("#version").count(), 0);
    await page.getByRole("dialog").getByRole("button", { name: "Upload YAML" }).click();
    await page.getByText("API version uploaded successfully.").waitFor();
    await page.getByRole("button", { name: "Expand info" }).click();
    await page.getByRole("cell", { name: "Quote API" }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: /Version 1.0.0/ }).click();
    await page.getByRole("button", { name: "Expand info" }).click();
    await page.getByRole("cell", { name: "Quote API" }).waitFor();
    await page.getByRole("button", { name: "Add version", exact: true }).click();
    const noVersion = (await readFile("specs/quote-api/1-initial.yaml", "utf8")).replace("  version: 1.0.0\n", "");
    await page.locator('input[type="file"]').setInputFiles({ name: "missing.yaml", mimeType: "application/yaml", buffer: Buffer.from(noVersion) });
    await page.locator("#version").fill("3.0.0");
    await page.getByRole("dialog").getByRole("button", { name: "Upload YAML" }).click();
    await page.getByRole("button", { name: /Version 3.0.0/ }).waitFor();
    await page.getByRole("button", { name: /Compare 1.0.0 .* to 3.0.0/ }).click();
    await page.getByRole("heading", { name: /1.0.0.*3.0.0/ }).waitFor();
    await page.getByText("/info/version").waitFor();
    await page.getByText("/info/version").click();
    await page.getByText('"1.0.0"', { exact: true }).waitFor();
    await page.getByLabel("Show").selectOption("schemas");
    await page.getByText("No changes in this category.").waitFor();

    await page.getByRole("link", { name: "Back to registry" }).click();
    await page.getByRole("link", { name: "New service" }).click();
    await page.locator("#name").fill(serviceName);
    await page.locator("#owner").fill("Mobile team");
    await page.getByRole("button", { name: "Create service" }).click();
    await page.getByRole("heading", { name: `${serviceName}.` }).waitFor();
    await page.getByRole("button", { name: "Upload YAML", exact: true }).click();
    const serviceYaml = (await readFile("consumers/mobile-app.yaml", "utf8")).replace("consumer: mobile-app", `consumer: ${serviceName}`);
    await page.locator('input[type="file"]').setInputFiles({ name: "service.yaml", mimeType: "application/yaml", buffer: Buffer.from(serviceYaml) });
    await page.getByRole("dialog").getByRole("button", { name: "Upload YAML" }).click();
    await page.getByText("Service definition uploaded successfully.").waitFor();
    await page.getByRole("cell", { name: serviceName }).waitFor();
    await page.getByRole("button", { name: "Expand uses" }).click();
    await page.getByRole("button", { name: "Expand [0]" }).click();
    await page.getByRole("cell", { name: "quote-api" }).waitFor();

    await page.getByRole("link", { name: "Back to registry" }).click();
    await page.getByLabel("Search by name or owner").fill(serviceName);
    await page.getByRole("link", { name: new RegExp(serviceName) }).first().waitFor();
    assert.equal(await page.getByText(apiName, { exact: true }).count(), 0);
    await page.getByRole("button", { name: /APIs/ }).click();
    await page.getByText("No matching entities").waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    console.log("Registry browser checks passed.");
  } finally { await browser.close(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
