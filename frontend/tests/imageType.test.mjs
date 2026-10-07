import test from "node:test";
import assert from "node:assert/strict";
import { sniffImageType } from "../src/imageType.js";

const bytes = (...b) => Uint8Array.from([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)]);
test("recognises PNG, JPEG and WebP by their first bytes", () => {
  assert.equal(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "png");
  assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), "jpeg");
  assert.equal(sniffImageType(Uint8Array.from([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBP"), 0])), "webp");
});
test("rejects text, SVG, GIF, empty and too-short input", () => {
  const text = (s) => Uint8Array.from(Buffer.from(s.padEnd(20, " ")));
  assert.equal(sniffImageType(text("this is plain text")), null);
  assert.equal(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(sniffImageType(text("GIF89a")), null);
  assert.equal(sniffImageType(new Uint8Array(0)), null);
  assert.equal(sniffImageType(Uint8Array.from([0x89, 0x50])), null);
  assert.equal(sniffImageType(null), null);
});
test("a PNG-looking start that isn't a full PNG signature is rejected", () => {
  assert.equal(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00)), null);
  assert.equal(sniffImageType(Uint8Array.from([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WAVE"), 0])), null);
});
