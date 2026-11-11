// drinkspry.com: static files from the spry-site repo; www redirects to the bare domain.
// POST / takes the site's two forms (gym-sampling, can-feedback) and stores them in D1 (spry-site-forms).
// The forms posted to Netlify Forms until the 9 Nov move to Cloudflare; this replaces that.
const ALLOWED = {
  "gym-sampling": ["gym", "email"],
  "can-feedback": ["rid", "step", "flavor", "overall", "buy", "sweet", "after", "replace", "freq", "where", "where_name", "email", "source"],
};
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.hostname === "www.drinkspry.com") {
      u.hostname = "drinkspry.com";
      return Response.redirect(u.toString(), 301);
    }
    if (req.method === "POST" && u.pathname === "/") {
      const ct = req.headers.get("content-type") || "";
      if (!ct.includes("application/x-www-form-urlencoded")) return new Response("Unsupported", { status: 415 });
      const body = await req.text();
      if (body.length > 8000) return new Response("Too large", { status: 413 });
      const p = new URLSearchParams(body);
      const form = p.get("form-name") || "";
      const keys = ALLOWED[form];
      if (!keys) return new Response("Unknown form", { status: 400 });
      if (p.get("bot-field")) return new Response("ok", { status: 200 }); // honeypot: accept quietly, store nothing
      const fields = {};
      for (const k of keys) { const v = p.get(k); if (v != null && v !== "") fields[k] = String(v).slice(0, 500); }
      await env.FORMS.prepare("INSERT INTO submissions (form, country, fields) VALUES (?, ?, ?)")
        .bind(form, (req.cf && req.cf.country) || null, JSON.stringify(fields)).run();
      return new Response("ok", { status: 200 });
    }
    return env.ASSETS.fetch(req);
  },
};
