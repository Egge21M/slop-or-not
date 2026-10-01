import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
const target = "http://localhost:3000"
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  build: { target: "chrome154" },
  server: {
    proxy: Object.fromEntries(
      ["/api", "/mcp", "/health"].map((path) => [
        path,
        {
          target,
          changeOrigin: true,
          configure(proxy) {
            proxy.on("proxyReq", (proxyRequest) => {
              if (proxyRequest.getHeader("origin"))
                proxyRequest.setHeader("origin", target)
            })
          },
        },
      ])
    ),
  },
})
