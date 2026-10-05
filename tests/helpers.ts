import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));

export const loadFixtureText = (name: string): string => readFileSync(fixturePath(name), "utf8");

export const loadFixture = (name: string): Record<string, unknown> => JSON.parse(loadFixtureText(name));
