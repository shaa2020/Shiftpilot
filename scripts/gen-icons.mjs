#!/usr/bin/env node
/** Renders the PWA / home-screen icons from public/icons/icon.svg (run after changing the logo). */
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile("public/icons/icon.svg");
const out = (name, size) => sharp(svg, { density: 512 }).resize(size, size).png().toFile(`public/icons/${name}`);
await out("icon-192.png", 192);
await out("icon-512.png", 512);
await out("apple-touch-icon.png", 180);
await out("favicon-32.png", 32);
// Maskable: logo inside the 80% safe zone on the brand background.
const inner = await sharp(svg, { density: 512 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#10243A" } }).composite([{ input: inner, gravity: "center" }]).png().toFile("public/icons/maskable-512.png");
console.log("icons written");
