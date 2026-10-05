import { test } from "node:test";
import assert from "node:assert/strict";
import { toSpeech } from "./speech-variant.js";

test("strips punctuation and case", () =>
  assert.equal(toSpeech("Um, started on October 1st. Ended Saturday!"), "um started on october 1st ended saturday"));
test("keeps apostrophes", () =>
  assert.equal(toSpeech("Haven't started bleeding yet."), "haven't started bleeding yet"));
test("keeps digit separators", () =>
  assert.equal(toSpeech("Started 10/2, ended 10-5."), "started 10/2 ended 10-5"));
test("collapses whitespace", () =>
  assert.equal(toSpeech("No cramps,   just  bloating."), "no cramps just bloating"));
