import test from "node:test";
import assert from "node:assert/strict";
import { buildCode, codeExists, defaultSeries, nextFreeSeries, nextSequence, nextZoneOrder, parseCode, seriesFitsZone, seriesInZone, typeLetter, zonesOf } from "../src/catalogCode.js";

const mk = (code, order, name) => ({ code, zone: { order, name } });
const dvps = [
  mk("UDVP-101-01", 1, "Instrument panel"), mk("UDVP-101-02", 1, "Instrument panel"), mk("UDVP-107-03", 1, "Instrument panel"),
  mk("VDVP-101-01", 1, "Instrument panel"), mk("UDVP-401-09", 4, "Seats"), mk("UDVP-404-01", 4, "Seats"), mk("UDVP-1001-01", 10, "NRS"),
];

test("parseCode reads valid codes and rejects bad ones", () => {
  assert.deepEqual(parseCode("UDVP-101-01"), { letter: "U", series: "101", seq: 1 });
  assert.deepEqual(parseCode("VDVP-1001-12"), { letter: "V", series: "1001", seq: 12 });
  for (const bad of ["", null, undefined, "UDVP-1-01", "UDVP-101-1", "XDVP-101-01", "udvp-101-01", "UDVP-101-01 "]) assert.equal(parseCode(bad), null, String(bad));
});
test("typeLetter and buildCode", () => {
  assert.equal(typeLetter("Usability"), "U"); assert.equal(typeLetter("Visibility"), "V"); assert.equal(typeLetter("anything else"), "U");
  assert.equal(buildCode("Usability", "101", 8), "UDVP-101-08"); assert.equal(buildCode("Visibility", "1001", 12), "VDVP-1001-12");
});
test("a series fits its zone only as <zone number> + two digits", () => {
  assert.ok(seriesFitsZone("101", 1)); assert.ok(seriesFitsZone("407", 4)); assert.ok(seriesFitsZone("1001", 10)); assert.ok(seriesFitsZone("1101", 11));
  assert.ok(!seriesFitsZone("401", 1)); assert.ok(!seriesFitsZone("101", 10)); assert.ok(!seriesFitsZone("1001", 1)); assert.ok(!seriesFitsZone("10", 1)); assert.ok(!seriesFitsZone("", 1));
});
test("zones are listed once each, in order", () => {
  assert.deepEqual(zonesOf(dvps), [{ order: 1, name: "Instrument panel" }, { order: 4, name: "Seats" }, { order: 10, name: "NRS" }]);
  assert.deepEqual(zonesOf([]), []);
  assert.equal(nextZoneOrder(dvps), 11); assert.equal(nextZoneOrder([]), 1);
});
test("series in a zone: distinct, numeric order", () => {
  assert.deepEqual(seriesInZone(dvps, 1), ["101", "107"]); assert.deepEqual(seriesInZone(dvps, 4), ["401", "404"]);
  assert.deepEqual(seriesInZone(dvps, 10), ["1001"]); assert.deepEqual(seriesInZone(dvps, 9), []);
  assert.deepEqual(seriesInZone([mk("UDVP-1001-01", 10, "x"), mk("UDVP-999-01", 10, "x")], 10), ["999", "1001"], "numeric, not alphabetical");
});
test("default and next-free series", () => {
  assert.equal(defaultSeries(dvps, 1), "107"); assert.equal(defaultSeries(dvps, 4), "404"); assert.equal(defaultSeries(dvps, 11), "1101"); assert.equal(defaultSeries(dvps, 5), "501");
  assert.equal(nextFreeSeries(dvps, 1), "108"); assert.equal(nextFreeSeries(dvps, 4), "405"); assert.equal(nextFreeSeries(dvps, 11), "1101");
});
test("next running number counts only the same type and series", () => {
  assert.equal(nextSequence(dvps, "Usability", "101"), 3);
  assert.equal(nextSequence(dvps, "Visibility", "101"), 2, "V and U are numbered separately");
  assert.equal(nextSequence(dvps, "Usability", "401"), 10);
  assert.equal(nextSequence(dvps, "Usability", "107"), 4);
  assert.equal(nextSequence(dvps, "Usability", "999"), 1, "a series with nothing yet starts at 1");
  assert.equal(nextSequence(dvps, "Visibility", "401"), 1);
  assert.equal(nextSequence([mk("UDVP-101-99", 1, "x")], "Usability", "101"), null, "a full series has no next number");
  assert.equal(nextSequence(dvps, "Usability", 101), 3, "accepts a number as well as text");
});
test("codeExists", () => {
  assert.ok(codeExists(dvps, "UDVP-101-01")); assert.ok(!codeExists(dvps, "UDVP-101-03")); assert.ok(!codeExists([], "UDVP-101-01"));
});
test("a suggested code never collides with an existing one", () => {
  for (const zone of [1, 4, 10, 11]) for (const type of ["Usability", "Visibility"]) {
    const series = defaultSeries(dvps, zone); const seq = nextSequence(dvps, type, series);
    assert.ok(seq === null || !codeExists(dvps, buildCode(type, series, seq)), `${type} zone ${zone}`);
  }
});
