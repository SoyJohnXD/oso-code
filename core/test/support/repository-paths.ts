import path from "node:path";
import { repositoryRoot } from "./state-sandbox.ts";

export function posixSpelled(nativePath: string): string {
  return nativePath.replaceAll(path.sep, "/");
}

export function posixRelativeTo(root: string, target: string): string {
  return posixSpelled(path.relative(root, target));
}

export function posixRepositoryPath(target: string): string {
  return posixRelativeTo(repositoryRoot, target);
}
