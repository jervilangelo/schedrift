import type { Project, SavedProjectFile, Scenario } from '../model/types';

export function toSavedFile(project: Project, scenario: Scenario): SavedProjectFile {
  return { format: 'schedrift-project', version: 1, savedAt: new Date().toISOString(), project, scenario };
}

/** Parses and sanity-checks a .schedrift.json file. Throws with a readable message. */
export function parseSavedFile(text: string): SavedProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const f = data as Partial<SavedProjectFile>;
  if (f?.format !== 'schedrift-project' || f.version !== 1 || !f.project || !Array.isArray(f.project.tasks)) {
    throw new Error('This is not a Schedrift project file.');
  }
  return { ...f, scenario: f.scenario ?? { items: [] } } as SavedProjectFile;
}

export function downloadFile(name: string, content: string, type = 'application/json'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
