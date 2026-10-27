import assert from "node:assert/strict";
import { test } from "node:test";
import { flowDatabaseCandidates, pickFlowSchema } from "../src/core/flow-schema";

test("finds Flow's history table and text column whatever they're called", () => {
  assert.deepEqual(pickFlowSchema({ History: ["id", "timestamp", "app", "formattedText", "audio"] }), {
    table: "History",
    text: "formattedText",
    app: "app",
  });
  assert.deepEqual(pickFlowSchema({ history: ["id", "asr_text", "app_name"] }), { table: "history", text: "asr_text", app: "app_name" });
  assert.deepEqual(pickFlowSchema({ History: ["id", "TEXT"] }), { table: "History", text: "TEXT", app: undefined });
  assert.equal(pickFlowSchema({ Settings: ["key", "value"] }), null);
  assert.equal(pickFlowSchema({ History: ["id", "audio"] }), null);
});

test("knows where Flow keeps its database", () => {
  assert.deepEqual(flowDatabaseCandidates("darwin", {}, "/Users/ritu"), ["/Users/ritu/Library/Application Support/Wispr Flow/flow.sqlite"]);
  assert.deepEqual(flowDatabaseCandidates("win32", { APPDATA: "C:\\Users\\R\\AppData\\Roaming" }, "C:\\Users\\R"), [
    "C:\\Users\\R\\AppData\\Roaming\\Wispr Flow\\flow.sqlite",
    "C:\\Users\\R\\AppData\\Roaming\\wispr-flow\\flow.sqlite",
  ]);
  assert.deepEqual(flowDatabaseCandidates("linux", {}, "/home/x"), []);
});

test("watcher reports new Flow dictations, not old ones, and never writes", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { FlowHistoryWatcher } = await import("../src/main/flow-history");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flow-")), "flow.sqlite");
  const flow = new DatabaseSync(file);
  flow.exec(`CREATE TABLE History (id INTEGER PRIMARY KEY, timestamp TEXT, app TEXT, formattedText TEXT)`);
  flow.prepare("INSERT INTO History (app, formattedText) VALUES (?, ?)").run("Slack", "an old dictation");

  const seen: { text: string; app?: string }[] = [];
  const watcher = new FlowHistoryWatcher();
  const status = watcher.start((d) => seen.push(d), file);
  assert.equal(status.ok, true);

  flow.prepare("INSERT INTO History (app, formattedText) VALUES (?, ?)").run("LinkedIn", "Write a message to Sam asking about the role");
  await new Promise((r) => setTimeout(r, 1000));
  watcher.stop();
  assert.deepEqual(seen, [{ text: "Write a message to Sam asking about the role", app: "LinkedIn" }]);
  const after = flow.prepare("SELECT COUNT(*) AS n FROM History").get() as { n: number };
  assert.equal(after.n, 2);
});

test("watcher catches dictations whose words arrive after the row is created", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { FlowHistoryWatcher } = await import("../src/main/flow-history");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flow-")), "flow.sqlite");
  const flow = new DatabaseSync(file);
  flow.exec(`CREATE TABLE History (id INTEGER PRIMARY KEY, formattedText TEXT)`);
  const seen: string[] = [];
  const watcher = new FlowHistoryWatcher();
  watcher.start((d) => seen.push(d.text), file);
  flow.prepare("INSERT INTO History (formattedText) VALUES (NULL)").run();
  await new Promise((r) => setTimeout(r, 500));
  flow.prepare("UPDATE History SET formattedText = ? WHERE id = 1").run("Write me an email to Sam");
  await new Promise((r) => setTimeout(r, 600));
  watcher.stop();
  assert.deepEqual(seen, ["Write me an email to Sam"]);
});
