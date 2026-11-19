// drinkspry.com: static files from the spry-site repo; www redirects to the bare domain.
// Email sign-up added 19 Nov 2026 (written and tested 18 Nov in ops/email/capture).
// POST /        the two older forms (gym-sampling, can-feedback), stored in D1 (spry-site-forms). Unchanged,
//               except that a ticked "news" box on either form also adds the person to the email list.
// POST /signup  the email sign-up: stored in D1 first, then passed to Loops (contacts API).
// Hourly cron   retries every sign-up Loops has not taken yet.
// Secret: LOOPS_API_KEY, set in the Cloudflare dashboard only. Without it sign-ups are still stored,
//         and the hourly run sends them once the key exists.
const ALLOWED = {
  "gym-sampling": ["gym", "email", "news"],
  "can-feedback": ["rid", "step", "flavor", "overall", "buy", "sweet", "after", "replace", "freq", "where", "where_name", "email", "source", "news"],
};
const LOOPS = "https://app.loops.so/api/v1";
const ORIGIN = "https://drinkspry.com";
const SIGNUP = "email-signup"; // the form name sign-ups are stored under
const SIGNUP_KEYS = ["placement", "page", "consent", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "click_id", "landed"];
const SOURCES = { // form name -> [Loops "source", Loops "signupSource"]
  "email-signup": ["Website sign-up", "site-form"],
  "gym-sampling": ["Ask your gym form", "gym-form"],
  "can-feedback": ["Taste survey", "survey"],
};
const UTM = { utm_source: "utmSource", utm_medium: "utmMedium", utm_campaign: "utmCampaign", utm_content: "utmContent", utm_term: "utmTerm" };
const MIN_FILL_MS = 1500;  // a person cannot load the page and send the form faster than this
const HOURLY_CAP = 60;     // more sign-ups than this in an hour are stored but held back from Loops until a person looks
const SWEEP_ROWS = 15;     // per hourly run: 2 Loops calls and 1 database write a row, under the Workers free plan's 50 subrequests

const clip = (v, n = 200) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>"'`]/g, "").trim().slice(0, n);
export function cleanEmail(v) {
  const e = String(v == null ? "" : v).trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"'`,;()]+@[^\s@<>"'`,;()]+\.[a-z0-9-]{2,}$/.test(e) ? e : "";
}
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z"; // the format of submissions.created_at

// What Loops is told about a new contact. Everything goes in the one request that creates the contact,
// so a workflow's audience filter sees it (Loops docs, "Triggering workflows").
export function contactFor(form, country, f, at) {
  const [source, signupSource] = SOURCES[form];
  const c = { email: f.email, source, userGroup: "List", signupSource, signupAt: at };
  if (f.placement) c.signupPlacement = f.placement;
  if (country) c.signupCountry = country;
  for (const k in UTM) if (f[k]) c[UTM[k]] = f[k];
  return c;
}

