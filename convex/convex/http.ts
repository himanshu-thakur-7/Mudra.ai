// HTTP routes. The Python PyMuPDF ingestion worker POSTs structured chunks to
// /api/actions/corpus/bulkIngest; we run the corpus.bulkIngest action.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/api/actions/corpus/bulkIngest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Simple shared-secret guard; set INGEST_TOKEN via `npx convex env set`.
    const token = request.headers.get("x-ingest-token");
    if (process.env.INGEST_TOKEN && token !== process.env.INGEST_TOKEN) {
      return new Response("unauthorized", { status: 401 });
    }
    const body = await request.json();
    const result = await ctx.runAction(api.corpus.bulkIngest, { chunks: body.chunks ?? [] });
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
});

export default http;
