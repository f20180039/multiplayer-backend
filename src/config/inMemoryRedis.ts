type HashValue = Record<string, string>;

const globToRegExp = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")}$`
  );

export class InMemoryRedis {
  private values = new Map<string, string>();
  private hashes = new Map<string, HashValue>();
  private lists = new Map<string, string[]>();

  async connect() {
    return this;
  }

  duplicate() {
    return this;
  }

  async disconnect() {
    return undefined;
  }

  async quit() {
    return undefined;
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }

  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) deleted += 1;
      if (this.hashes.delete(key)) deleted += 1;
      if (this.lists.delete(key)) deleted += 1;
    }
    return deleted;
  }

  async hGet(key: string, field: string) {
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hGetAll(key: string) {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async hSet(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? {};
    hash[field] = value;
    this.hashes.set(key, hash);
    return 1;
  }

  async hDel(key: string, field: string) {
    const hash = this.hashes.get(key);
    if (!hash || !(field in hash)) return 0;

    delete hash[field];
    this.hashes.set(key, hash);
    return 1;
  }

  async rPush(key: string, value: string) {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }

  async lRange(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];
    const normalizedStart = start < 0 ? Math.max(list.length + start, 0) : start;
    const normalizedStop = stop < 0 ? list.length + stop : stop;
    return list.slice(normalizedStart, normalizedStop + 1);
  }

  async lTrim(key: string, start: number, stop: number) {
    const trimmed = await this.lRange(key, start, stop);
    this.lists.set(key, trimmed);
    return "OK";
  }

  async keys(pattern: string) {
    const matcher = globToRegExp(pattern);
    const allKeys = new Set([
      ...this.values.keys(),
      ...this.hashes.keys(),
      ...this.lists.keys(),
    ]);
    return [...allKeys].filter((key) => matcher.test(key));
  }
}
