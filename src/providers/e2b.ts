import { Sandbox } from "@e2b/code-interpreter";
import { config } from "../config.js";
import { keyPool } from "../lib/key-pool.js";

export interface CodeExecutionRequest {
  code: string;
  language: "python" | "javascript" | "bash" | "r";
  timeout?: number;
  files?: Array<{ path: string; content: string }>;
}

export interface CodeExecutionResponse {
  stdout: string;
  stderr: string;
  exit_code: number;
  execution_time_ms: number;
  outputs?: Array<{ type: string; data: any }>;
}

export async function executeCode(req: CodeExecutionRequest): Promise<CodeExecutionResponse> {
  const apiKey = keyPool.acquire("e2b");
  if (!apiKey) {
    throw Object.assign(new Error("E2B not configured"), { status: 502 });
  }

  const maxTimeout = config.computeProviders.e2b.maxTimeout;
  const timeout = Math.min(req.timeout || config.computeProviders.e2b.defaultTimeout, maxTimeout);
  const startTime = Date.now();

  const sandbox = await Sandbox.create({
    timeoutMs: timeout * 1000,
    apiKey,
  });

  try {
    // Write any input files
    if (req.files) {
      for (const file of req.files) {
        await sandbox.files.write(file.path, file.content);
      }
    }

    let result: any;
    if (req.language === "bash") {
      const cmdResult = await sandbox.commands.run(req.code);
      return {
        stdout: cmdResult.stdout,
        stderr: cmdResult.stderr,
        exit_code: cmdResult.exitCode,
        execution_time_ms: Date.now() - startTime,
      };
    }

    // Python, JavaScript, R via code interpreter
    const langMap: Record<string, string> = {
      python: "python",
      javascript: "javascript",
      r: "r",
    };

    result = await sandbox.runCode(req.code, {
      language: langMap[req.language] as any,
    });

    return {
      stdout: result.logs?.stdout?.join("\n") || result.text || "",
      stderr: result.logs?.stderr?.join("\n") || "",
      exit_code: result.error ? 1 : 0,
      execution_time_ms: Date.now() - startTime,
      outputs: result.results?.map((r: any) => ({
        type: r.type,
        data: r.data,
      })),
    };
  } finally {
    await sandbox.kill();
  }
}
