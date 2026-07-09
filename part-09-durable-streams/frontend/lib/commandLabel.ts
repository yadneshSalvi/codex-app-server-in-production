// Commands arrive as the full shell invocation — `/bin/zsh -lc 'ls -la'`
// on macOS. Unwrap the shell so labels and the expanded view show what
// the agent actually asked for.
export function unwrapShell(command: string): string {
  const match = command.match(/^\S*\/(?:zsh|bash|sh) -lc ([\s\S]*)$/);
  if (!match) return command;
  const inner = match[1];
  if (inner.startsWith("'") && inner.endsWith("'")) {
    return inner.slice(1, -1).replace(/'\\''/g, "'");
  }
  return inner;
}

// One friendly line per command for the collapsed badge. The default
// branch matters most: a command this map has never heard of still
// reads as itself, so nothing in later parts needs edits here.
export function commandLabel(command: string): string {
  const cmd = unwrapShell(command);
  const words = cmd.split(/\s+/);
  const head = words[0] === "sudo" ? words[1] : words[0];
  switch (head) {
    case "ls":
    case "rg":
    case "find":
      return "Listing files";
    case "cat":
    case "head":
    case "tail":
      return `Reading ${basename(words[words.length - 1])}`;
    case "mkdir":
      return `Creating folder ${basename(words[words.length - 1])}`;
    case "touch":
      return `Creating ${basename(words[words.length - 1])}`;
    case "rm":
      return `Removing ${basename(words[words.length - 1])}`;
    case "mv":
    case "cp":
      return `Moving ${basename(words[1] ?? "")}`;
    case "pwd":
      return "Checking the working directory";
    case "echo":
    case "printf":
      return "Printing output";
    case "python":
    case "python3":
    case "node":
      return "Running a script";
    case "npx":
      return `Running ${words[1] ?? "npx"}`;
    case "git":
      return `Running git ${words[1] ?? ""}`.trim();
    default:
      return `Running: ${cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd}`;
  }
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}
