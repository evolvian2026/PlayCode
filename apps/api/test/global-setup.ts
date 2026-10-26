import pg from "pg";
import { BASE_URL, baseName, RUN, WORKERS, workerUrl } from "./databases";

const quote = (name: string) => `"${name.replace(/"/g, "")}"`;

async function admin() {
  const url = new URL(BASE_URL);
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Create this run's worker databases (needs CREATEDB), after dropping any left by runs that crashed. */
export default async function setup() {
  const client = await admin();
  try {
    const { rows } = await client.query<{ datname: string }>("select datname from pg_database where datname like $1", [`${baseName()}_r%`]);
    for (const { datname } of rows) {
      const pid = Number(datname.slice(baseName().length + 2).split("_")[0]);
      if (pid && pid !== Number(RUN) && !alive(pid)) await client.query(`drop database if exists ${quote(datname)} with (force)`);
    }
    for (let i = 1; i <= WORKERS; i++) await client.query(`create database ${quote(new URL(workerUrl(i)).pathname.slice(1))}`);
  } finally {
    await client.end();
  }
  return async function teardown() {
    const c = await admin();
    try {
      for (let i = 1; i <= WORKERS; i++) await c.query(`drop database if exists ${quote(new URL(workerUrl(i)).pathname.slice(1))} with (force)`);
    } finally {
      await c.end();
    }
  };
}
