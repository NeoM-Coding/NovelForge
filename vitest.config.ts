import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".worktrees/**"],
  },
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
      "@contracts/": new URL("./contracts/", import.meta.url).pathname,
      "@db/": new URL("./db/", import.meta.url).pathname,
      "db": new URL("./db/", import.meta.url).pathname,
    },
  },
})
