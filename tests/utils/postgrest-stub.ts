/**
 * A recording stand-in for the PostgREST query builder.
 *
 * The account-deletion and export routes fan out across ~210 tables, so the
 * thing worth asserting is not one query but the *shape of the whole
 * sequence*: which tables were touched, in what order, with which filters, and
 * that nothing kept running after a failure. This stub records every call and
 * lets a test fail an individual table so error propagation can be proven.
 *
 * Supports only what those routes use: select / update / delete, the
 * eq / is / in / not filters, `{ count, head }` selects, single(), and the
 * `rpc()` call the cascade uses for the tables `service_role` may not delete
 * from directly. An `rpc` op is recorded against the table it names, so
 * `opsFor()` / `firstSeq()` / `failOn()` reach it exactly like any other step.
 */

export type Row = Record<string, unknown>;

export type FilterOp = "eq" | "is" | "in" | "not";

export interface RecordedFilter {
  op: FilterOp;
  column: string;
  value: unknown;
}

export interface RecordedOp {
  seq: number;
  table: string;
  kind: "select" | "update" | "delete" | "rpc";
  columns?: string;
  head: boolean;
  countMode?: string;
  payload?: Row;
  filters: RecordedFilter[];
  /** `rpc` only: the function name and the arguments it was called with. */
  fn?: string;
  args?: Row;
}

export interface StubFailure {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

type Result = { data: unknown; count: number | null; error: StubFailure | null };

function matches(row: Row, filters: RecordedFilter[]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    switch (f.op) {
      case "eq":
        return actual === f.value;
      case "is":
        return f.value === null ? actual === null || actual === undefined : actual === f.value;
      case "in":
        return Array.isArray(f.value) && f.value.includes(actual);
      case "not":
        // Only `not(column, "is", null)` is used by the routes.
        return actual !== null && actual !== undefined;
      default:
        return true;
    }
  });
}

export class PostgrestStub {
  readonly ops: RecordedOp[] = [];
  private readonly rows = new Map<string, Row[]>();
  private readonly failures = new Map<string, StubFailure>();
  private seq = 0;

  setRows(table: string, rows: Row[]): this {
    this.rows.set(table, rows.map((r) => ({ ...r })));
    return this;
  }

  getRows(table: string): Row[] {
    return this.rows.get(table) ?? [];
  }

  /** Make every matching operation on `table` fail. `kind` "*" fails all kinds. */
  failOn(
    table: string,
    kind: RecordedOp["kind"] | "*",
    failure: StubFailure
  ): this {
    this.failures.set(`${kind}:${table}`, failure);
    return this;
  }

  opsFor(table: string): RecordedOp[] {
    return this.ops.filter((o) => o.table === table);
  }

  tablesTouched(): string[] {
    return [...new Set(this.ops.map((o) => o.table))];
  }

  /** Sequence number of the first op on `table`, or Infinity when untouched. */
  firstSeq(table: string, kind?: RecordedOp["kind"]): number {
    const op = this.ops.find(
      (o) => o.table === table && (kind === undefined || o.kind === kind)
    );
    return op ? op.seq : Number.POSITIVE_INFINITY;
  }

  client() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (table: string) => new StubBuilder(this, table) as any,
      rpc: (fn: string, args: Row) => this.callRpc(fn, args),
    };
  }

  /**
   * `db.rpc(fn, args)`. Modelled on `public.purge_company_rows`: it hard-deletes
   * every row of `args.p_table` whose `company_id` matches `args.p_company_id`
   * and returns the number removed, in one call — no separate count.
   *
   * Recorded against the table rather than the function so a test asserts the
   * step the same way it asserts a direct delete.
   */
  async callRpc(
    fn: string,
    args: Row
  ): Promise<{ data: unknown; error: StubFailure | null }> {
    const table = String(args.p_table ?? fn);
    this.ops.push({
      seq: this.seq++,
      table,
      kind: "rpc",
      head: false,
      filters: [],
      fn,
      args: { ...args },
    });

    const failure =
      this.failures.get(`rpc:${table}`) ?? this.failures.get(`*:${table}`);
    if (failure) return { data: null, error: failure };

    const rows = this.rows.get(table) ?? [];
    const hit = rows.filter((row) => row.company_id === args.p_company_id);
    this.rows.set(
      table,
      rows.filter((row) => !hit.includes(row))
    );
    return { data: hit.length, error: null };
  }

  /** @internal */
  run(op: RecordedOp): Result {
    op.seq = this.seq++;
    this.ops.push(op);

    const failure =
      this.failures.get(`${op.kind}:${op.table}`) ??
      this.failures.get(`*:${op.table}`);
    if (failure) return { data: null, count: null, error: failure };

    const table = this.rows.get(op.table) ?? [];
    const hit = table.filter((row) => matches(row, op.filters));

    if (op.kind === "select") {
      return {
        data: op.head ? null : hit.map((r) => ({ ...r })),
        count: op.countMode ? hit.length : null,
        error: null,
      };
    }

    if (op.kind === "update") {
      for (const row of hit) Object.assign(row, op.payload);
      return { data: null, count: op.countMode ? hit.length : null, error: null };
    }

    this.rows.set(
      op.table,
      table.filter((row) => !hit.includes(row))
    );
    return { data: null, count: op.countMode ? hit.length : null, error: null };
  }
}

class StubBuilder implements PromiseLike<Result> {
  private kind: RecordedOp["kind"] = "select";
  private columns?: string;
  private head = false;
  private countMode?: string;
  private payload?: Row;
  private readonly filters: RecordedFilter[] = [];

  constructor(
    private readonly stub: PostgrestStub,
    private readonly table: string
  ) {}

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.kind === "select") this.columns = columns;
    this.head = options?.head ?? false;
    this.countMode = options?.count;
    return this;
  }

  update(payload: Row) {
    this.kind = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.kind = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ op: "is", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  not(column: string, _operator: string, value: unknown) {
    this.filters.push({ op: "not", column, value });
    return this;
  }

  private exec(): Result {
    return this.stub.run({
      seq: -1,
      table: this.table,
      kind: this.kind,
      columns: this.columns,
      head: this.head,
      countMode: this.countMode,
      payload: this.payload,
      filters: this.filters,
    });
  }

  async single() {
    const result = this.exec();
    if (result.error) return { data: null, error: result.error };
    const rows = (result.data as Row[]) ?? [];
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { message: "no rows", code: "PGRST116" } };
  }

  async maybeSingle() {
    const result = this.exec();
    if (result.error) return { data: null, error: result.error };
    const rows = (result.data as Row[]) ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?:
      | ((value: Result) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}
