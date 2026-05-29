import { Context } from "@netlify/functions";

export function wrapVercelHandler(
  handler: (req: any, res: any) => Promise<any>,
  options: { isScheduled?: boolean } = {}
) {
  return async (req: Request, context: Context): Promise<Response> => {
    // 1. Read request body if present
    let body: any = null;
    const contentType = req.headers.get("content-type") || "";
    
    // Only attempt to read body if there is one
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      try {
        if (contentType.includes("application/json")) {
          body = await req.json();
        } else {
          body = await req.text();
        }
      } catch (e) {
        console.warn("Failed to parse request body:", e);
      }
    }

    // 2. Parse query parameters
    const url = new URL(req.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    // 3. Prepare headers
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Automatically inject cron authorization header for Netlify scheduled executions
    if (options.isScheduled && process.env.CRON_SECRET) {
      headers["authorization"] = `Bearer ${process.env.CRON_SECRET}`;
    }

    const mockReq = {
      method: req.method,
      headers,
      query,
      body,
    };

    let responseStatus = 200;
    let responseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let responseBody: any = "";

    const mockRes = {
      status(code: number) {
        responseStatus = code;
        return mockRes;
      },
      json(data: any) {
        responseHeaders["Content-Type"] = "application/json";
        responseBody = JSON.stringify(data);
      },
      send(data: string) {
        responseHeaders["Content-Type"] = "text/plain";
        responseBody = data;
      },
    };

    try {
      await handler(mockReq as any, mockRes as any);
    } catch (err: any) {
      console.error("Netlify wrapped handler error:", err);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: err.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(responseBody, {
      status: responseStatus,
      headers: responseHeaders,
    });
  };
}
