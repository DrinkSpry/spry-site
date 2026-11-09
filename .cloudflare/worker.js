// drinkspry.com: static files from the spry-site repo; www redirects to the bare domain.
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.hostname === "www.drinkspry.com") {
      u.hostname = "drinkspry.com";
      return Response.redirect(u.toString(), 301);
    }
    return env.ASSETS.fetch(req);
  },
};
