// /api/pool  -- shared state for the World Cup pool, stored in Upstash Redis.
// GET  -> { config (no passcodes), exists, roster, picks }
// POST -> { type: 'create' | 'join' | 'picks' | 'admin' | 'config-update', ... }

const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function rcmd(arr){
  const r = await fetch(RURL, {
    method: "POST",
    headers: { Authorization: "Bearer " + RTOK, "Content-Type": "application/json" },
    body: JSON.stringify(arr)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function rget(k){ const v = await rcmd(["GET", k]); return v ? JSON.parse(v) : null; }
async function rset(k, val){ return rcmd(["SET", k, JSON.stringify(val)]); }

function sanitize(cfg){
  if (!cfg) return null;
  const c = Object.assign({}, cfg);
  delete c.groupPass; delete c.adminPass;
  return c;
}
async function readJson(req){
  if (req.body){ return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body; }
  return await new Promise((resolve) => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch(e){ resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (!RURL || !RTOK){
    res.status(500).json({ error: "Database not connected yet. In Vercel, open the Storage tab, add Upstash Redis, connect it to this project, then Redeploy." });
    return;
  }
  try {
    if (req.method === "GET"){
      const config = await rget("config");
      const roster = (await rget("roster")) || [];
      const picks = {};
      for (const p of roster){ picks[p.slug] = (await rget("picks:" + p.slug)) || {}; }
      res.status(200).json({ config: sanitize(config), exists: !!config, roster, picks });
      return;
    }
    if (req.method === "POST"){
      const body = await readJson(req);
      const type = body.type;
      const config = await rget("config");

      if (type === "create"){
        if (config){ res.status(400).json({ error: "A pool already exists." }); return; }
        await rset("config", body.config);
        await rset("roster", []);
        res.status(200).json({ ok: true });
        return;
      }
      if (type === "join"){
        if (!config){ res.status(400).json({ error: "No pool yet." }); return; }
        if (body.groupPass !== config.groupPass){ res.status(401).json({ error: "Wrong group passcode." }); return; }
        let roster = (await rget("roster")) || [];
        if (!roster.find(p => p.slug === body.slug)){
          roster.push({ name: body.name, slug: body.slug });
          await rset("roster", roster);
          if (!(await rget("picks:" + body.slug))) await rset("picks:" + body.slug, {});
        }
        res.status(200).json({ ok: true, roster });
        return;
      }
      if (type === "picks"){
        if (!config){ res.status(400).json({ error: "No pool yet." }); return; }
        if (body.groupPass !== config.groupPass && body.adminPass !== config.adminPass){
          res.status(401).json({ error: "Not authorized." }); return;
        }
        await rset("picks:" + body.slug, body.picks || {});
        res.status(200).json({ ok: true });
        return;
      }
      if (type === "admin"){
        if (!config){ res.status(400).json({ error: "No pool yet." }); return; }
        if (body.adminPass !== config.adminPass){ res.status(401).json({ error: "Wrong commissioner passcode." }); return; }
        res.status(200).json({ ok: true, groupPass: config.groupPass });
        return;
      }
      if (type === "config-update"){
        if (!config){ res.status(400).json({ error: "No pool yet." }); return; }
        if (body.adminPass !== config.adminPass){ res.status(401).json({ error: "Wrong commissioner passcode." }); return; }
        const merged = Object.assign({}, config, body.config, { groupPass: config.groupPass, adminPass: config.adminPass });
        await rset("config", merged);
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: "Unknown action." });
      return;
    }
    res.status(405).json({ error: "Method not allowed." });
  } catch (e){
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
