import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { env } from "../lib/env"
import * as schema from "@db/schema"
import * as relations from "@db/relations"

const fullSchema = { ...schema, ...relations }

let instance: ReturnType<typeof drizzle<typeof fullSchema>>

export function getDb() {
  if (!instance) {
    const client = postgres(env.DATABASE_URL, { prepare: false })
    instance = drizzle(client, { schema: fullSchema })
    // 设置 HNSW 搜索精度，平衡查询速度与召回率
    client.unsafe("SET hnsw.ef_search = 64").catch((err: unknown) => {
      console.error("[DB] Failed to set hnsw.ef_search:", err)
    })
  }
  return instance
}
