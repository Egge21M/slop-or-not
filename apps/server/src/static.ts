import { resolve, sep } from "node:path";
export async function serveWeb(request: Request, directory: string) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Not found", { status: 404 });
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  const root = resolve(directory);
  const path = resolve(root, `.${pathname}`);
  if (path !== root && !path.startsWith(root + sep))
    return new Response("Not found", { status: 404 });
  let file = Bun.file(path);
  if (pathname === "/" || !(await file.exists())) {
    if (pathname !== "/" && pathname.split("/").at(-1)?.includes("."))
      return new Response("Not found", { status: 404 });
    file = Bun.file(resolve(root, "index.html"));
  }
  if (!(await file.exists()))
    return new Response(
      "Build the frontend with bun run build before starting production.",
      { status: 503 },
    );
  return new Response(request.method === "HEAD" ? null : file, {
    headers: {
      "content-type": file.type,
      "cache-control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}
