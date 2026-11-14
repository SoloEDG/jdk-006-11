import test from "node:test";
import assert from "node:assert/strict";
import {
  createEvidence,
  addNote,
  collectClue,
  canCollectSound,
  editNote,
  deleteNote,
  togglePinned,
} from "../src/features/evidence/index";
import {
  createSnapshot,
  validateSnapshot,
  createSlot,
  writeSlot,
  readSlots,
  deleteSlot,
  exportSlot,
  parseImported,
} from "../src/features/profiles/index";
import { CASE_CONTENT } from "../src/features/story";
import type { CaseContent, Investigation } from "../src/shared/types";
const content: CaseContent = {
  id: "test",
  title: "test",
  scenes: [
    {
      id: "arrival",
      title: "A",
      location: "x",
      chapter: "1",
      description: "",
      choices: [],
    },
  ],
  episodes: [
    {
      id: "arrival-main",
      sceneId: "arrival",
      title: "A",
      version: "main",
      description: "",
      audio: "a",
      duration: 20,
      wave: [],
      cues: [
        {
          id: "cue",
          start: 0,
          end: 12,
          speaker: "S",
          text: "hello",
          sound: { clueId: "bell", start: 5, end: 7, description: "bell" },
        },
      ],
    },
  ],
  clues: [{ id: "bell", title: "Bell", kind: "sound", description: "" }],
};
const story: Investigation = {
  sceneId: "arrival",
  visited: ["arrival"],
  decisions: [],
  ending: null,
};
const anchor = { sceneId: "arrival" as const, start: 5, end: 7 };
function snapshot() {
  return createSnapshot(
    content,
    story,
    addNote(createEvidence(), anchor, "memo"),
    { "arrival-main": 7 },
    { sceneId: "arrival", position: 6, rate: 1 },
  );
}
test("notes normalize anchors, edit, pin and delete without mutation", () => {
  const initial = createEvidence();
  const state = addNote(initial, { ...anchor, extra: "drop" } as any, " memo ");
  assert.equal(initial.notes.length, 0);
  assert.deepEqual(state.notes[0].anchor, anchor);
  const id = state.notes[0].id;
  assert.equal(editNote(state, id, "updated").notes[0].text, "updated");
  assert.equal(togglePinned(state, id).notes[0].pinned, true);
  assert.equal(deleteNote(state, id).selectedId, null);
  assert.throws(() => addNote(initial, { ...anchor, end: NaN }, "bad"));
});
test("clues unlock at actual sound end, use episode source and cannot duplicate", () => {
  const episode = content.episodes[0],
    cue = episode.cues[0];
  assert.equal(canCollectSound({ "arrival-main": 6 }, episode, cue), false);
  assert.equal(canCollectSound({ "arrival-main": 7 }, episode, cue), true);
  assert.equal(
    collectClue(createEvidence(), episode, cue, { "arrival-main": 6 }, anchor),
    null,
  );
  const found = collectClue(
    createEvidence(),
    episode,
    cue,
    { "arrival-main": 7 },
    anchor,
  )!;
  assert.deepEqual(found.clues, ["bell"]);
  assert.equal(
    collectClue(found, episode, cue, { "arrival-main": 10 }, anchor),
    null,
  );
});
test("snapshot rebuild strips unknown fields and rejects invalid ranges and heard sources", () => {
  const s = snapshot();
  const raw = JSON.parse(JSON.stringify(s));
  raw.extra = "drop";
  raw.evidence.notes[0].anchor.extra = "drop";
  const checked = validateSnapshot(raw, content);
  assert.equal("extra" in checked, false);
  assert.deepEqual(checked.evidence.notes[0].anchor, anchor);
  raw.heard.unknown = 1;
  assert.throws(() => validateSnapshot(raw, content), /听|source|音源/i);
  delete raw.heard.unknown;
  raw.evidence.notes[0].anchor.end = Infinity;
  assert.throws(() => validateSnapshot(raw, content));
});
test("slots keep deep independent copies and imported files get new identity", () => {
  const s = snapshot();
  const a = createSlot("  Case A  ", s),
    b = createSlot("B", s);
  s.evidence.notes[0].text = "changed";
  assert.equal(a.name, "Case A");
  assert.equal(a.snapshot.evidence.notes[0].text, "memo");
  a.snapshot.evidence.notes[0].text = "a";
  assert.equal(b.snapshot.evidence.notes[0].text, "memo");
  const imported = parseImported(exportSlot(a), content);
  assert.notEqual(imported.id, a.id);
  assert.match(imported.name, /副本/);
});
test("storage recovers corruption with warning, enforces limit and surfaces quota errors", () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    },
  });
  const first = createSlot("first", snapshot());
  let slots = writeSlot([], first);
  assert.equal(readSlots(content).slots.length, 1);
  assert.equal(deleteSlot(slots, first.id).length, 0);
  for (let i = 0; i < 8; i++)
    slots = writeSlot(
      i === 0 ? [] : slots,
      createSlot("slot " + i, snapshot()),
    );
  assert.throws(() => writeSlot(slots, createSlot("ninth", snapshot())), /8/);
  for (const key of memory.keys()) memory.set(key, "corrupt");
  assert.ok(readSlots(content).warning);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error("quota");
      },
      getItem: () => null,
    },
  });
  assert.throws(() => writeSlot([], first), /quota/);
});
const fogStory: Investigation = {
  sceneId: "interview",
  visited: ["arrival", "interview"],
  decisions: [],
  ending: null,
};
const fogResume = { sceneId: "interview" as const, position: 0, rate: 1 };
function fogSnapshot(noteAnchor: object, clues: string[] = []) {
  const evidence = addNote(
    { ...createEvidence(), clues },
    noteAnchor as any,
    "memo",
  );
  return createSnapshot(CASE_CONTENT, fogStory, evidence, {}, fogResume);
}
test("notes keep recording provenance through edit, pin and save round-trip", () => {
  const state = addNote(
    createEvidence(),
    { sceneId: "interview", start: 0, end: 5, sourceId: "interview-normal" },
    "memo",
  );
  const id = state.notes[0].id;
  for (const next of [editNote(state, id, "updated"), togglePinned(state, id)])
    assert.equal(next.notes[0].anchor.sourceId, "interview-normal");
  assert.throws(() =>
    addNote(
      createEvidence(),
      { sceneId: "interview", start: 0, end: 5, sourceId: 7 } as any,
      "bad",
    ),
  );
  const snap = validateSnapshot(
    JSON.parse(
      JSON.stringify(
        fogSnapshot({
          sceneId: "interview",
          start: 0,
          end: 5,
          sourceId: "interview-normal",
        }),
      ),
    ),
    CASE_CONTENT,
  );
  assert.equal(
    snap.evidence.notes[0].anchor.sourceId,
    "interview-normal",
  );
});
test("imports with contradictory source, scene or range are rejected as a whole", () => {
  const tampered = (anchor: object) => {
    const slot = createSlot(
      "x",
      fogSnapshot({
        sceneId: "interview",
        start: 0,
        end: 5,
        sourceId: "interview-normal",
      }),
    );
    const raw = JSON.parse(exportSlot(slot));
    raw.snapshot.evidence.notes[0].anchor = anchor;
    return JSON.stringify(raw);
  };
  // 来源不存在
  assert.throws(() =>
    parseImported(
      tampered({ sceneId: "interview", start: 0, end: 5, sourceId: "nope" }),
      CASE_CONTENT,
    ),
  );
  // 来源与场景矛盾
  assert.throws(() =>
    parseImported(
      tampered({ sceneId: "arrival", start: 0, end: 5, sourceId: "interview-normal" }),
      CASE_CONTENT,
    ),
  );
  // 范围超出来源录音（interview-normal 长 24.735，interview-aware 长 28.661）
  assert.throws(() =>
    parseImported(
      tampered({ sceneId: "interview", start: 20, end: 26, sourceId: "interview-normal" }),
      CASE_CONTENT,
    ),
  );
  const ok = parseImported(
    tampered({ sceneId: "interview", start: 20, end: 26, sourceId: "interview-aware" }),
    CASE_CONTENT,
  );
  assert.equal(
    ok.snapshot.evidence.notes[0].anchor.sourceId,
    "interview-aware",
  );
});
test("legacy notes without provenance stay unknown and are never backfilled", () => {
  const raw = JSON.parse(
    JSON.stringify(
      fogSnapshot({ sceneId: "interview", start: 0, end: 26 }, ["bell"]),
    ),
  );
  delete raw.evidence.notes[0].anchor.sourceId;
  const checked = validateSnapshot(raw, CASE_CONTENT);
  const anchor = checked.evidence.notes[0].anchor;
  assert.equal("sourceId" in anchor, false);
  assert.equal(anchor.end, 26);
  assert.deepEqual(checked.evidence.clues, ["bell"]);
});
