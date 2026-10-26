import fs from "node:fs";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { type FlowSchema, flowDatabaseCandidates, pickFlowSchema } from "../core/flow-schema";

// Max's ear on Wispr Flow: notices each new Flow dictation, read-only, by
// watching Flow's local history. Nothing is ever written to Flow's database.

export interface FlowDictation {
  text: string;
  app?: string;
}

const POLL_MS = 250;

export class FlowHistoryWatcher {
  private db?: DatabaseSync;
  private schema?: FlowSchema;
  private lastId = 0;
  private timer?: NodeJS.Timeout;

  /** Starts watching; returns a message for Settings either way. */
  start(onDictation: (d: FlowDictation) => void, at?: string): { ok: boolean; message: string } {
    this.stop();
    const file = at ?? flowDatabaseCandidates(process.platform, process.env, os.homedir()).find((f) => fs.existsSync(f));
    if (!file) return { ok: false, message: "Couldn't find Wispr Flow's history on this computer. Is Flow installed?" };
    try {
      this.db = new DatabaseSync(file, { readOnly: true });
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      const columns = Object.fromEntries(
        tables.map(({ name }) => [
          name,
          (this.db!.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string }[]).map((c) => c.name),
        ]),
      );
      const schema = pickFlowSchema(columns);
      if (!schema) {
        this.stop();
        return { ok: false, message: "This version of Wispr Flow stores its history differently, so this can't work yet." };
      }
      this.schema = schema;
      const last = this.db.prepare(`SELECT MAX(rowid) AS id FROM "${schema.table}"`).get() as { id: number | null };
      this.lastId = last.id ?? 0;
      this.timer = setInterval(() => this.poll(onDictation), POLL_MS);
      return { ok: true, message: 'Listening along with Wispr Flow. Start a dictation with "Hey Max" to hand it over.' };
    } catch (err) {
      this.stop();
      return { ok: false, message: `Couldn't open Wispr Flow's history: ${(err as Error).message}` };
    }
  }

  private poll(onDictation: (d: FlowDictation) => void) {
    if (!this.db || !this.schema) return;
    const { table, text, app } = this.schema;
    try {
      const rows = this.db
        .prepare(`SELECT rowid AS id, "${text}" AS text${app ? `, "${app}" AS app` : ""} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT 20`)
        .all(this.lastId) as { id: number; text: string | null; app?: string | null }[];
      for (const row of rows) {
        this.lastId = row.id;
        if (row.text?.trim()) onDictation({ text: row.text.trim(), app: row.app ?? undefined });
      }
    } catch {
      // Flow may be mid-write; try again on the next tick.
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.db?.close();
    } catch {
      // already closed
    }
    this.db = undefined;
    this.schema = undefined;
  }
}
