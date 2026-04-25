#!/usr/bin/env bun
/**
 * Add one or more UI string keys to every locale catalog under
 * src/locales/, keeping key sets identical across files and writing
 * them alphabetized so diffs stay minimal.
 *
 * Invocation (any of):
 *   bun scripts/add-key.ts path/to/payload.json
 *   bun scripts/add-key.ts < payload.json
 *   bun scripts/add-key.ts --stdin  (explicit)
 *
 * Payload shape — single object or array:
 *
 *   { "key": "home.greeting", "translations": { "en": "Hi", "fr": "Salut" } }
 *
 *   [
 *     { "key": "a.b", "translations": { "en": "...", "fr": "..." } },
 *     { "key": "c.d", "translations": { "en": "...", "fr": "..." } }
 *   ]
 *
 * Rules:
 *   - Every locale in SUPPORTED_LOCALES must have a translation.
 *   - Existing keys are not overwritten — run with `--force` to replace.
 *   - Files are rewritten in sorted order with a trailing newline.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "../src/mapping.ts";

interface Entry {
  key: string;
  translations: Record<string, string>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const localesDir = join(scriptDir, "..", "src", "locales");

function parseArgs(argv: string[]): { file: string | null; force: boolean } {
  let file: string | null = null;
  let force = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--force") force = true;
    else if (arg === "--stdin") file = null;
    else if (!arg.startsWith("--")) file = arg;
  }
  return { file, force };
}

function readPayload(file: string | null): Entry[] {
  const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as Entry).key !== "string" ||
      !(entry as Entry).key
    ) {
      throw new Error(`Invalid entry — expected { key, translations }: ${JSON.stringify(entry)}`);
    }
    const e = entry as Entry;
    if (!e.translations || typeof e.translations !== "object") {
      throw new Error(`${e.key}: missing translations object`);
    }
    for (const locale of SUPPORTED_LOCALES) {
      const value = e.translations[locale];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${e.key}: missing or empty translation for "${locale}"`);
      }
    }
  }
  return entries as Entry[];
}

function loadCatalog(locale: string): Record<string, string> {
  const path = join(localesDir, `${locale}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

function saveCatalog(locale: string, data: Record<string, string>): void {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(data).sort((a, b) => a.localeCompare(b))) {
    sorted[k] = data[k]!;
  }
  writeFileSync(join(localesDir, `${locale}.json`), `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function main(): void {
  const { file, force } = parseArgs(process.argv);
  const entries = readPayload(file);
  const summary: string[] = [];

  for (const locale of SUPPORTED_LOCALES) {
    const catalog = loadCatalog(locale);
    const added: string[] = [];
    const replaced: string[] = [];
    for (const entry of entries) {
      if (catalog[entry.key] !== undefined) {
        if (!force) {
          throw new Error(
            `${entry.key} already exists in ${locale}.json — rerun with --force to overwrite`,
          );
        }
        replaced.push(entry.key);
      } else {
        added.push(entry.key);
      }
      catalog[entry.key] = entry.translations[locale]!;
    }
    saveCatalog(locale, catalog);
    summary.push(
      `${locale}: +${added.length} added${replaced.length > 0 ? `, ${replaced.length} replaced` : ""}`,
    );
  }

  for (const line of summary) console.log(line);
}

main();
