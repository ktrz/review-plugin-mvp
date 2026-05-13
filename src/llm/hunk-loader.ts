export interface HunkLoadResult {
  hunk: string;
  startLine: number;
  lang: string;
}

export interface HunkLoaderDeps {
  readFile: (filePath: string) => Promise<string>;
}

export interface HunkLoader {
  load(filePath: string, line: number): Promise<HunkLoadResult>;
}

export class HunkLoaderError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HunkLoaderError';
  }

  get cause(): unknown {
    return (this as unknown as { cause?: unknown }).cause;
  }
}

const SMALL_FILE_LIMIT = 200;
const WINDOW_RADIUS = 30;
const UPWARD_EXPANSION_CAP = 20;

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  go: 'go',
};

export function createHunkLoader(deps: HunkLoaderDeps): HunkLoader {
  return {
    async load(filePath, line) {
      return loadHunk(deps, filePath, line);
    },
  };
}

async function loadHunk(
  deps: HunkLoaderDeps,
  filePath: string,
  line: number,
): Promise<HunkLoadResult> {
  if (!Number.isInteger(line) || line < 1) {
    throw new HunkLoaderError(
      `line ${line} out of range (must be >= 1)`,
      filePath,
    );
  }

  let content: string;
  try {
    content = await deps.readFile(filePath);
  } catch (err) {
    throw new HunkLoaderError(
      `failed to read file ${filePath}`,
      filePath,
      { cause: err },
    );
  }

  const allLines = content.split('\n');
  const total = allLines.length;

  if (line > total) {
    throw new HunkLoaderError(
      `line ${line} out of range (file has ${total} lines)`,
      filePath,
    );
  }

  const lang = inferLang(filePath);

  if (total <= SMALL_FILE_LIMIT) {
    return { hunk: content, startLine: 1, lang };
  }

  let startIdx = Math.max(0, line - 1 - WINDOW_RADIUS);
  const endIdx = Math.min(total - 1, line - 1 + WINDOW_RADIUS);

  let expanded = 0;
  while (
    expanded < UPWARD_EXPANSION_CAP &&
    startIdx > 0 &&
    !startsAtColumnZero(allLines[startIdx])
  ) {
    startIdx -= 1;
    expanded += 1;
  }

  const sliced = allLines.slice(startIdx, endIdx + 1);
  return {
    hunk: sliced.join('\n'),
    startLine: startIdx + 1,
    lang,
  };
}

function startsAtColumnZero(line: string): boolean {
  if (line.length === 0) {
    return false;
  }
  const first = line.charAt(0);
  return first !== ' ' && first !== '\t';
}

function inferLang(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0 || idx === filePath.length - 1) {
    return 'text';
  }
  const slashIdx = Math.max(
    filePath.lastIndexOf('/'),
    filePath.lastIndexOf('\\'),
  );
  if (idx < slashIdx) {
    return 'text';
  }
  const ext = filePath.slice(idx + 1).toLowerCase();
  return LANG_BY_EXT[ext] ?? 'text';
}
