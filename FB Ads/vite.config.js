import { defineConfig } from "vite";

const allowedHosts = new Set(["s.shopee.vn", "shopee.vn", "www.shopee.vn"]);

function resolveUrlPlugin() {
  return {
    name: "adsflow-local-api",
    configureServer(server) {
      server.middlewares.use("/api/resolve-url", async (request, response) => {
        try {
          const requestUrl = new URL(request.url, "http://localhost");
          const target = new URL(requestUrl.searchParams.get("url") || "");

          if (!["http:", "https:"].includes(target.protocol) || !allowedHosts.has(target.hostname)) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "URL không được hỗ trợ." }));
            return;
          }

          const result = await fetch(target, {
            redirect: "follow",
            headers: { "user-agent": "Mozilla/5.0" },
          });

          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ url: result.url }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error.message }));
        }
      });
      server.middlewares.use("/api/meta/long-lived-token", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: "Phương thức không được hỗ trợ." }));
          return;
        }

        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 200000) throw new Error("Dữ liệu gửi lên quá lớn.");
          }
          const { appId, appSecret, shortLivedToken } = JSON.parse(body || "{}");
          if (!appId || !appSecret || !shortLivedToken) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Thiếu App ID, App Secret hoặc User Token." }));
            return;
          }

          const endpoint = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
          endpoint.searchParams.set("grant_type", "fb_exchange_token");
          endpoint.searchParams.set("client_id", String(appId).trim());
          endpoint.searchParams.set("client_secret", String(appSecret).trim());
          endpoint.searchParams.set("fb_exchange_token", String(shortLivedToken).trim());

          const metaResponse = await fetch(endpoint);
          const data = await metaResponse.json();
          if (!metaResponse.ok || data.error) {
            response.statusCode = metaResponse.status || 400;
            response.end(
              JSON.stringify({
                error: data.error?.message || "Meta không đổi được Long-lived Token.",
              }),
            );
            return;
          }

          response.end(
            JSON.stringify({
              accessToken: data.access_token,
              tokenType: data.token_type,
              expiresIn: data.expires_in,
            }),
          );
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [resolveUrlPlugin()],
});
