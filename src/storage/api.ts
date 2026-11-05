import type { SavedProjectFile } from '../model/types';

export interface ServerStatus {
  app: 'schedrift';
  mpp: boolean;
  java: { major: number; source: string } | null;
  mpxj: boolean;
}

export interface SavedProjectSummary {
  id: string;
  name: string;
  sourceFileName: string;
  savedAt: string;
  scenarioItems: number;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function getStatus(): Promise<ServerStatus | null> {
  try {
    return await json<ServerStatus>(await fetch('/api/status'));
  } catch {
    return null;
  }
}

/** Sends a project file to the local server; .mpp/.mpx are converted to MSPDI XML with MPXJ. */
export async function convertFile(file: File): Promise<string> {
  const res = await fetch(`/api/import?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  return (await json<{ xml: string }>(res)).xml;
}

export async function listProjects(): Promise<SavedProjectSummary[]> {
  try {
    return (await json<{ projects: SavedProjectSummary[] }>(await fetch('/api/projects'))).projects;
  } catch {
    return [];
  }
}

export async function loadProject(id: string): Promise<SavedProjectFile> {
  return json<SavedProjectFile>(await fetch(`/api/projects/${encodeURIComponent(id)}`));
}

export async function saveProject(file: SavedProjectFile): Promise<void> {
  await json(await fetch(`/api/projects/${encodeURIComponent(file.project.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(file),
  }));
}

export async function deleteProject(id: string): Promise<void> {
  await json(await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
