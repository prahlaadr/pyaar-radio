// Server-only helpers to trigger GitHub Actions from the deployed site.
//
// Lets the /radar page kick off the radar scan and apply triage picks in the
// cloud (where the YT Music auth secret lives) without any local machine.
// Requires a fine-grained PAT in the GITHUB_DISPATCH_TOKEN env var with, on this
// repo only: Actions = Read/Write (dispatch workflows) + Contents = Read/Write
// (commit the picks file). NEVER import this into client code — the token must
// stay server-side.

const API = "https://api.github.com";

function repo(): string {
  return process.env.GITHUB_REPO || "prahlaadr/pyaar-radio";
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not configured");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

// Trigger a workflow_dispatch. `workflowFile` is the filename in
// .github/workflows (e.g. "radar-scan.yml"). Returns nothing; throws on failure.
export async function dispatchWorkflow(
  workflowFile: string,
  inputs: Record<string, string> = {},
  ref = "main",
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${repo()}/actions/workflows/${workflowFile}/dispatches`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify({ ref, inputs }) },
  );
  if (res.status !== 204) {
    throw new Error(`dispatch ${workflowFile} failed: ${res.status} ${await res.text()}`);
  }
}

// Create (or overwrite) a file on `branch` via the Contents API. Used to drop a
// picks file into triage-runs/ before dispatching triage-apply.
export async function putFile(
  path: string,
  content: string,
  message: string,
  branch = "main",
): Promise<void> {
  // Look up an existing sha so we can update rather than fail on conflict.
  let sha: string | undefined;
  const head = await fetch(
    `${API}/repos/${repo()}/contents/${encodeURIComponent(path)}?ref=${branch}`,
    { headers: authHeaders() },
  );
  if (head.status === 200) {
    sha = (await head.json())?.sha;
  }
  const res = await fetch(`${API}/repos/${repo()}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`put ${path} failed: ${res.status} ${await res.text()}`);
  }
}