async function loops(env, method, path, body) {
  const init = { method, headers: { Authorization: `Bearer ${env.LOOPS_API_KEY}`, Accept: "application/json" } };
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const r = await fetch(LOOPS + path, init);
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

// Returns the status kept on the row: ok:new, ok:existing, skip:unsubscribed, rejected:<code>, fail:<code>, or pending (no key yet).
export async function sendToLoops(env, form, country, f, at) {
  if (!env.LOOPS_API_KEY) return "pending";
  try {
    const found = await loops(env, "GET", `/contacts/find?email=${encodeURIComponent(f.email)}`);
    if (found.status !== 200 || !Array.isArray(found.data)) return `fail:${found.status}`;
    const had = found.data[0];
    const fresh = contactFor(form, country, f, at);
    if (!had) {
      const made = await loops(env, "POST", "/contacts/create", fresh);
      if (made.status === 200) return "ok:new";
      if (made.status === 409) return "ok:existing"; // created a moment ago by another request
      return made.status === 400 ? "rejected:400" : `fail:${made.status}`;
    }
    // Someone Loops already knows. Never re-subscribe a person who unsubscribed, never change "source",
    // never turn a Customer back into List. Only fill in what is empty.
    if (had.subscribed === false) return "skip:unsubscribed";
    const patch = { email: f.email };
    if (!had.signupAt) { const { email, source, userGroup, ...rest } = fresh; Object.assign(patch, rest); }
    if (!had.userGroup) patch.userGroup = "List";
    if (Object.keys(patch).length === 1) return "ok:existing";
    const put = await loops(env, "PUT", "/contacts/update", patch);
    if (put.status === 200) return "ok:existing";
    return put.status === 400 ? "rejected:400" : `fail:${put.status}`;
  } catch (e) {
    return "fail:network";
  }
}

async function syncRow(env, id, form, country, f, at) {
  const status = await sendToLoops(env, form, country, f, at);
  await env.FORMS.prepare("UPDATE submissions SET fields = json_set(fields, '$._loops', ?) WHERE id = ?").bind(status, id).run();
  return status;
}

async function signup(req, env, ctx) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/x-www-form-urlencoded")) return new Response("Unsupported", { status: 415 });
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return new Response("Forbidden", { status: 403 });
  const body = await req.text();
  if (body.length > 8000) return new Response("Too large", { status: 413 });
  const p = new URLSearchParams(body);
  if (p.get("bot-field")) return new Response("ok", { status: 200 }); // honeypot: accept quietly, store nothing
  const email = cleanEmail(p.get("email"));
  if (!email) return new Response("invalid", { status: 422 });

  const again = await env.FORMS.prepare("SELECT id FROM submissions WHERE form = ? AND json_extract(fields, '$.email') = ? LIMIT 1").bind(SIGNUP, email).first();
  if (again) return new Response("ok", { status: 200 }); // already stored: same answer, nothing new written

  const fields = { email };
  for (const k of SIGNUP_KEYS) { const v = clip(p.get(k)); if (v) fields[k] = v; }
  const t = parseInt(p.get("t") || "", 10);
  const hour = await env.FORMS.prepare("SELECT COUNT(*) AS n FROM submissions WHERE form = ? AND created_at > ?").bind(SIGNUP, stamp(Date.now() - 3600e3)).first();
  const cap = parseInt(env.SIGNUP_HOURLY_CAP, 10) || HOURLY_CAP;
  let hold = "";
  if (!(t >= MIN_FILL_MS)) hold = "fast";
  else if (!origin) hold = "no-origin";
  else if (hour && hour.n >= cap) hold = "cap";
  fields._loops = hold ? `held:${hold}` : "pending";

  const country = (req.cf && req.cf.country) || null;
  const row = await env.FORMS.prepare("INSERT INTO submissions (form, country, fields) VALUES (?, ?, ?)").bind(SIGNUP, country, JSON.stringify(fields)).run();
  if (!hold) {
    const job = syncRow(env, row.meta.last_row_id, SIGNUP, country, fields, stamp(Date.now()));
    if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  }
  return new Response("ok", { status: 200 }); // the visitor's answer never waits on Loops
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.hostname === "www.drinkspry.com") {
      u.hostname = "drinkspry.com";
      return Response.redirect(u.toString(), 301);
    }
    if (req.method === "POST" && u.pathname === "/signup") {
      try { return await signup(req, env, ctx); } catch (e) { return new Response("error", { status: 500 }); }
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
      // A ticked "Also send me Spry news" box (news=yes) with a usable address joins the list; no tick, no list.
      const email = fields.news === "yes" ? cleanEmail(fields.email) : "";
      if (email) fields._loops = "pending";
      const country = (req.cf && req.cf.country) || null;
      const row = await env.FORMS.prepare("INSERT INTO submissions (form, country, fields) VALUES (?, ?, ?)")
        .bind(form, country, JSON.stringify(fields)).run();
      if (email) {
        const job = syncRow(env, row.meta.last_row_id, form, country, { email }, stamp(Date.now())).catch(() => {});
        if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
      }
      return new Response("ok", { status: 200 });
    }
    return env.ASSETS.fetch(req);
  },

  // Hourly: anything stored but not yet in Loops (key added later, Loops down, rate limit) is tried again.
  // Rows marked held:, skip: or rejected: are left for a person.
  async scheduled(_event, env) {
    if (!env.LOOPS_API_KEY) return;
    const due = await env.FORMS.prepare(
      "SELECT id, form, country, created_at, fields FROM submissions WHERE created_at < ? AND (json_extract(fields, '$._loops') = 'pending' OR json_extract(fields, '$._loops') LIKE 'fail:%') ORDER BY id LIMIT ?"
    ).bind(stamp(Date.now() - 120e3), SWEEP_ROWS).all();
    for (const r of due.results || []) {
      let f; try { f = JSON.parse(r.fields); } catch (e) { continue; }
      const email = cleanEmail(f.email);
      if (!email || !SOURCES[r.form]) continue;
      await syncRow(env, r.id, r.form, r.country, { ...f, email }, r.created_at);
    }
  },
};
