import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

function quoteIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function topologicalOrder(tables) {
  const names = new Set(tables.map((table) => table.name));
  const outgoing = new Map([...names].map((name) => [name, new Set()]));
  const indegree = new Map([...names].map((name) => [name, 0]));

  for (const table of tables) {
    for (const foreignKey of table.foreignKeys) {
      const parent = foreignKey.table;
      if (!names.has(parent) || parent === table.name) continue;
      if (!outgoing.get(parent).has(table.name)) {
        outgoing.get(parent).add(table.name);
        indegree.set(table.name, indegree.get(table.name) + 1);
      }
    }
  }

  const ready = [...indegree].filter(([, count]) => count === 0).map(([name]) => name).sort();
  const ordered = [];
  while (ready.length) {
    const name = ready.shift();
    ordered.push(name);
    for (const child of [...outgoing.get(name)].sort()) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  return {
    ordered,
    cyclicTables: [...indegree].filter(([, count]) => count > 0).map(([name]) => name).sort(),
  };
}

function sqliteFeatures(sql) {
  const source = String(sql || "");
  const checks = [
    ["AUTOINCREMENT", /\bAUTOINCREMENT\b/i],
    ["NOCASE collation", /\bCOLLATE\s+NOCASE\b/i],
    ["WITHOUT ROWID", /\bWITHOUT\s+ROWID\b/i],
    ["STRICT tables", /\)\s*STRICT\b/i],
    ["generated columns", /\bGENERATED\s+(?:ALWAYS\s+)?AS\b/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

/**
 * Read-only inventory of the configured SQLite database before a future
 * PostgreSQL migration. No PII values or row contents are exported.
 */
export function buildSqlitePostgresPreflight(databasePath) {
  const absolutePath = resolve(databasePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`SQLite database file does not exist: ${absolutePath}`);
  }

  const fileBytes = statSync(absolutePath).size;
  const database = new DatabaseSync(absolutePath, { readOnly: true, timeout: 5000 });
  try {
    const integrityMessages = database.prepare("PRAGMA integrity_check").all()
      .map((row) => String(row.integrity_check || Object.values(row)[0] || ""));
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all()
      .map((row) => ({
        table: String(row.table),
        rowid: row.rowid === null ? null : Number(row.rowid),
        parent: String(row.parent),
        constraint: Number(row.fkid),
      }));

    const masterRows = database.prepare(`
      SELECT type,name,tbl_name,sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type,name
    `).all();

    const tableRows = masterRows.filter((row) => row.type === "table");
    const tables = tableRows.map((row) => {
      const name = String(row.name);
      const quoted = quoteIdentifier(name);
      const columns = database.prepare(`PRAGMA table_info(${quoted})`).all().map((column) => ({
        name: String(column.name),
        type: String(column.type || ""),
        notNull: Boolean(column.notnull),
        primaryKeyOrder: Number(column.pk || 0),
        defaultExpression: column.dflt_value === null ? null : String(column.dflt_value),
      }));
      const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoted})`).all().map((key) => ({
        table: String(key.table),
        from: String(key.from),
        to: String(key.to),
        onUpdate: String(key.on_update),
        onDelete: String(key.on_delete),
        match: String(key.match),
      }));
      const indexes = database.prepare(`PRAGMA index_list(${quoted})`).all().map((index) => {
        const indexName = String(index.name);
        const indexSql = masterRows.find((item) => item.type === "index" && item.name === indexName)?.sql || null;
        const indexColumns = database.prepare(`PRAGMA index_info(${quoteIdentifier(indexName)})`).all()
          .map((column) => ({
            name: column.name === null ? null : String(column.name),
            sequence: Number(column.seqno),
            expression: Number(column.cid) === -2,
          }));
        return {
          name: indexName,
          unique: Boolean(index.unique),
          origin: String(index.origin || ""),
          partial: Boolean(index.partial),
          columns: indexColumns,
          sql: indexSql === null ? null : String(indexSql),
        };
      });
      const count = database.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get();
      return {
        name,
        rowCount: Number(count.count),
        columns,
        foreignKeys,
        indexes,
        sqliteFeatures: sqliteFeatures(row.sql),
      };
    });

    const dependency = topologicalOrder(tables);
    const pageCount = Number(database.prepare("PRAGMA page_count").get().page_count || 0);
    const pageSize = Number(database.prepare("PRAGMA page_size").get().page_size || 0);
    const sqliteVersion = String(database.prepare("SELECT sqlite_version() AS version").get().version);
    const totalRows = tables.reduce((sum, table) => sum + table.rowCount, 0);
    const indexCount = tables.reduce((sum, table) => sum + table.indexes.length, 0);

    const warnings = [];
    if (integrityMessages.some((message) => message !== "ok")) {
      warnings.push("SQLite integrity_check reported one or more problems. Resolve these before copying data.");
    }
    if (foreignKeyViolations.length) {
      warnings.push("SQLite foreign_key_check found violations. Resolve them before copying data.");
    }
    if (dependency.cyclicTables.length) {
      warnings.push("The schema contains cyclic foreign-key dependencies; the PostgreSQL import must defer or stage those constraints.");
    }
    const featureCounts = new Map();
    for (const table of tables) {
      for (const feature of table.sqliteFeatures) {
        featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
      }
    }
    for (const [feature, count] of featureCounts) {
      warnings.push(`${feature} appears in ${count} table definition(s) and needs explicit PostgreSQL mapping.`);
    }

    return {
      reportVersion: 1,
      generatedAt: new Date().toISOString(),
      source: {
        engine: "sqlite",
        fileName: basename(absolutePath),
        fileBytes,
        pageCount,
        pageSize,
        logicalSizeBytes: pageCount * pageSize,
        sqliteVersion,
      },
      integrity: {
        ok: integrityMessages.length > 0 && integrityMessages.every((message) => message === "ok"),
        messages: integrityMessages,
        foreignKeyViolationCount: foreignKeyViolations.length,
        foreignKeyViolations: foreignKeyViolations.slice(0, 50),
        foreignKeyViolationsTruncated: foreignKeyViolations.length > 50,
      },
      summary: {
        tableCount: tables.length,
        rowCount: totalRows,
        indexCount,
        viewCount: masterRows.filter((row) => row.type === "view").length,
        triggerCount: masterRows.filter((row) => row.type === "trigger").length,
        cyclicForeignKeyTables: dependency.cyclicTables,
      },
      insertionOrder: dependency.ordered,
      tables,
      warnings,
    };
  } finally {
    database.close();
  }
}

function parseArgs(args) {
  const parsed = { databasePath: process.env.DATABASE_PATH || "./data/secureid.sqlite", format: "text" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--database") {
      if (!args[index + 1]) throw new Error("--database requires a file path.");
      parsed.databasePath = args[++index];
    } else if (args[index] === "--format") {
      if (!["json", "text"].includes(args[index + 1])) throw new Error("--format must be json or text.");
      parsed.format = args[++index];
    } else if (args[index] === "--help") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  return parsed;
}

function printText(report) {
  console.log("SecureID SQLite → PostgreSQL migration preflight");
  console.log(`SQLite ${report.source.sqliteVersion} · file ${report.source.fileName}`);
  console.log(`Database size: ${report.source.logicalSizeBytes} bytes · file bytes: ${report.source.fileBytes}`);
  console.log(`Tables: ${report.summary.tableCount} · rows: ${report.summary.rowCount} · indexes: ${report.summary.indexCount}`);
  console.log(`Views: ${report.summary.viewCount} · triggers: ${report.summary.triggerCount}`);
  console.log(`Integrity check: ${report.integrity.ok ? "PASS" : "FAIL"}`);
  console.log(`Foreign-key violations: ${report.integrity.foreignKeyViolationCount}`);
  console.log(`Dependency order: ${report.insertionOrder.length}/${report.summary.tableCount} tables`);
  if (report.summary.cyclicForeignKeyTables.length) {
    console.log(`Cyclic tables: ${report.summary.cyclicForeignKeyTables.join(", ")}`);
  }
  if (report.warnings.length) {
    console.log("Migration warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
  console.log("No row values or personal data were read into the report.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: npm run db:preflight -- [--database <sqlite-file>] [--format text|json]");
    return;
  }
  const report = buildSqlitePostgresPreflight(options.databasePath);
  if (options.format === "json") console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (!report.integrity.ok || report.integrity.foreignKeyViolationCount > 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`PostgreSQL migration preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
