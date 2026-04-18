export type FormPathSegment = string | number;
export type FormPath = readonly FormPathSegment[];

export function pathToKey(path: FormPath): string {
  return path.map(String).join(".");
}

export function getAtPath(root: unknown, path: FormPath): unknown {
  if (path.length === 0) return root;
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function isPresentAtPath(root: unknown, path: FormPath): boolean {
  if (path.length === 0) return root !== undefined;
  let current: unknown = root;
  for (let i = 0; i < path.length; i += 1) {
    if (current === null || current === undefined) return false;
    const segment = path[i];
    const isLeaf = i === path.length - 1;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return false;
      if (segment < 0 || segment >= current.length) return false;
      if (isLeaf) return true;
      current = current[segment];
      continue;
    }
    if (typeof current !== "object" || Array.isArray(current)) return false;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return false;
    if (isLeaf) return true;
    current = record[segment];
  }
  return false;
}

export function ensureAtPath(
  root: unknown,
  path: FormPath,
  value: unknown,
): unknown {
  return isPresentAtPath(root, path) ? root : setAtPath(root, path, value);
}

export function setAtPath(
  root: unknown,
  path: FormPath,
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (typeof head === "number") {
    const list = Array.isArray(root) ? [...root] : [];
    list[head] = setAtPath(list[head], tail, value);
    return list;
  }
  const record =
    root !== null && typeof root === "object" && !Array.isArray(root)
      ? { ...(root as Record<string, unknown>) }
      : {};
  record[head] = setAtPath(record[head], tail, value);
  return record;
}

export function removeAtPath(root: unknown, path: FormPath): unknown {
  if (path.length === 0) return undefined;
  const [head, ...tail] = path;
  if (typeof head === "number") {
    if (!Array.isArray(root)) return root;
    const list = [...root];
    if (tail.length === 0) {
      if (head < 0 || head >= list.length) return root;
      list.splice(head, 1);
      return list;
    }
    list[head] = removeAtPath(list[head], tail);
    return list;
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return root;
  }
  const record = { ...(root as Record<string, unknown>) };
  if (tail.length === 0) {
    if (!Object.prototype.hasOwnProperty.call(record, head)) return root;
    delete record[head];
    return record;
  }
  if (!Object.prototype.hasOwnProperty.call(record, head)) return root;
  record[head] = removeAtPath(record[head], tail);
  return record;
}
