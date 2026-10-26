// Wispr Flow keeps its dictation history in a local SQLite database. It isn't
// a documented API, so the table and column names are discovered at run time
// instead of hard-coded: a Flow update that renames them just turns the
// feature off rather than breaking anything.

const TABLES = ["History", "history", "Dictations", "dictations", "Transcripts", "transcripts"];
const TEXT = ["formattedText", "formatted_text", "editedText", "edited_text", "finalText", "final_text", "text", "asrText", "asr_text", "transcript"];
const APP = ["app", "appName", "app_name", "application", "appBundleId", "bundleId"];

export interface FlowSchema {
  table: string;
  text: string;
  app?: string;
}

/** Picks the history table and its text/app columns from what the database actually has. */
export function pickFlowSchema(tables: Record<string, string[]>): FlowSchema | null {
  const find = (want: string[], have: string[]) => {
    const lower = new Map(have.map((h) => [h.toLowerCase(), h]));
    for (const w of want) {
      const hit = lower.get(w.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };
  for (const table of TABLES) {
    const columns = tables[table];
    if (!columns) continue;
    const text = find(TEXT, columns);
    if (text) return { table, text, app: find(APP, columns) };
  }
  return null;
}

/** Where Flow keeps its database on each platform (the first that exists is used). */
export function flowDatabaseCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string[] {
  const join = (...p: string[]) => p.join(platform === "win32" ? "\\" : "/");
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Wispr Flow", "flow.sqlite")];
  if (platform === "win32") {
    return [env.APPDATA, env.LOCALAPPDATA]
      .filter((d): d is string => Boolean(d))
      .flatMap((d) => [join(d, "Wispr Flow", "flow.sqlite"), join(d, "wispr-flow", "flow.sqlite")]);
  }
  return [];
}
