import { spawn } from "node:child_process";
import os from "node:os";

// "Hey Max, tell Claude to…": hands the task to the agent already installed and
// signed in on this computer (Claude Code or Codex), so it runs on the user's
// own subscription with no API keys. The task goes in on stdin, never through
// a shell command line.

export type AgentName = "claude" | "codex";

export const AGENT_LABEL: Record<AgentName, string> = { claude: "Claude", codex: "Codex" };

const COMMANDS: Record<AgentName, { cmd: string; args: string[]; install: string }> = {
  // Edits files in the work folder; anything riskier still needs the user's OK in Claude Code.
  claude: {
    cmd: "claude",
    // Research needs the web; file edits stay inside the work folder.
    args: ["-p", "--permission-mode", "acceptEdits", "--allowedTools", "WebSearch,WebFetch,Read,Glob,Grep,Edit,Write"],
    install: "npm install -g @anthropic-ai/claude-code, then run claude once to sign in",
  },
  codex: { cmd: "codex", args: ["exec", "--full-auto", "-"], install: "npm install -g @openai/codex, then run codex once to sign in" },
};

const TIMEOUT_MS = 10 * 60_000;

export interface AgentRun {
  done: Promise<string>;
  cancel(): void;
}

export function runAgent(agent: AgentName, task: string, cwd: string): AgentRun {
  const { cmd, args, install } = COMMANDS[agent];
  const child = spawn(cmd, args, {
    cwd: cwd || os.homedir(),
    // npm installs these as .cmd scripts on Windows, which need a shell to start.
    shell: process.platform === "win32",
    windowsHide: true,
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.stdin.on("error", () => undefined);
  child.stdin.end(task);
  const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
  const done = new Promise<string>((resolve, reject) => {
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === "ENOENT" ? `I couldn't find ${AGENT_LABEL[agent]} on this computer. Install it (${install}).` : e.message)),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      // On Windows a missing command comes back as a shell error, not ENOENT.
      if (code !== 0 && /not recognized|not found/i.test(err)) {
        return reject(new Error(`I couldn't find ${AGENT_LABEL[agent]} on this computer. Install it (${install}).`));
      }
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${AGENT_LABEL[agent]} stopped: ${(err || out).trim().split("\n").pop()?.slice(0, 160) || `exit ${code}`}`));
    });
  });
  return { done, cancel: () => child.kill() };
}

/** The first sentence or two of the agent's answer: what the ghost says out loud. */
export function spokenSummary(text: string, max = 220): string {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>_-]+/g, " ").replace(/\s+/g, " ").trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  let said = "";
  for (const s of sentences) {
    if ((said + s).length > max) break;
    said += s;
  }
  return (said || plain.slice(0, max)).trim();
}
