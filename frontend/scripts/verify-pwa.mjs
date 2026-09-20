import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("out");
const manifest = JSON.parse(await readFile(path.join(output, "manifest.webmanifest"), "utf8"));
const required = [
  ["icons/stockpilot-192.png", 192],
  ["icons/stockpilot-512.png", 512],
  ["icons/stockpilot-maskable-512.png", 512],
  ["icons/stockpilot-badge-96.png", 96],
];

if (manifest.id !== "/" || manifest.display !== "standalone") {
  throw new Error("Manifest must use a stable id and standalone display mode.");
}

for (const [file, expectedSize] of required) {
  const absolute = path.join(output, file);
  await stat(absolute);
  const png = await readFile(absolute);
  if (png.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG.`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`${file} must be ${expectedSize}x${expectedSize}, received ${width}x${height}.`);
  }
}

const worker = await readFile(path.join(output, "firebase-messaging-sw.js"), "utf8");
if (!worker.includes("SKIP_WAITING") || !worker.includes('startsWith("/api/")')) {
  throw new Error("Service worker update handling or API cache exclusion is missing.");
}

await stat(path.join(output, "offline.html"));
console.log("PWA verification passed: manifest, icons, offline fallback and service worker are ready.");
